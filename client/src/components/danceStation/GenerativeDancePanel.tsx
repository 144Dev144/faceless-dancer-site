import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Image as ImageIcon, LoaderCircle, Pause, Play, Plus, RefreshCw, Save, Scissors, Sparkles, Trash2, Upload, Video, WandSparkles } from "lucide-preact";
import { GENERATIVE_DANCE_MAX_DURATION_SECONDS, type GenerativeDanceSequence, type GenerativeDanceSequenceSegment } from "@faceless/shared";
import { api, type LibraryItem, type RemoteGenerationInput, type RemoteGenerationRequest, type RemoteJob, type RemotePaymentCurrency, type RemotePricingConfig, type RemotePricingQuote } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import { createRemoteGenerativeDanceWorkspaceItem, createRemoteImageWorkspaceItem, listWorkspaceItems, saveWorkspaceItem, type BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import { fetchFaceLESSWalletBalance, fetchSolWalletBalance, type FaceLESSWalletBalance } from "../../lib/facelessBalance";
import { sendRemoteGenerationPayment, sendRemoteGenerationSolPayment, signRemoteGenerationPayment } from "../../lib/remoteGenerationPayment";
import { calculateRemotePricing, createFreeMarketPrice, fetchOnChainMarketPrice, holderFreeForRequest, type RemoteMarketPrice } from "../../lib/remoteGenerationPricing";

const FPS = 24;
const MAX_FRAMES_PER_GENERATION = 81;
const MAX_WINDOW_SECONDS = MAX_FRAMES_PER_GENERATION / FPS;
const TRACK_PIXELS_PER_SECOND = 92;
const TRACK_MIN_SECONDS = 8;
const MIN_CLIP_SECONDS = 0.08;
const PENDING_AVATAR_JOB_STORAGE_PREFIX = "faceless-dancer:pending-avatar-job:";
const PENDING_DANCE_JOB_STORAGE_PREFIX = "faceless-dancer:pending-generative-dance-job:";
const TERMINAL_REMOTE_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled", "refunded", "expired", "completed"]);

interface Props {
  session: SessionState;
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  onWorkspaceChanged?: () => void | Promise<void>;
}

interface DriverClip {
  id: string;
  title: string;
  file: File;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  offsetSeconds: number;
  prompt: string;
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
}

function formatToken(amount: string, decimals: number): string {
  const value = Number(amount) / 10 ** decimals;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function pendingAvatarJobStorageKey(publicKey: string): string {
  return `${PENDING_AVATAR_JOB_STORAGE_PREFIX}${publicKey}`;
}

function readPendingAvatarJob(publicKey: string): { jobId: string; title: string } | null {
  try {
    const raw = window.sessionStorage.getItem(pendingAvatarJobStorageKey(publicKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as { jobId?: unknown; title?: unknown };
    return typeof value.jobId === "string" && value.jobId && typeof value.title === "string" && value.title.trim()
      ? { jobId: value.jobId, title: value.title.trim() }
      : null;
  } catch {
    return null;
  }
}

function writePendingAvatarJob(publicKey: string, value: { jobId: string; title: string }): void {
  try {
    window.sessionStorage.setItem(pendingAvatarJobStorageKey(publicKey), JSON.stringify(value));
  } catch {
    // Session storage is only a recovery aid; the generation itself must not fail if it is unavailable.
  }
}

function clearPendingAvatarJob(publicKey: string, jobId?: string): void {
  try {
    const key = pendingAvatarJobStorageKey(publicKey);
    if (!jobId || readPendingAvatarJob(publicKey)?.jobId === jobId) window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures after the job has been persisted.
  }
}

interface PendingDanceJob {
  jobId: string;
  title: string;
  sequence: GenerativeDanceSequence;
}

function pendingDanceJobStorageKey(publicKey: string): string {
  return `${PENDING_DANCE_JOB_STORAGE_PREFIX}${publicKey}`;
}

function readPendingDanceJob(publicKey: string): PendingDanceJob | null {
  try {
    const raw = window.sessionStorage.getItem(pendingDanceJobStorageKey(publicKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingDanceJob>;
    return typeof value.jobId === "string" && value.jobId
      && typeof value.title === "string" && value.title.trim()
      && value.sequence && typeof value.sequence === "object"
      ? { jobId: value.jobId, title: value.title.trim(), sequence: value.sequence as GenerativeDanceSequence }
      : null;
  } catch {
    return null;
  }
}

function writePendingDanceJob(publicKey: string, value: PendingDanceJob): void {
  try {
    window.sessionStorage.setItem(pendingDanceJobStorageKey(publicKey), JSON.stringify(value));
  } catch {
    // Session storage is only a recovery aid; the generation must continue if it is unavailable.
  }
}

function clearPendingDanceJob(publicKey: string, jobId?: string): void {
  try {
    const key = pendingDanceJobStorageKey(publicKey);
    if (!jobId || readPendingDanceJob(publicKey)?.jobId === jobId) window.sessionStorage.removeItem(key);
  } catch {
    // Ignore cleanup failures after a completed job has been persisted.
  }
}

function remoteArtifactProxyUrl(objectPath: string): string {
  return `/api/remote-generation/assets/file?path=${encodeURIComponent(objectPath)}`;
}

function artifactRecord(job: RemoteJob, kind: "image" | "video"): RemoteJob["artifacts"][number] | null {
  const media = job.artifacts.filter((item) => {
    const isImage = item.mimeType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(item.objectPath);
    const isVideo = item.mimeType.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(item.objectPath);
    return kind === "image" ? isImage : isVideo;
  });
  const finalMedia = media.filter((item) => /generative-dance-output|00-final|final|output/i.test(item.objectPath));
  const candidates = finalMedia.length ? finalMedia : media;
  if (kind === "video") {
    const isWebm = (item: RemoteJob["artifacts"][number]) => item.mimeType === "video/webm" || /\.webm$/i.test(item.objectPath);
    return candidates.find((item) => /generative-dance-output\.webm$/i.test(item.objectPath))
      ?? candidates.find(isWebm)
      ?? null;
  }
  return candidates.find((item) => item.mimeType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(item.objectPath))
    ?? candidates.find((item) => (item as RemoteJob["artifacts"][number] & { primary?: boolean }).primary === true)
    ?? candidates[0]
    ?? null;
}

function inputFromAvatar(item: BrowserWorkspaceItem | LibraryItem): RemoteGenerationInput | null {
  const metadata = item.metadata as Record<string, unknown>;
  const files = Array.isArray(metadata.files)
    ? metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
    : Array.isArray((item as LibraryItem).files)
      ? (item as LibraryItem).files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const file = files.find((candidate) => candidate.role === "reference-image" || candidate.role === "image") ?? (metadata.avatarMode === "generative-image" ? files[0] : undefined);
  const sourceUrl = typeof file?.sourcePublicUrl === "string" ? file.sourcePublicUrl : typeof metadata.sourcePublicUrl === "string" ? metadata.sourcePublicUrl : "";
  if (!sourceUrl) return null;
  return {
    id: "avatar-reference",
    role: "avatar-reference",
    sourceUrl,
    mimeType: typeof file?.mimeType === "string" ? file.mimeType : "image/png",
    fileName: typeof file?.fileName === "string" ? file.fileName : `${item.title}.png`,
    sizeBytes: typeof file?.sizeBytes === "number" ? file.sizeBytes : undefined,
  };
}

function sourceUrlFromDanceItem(item: BrowserWorkspaceItem | LibraryItem): string {
  const metadata = item.metadata as Record<string, unknown>;
  const files = Array.isArray(metadata.files)
    ? metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
    : Array.isArray((item as LibraryItem).files)
      ? (item as LibraryItem).files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const videoFiles = files.filter((candidate) => candidate.role === "generative-video" || candidate.role === "video" || candidate.mimeType === "video/mp4" || candidate.mimeType === "video/webm" || candidate.mimeType === "video/quicktime");
  const file = videoFiles.find((candidate) => candidate.mimeType === "video/webm" || /\.webm$/i.test(String(candidate.objectPath || candidate.fileName || "")))
    ?? videoFiles.find((candidate) => candidate.mimeType === "video/mp4" || /\.mp4$/i.test(String(candidate.objectPath || candidate.fileName || "")))
    ?? videoFiles[0];
  const objectPath = typeof file?.objectPath === "string" ? file.objectPath : typeof metadata.objectPath === "string" ? metadata.objectPath : "";
  const legacyAlphaPath = objectPath.replace(/generative-dance-output-alpha\.mov$/i, "generative-dance-output.webm");
  if (legacyAlphaPath && legacyAlphaPath !== objectPath) {
    return `/api/remote-generation/assets/file?path=${encodeURIComponent(legacyAlphaPath)}`;
  }
  return typeof file?.publicUrl === "string" ? file.publicUrl : typeof file?.sourcePublicUrl === "string" ? file.sourcePublicUrl : "";
}

function splitWindows(segment: DriverClip, inputId: string): GenerativeDanceSequenceSegment {
  const sourceDuration = Math.max(0.01, segment.trimEndSeconds - segment.trimStartSeconds);
  const outputStart = segment.offsetSeconds;
  const windows = [];
  let elapsed = 0;
  let index = 0;
  while (elapsed < sourceDuration - 0.001) {
    const length = Math.min(MAX_WINDOW_SECONDS, sourceDuration - elapsed);
    windows.push({
      index,
      sourceStartSeconds: segment.trimStartSeconds + elapsed,
      sourceEndSeconds: segment.trimStartSeconds + elapsed + length,
      timelineStartSeconds: outputStart + elapsed,
      timelineEndSeconds: outputStart + elapsed + length,
    });
    elapsed += length;
    index += 1;
  }
  return {
    id: segment.id,
    inputId,
    title: segment.title,
    prompt: segment.prompt.trim(),
    sourceStartSeconds: segment.trimStartSeconds,
    sourceEndSeconds: segment.trimEndSeconds,
    timelineStartSeconds: segment.offsetSeconds,
    timelineEndSeconds: segment.offsetSeconds + sourceDuration,
    placement: {
      translateX: segment.translateX,
      translateY: segment.translateY,
      scale: segment.scale,
      rotationDegrees: segment.rotationDegrees,
    },
    anchor: [0.5, 0.58],
    subjectBounds: [0.15, 0.05, 0.85, 0.95],
    windows,
  };
}

function durationFor(clip: DriverClip): number {
  return Math.max(0.01, clip.trimEndSeconds - clip.trimStartSeconds);
}

function compactClips(clips: DriverClip[]): DriverClip[] {
  let offsetSeconds = 0;
  return clips.map((clip) => {
    const next = { ...clip, offsetSeconds };
    offsetSeconds += durationFor(next);
    return next;
  });
}

type SequencePointerEdit = {
  kind: "move" | "trim-left" | "trim-right";
  id: string;
  startX: number;
  index: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
};

interface GenerativeDanceSequenceTrackProps {
  clips: DriverClip[];
  selectedClipId: string | null;
  durationSeconds: number;
  cursorSeconds: number;
  onCursorChange: (seconds: number) => void;
  onSelectClip: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<DriverClip>) => void;
  onMoveClip: (id: string, direction: -1 | 1) => void;
  onCutAtCursor: (seconds?: number) => void;
}

function GenerativeDanceSequenceTrack({ clips, selectedClipId, durationSeconds, cursorSeconds, onCursorChange, onSelectClip, onUpdateClip, onMoveClip, onCutAtCursor }: GenerativeDanceSequenceTrackProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerEditRef = useRef<SequencePointerEdit | null>(null);
  const [cutMode, setCutMode] = useState(false);
  const trackSeconds = Math.max(TRACK_MIN_SECONDS, durationSeconds + 1);
  const trackWidth = trackSeconds * TRACK_PIXELS_PER_SECOND;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;

  const secondsAtClientX = (clientX: number): number => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    return Math.max(0, Math.min(trackSeconds, (clientX - bounds.left + viewport.scrollLeft) / TRACK_PIXELS_PER_SECOND));
  };

  const handleTimelinePointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-generative-clip]")) return;
    const seconds = secondsAtClientX(event.clientX);
    onCursorChange(seconds);
    if (cutMode && selectedClip && seconds >= selectedClip.offsetSeconds && seconds <= selectedClip.offsetSeconds + durationFor(selectedClip)) {
      onCutAtCursor(seconds);
      setCutMode(false);
    }
  };

  const beginEdit = (event: PointerEvent, kind: SequencePointerEdit["kind"], clip: DriverClip) => {
    event.stopPropagation();
    event.preventDefault();
    onSelectClip(clip.id);
    pointerEditRef.current = { kind, id: clip.id, startX: event.clientX, index: clips.findIndex((candidate) => candidate.id === clip.id), trimStartSeconds: clip.trimStartSeconds, trimEndSeconds: clip.trimEndSeconds };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const updateEdit = (event: PointerEvent) => {
    const edit = pointerEditRef.current;
    if (!edit) return;
    const delta = (event.clientX - edit.startX) / TRACK_PIXELS_PER_SECOND;
    const clip = clips.find((candidate) => candidate.id === edit.id);
    if (!clip) return;
    if (edit.kind === "move") {
      const currentIndex = clips.findIndex((candidate) => candidate.id === edit.id);
      if (currentIndex < 0) return;
      let targetIndex = clips.length - 1;
      const seconds = secondsAtClientX(event.clientX);
      const hit = clips.findIndex((candidate) => seconds < candidate.offsetSeconds + durationFor(candidate) / 2);
      if (hit >= 0) targetIndex = hit;
      if (targetIndex !== currentIndex) {
        onMoveClip(edit.id, targetIndex > currentIndex ? 1 : -1);
        pointerEditRef.current = { ...edit, index: targetIndex };
      }
    } else if (edit.kind === "trim-left") {
      onUpdateClip(edit.id, { trimStartSeconds: Math.max(0, Math.min(edit.trimEndSeconds - MIN_CLIP_SECONDS, edit.trimStartSeconds + delta)) });
    } else {
      onUpdateClip(edit.id, { trimEndSeconds: Math.min(clip.durationSeconds, Math.max(edit.trimStartSeconds + MIN_CLIP_SECONDS, edit.trimEndSeconds + delta)) });
    }
  };

  return <div className="generative-dance-composition-editor">
    <div className="generative-dance-composition-toolbar"><span>Clips play end to end. Use the arrows below to reorder them, or pull an edge to trim.</span><div><button type="button" className={`rhythm-beats-secondary-button generative-dance-composition-tool${cutMode ? " is-active" : ""}`} title="Cut selected clip at the playhead" aria-label="Cut selected clip at the playhead" disabled={!selectedClip} onClick={() => setCutMode((value) => !value)}><Scissors size={15} aria-hidden="true" /></button></div></div>
    <div ref={viewportRef} className="generative-dance-composition-viewport" onPointerDown={handleTimelinePointerDown}>
      <div className="generative-dance-composition-canvas" style={{ width: `${trackWidth}px` }}>
        <div className="generative-dance-composition-axis" aria-hidden="true">{Array.from({ length: Math.ceil(trackSeconds) + 1 }, (_, index) => <span key={index} style={{ left: `${index * TRACK_PIXELS_PER_SECOND}px` }}>{index}s</span>)}</div>
        <div className="generative-dance-composition-lane">
          {clips.map((clip, index) => {
            const width = durationFor(clip) * TRACK_PIXELS_PER_SECOND;
            return <div key={clip.id} data-generative-clip="true" className={`generative-dance-composition-clip${selectedClipId === clip.id ? " is-selected" : ""}`} style={{ left: `${clip.offsetSeconds * TRACK_PIXELS_PER_SECOND}px`, width: `${Math.max(30, width)}px` }} title={`${clip.title} · ${durationFor(clip).toFixed(2)} seconds`} onPointerDown={(event) => {
              if (cutMode) {
                event.stopPropagation();
                event.preventDefault();
                onSelectClip(clip.id);
                const seconds = secondsAtClientX(event.clientX);
                onCursorChange(seconds);
                if (selectedClipId === clip.id) {
                  onCutAtCursor(seconds);
                  setCutMode(false);
                }
                return;
              }
              beginEdit(event, "move", clip);
            }} onPointerMove={updateEdit} onPointerUp={() => { pointerEditRef.current = null; }} onPointerCancel={() => { pointerEditRef.current = null; }} onClick={(event) => { event.stopPropagation(); onSelectClip(clip.id); }}>
              <button type="button" className="generative-dance-composition-handle is-left" aria-label={`Trim start of ${clip.title}`} onPointerDown={(event) => beginEdit(event, "trim-left", clip)} />
              <span>{index + 1}. {clip.title}</span><small>{durationFor(clip).toFixed(1)}s</small>
              <button type="button" className="generative-dance-composition-handle is-right" aria-label={`Trim end of ${clip.title}`} onPointerDown={(event) => beginEdit(event, "trim-right", clip)} />
            </div>;
          })}
          {!clips.length ? <span className="generative-dance-composition-empty">Add driver videos above to begin the sequence.</span> : null}
          <div className="generative-dance-composition-playhead" style={{ left: `${Math.max(0, Math.min(trackSeconds, cursorSeconds)) * TRACK_PIXELS_PER_SECOND}px` }} aria-label={`Playhead at ${cursorSeconds.toFixed(2)} seconds`} />
        </div>
      </div>
    </div>
    <div className="generative-dance-composition-selection"><span>{selectedClip ? `Selected: ${selectedClip.title}` : "Select a clip to edit it"}</span><span>Playhead {cursorSeconds.toFixed(2)}s · {durationSeconds.toFixed(2)}s total</span>{cutMode ? <strong>Click inside the selected clip to cut</strong> : null}</div>
  </div>;
}

interface GenerativeDanceSourcePlaybackProps {
  clips: DriverClip[];
  durationSeconds: number;
  cursorSeconds: number;
  onCursorChange: (seconds: number) => void;
}

function GenerativeDanceSourcePlayback({ clips, durationSeconds, cursorSeconds, onCursorChange }: GenerativeDanceSourcePlaybackProps): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sourceUrlsRef = useRef(new Map<string, { file: File; url: string }>());
  const activeClipIdRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<{ clipId: string; seconds: number; shouldPlay: boolean } | null>(null);
  const isPlayingRef = useRef(false);
  const cursorRef = useRef(cursorSeconds);
  const animationFrameRef = useRef<number | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    cursorRef.current = cursorSeconds;
  }, [cursorSeconds]);

  useEffect(() => {
    const activeIds = new Set(clips.map((clip) => clip.id));
    clips.forEach((clip) => {
      const existing = sourceUrlsRef.current.get(clip.id);
      if (existing?.file === clip.file) return;
      if (existing) URL.revokeObjectURL(existing.url);
      sourceUrlsRef.current.set(clip.id, { file: clip.file, url: URL.createObjectURL(clip.file) });
    });
    for (const [id, source] of sourceUrlsRef.current) {
      if (!activeIds.has(id)) {
        URL.revokeObjectURL(source.url);
        sourceUrlsRef.current.delete(id);
      }
    }
    if (activeClipIdRef.current && !activeIds.has(activeClipIdRef.current)) {
      activeClipIdRef.current = null;
      pendingSeekRef.current = null;
      setActiveClipId(null);
      videoRef.current?.pause();
      if (videoRef.current) {
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    }
  }, [clips]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    for (const source of sourceUrlsRef.current.values()) URL.revokeObjectURL(source.url);
    sourceUrlsRef.current.clear();
  }, []);

  const clipAt = (seconds: number): DriverClip | null => {
    if (!clips.length) return null;
    const clamped = Math.max(0, Math.min(durationSeconds, seconds));
    return clips.find((clip, index) => clamped < clip.offsetSeconds + durationFor(clip) - 0.001 || index === clips.length - 1) ?? clips[clips.length - 1];
  };

  const sourceFor = (clip: DriverClip): string => {
    const existing = sourceUrlsRef.current.get(clip.id);
    if (existing?.file === clip.file) return existing.url;
    if (existing) URL.revokeObjectURL(existing.url);
    const url = URL.createObjectURL(clip.file);
    sourceUrlsRef.current.set(clip.id, { file: clip.file, url });
    return url;
  };

  const stopTicker = () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
  };

  const seekTo = (seconds: number, shouldPlay = isPlayingRef.current) => {
    const video = videoRef.current;
    const clip = clipAt(seconds);
    if (!video || !clip) return;
    const globalSeconds = Math.max(0, Math.min(durationSeconds, seconds));
    const localSeconds = Math.max(clip.trimStartSeconds, Math.min(clip.trimEndSeconds, clip.trimStartSeconds + globalSeconds - clip.offsetSeconds));
    const sourceUrl = sourceFor(clip);
    const sourceChanged = activeClipIdRef.current !== clip.id || video.dataset.sourceClipId !== clip.id;
    activeClipIdRef.current = clip.id;
    setActiveClipId(clip.id);
    pendingSeekRef.current = { clipId: clip.id, seconds: localSeconds, shouldPlay };
    setPlaybackError(null);
    if (sourceChanged) {
      video.dataset.sourceClipId = clip.id;
      video.src = sourceUrl;
      video.load();
    } else if (video.readyState >= 1) {
      video.currentTime = localSeconds;
      pendingSeekRef.current = null;
      if (shouldPlay) void video.play().catch(() => setPlaybackError("This source video could not be played in the browser."));
    }
  };

  const tick = () => {
    if (!isPlayingRef.current) return;
    const video = videoRef.current;
    const clip = clips.find((candidate) => candidate.id === activeClipIdRef.current);
    if (!video || !clip) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopTicker();
      return;
    }
    if (pendingSeekRef.current) {
      animationFrameRef.current = requestAnimationFrame(tick);
      return;
    }
    const globalSeconds = clip.offsetSeconds + Math.max(0, video.currentTime - clip.trimStartSeconds);
    const clipEnd = clip.offsetSeconds + durationFor(clip);
    if (globalSeconds >= clipEnd - 0.02) {
      const nextIndex = clips.findIndex((candidate) => candidate.id === clip.id) + 1;
      if (nextIndex < clips.length) {
        seekTo(clips[nextIndex].offsetSeconds, true);
      } else {
        cursorRef.current = durationSeconds;
        onCursorChange(durationSeconds);
        isPlayingRef.current = false;
        setIsPlaying(false);
        video.pause();
        stopTicker();
        return;
      }
    } else {
      cursorRef.current = globalSeconds;
      onCursorChange(globalSeconds);
    }
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const startPlayback = () => {
    if (!clips.length) return;
    const startSeconds = cursorRef.current >= durationSeconds - 0.02 ? 0 : cursorRef.current;
    isPlayingRef.current = true;
    setIsPlaying(true);
    seekTo(startSeconds, true);
    stopTicker();
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const pausePlayback = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    pendingSeekRef.current = null;
    videoRef.current?.pause();
    stopTicker();
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    const pending = pendingSeekRef.current;
    if (!video || !pending || pending.clipId !== activeClipIdRef.current) return;
    video.currentTime = pending.seconds;
    pendingSeekRef.current = null;
    if (pending.shouldPlay) void video.play().catch(() => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setPlaybackError("This source video could not be played in the browser.");
    });
  };

  useEffect(() => {
    if (!isPlayingRef.current) seekTo(cursorSeconds, false);
  }, [cursorSeconds, clips, durationSeconds]);

  const handleSeek = (event: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const nextSeconds = Math.max(0, Math.min(durationSeconds, Number(event.currentTarget.value)));
    cursorRef.current = nextSeconds;
    onCursorChange(nextSeconds);
    seekTo(nextSeconds, isPlayingRef.current);
  };

  const activeClip = clips.find((clip) => clip.id === activeClipId) ?? null;
  return <div className="generative-dance-source-playback" aria-label="Source video playback">
    <div className="generative-dance-source-playback__header"><div><strong>Source preview</strong><span>{activeClip ? `Playing ${activeClip.title}` : "Play the trimmed sequence before generating"}</span></div><button type="button" className="rhythm-beats-secondary-button generative-dance-source-playback__play" onClick={isPlaying ? pausePlayback : startPlayback} disabled={!clips.length} aria-label={isPlaying ? "Pause source preview" : "Play source preview"} title={isPlaying ? "Pause source preview" : "Play source preview"}>{isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}</button></div>
    <div className="generative-dance-source-playback__video-wrap">{clips.length ? <video ref={videoRef} className="generative-dance-source-playback__video" playsInline preload="metadata" onLoadedMetadata={handleLoadedMetadata} onError={() => setPlaybackError("This source video could not be decoded in the browser.")} /> : <div className="generative-dance-source-playback__empty"><Video size={20} aria-hidden="true" />Add driver videos to preview the sequence.</div>}</div>
    <div className="generative-dance-source-playback__controls"><span>{cursorSeconds.toFixed(2)}s</span><input type="range" min="0" max={Math.max(0, durationSeconds)} step="0.01" value={Math.min(cursorSeconds, durationSeconds)} onInput={handleSeek} disabled={!clips.length} aria-label="Source preview position" /><span>{durationSeconds.toFixed(2)}s</span></div>
    {playbackError ? <p className="generative-dance-source-playback__error" role="status">{playbackError}</p> : null}
  </div>;
}

function avatarItems(workspaceItems: BrowserWorkspaceItem[], publicItems: LibraryItem[]): Array<{ id: string; item: BrowserWorkspaceItem | LibraryItem; label: string }> {
  return [
    ...workspaceItems.filter((item) => item.kind === "avatar" && item.metadata.avatarMode === "generative-image").map((item) => ({ id: `private:${item.id}`, item, label: `Private · ${item.title}` })),
    ...publicItems.filter((item) => item.kind === "avatar" && item.metadata.avatarMode === "generative-image").map((item) => ({ id: `public:${item.id}`, item, label: `Public · ${item.title}` })),
  ];
}

function GenerativeDanceAvatarPreview({ url, title, compact = false }: { url: string; title: string; compact?: boolean }): JSX.Element | null {
  if (!url) return null;
  return <div className={`generative-dance-avatar-preview${compact ? " is-compact" : ""}`}>
    <img src={url} alt={`${title} avatar preview`} />
    {compact ? <div><strong>{title}</strong><span>Selected dancer</span></div> : <strong className="generative-dance-avatar-preview__title">{title}</strong>}
  </div>;
}

function GenerativeDanceLoopLibrary({ items }: { items: BrowserWorkspaceItem[] }): JSX.Element {
  return <section className="generative-dance-library" aria-labelledby="generative-dance-library-title">
    <div className="generative-dance-library__heading"><div><span className="dance-engine-eyebrow"><Play size={14} aria-hidden="true" /> Private results</span><h3 id="generative-dance-library-title">Private dance loops</h3></div><span>{items.length ? `${items.length} saved loop${items.length === 1 ? "" : "s"}` : "No saved loops yet"}</span></div>
    {items.length ? <div className="generative-dance-library__list">{items.map((item) => {
      const videoUrl = sourceUrlFromDanceItem(item);
      return <article className="generative-dance-library__item" key={item.id}>
        <div className="generative-dance-library__video-wrap">{videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" aria-label={`Play ${item.title}`} /> : <span>Video artifact unavailable</span>}</div>
        <div className="generative-dance-library__item-info"><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleString()}</span></div>
      </article>;
    })}</div> : <div className="generative-dance-library__empty"><Video size={18} aria-hidden="true" /><span>Completed dance loops will appear here with playback controls.</span></div>}
  </section>;
}

export function GenerativeDancePanel({ session, workspaceItems, publicItems, onWorkspaceChanged }: Props): JSX.Element {
  const [avatarTitle, setAvatarTitle] = useState("");
  const [avatarDescription, setAvatarDescription] = useState("");
  const [avatarReference, setAvatarReference] = useState<File | null>(null);
  const [avatarId, setAvatarId] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [generatedAvatarPreview, setGeneratedAvatarPreview] = useState<{ id: string; title: string; url: string } | null>(null);
  const [latestDanceLoop, setLatestDanceLoop] = useState<BrowserWorkspaceItem | null>(null);
  const [danceTitle, setDanceTitle] = useState("My Generative Dance");
  const [dancePrompt, setDancePrompt] = useState("Preserve the dancer's identity and motion style; keep the full body visible.");
  const [enhancementEnabled, setEnhancementEnabled] = useState(true);
  const [motionInterpolationEnabled, setMotionInterpolationEnabled] = useState(true);
  const [clips, setClips] = useState<DriverClip[]>([]);
  const [savedDriverId, setSavedDriverId] = useState("");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [cursorSeconds, setCursorSeconds] = useState(0);
  const [danceBusy, setDanceBusy] = useState(false);
  const [danceMessage, setDanceMessage] = useState<string | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<RemotePaymentCurrency>("FACELESS");
  const [pricingConfig, setPricingConfig] = useState<RemotePricingConfig | null>(null);
  const [marketPrice, setMarketPrice] = useState<RemoteMarketPrice | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [pricing, setPricing] = useState<RemotePricingQuote | null>(null);
  const [walletBalance, setWalletBalance] = useState<FaceLESSWalletBalance | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [avatarPricing, setAvatarPricing] = useState<RemotePricingQuote | null>(null);
  const workspaceChangedRef = useRef<Props["onWorkspaceChanged"]>(onWorkspaceChanged);
  workspaceChangedRef.current = onWorkspaceChanged;

  const selectedAvatar = avatarItems(workspaceItems, publicItems).find((item) => item.id === avatarId)?.item ?? null;
  const selectedAvatarInput = selectedAvatar ? inputFromAvatar(selectedAvatar) : null;
  const selectedAvatarPreviewUrl = selectedAvatarInput?.sourceUrl || (generatedAvatarPreview?.id === avatarId ? generatedAvatarPreview.url : "");
  const savedDriverItems = [
    ...workspaceItems.filter((item) => item.kind === "dance_motion" && item.metadata.danceMode === "generative-video").map((item) => ({ id: `private:${item.id}`, item, label: `Private · ${item.title}` })),
    ...publicItems.filter((item) => item.kind === "dance_motion" && item.metadata.danceMode === "generative-video").map((item) => ({ id: `public:${item.id}`, item, label: `Public · ${item.title}` })),
  ];
  const privateDanceLoops = [
    ...(latestDanceLoop ? [latestDanceLoop] : []),
    ...workspaceItems,
  ].filter((item) => item.kind === "dance_motion" && item.metadata.danceMode === "generative-video").filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
  const holderFreeAvatar = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, { runtime: "flux-image", modelRevision: "flux-2-klein-4b", inputs: [], priority: "low", paymentCurrency, metadata: { title: avatarTitle || "Generated avatar" }, parameters: { task_type: "generative_avatar", description: avatarDescription } }));
  const holderFreeDance = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, { runtime: "wan-animate", modelRevision: "wan-animate-2", inputs: [], priority: "low", paymentCurrency, metadata: { title: danceTitle }, parameters: { task_type: "generative_dance" } }));

  const avatarRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "flux-image",
    modelRevision: "flux-2-klein-4b",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: avatarTitle.trim() || "Generated avatar" },
    parameters: {
      task_type: "generative_avatar",
      description: avatarDescription.trim(),
      steps: 4,
      true_cfg_scale: 1,
    },
  }), [avatarDescription, avatarTitle, paymentCurrency]);

  const sequence = useMemo<GenerativeDanceSequence | null>(() => {
    if (!clips.length) return null;
    const segments = clips.map((clip) => splitWindows(clip, `driver-${clip.id}`));
    return {
      format: "faceless-generative-dance-sequence",
      version: 1,
      fps: FPS,
      maxFramesPerGeneration: MAX_FRAMES_PER_GENERATION,
      canvas: { width: 480, height: 832, anchorSemantic: "pelvis", anchorX: 0.5, anchorY: 0.58, floorY: 0.94 },
      durationSeconds: clips.reduce((total, clip) => total + durationFor(clip), 0),
      segments,
    };
  }, [clips]);

  const danceRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "wan-animate",
    modelRevision: "wan-animate-2-q6",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: danceTitle.trim() || "Generative dance" },
    parameters: {
      task_type: "generative_dance",
      prompt: dancePrompt.trim(),
      fps: FPS,
      max_frames_per_generation: MAX_FRAMES_PER_GENERATION,
      avatar_input_id: "avatar-reference",
      postprocess: {
        enhancement_enabled: enhancementEnabled,
        enhancement_scale: 2,
        motion_interpolation_enabled: motionInterpolationEnabled,
        motion_interpolation_target_fps: 48,
      },
      sequence,
    },
  }), [dancePrompt, danceTitle, enhancementEnabled, motionInterpolationEnabled, paymentCurrency, sequence]);

  useEffect(() => {
    let cancelled = false;
    const loadPricing = async () => {
      setMarketPrice(null);
      setAvatarPricing(null);
      setPricing(null);
      try {
        const config = await api.remoteGenerationPricingConfig();
        const holderFree = session.isHolder && (config.settings.fluxImageFreeForHolders || config.settings.wanAnimateFreeForHolders);
        const market = config.paymentMode === "free-signature" || holderFree
          ? createFreeMarketPrice(config, holderFree ? "holder-free" : "free-signature")
          : await fetchOnChainMarketPrice(config);
        if (cancelled) return;
        setPricingConfig(config);
        setMarketPrice(market);
        setPricingError("");
      } catch (error: unknown) {
        if (!cancelled) setPricingError(error instanceof Error ? error.message : "Pricing is temporarily unavailable.");
      }
    };
    void loadPricing();
    return () => { cancelled = true; };
  }, [session.authenticated, session.isHolder]);

  useEffect(() => {
    if (!pricingConfig) {
      setAvatarPricing(null);
      setPricing(null);
      return;
    }
    const quoteRequest = (request: RemoteGenerationRequest, kind: "avatar" | "dance") => {
      try {
        const free = session.isHolder && holderFreeForRequest(pricingConfig, request);
        const effectiveMarket = free
          ? createFreeMarketPrice(pricingConfig, "holder-free")
          : marketPrice;
        if (!effectiveMarket) {
          if (kind === "avatar") setAvatarPricing(null); else setPricing(null);
          return;
        }
        const next = calculateRemotePricing(pricingConfig, request, effectiveMarket, { freeForHolder: free });
        if (kind === "avatar") setAvatarPricing(next); else setPricing(next);
      } catch {
        if (kind === "avatar") setAvatarPricing(null); else setPricing(null);
      }
    };
    quoteRequest(avatarRequest, "avatar");
    quoteRequest(danceRequest, "dance");
  }, [avatarRequest, danceRequest, marketPrice, pricingConfig, session.isHolder]);

  useEffect(() => {
    if (!session.authenticated || !session.publicKey || !pricingConfig) return;
    let cancelled = false;
    setWalletBalanceLoading(true);
    const network = { network: pricingConfig.network, rpcUrl: pricingConfig.market.rpcUrl };
    void (paymentCurrency === "SOL"
      ? fetchSolWalletBalance(session.publicKey, network)
      : fetchFaceLESSWalletBalance(session.publicKey, pricing?.tokenMint ?? avatarPricing?.tokenMint ?? pricingConfig.currencies.FACELESS.tokenMint, pricing?.tokenDecimals ?? avatarPricing?.tokenDecimals ?? pricingConfig.currencies.FACELESS.tokenDecimals, network))
      .then((balance) => { if (!cancelled) setWalletBalance(balance); })
      .catch(() => { if (!cancelled) setWalletBalance(null); })
      .finally(() => { if (!cancelled) setWalletBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [avatarPricing?.tokenDecimals, avatarPricing?.tokenMint, paymentCurrency, pricing?.tokenDecimals, pricing?.tokenMint, pricingConfig?.market.rpcUrl, pricingConfig?.network, session.authenticated, session.publicKey, walletRefresh]);

  const submit = async (request: RemoteGenerationRequest, onQueued?: (job: RemoteJob) => Promise<void>): Promise<RemoteJob> => {
    if (!session.authenticated || !session.publicKey) throw new Error("Connect and verify your wallet before generating.");
    const intent = await api.createRemotePaymentIntent(request);
    const signature = intent.paymentMode === "free-signature"
      ? intent.paymentMessage ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage }) : (() => { throw new Error("The launch server did not provide the wallet authorization message."); })()
      : intent.currency === "SOL"
        ? await sendRemoteGenerationSolPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference })
        : await sendRemoteGenerationPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, tokenMint: intent.tokenMint, tokenDecimals: intent.tokenDecimals, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference });
    const paid = await api.verifyRemotePayment(intent.id, signature);
    const queued = await api.createRemoteJob(paid.id, request);
    await onQueued?.(queued);
    let lastStatusError: unknown;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        const current = await api.remoteJob(queued.id);
        lastStatusError = undefined;
        if (TERMINAL_REMOTE_JOB_STATUSES.has(current.status)) return current;
      } catch (error) {
        lastStatusError = error;
        // The launch server can briefly reject a status read while it is
        // reconciling the provider callback. History has the same job ID and
        // is a useful recovery path without losing the completed generation.
        try {
          const history = await api.remoteJobs({ limit: 1, knownJobIds: [queued.id] });
          const current = history.jobs.find((candidate) => candidate.id === queued.id);
          if (current && TERMINAL_REMOTE_JOB_STATUSES.has(current.status)) return current;
        } catch {
          // Keep polling the canonical job endpoint before giving up.
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
    if (lastStatusError) throw lastStatusError;
    throw new Error("The generation is still running. Check generation history for its result.");
  };

  const persistAvatarJob = async (job: RemoteJob, title: string): Promise<{ item: BrowserWorkspaceItem; previewId: string; previewUrl: string }> => {
    if (job.status !== "succeeded" && job.status !== "completed") {
      throw new Error(job.errorMessage || "The avatar image could not be generated.");
    }
    const artifact = artifactRecord(job, "image");
    const publicUrl = artifact?.publicUrl || "";
    if (!artifact || !publicUrl) throw new Error("The image worker finished without returning an image artifact.");
    const item = createRemoteImageWorkspaceItem({ jobId: job.id, title, publicUrl, objectPath: artifact.objectPath, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, createdAt: job.createdAt, updatedAt: new Date().toISOString() });
    await saveWorkspaceItem(item);
    return { item, previewId: `private:${item.id}`, previewUrl: publicUrl };
  };

  const notifyWorkspaceChanged = () => {
    try {
      const refresh = workspaceChangedRef.current?.();
      void Promise.resolve(refresh).catch((error) => console.error("[generative-avatar] workspace refresh failed", error));
    } catch (error) {
      console.error("[generative-avatar] workspace refresh failed", error);
    }
  };

  const persistDanceJob = async (job: RemoteJob, title: string, sequence: unknown): Promise<BrowserWorkspaceItem> => {
    if (job.status !== "succeeded" && job.status !== "completed") {
      throw new Error(job.errorMessage || "The generative dance could not be completed.");
    }
    const artifact = artifactRecord(job, "video");
    if (!artifact) throw new Error("The animation worker finished without returning its playable WebM artifact.");
    const objectPath = typeof artifact.objectPath === "string" ? artifact.objectPath : "";
    if (!objectPath) throw new Error("The animation worker returned a video without an asset path.");
    const publicUrl = artifact.publicUrl || remoteArtifactProxyUrl(objectPath);
    const item = createRemoteGenerativeDanceWorkspaceItem({
      jobId: job.id,
      title: title.trim() || "Generative dance",
      publicUrl,
      objectPath,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
      sequence,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await saveWorkspaceItem(item);
    return item;
  };

  useEffect(() => {
    if (!session.authenticated || !session.publicKey) return;
    let cancelled = false;
    const recoverCompletedDanceJobs = async () => {
      try {
        const existingItems = await listWorkspaceItems();
        const existingIds = new Set(existingItems.map((item) => item.id));
        const pending = readPendingDanceJob(session.publicKey);
        const jobs = pending
          ? [await api.remoteJob(pending.jobId)]
          : (await api.remoteJobs({ limit: 50, runtime: "wan-animate" })).jobs;
        let recovered: BrowserWorkspaceItem | null = null;
        for (const job of jobs) {
          if (cancelled || job.status !== "succeeded" && job.status !== "completed") continue;
          const sequence = pending?.jobId === job.id ? pending.sequence : job.request.parameters.sequence;
          if (!sequence || typeof sequence !== "object" || !Array.isArray((sequence as { segments?: unknown }).segments)) continue;
          const itemId = `remote-generative-dance-${job.id}`;
          if (existingIds.has(itemId)) {
            if (pending?.jobId === job.id) clearPendingDanceJob(session.publicKey, job.id);
            continue;
          }
          const requestTitle = typeof job.request.metadata?.title === "string" ? job.request.metadata.title : "Generative dance";
          recovered = await persistDanceJob(job, pending?.jobId === job.id ? pending.title : requestTitle, sequence);
          existingIds.add(recovered.id);
          if (pending?.jobId === job.id) clearPendingDanceJob(session.publicKey, job.id);
        }
        if (!cancelled && recovered) {
          setLatestDanceLoop(recovered);
          setDanceMessage("Recovered the completed generative dance and saved it to Private Assets.");
          notifyWorkspaceChanged();
        }
      } catch (error) {
        console.warn("[generative-dance] completed job recovery deferred", error);
      }
    };
    void recoverCompletedDanceJobs();
    return () => { cancelled = true; };
  }, [session.authenticated, session.publicKey]);

  useEffect(() => {
    if (!session.authenticated || !session.publicKey) return;
    const pending = readPendingAvatarJob(session.publicKey);
    if (!pending) return;
    let cancelled = false;
    const recover = async () => {
      try {
        const job = await api.remoteJob(pending.jobId);
        if (!TERMINAL_REMOTE_JOB_STATUSES.has(job.status)) return;
        if (job.status !== "succeeded" && job.status !== "completed") {
          clearPendingAvatarJob(session.publicKey, pending.jobId);
          return;
        }
        const saved = await persistAvatarJob(job, pending.title);
        if (cancelled) return;
        clearPendingAvatarJob(session.publicKey, pending.jobId);
        setGeneratedAvatarPreview({ id: saved.previewId, title: pending.title, url: saved.previewUrl });
        setAvatarId(saved.previewId);
        setAvatarMessage("Recovered the completed avatar image and saved it to Private Assets.");
        notifyWorkspaceChanged();
      } catch (error) {
        console.warn("[generative-avatar] pending job recovery deferred", error);
      }
    };
    void recover();
    return () => { cancelled = true; };
  }, [session.authenticated, session.publicKey]);

  const addClip = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name)) {
      setDanceMessage("Choose an MP4, WebM, MOV, or MKV dance video.");
      return;
    }
    const currentEnd = clips.reduce((end, clip) => end + durationFor(clip), 0);
    if (GENERATIVE_DANCE_MAX_DURATION_SECONDS - currentEnd < MIN_CLIP_SECONDS) {
      setDanceMessage(`The sequence is already at the ${GENERATIVE_DANCE_MAX_DURATION_SECONDS}-second limit.`);
      return;
    }
    const id = crypto.randomUUID();
    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : MAX_WINDOW_SECONDS;
      URL.revokeObjectURL(objectUrl);
      const available = Math.max(0, GENERATIVE_DANCE_MAX_DURATION_SECONDS - currentEnd);
      const trimEnd = Math.min(duration, available);
      setClips((current) => {
        const offset = current.reduce((end, clip) => end + durationFor(clip), 0);
        const currentAvailable = GENERATIVE_DANCE_MAX_DURATION_SECONDS - offset;
        if (currentAvailable < MIN_CLIP_SECONDS) return current;
        const next: DriverClip = { id, title: file.name.replace(/\.[^.]+$/, ""), file, durationSeconds: duration, trimStartSeconds: 0, trimEndSeconds: trimEnd, offsetSeconds: 0, prompt: dancePrompt, translateX: 0, translateY: 0, scale: 1, rotationDegrees: 0 };
        return compactClips([...current, next]);
      });
      setDanceMessage(duration > trimEnd + 0.01 ? `This clip was trimmed to keep the sequence within ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.` : null);
      setSelectedClipId(id);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setDanceMessage("The dance video duration could not be read.");
    };
  };

  const addSavedDriver = async () => {
    const selected = savedDriverItems.find((item) => item.id === savedDriverId)?.item;
    const sourceUrl = selected ? sourceUrlFromDanceItem(selected) : "";
    if (!selected || !sourceUrl) {
      setDanceMessage("Choose a saved generative dance with a public video source.");
      return;
    }
    try {
      const response = await fetch(sourceUrl, { credentials: "include" });
      if (!response.ok) throw new Error("The saved dance video could not be loaded.");
      const blob = await response.blob();
      addClip(new File([blob], `${selected.title}.mp4`, { type: blob.type || "video/mp4" }));
      setSavedDriverId("");
    } catch (error: unknown) {
      setDanceMessage(error instanceof Error ? error.message : "The saved dance video could not be loaded.");
    }
  };

  const updateClip = (id: string, patch: Partial<DriverClip>) => setClips((current) => compactClips(current.map((clip) => {
    if (clip.id !== id) return clip;
    const next = { ...clip, ...patch };
    const trimStartSeconds = Math.max(0, Math.min(next.durationSeconds - MIN_CLIP_SECONDS, next.trimStartSeconds));
    const trimEndSeconds = Math.max(trimStartSeconds + MIN_CLIP_SECONDS, Math.min(next.durationSeconds, next.trimEndSeconds));
    return { ...next, trimStartSeconds, trimEndSeconds };
  })));
  const removeClip = (id: string) => { setClips((current) => compactClips(current.filter((clip) => clip.id !== id))); setSelectedClipId((current) => current === id ? null : current); };
  const moveClip = (id: string, direction: -1 | 1) => setClips((current) => {
    const index = current.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return compactClips(next);
  });

  const cutSelectedAtCursor = (cutAtSeconds = cursorSeconds) => {
    if (!selectedClipId) return;
    setClips((current) => {
      const selected = current.find((clip) => clip.id === selectedClipId);
      if (!selected) return current;
      const localOffset = cutAtSeconds - selected.offsetSeconds;
      const duration = durationFor(selected);
      if (localOffset <= MIN_CLIP_SECONDS || localOffset >= duration - MIN_CLIP_SECONDS) return current;
      const splitSourceTime = selected.trimStartSeconds + localOffset;
      const first = { ...selected, id: crypto.randomUUID(), title: `${selected.title} A`, trimEndSeconds: splitSourceTime };
      const second = { ...selected, id: crypto.randomUUID(), title: `${selected.title} B`, trimStartSeconds: splitSourceTime, offsetSeconds: 0 };
      setSelectedClipId(second.id);
      return compactClips(current.flatMap((clip) => clip.id === selected.id ? [first, second] : [clip]));
    });
  };

  const generateAvatar = async () => {
    if (!avatarTitle.trim() || !avatarDescription.trim() || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage(null);
    const title = avatarTitle.trim();
    try {
      const inputs = avatarReference ? [(await api.uploadRemoteGenerationAvatarSource(avatarReference, "reference-image")).input] : [];
      const job = await submit({ ...avatarRequest, inputs }, async (queued) => {
        if (session.publicKey) writePendingAvatarJob(session.publicKey, { jobId: queued.id, title });
      });
      const saved = await persistAvatarJob(job, title);
      if (session.publicKey) clearPendingAvatarJob(session.publicKey, job.id);
      setAvatarMessage("Avatar image generated and saved to Private Assets.");
      setGeneratedAvatarPreview({ id: saved.previewId, title, url: saved.previewUrl });
      setAvatarId(saved.previewId);
      notifyWorkspaceChanged();
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "The avatar image could not be generated.");
    } finally { setAvatarBusy(false); }
  };

  const generateDance = async () => {
    if (!sequence || !selectedAvatar || danceBusy) return;
    const avatarInput = inputFromAvatar(selectedAvatar);
    if (!avatarInput) { setDanceMessage("Choose a generated avatar image with a CDN reference."); return; }
    if (sequence.durationSeconds > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01) { setDanceMessage(`The dance sequence cannot exceed ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.`); return; }
    if (sequence.segments.some((segment) => segment.windows.some((window) => window.sourceEndSeconds - window.sourceStartSeconds > MAX_WINDOW_SECONDS + 0.05))) { setDanceMessage("One or more clips exceed the worker window. Trim them or split the source clip."); return; }
    setDanceBusy(true);
    setDanceMessage(null);
    try {
      const uploaded: RemoteGenerationInput[] = [];
      for (const clip of clips) {
        const input = (await api.uploadRemoteGenerationSource(clip.file)).input;
        uploaded.push({ ...input, id: `driver-${clip.id}`, role: "driver", durationSeconds: clip.durationSeconds });
      }
      const title = danceTitle.trim() || "Generative dance";
      const job = await submit({ ...danceRequest, inputs: [avatarInput, ...uploaded] }, async (queued) => {
        if (session.publicKey && sequence) writePendingDanceJob(session.publicKey, { jobId: queued.id, title, sequence });
      });
      if (job.status !== "succeeded" && job.status !== "completed") {
        if (session.publicKey) clearPendingDanceJob(session.publicKey, job.id);
        throw new Error(job.errorMessage || "The generative dance could not be completed.");
      }
      const savedDanceLoop = await persistDanceJob(job, title, sequence);
      if (session.publicKey) clearPendingDanceJob(session.publicKey, job.id);
      setLatestDanceLoop(savedDanceLoop);
      setDanceMessage("Generative dance video saved to Private Assets.");
      notifyWorkspaceChanged();
    } catch (error: unknown) {
      setDanceMessage(error instanceof Error ? error.message : "The generative dance could not be completed.");
    } finally { setDanceBusy(false); }
  };

  const balanceLabel = !session.authenticated ? "Connect wallet" : walletBalance ? `${formatToken(walletBalance.amountAtomic, walletBalance.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}` : walletBalanceLoading ? "Checking..." : "Unavailable";
  const avatarHolderBaseOnlyFree = holderFreeAvatar && (!avatarPricing || avatarPricing.priceUsd === 0);
  const danceHolderBaseOnlyFree = holderFreeDance && (!pricing || pricing.priceUsd === 0);
  const avatarCost = avatarHolderBaseOnlyFree ? "Free for holders · signature required" : avatarPricing ? `${formatToken(avatarPricing.amountAtomic, avatarPricing.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}${holderFreeAvatar ? " · base waived" : ""}` : pricingConfig ? "Checking price..." : "Price unavailable";
  const danceCost = danceHolderBaseOnlyFree ? "Free for holders · signature required" : pricing ? `${formatToken(pricing.amountAtomic, pricing.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}${holderFreeDance ? " · base waived" : ""}` : pricingConfig ? "Checking price..." : "Price unavailable";

  return <section className="generative-dance-panel" aria-labelledby="generative-dance-title">
    <header className="generative-dance-panel__header"><div><span className="dance-engine-eyebrow"><Sparkles size={14} aria-hidden="true" /> Generative dance</span><h2 id="generative-dance-title">Create a dancer, then animate a sequence</h2><p>Generate a character image, arrange driver clips, and send one normalized sequence to Wan Animate.</p></div><span className="generative-dance-panel__window">{GENERATIVE_DANCE_MAX_DURATION_SECONDS}s max sequence · {MAX_FRAMES_PER_GENERATION} frames / window</span></header>
    <div className="generative-dance-panel__grid">
      <section className="generative-dance-card generative-dance-avatar-card"><div className="generative-dance-card__heading"><div><span className="dance-engine-eyebrow"><ImageIcon size={14} aria-hidden="true" /> Step 01</span><h3>Generate avatar image</h3></div></div>
        <label className="dance-creation-field"><span>Avatar title</span><input value={avatarTitle} onInput={(event) => setAvatarTitle(event.currentTarget.value)} placeholder="Purple cowboy frog" maxLength={120} /></label>
        <label className="dance-creation-field"><span>Character description</span><textarea value={avatarDescription} onInput={(event) => setAvatarDescription(event.currentTarget.value)} placeholder="A purple horse wearing a baseball cap" rows={4} /></label>
        <label className="dance-creation-file rhythm-beats-secondary-button"><Upload size={15} aria-hidden="true" /><span>{avatarReference?.name || "Optional reference image"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAvatarReference(event.currentTarget.files?.[0] ?? null)} /></label>
        {generatedAvatarPreview ? <GenerativeDanceAvatarPreview url={generatedAvatarPreview.url} title={generatedAvatarPreview.title} /> : null}
        <div className="generative-dance-payment"><div><span>Wallet</span><strong>{balanceLabel}</strong><button type="button" className="dance-station-cost-estimator__refresh" onClick={() => setWalletRefresh((value) => value + 1)} aria-label="Refresh wallet balance" title="Refresh wallet balance"><RefreshCw size={14} aria-hidden="true" /></button></div><div className="dance-station-payment-currency" role="radiogroup" aria-label={avatarHolderBaseOnlyFree ? "Holder payment benefit" : "Avatar payment currency"}>{avatarHolderBaseOnlyFree ? <label className="is-active"><input type="radio" checked readOnly disabled={avatarBusy} /><span>Free for holders</span></label> : (["FACELESS", "SOL"] as const).map((currency) => <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}><input type="radio" name="generative-avatar-currency" checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} /><span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span></label>)}</div><div className="dance-creation-price-row"><span>Avatar image</span><strong>{avatarCost}</strong></div></div>
        <button type="button" className="rhythm-beats-submit" disabled={avatarBusy || !avatarTitle.trim() || !avatarDescription.trim() || !avatarPricing} onClick={() => void generateAvatar()}>{avatarBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Generating</> : <><WandSparkles size={15} aria-hidden="true" /> Generate avatar image</>}</button>
        {avatarMessage ? <p className="generative-dance-message" role="status">{avatarMessage}</p> : null}
      </section>
      <section className="generative-dance-card generative-dance-sequence-card"><div className="generative-dance-card__heading"><div><span className="dance-engine-eyebrow"><Video size={14} aria-hidden="true" /> Step 02</span><h3>Build generative dance</h3></div><label className="generative-dance-title-input"><span>Asset title</span><input value={danceTitle} onInput={(event) => setDanceTitle(event.currentTarget.value)} /></label></div>
        <div className="generative-dance-sequence-settings"><label className="dance-creation-field"><span>Dancer image</span><select value={avatarId} onChange={(event) => setAvatarId(event.currentTarget.value)}><option value="">Choose a generated avatar</option>{avatarItems(workspaceItems, publicItems).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="dance-creation-field"><span>Overall direction</span><input value={dancePrompt} onInput={(event) => setDancePrompt(event.currentTarget.value)} /></label></div>
        {selectedAvatar && selectedAvatarPreviewUrl ? <GenerativeDanceAvatarPreview url={selectedAvatarPreviewUrl} title={selectedAvatar.title} compact /> : null}
        <div className="generative-dance-postprocess" aria-label="Dance video quality options">
          <span className="generative-dance-postprocess__title">Output quality</span>
          <label><input type="checkbox" checked={enhancementEnabled} onChange={(event) => setEnhancementEnabled(event.currentTarget.checked)} /><span>2x enhancement</span></label>
          <label><input type="checkbox" checked={motionInterpolationEnabled} onChange={(event) => setMotionInterpolationEnabled(event.currentTarget.checked)} /><span>Motion interpolation · 48 FPS</span></label>
        </div>
        <div className="generative-dance-track-toolbar"><div><strong>Driver sequence</strong><span>{clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"} · ${sequence?.durationSeconds.toFixed(2)}s timeline` : "Add videos to create the sequence"}</span></div><div className="generative-dance-track-toolbar__actions">{savedDriverItems.length ? <><select value={savedDriverId} onChange={(event) => setSavedDriverId(event.currentTarget.value)} aria-label="Saved generative dance source"><option value="">Add saved dance</option>{savedDriverItems.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><button type="button" className="rhythm-beats-secondary-button" disabled={!savedDriverId} onClick={() => void addSavedDriver()}><Plus size={15} aria-hidden="true" /> Add saved</button></> : null}<label className="rhythm-beats-secondary-button"><Plus size={15} aria-hidden="true" /> Add driver video<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" onChange={(event) => { addClip(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} /></label></div></div>
        <GenerativeDanceSequenceTrack clips={clips} selectedClipId={selectedClipId} durationSeconds={sequence?.durationSeconds ?? 0} cursorSeconds={cursorSeconds} onCursorChange={setCursorSeconds} onSelectClip={setSelectedClipId} onUpdateClip={updateClip} onMoveClip={moveClip} onCutAtCursor={cutSelectedAtCursor} />
        <GenerativeDanceSourcePlayback clips={clips} durationSeconds={sequence?.durationSeconds ?? 0} cursorSeconds={cursorSeconds} onCursorChange={setCursorSeconds} />
        <div className="generative-dance-track" role="list" aria-label="Generative dance driver sequence">{clips.length ? clips.map((clip, index) => <article className={`generative-dance-clip${selectedClipId === clip.id ? " is-selected" : ""}`} key={clip.id} onClick={() => setSelectedClipId(clip.id)}><div className="generative-dance-clip__top"><strong>{index + 1}. {clip.title}</strong><span>{durationFor(clip).toFixed(2)}s · end-to-end</span><div><button type="button" onClick={(event) => { event.stopPropagation(); moveClip(clip.id, -1); }} disabled={index === 0} aria-label="Move clip earlier" title="Move clip earlier"><ChevronUp size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); moveClip(clip.id, 1); }} disabled={index === clips.length - 1} aria-label="Move clip later" title="Move clip later"><ChevronDown size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }} aria-label={`Remove ${clip.title}`} title="Remove clip"><Trash2 size={14} /></button></div></div><div className="generative-dance-clip__controls"><label><span>Trim in</span><input type="number" min="0" max={Math.max(0, clip.trimEndSeconds - 0.01)} step="0.01" value={clip.trimStartSeconds} onInput={(event) => updateClip(clip.id, { trimStartSeconds: Math.min(Number(event.currentTarget.value), clip.trimEndSeconds - 0.01) })} /></label><label><span>Trim out</span><input type="number" min={Math.min(clip.durationSeconds, clip.trimStartSeconds + 0.01)} max={clip.durationSeconds} step="0.01" value={clip.trimEndSeconds} onInput={(event) => updateClip(clip.id, { trimEndSeconds: Math.max(Number(event.currentTarget.value), clip.trimStartSeconds + 0.01) })} /></label><label className="generative-dance-clip__prompt"><span>Motion prompt</span><input value={clip.prompt} onInput={(event) => updateClip(clip.id, { prompt: event.currentTarget.value })} /></label></div><div className="generative-dance-clip__placement"><span>Normalized placement</span><label>X <input type="number" step="0.01" value={clip.translateX} onInput={(event) => updateClip(clip.id, { translateX: Number(event.currentTarget.value) })} /></label><label>Y <input type="number" step="0.01" value={clip.translateY} onInput={(event) => updateClip(clip.id, { translateY: Number(event.currentTarget.value) })} /></label><label>Scale <input type="number" min="0.5" max="2" step="0.01" value={clip.scale} onInput={(event) => updateClip(clip.id, { scale: Number(event.currentTarget.value) })} /></label><label>Rotate <input type="number" min="-180" max="180" step="1" value={clip.rotationDegrees} onInput={(event) => updateClip(clip.id, { rotationDegrees: Number(event.currentTarget.value) })} /></label></div><small>Worker windows: {splitWindows(clip, `driver-${clip.id}`).windows.length} · each at most {MAX_WINDOW_SECONDS.toFixed(2)}s · pelvis anchor (50%, 58%)</small></article>) : <div className="generative-dance-track__empty"><Video size={20} aria-hidden="true" /><strong>Your sequence is empty</strong><span>Add driver videos. Clips are joined end to end; stitches are created by the worker.</span></div>}</div>
        <div className="generative-dance-payment"><div><span>Wallet</span><strong>{balanceLabel}</strong></div><div className="dance-station-payment-currency" role="radiogroup" aria-label={danceHolderBaseOnlyFree ? "Holder payment benefit" : "Generative dance payment currency"}>{danceHolderBaseOnlyFree ? <label className="is-active"><input type="radio" checked readOnly disabled={danceBusy} /><span>Free for holders</span></label> : (["FACELESS", "SOL"] as const).map((currency) => <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}><input type="radio" name="generative-dance-currency" checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} /><span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span></label>)}</div><div className="dance-creation-price-row"><span>Generative dance loop</span><strong>{danceCost}</strong></div></div>
        <button type="button" className="rhythm-beats-submit" disabled={danceBusy || !sequence || sequence.durationSeconds > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01 || !selectedAvatar || !pricing} onClick={() => void generateDance()}>{danceBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Generating sequence</> : <><Save size={15} aria-hidden="true" /> Generate and save dance</>}</button>
        {danceMessage ? <p className={`generative-dance-message${/could not|failed|error|choose/i.test(danceMessage) ? " is-error" : ""}`} role="status">{/could not|failed|error/i.test(danceMessage) ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}{danceMessage}</p> : null}
        {pricingError ? <p className="generative-dance-message is-error" role="status">{pricingError}</p> : null}
      </section>
    </div>
    <GenerativeDanceLoopLibrary items={privateDanceLoops} />
  </section>;
}
