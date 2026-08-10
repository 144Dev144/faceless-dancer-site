import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AlertTriangle, CheckCircle2, Database, Download, FileVideo, LoaderCircle, Play, RotateCcw, Upload, Video } from "lucide-preact";
import type { DanceMotionClip, DanceMotionJob } from "@faceless/shared";
import { processDanceVideo } from "../../game/dance-engine/poseProcessor";
import { DEFAULT_POSE_CAPTURE_QUALITY, type PoseCaptureQuality } from "../../game/dance-engine/poseCaptureConfig";

const JOB_STORAGE_KEY = "faceless-dance-motion-last-job";
const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 180;

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name);
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  return body as T;
}

interface DanceMotionCapturePanelProps {
  motionApplied: boolean;
  onMotionClip: (clip: DanceMotionClip | null) => void;
  onJob?: (job: DanceMotionJob | null) => void;
  onApplyMotion: () => void;
  onUseProcedural: () => void;
}

export function DanceMotionCapturePanel({
  motionApplied,
  onMotionClip,
  onJob,
  onApplyMotion,
  onUseProcedural
}: DanceMotionCapturePanelProps): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [job, setJob] = useState<DanceMotionJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [captureQuality, setCaptureQuality] = useState<PoseCaptureQuality>(DEFAULT_POSE_CAPTURE_QUALITY);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);
  const wireframeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const jobId = window.localStorage.getItem(JOB_STORAGE_KEY);
    if (!jobId) return;
    void fetch(`/api/dance-motion/jobs/${encodeURIComponent(jobId)}`, { credentials: "include" })
      .then((response) => readJson<{ job: DanceMotionJob }>(response))
      .then(async ({ job: restored }) => {
        setJob(restored);
        onJob?.(restored);
        const artifact = restored.artifacts.find((item) => item.kind === "canonical-motion");
        if (!artifact) return;
        const response = await fetch(artifact.url, { credentials: "include" });
        const clip = await readJson<DanceMotionClip>(response);
        onMotionClip(clip);
      })
      .catch(() => window.localStorage.removeItem(JOB_STORAGE_KEY));
  }, [onJob, onMotionClip]);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  const chooseFile = (nextFile: File | null) => {
    if (!nextFile) return;
    if (!isVideoFile(nextFile)) {
      setMessage("Choose a video file containing one full-body dancer.");
      return;
    }
    if (nextFile.size > MAX_VIDEO_BYTES) {
      setMessage(`This test client accepts videos up to ${formatBytes(MAX_VIDEO_BYTES)}.`);
      return;
    }
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setFile(nextFile);
    setSourceUrl(URL.createObjectURL(nextFile));
    setMessage(null);
    setJob(null);
    onJob?.(null);
    onMotionClip(null);
    onUseProcedural();
  };

  const updateJob = async (jobId: string, update: Record<string, unknown>) => {
    const response = await fetch(`/api/dance-motion/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(update)
    });
    const result = await readJson<{ job: DanceMotionJob }>(response);
    setJob(result.job);
    return result.job;
  };

  const reportJob = async (jobId: string, update: Record<string, unknown>) => {
    await fetch(`/api/dance-motion/jobs/${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(update)
    });
  };

  const process = async () => {
    if (!file || !sourceVideoRef.current || !wireframeCanvasRef.current || busy) return;
    setBusy(true);
    setMessage(null);
    let activeJobId: string | null = null;
    try {
      const form = new FormData();
      form.append("video", file, file.name);
      const uploadResponse = await fetch("/api/dance-motion/jobs", { method: "POST", body: form, credentials: "include" });
      const uploaded = await readJson<{ job: DanceMotionJob }>(uploadResponse);
      activeJobId = uploaded.job.id;
      setJob(uploaded.job);
      onJob?.(uploaded.job);
      window.localStorage.setItem(JOB_STORAGE_KEY, uploaded.job.id);
      await updateJob(uploaded.job.id, { status: "processing", progress: 1, stage: "Preparing video frames." });
      const video = sourceVideoRef.current;
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("The video duration could not be read.");
      if (video.duration > MAX_VIDEO_SECONDS) throw new Error(`Keep test clips under ${MAX_VIDEO_SECONDS} seconds.`);
      let lastReported = 1;
      const result = await processDanceVideo(video, wireframeCanvasRef.current, { fileName: file.name, mimeType: file.type || "video/*" }, {
        onProgress: (progress, stage) => {
          setJob((current) => current ? { ...current, status: "processing", progress, stage, updatedAt: new Date().toISOString() } : current);
          if (progress < 100 && progress - lastReported >= 5) {
            lastReported = progress;
            void reportJob(uploaded.job.id, { status: "processing", progress, stage }).catch(() => undefined);
          }
        }
      }, { quality: captureQuality });
      const resultForm = new FormData();
      resultForm.append("rawPoseJson", JSON.stringify(result.rawPose));
      resultForm.append("filteredPoseJson", JSON.stringify(result.filteredPose));
      resultForm.append("depthResolvedPoseJson", JSON.stringify(result.depthResolvedPose));
      resultForm.append("canonicalMotionJson", JSON.stringify(result.canonicalMotion));
      resultForm.append("diagnosticsJson", JSON.stringify(result.diagnostics));
      if (result.wireframeVideo) resultForm.append("wireframeVideo", result.wireframeVideo, "wireframe-review.webm");
      const resultResponse = await fetch(`/api/dance-motion/jobs/${encodeURIComponent(uploaded.job.id)}/result`, {
        method: "POST",
        body: resultForm,
        credentials: "include"
      });
      const completed = await readJson<{ job: DanceMotionJob }>(resultResponse);
      setJob(completed.job);
      onJob?.(completed.job);
      onMotionClip(result.canonicalMotion);
      setMessage("Pose data and wireframe review are ready.");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "The dance video could not be processed.";
      setMessage(errorMessage);
      if (activeJobId) void updateJob(activeJobId, { status: "failed", stage: "Processing failed.", error: errorMessage }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const sourceArtifact = job?.artifacts.find((artifact) => artifact.kind === "source-video");
  const wireframeArtifact = job?.artifacts.find((artifact) => artifact.kind === "wireframe-video");
  const canonicalArtifact = job?.artifacts.find((artifact) => artifact.kind === "canonical-motion");
  const rawArtifact = job?.artifacts.find((artifact) => artifact.kind === "raw-pose");
  const filteredArtifact = job?.artifacts.find((artifact) => artifact.kind === "filtered-pose");
  const depthResolvedArtifact = job?.artifacts.find((artifact) => artifact.kind === "depth-resolved-pose");
  const diagnosticsArtifact = job?.artifacts.find((artifact) => artifact.kind === "diagnostics");

  return (
    <section className="dance-motion-capture" aria-labelledby="dance-motion-capture-title">
      <div className="dance-motion-capture__heading">
        <div>
          <span className="dance-engine-eyebrow"><Video size={14} aria-hidden="true" /> Motion capture test</span>
          <h2 id="dance-motion-capture-title">Turn a full-body dance video into a motion asset</h2>
          <p>Upload one dancer, inspect the extracted wireframe, and keep the raw pose data beside the cleaned canonical clip.</p>
        </div>
        <div className="dance-motion-capture__format"><Database size={16} aria-hidden="true" /><span>Local test storage</span><small>Up to 180 seconds</small></div>
      </div>
      <div className="dance-motion-capture__grid">
        <div className="dance-motion-capture__input-column">
          <label className={`dance-motion-dropzone${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer?.files[0] ?? null); }}>
            <input type="file" accept="video/*" onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)} />
            <Upload size={20} aria-hidden="true" />
            <strong>{file ? file.name : "Drop a dance video here"}</strong>
            <span>{file ? `${formatBytes(file.size)} · ready to process` : "or choose a video from this device"}</span>
          </label>
          <div className="dance-motion-capture__actions">
            <button type="button" className="primary" disabled={!file || busy} onClick={() => void process()}>{busy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Processing</> : <><FileVideo size={15} aria-hidden="true" /> Extract pose</>}</button>
            <label className="dance-motion-quality-control"><span>Capture model</span><select value={captureQuality} disabled={busy} onChange={(event) => setCaptureQuality(event.currentTarget.value as PoseCaptureQuality)}><option value="full">Full · recommended</option><option value="heavy">Heavy · highest quality</option><option value="lite">Lite · fastest fallback</option></select></label>
            {job?.status === "completed" ? <span className="dance-motion-complete"><CheckCircle2 size={15} aria-hidden="true" /> Complete</span> : null}
          </div>
          <p className="dance-motion-capture__hint">Best results come from a single full-body subject, a mostly fixed camera, and enough space to see both feet and hands.</p>
          {message ? <p className={`dance-motion-capture__message${job?.status === "failed" ? " is-error" : ""}`} role="status">{job?.status === "failed" ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}{message}</p> : null}
        </div>
        <div className="dance-motion-capture__preview-column">
          <div className="dance-motion-preview-card"><span>Source video</span>{sourceUrl ? <video ref={sourceVideoRef} src={sourceUrl} controls muted playsInline preload="metadata" /> : <div className="dance-motion-empty-preview">Your source video will appear here.</div>}</div>
          <div className="dance-motion-preview-card is-wireframe"><span>Wireframe output</span><canvas ref={wireframeCanvasRef} width={960} height={540} aria-label="Extracted dance wireframe preview" />{!busy && !wireframeArtifact ? <div className="dance-motion-empty-preview is-overlay">The extracted pose will appear here.</div> : null}</div>
        </div>
      </div>
      {job ? <div className="dance-motion-job-row"><div><strong>{job.status === "completed" ? "Motion review ready" : job.stage}</strong><span>{job.originalFileName} · {Math.round(job.progress)}%</span></div><div className="dance-motion-progress"><span style={{ width: `${job.progress}%` }} /></div><div className="dance-motion-artifacts">{wireframeArtifact ? <a href={wireframeArtifact.url} download><Download size={14} aria-hidden="true" /> Wireframe video</a> : null}{canonicalArtifact ? <a href={canonicalArtifact.url} download><Download size={14} aria-hidden="true" /> Canonical clip</a> : null}{rawArtifact ? <a href={rawArtifact.url} download><Download size={14} aria-hidden="true" /> Raw pose</a> : null}{filteredArtifact ? <a href={filteredArtifact.url} download><Download size={14} aria-hidden="true" /> Filtered pose</a> : null}{depthResolvedArtifact ? <a href={depthResolvedArtifact.url} download><Download size={14} aria-hidden="true" /> Resolved depth</a> : null}{diagnosticsArtifact ? <a href={diagnosticsArtifact.url} download><Download size={14} aria-hidden="true" /> Diagnostics</a> : null}</div></div> : null}
      {wireframeArtifact ? <div className="dance-motion-result-video"><div><strong>Rendered wireframe review</strong><span>Use this to check tracking, missing joints, facing direction, and foot stability before using the motion clip.</span></div><video src={wireframeArtifact.url} controls playsInline preload="metadata" /></div> : null}
      {job?.status === "completed" && canonicalArtifact ? <div className="dance-motion-apply-row"><div><strong>Avatar playback</strong><span>Preview this canonical motion on the selected model in the engine below.</span></div><div>{motionApplied ? <button type="button" className="secondary" onClick={onUseProcedural}><RotateCcw size={14} aria-hidden="true" /> Use procedural motion</button> : <button type="button" className="primary" onClick={onApplyMotion}><Play size={14} aria-hidden="true" /> Apply to model</button>}</div></div> : null}
      {sourceArtifact ? <span className="dance-motion-source-note">Source persisted as job {job?.id.slice(0, 8)} · {sourceArtifact.fileName}</span> : null}
    </section>
  );
}
