import { useEffect, useRef, useState } from "preact/hooks";
import { CheckCircle2, Clock3, Download, Film, LoaderCircle, Square } from "lucide-preact";
import {
  createDanceAudioCaptureRoute,
  disposeDanceAudioCaptureRoute,
  recordDanceClip,
  type DanceAudioCaptureRoute,
  type DanceClipRecordingResult
} from "../../game/dance-engine/recordDanceClip";

interface DanceClipExportPanelProps {
  audioRef: { current: HTMLAudioElement | null };
  canvas: HTMLCanvasElement | null;
  audioUrl: string;
  songTitle: string;
  duration: number;
  currentTime: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function fileStem(value: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "dance-clip";
}

export function DanceClipExportPanel({
  audioRef,
  canvas,
  audioUrl,
  songTitle,
  duration,
  currentTime
}: DanceClipExportPanelProps): JSX.Element {
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [recording, setRecording] = useState(false);
  const [converting, setConverting] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<(DanceClipRecordingResult & { webmUrl: string; mp4Url?: string }) | null>(null);
  const routeRef = useRef<DanceAudioCaptureRoute | null>(null);
  const resultUrlsRef = useRef<string[]>([]);

  const clearResultUrls = () => {
    resultUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    resultUrlsRef.current = [];
  };

  useEffect(() => {
    if (duration <= 0) return;
    setEndSeconds((current) => current > 0 ? clamp(current, 0.05, duration) : duration);
  }, [duration]);

  useEffect(() => {
    setStartSeconds(0);
    setEndSeconds(duration > 0 ? duration : 0);
    setAudioReady(false);
    setMessage(null);
    setProgress(0);
    clearResultUrls();
    setResult(null);
    const oldRoute = routeRef.current;
    routeRef.current = null;
    void disposeDanceAudioCaptureRoute(oldRoute);
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      setAudioReady(false);
      return;
    }
    const updateAudioReady = () => {
      setAudioReady(audio.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(audio.duration) && audio.duration > 0);
    };
    updateAudioReady();
    audio.addEventListener("loadedmetadata", updateAudioReady);
    audio.addEventListener("canplay", updateAudioReady);
    audio.addEventListener("error", updateAudioReady);
    return () => {
      audio.removeEventListener("loadedmetadata", updateAudioReady);
      audio.removeEventListener("canplay", updateAudioReady);
      audio.removeEventListener("error", updateAudioReady);
    };
  }, [audioRef, audioUrl]);

  useEffect(() => () => {
    clearResultUrls();
    void disposeDanceAudioCaptureRoute(routeRef.current);
  }, []);

  const setStartFromPlayhead = () => {
    const next = clamp(currentTime, 0, Math.max(0, endSeconds - 0.05));
    setStartSeconds(next);
  };

  const setEndFromPlayhead = () => {
    const next = clamp(currentTime, Math.min(duration, startSeconds + 0.05), duration);
    setEndSeconds(next);
  };

  const record = async () => {
    const audio = audioRef.current;
    if (!audio || !canvas || !audioUrl || duration <= 0 || recording) return;
    setRecording(true);
    setMessage(null);
    setProgress(0);
    try {
      if (!routeRef.current || routeRef.current.audio !== audio) {
        await disposeDanceAudioCaptureRoute(routeRef.current);
        routeRef.current = createDanceAudioCaptureRoute(audio);
      }
      const next = await recordDanceClip({
        canvas,
        audio,
        route: routeRef.current,
        startSeconds,
        endSeconds,
        onProgress: (elapsed, total) => setProgress(total > 0 ? elapsed / total : 0)
      });
      clearResultUrls();
      const webmUrl = URL.createObjectURL(next.blob);
      resultUrlsRef.current.push(webmUrl);
      setResult({ ...next, webmUrl });
      setMessage("WebM captured. Converting to MP4...");
      setProgress(1);
      setConverting(true);
      const form = new FormData();
      form.append("webm", next.blob, "dance-clip.webm");
      const conversionResponse = await fetch("/api/dance-motion/render-mp4", {
        method: "POST",
        body: form,
        credentials: "include"
      });
      if (!conversionResponse.ok) {
        const conversionBody = await conversionResponse.json().catch(() => ({}));
        throw new Error((conversionBody as { error?: string }).error || "The dance clip could not be converted to MP4.");
      }
      const mp4Url = URL.createObjectURL(await conversionResponse.blob());
      resultUrlsRef.current.push(mp4Url);
      setResult((current) => current ? { ...current, mp4Url } : current);
      setMessage("Synchronized dance clip ready.");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "The dance clip could not be recorded or converted.");
    } finally {
      setConverting(false);
      setRecording(false);
    }
  };

  const hasRange = Boolean(audioUrl && duration > 0 && endSeconds > startSeconds && endSeconds - startSeconds >= 0.05);
  const downloadName = `${fileStem(songTitle)}-${Math.round(startSeconds * 100)}-${Math.round(endSeconds * 100)}.webm`;

  return (
    <section className="dance-engine-clip-export" aria-labelledby="dance-engine-clip-export-title">
      <div className="dance-engine-clip-export__heading">
        <div>
          <span className="dance-engine-eyebrow"><Film size={14} aria-hidden="true" /> Save performance</span>
          <h3 id="dance-engine-clip-export-title">Export a synchronized dance clip</h3>
          <p>Save the model currently on stage with the matching section of the song.</p>
        </div>
        <span className="dance-engine-clip-export__duration">{hasRange ? `${formatTime(endSeconds - startSeconds)} selected` : "Choose a range"}</span>
      </div>
      <div className="dance-engine-clip-export__controls">
        <label><span>Start</span><input type="number" min="0" max={Math.max(0, endSeconds - 0.05)} step="0.01" value={startSeconds.toFixed(2)} onInput={(event) => setStartSeconds(clamp(Number(event.currentTarget.value) || 0, 0, Math.max(0, endSeconds - 0.05)))} /><small>{formatTime(startSeconds)}</small></label>
        <button type="button" className="dance-engine-clip-export__set-time" onClick={setStartFromPlayhead} disabled={!duration} title="Use the current song position as the clip start"><Clock3 size={13} aria-hidden="true" /> Use playhead</button>
        <label><span>End</span><input type="number" min={Math.min(duration, startSeconds + 0.05)} max={duration} step="0.01" value={endSeconds.toFixed(2)} onInput={(event) => setEndSeconds(clamp(Number(event.currentTarget.value) || 0, Math.min(duration, startSeconds + 0.05), duration))} /><small>{formatTime(endSeconds)}</small></label>
        <button type="button" className="dance-engine-clip-export__set-time" onClick={setEndFromPlayhead} disabled={!duration} title="Use the current song position as the clip end"><Clock3 size={13} aria-hidden="true" /> Use playhead</button>
        <button type="button" className="dance-engine-clip-export__record" onClick={() => void record()} disabled={!hasRange || recording || !canvas || !audioReady} title={!audioReady ? "Wait for the song audio to finish loading" : undefined}>
          {converting ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Converting to MP4</> : recording ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Recording {Math.round(progress * 100)}%</> : <><Film size={15} aria-hidden="true" /> Record selected clip</>}
        </button>
      </div>
      {recording ? <div className="dance-engine-clip-export__progress" aria-label="Recording progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div> : null}
      {message ? <p className={`dance-engine-clip-export__message${result ? " is-success" : ""}`} role="status">{result ? <CheckCircle2 size={14} aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}{message}</p> : null}
      {result ? <div className="dance-engine-clip-export__result"><video src={result.mp4Url ?? result.webmUrl} controls playsInline preload="metadata" /><div className="dance-engine-clip-export__downloads">{result.mp4Url ? <a className="dance-engine-clip-export__download" href={result.mp4Url} download={`${fileStem(songTitle)}-${Math.round(startSeconds * 100)}-${Math.round(endSeconds * 100)}.mp4`}><Download size={14} aria-hidden="true" /> Download MP4</a> : null}<a className="dance-engine-clip-export__download is-secondary" href={result.webmUrl} download={downloadName}><Download size={14} aria-hidden="true" /> Download WebM</a></div></div> : null}
    </section>
  );
}
