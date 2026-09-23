import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronLeft, ChevronRight, Download, Maximize2, Pause, Play, ScanLine } from "lucide-preact";
import { downloadAsset } from "../../lib/downloadAsset";

export interface VideoFramePlayerSource {
  id: string;
  title: string;
  url: string;
  downloadUrl?: string;
  frameRate: number;
  durationSeconds?: number;
}

export interface VideoFrameSelectionResult {
  blob: Blob;
  frameIndex: number;
  timeSeconds: number;
  frameRate: number;
  aspectRatio?: "16:9" | "9:16" | "1:1";
}

interface Props {
  source: VideoFramePlayerSource;
  disabled?: boolean;
  onUseAsFirstFrame: (selection: VideoFrameSelectionResult) => void | Promise<void>;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function aspectRatioForDimensions(width: number, height: number): "16:9" | "9:16" | "1:1" {
  const ratio = width / Math.max(1, height);
  if (ratio >= 1.35) return "16:9";
  if (ratio <= 0.82) return "9:16";
  return "1:1";
}

interface VideoThumbnail {
  frameIndex: number;
  dataUrl: string;
}

function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  if (Math.abs(video.currentTime - timeSeconds) < 0.002) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    const timeout = window.setTimeout(finish, 1200);
    video.addEventListener("seeked", finish, { once: true });
    video.currentTime = timeSeconds;
  });
}

export function VideoFramePlayer({ source, disabled = false, onUseAsFirstFrame }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [duration, setDuration] = useState(source.durationSeconds ?? 0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameCount, setFrameCount] = useState(Math.max(1, Math.round((source.durationSeconds ?? 1) * source.frameRate)));
  const [thumbnails, setThumbnails] = useState<VideoThumbnail[]>([]);
  const [playing, setPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const hideControlsTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setDuration(source.durationSeconds ?? 0);
    setFrameIndex(0);
    setFrameCount(Math.max(1, Math.round((source.durationSeconds ?? 1) * source.frameRate)));
    setThumbnails([]);
    setPlaying(false);
    setControlsVisible(true);
    setError("");
  }, [source.id, source.durationSeconds, source.frameRate]);

  useEffect(() => () => {
    if (hideControlsTimeoutRef.current !== null) window.clearTimeout(hideControlsTimeoutRef.current);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (hideControlsTimeoutRef.current !== null) window.clearTimeout(hideControlsTimeoutRef.current);
    setControlsVisible(true);
    if (!playing) return;
    hideControlsTimeoutRef.current = window.setTimeout(() => setControlsVisible(false), 1200);
  }, [playing]);

  useEffect(() => {
    let cancelled = false;
    const thumbnailVideo = document.createElement("video");
    thumbnailVideo.muted = true;
    thumbnailVideo.preload = "auto";
    thumbnailVideo.playsInline = true;
    thumbnailVideo.src = source.url;

    const buildThumbnails = async () => {
      try {
        if (thumbnailVideo.readyState < 1) {
          await new Promise<void>((resolve, reject) => {
            const onMetadata = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(new Error("Thumbnail source unavailable")); };
            const cleanup = () => {
              thumbnailVideo.removeEventListener("loadedmetadata", onMetadata);
              thumbnailVideo.removeEventListener("error", onError);
            };
            thumbnailVideo.addEventListener("loadedmetadata", onMetadata, { once: true });
            thumbnailVideo.addEventListener("error", onError, { once: true });
          });
        }
        const sourceDuration = Number.isFinite(thumbnailVideo.duration) && thumbnailVideo.duration > 0
          ? thumbnailVideo.duration
          : source.durationSeconds ?? 0;
        if (!sourceDuration || !thumbnailVideo.videoWidth || !thumbnailVideo.videoHeight) return;
        const canvas = document.createElement("canvas");
        const thumbnailWidth = 180;
        canvas.width = thumbnailWidth;
        canvas.height = Math.max(1, Math.round(thumbnailWidth * thumbnailVideo.videoHeight / thumbnailVideo.videoWidth));
        const context = canvas.getContext("2d");
        if (!context) return;
        const thumbnailCount = 5;
        const nextThumbnails: VideoThumbnail[] = [];
        for (let index = 0; index < thumbnailCount; index += 1) {
          if (cancelled) return;
          const time = thumbnailCount === 1 ? 0 : Math.min(sourceDuration - 0.001, sourceDuration * index / (thumbnailCount - 1));
          await seekVideo(thumbnailVideo, Math.max(0, time));
          if (cancelled) return;
          context.drawImage(thumbnailVideo, 0, 0, canvas.width, canvas.height);
          nextThumbnails.push({
            frameIndex: Math.max(0, Math.min(Math.max(1, Math.round(sourceDuration * source.frameRate)) - 1, Math.round(time * source.frameRate))),
            dataUrl: canvas.toDataURL("image/jpeg", 0.78),
          });
        }
        if (!cancelled) setThumbnails(nextThumbnails);
      } catch {
        if (!cancelled) setThumbnails([]);
      } finally {
        thumbnailVideo.pause();
        thumbnailVideo.removeAttribute("src");
        thumbnailVideo.load();
      }
    };

    void buildThumbnails();
    return () => {
      cancelled = true;
      thumbnailVideo.pause();
      thumbnailVideo.removeAttribute("src");
      thumbnailVideo.load();
    };
  }, [source.id, source.url, source.durationSeconds, source.frameRate]);

  const seekToFrame = (nextFrame: number) => {
    const video = videoRef.current;
    const clamped = Math.max(0, Math.min(frameCount - 1, Math.round(nextFrame)));
    setFrameIndex(clamped);
    if (video) video.currentTime = clamped / source.frameRate;
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setError("The video could not be played."));
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const revealPlaybackControls = () => {
    setControlsVisible(true);
    if (hideControlsTimeoutRef.current !== null) window.clearTimeout(hideControlsTimeoutRef.current);
    if (playing) {
      hideControlsTimeoutRef.current = window.setTimeout(() => setControlsVisible(false), 1200);
    }
  };

  const toggleFullscreen = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      setError("Fullscreen playback is not available in this browser.");
    }
  };

  const captureCurrentFrame = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setError("Wait for the video frame to load before selecting it.");
      return;
    }
    setCapturing(true);
    setError("");
    const snappedFrame = Math.max(0, Math.min(frameCount - 1, Math.round(video.currentTime * source.frameRate)));
    const snappedTime = snappedFrame / source.frameRate;
    try {
      video.pause();
      setPlaying(false);
      video.currentTime = snappedTime;
      await new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
        };
        if (Math.abs(video.currentTime - snappedTime) < 0.002) settle();
        else video.addEventListener("seeked", settle, { once: true });
      });
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas capture is unavailable in this browser.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The selected frame could not be captured.");
      setFrameIndex(snappedFrame);
      await onUseAsFirstFrame({ blob, frameIndex: snappedFrame, timeSeconds: snappedTime, frameRate: source.frameRate, aspectRatio: aspectRatioForDimensions(video.videoWidth, video.videoHeight) });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The selected frame could not be captured.");
    } finally {
      setCapturing(false);
    }
  };

  const downloadVideo = async () => {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      await downloadAsset(source.url, `${source.title}.mp4`, source.downloadUrl);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The video could not be downloaded.");
    } finally {
      setDownloading(false);
    }
  };

  return <div className="dance-station-video-frame-player">
    <div ref={stageRef} className="dance-station-video-frame-player__stage" onPointerMove={revealPlaybackControls} onFocusCapture={revealPlaybackControls}>
      <video
        ref={videoRef}
        className="dance-station-video-preview__player"
        src={source.url}
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const nextDuration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : source.durationSeconds ?? 0;
          setDuration(nextDuration);
          setFrameCount(Math.max(1, Math.round(nextDuration * source.frameRate)));
          event.currentTarget.currentTime = 0;
        }}
        onTimeUpdate={(event) => setFrameIndex(Math.max(0, Math.min(frameCount - 1, Math.round(event.currentTarget.currentTime * source.frameRate))))}
        onPlay={() => { setPlaying(true); setControlsVisible(true); }}
        onPause={() => { setPlaying(false); setControlsVisible(true); }}
        onEnded={() => { setPlaying(false); setControlsVisible(true); }}
        onError={() => setError("The video preview could not be loaded.")}
      />
      <div className={`dance-station-video-frame-player__overlay${controlsVisible ? " is-visible" : ""}`}>
        <button type="button" className="dance-station-video-frame-player__play" onClick={togglePlayback} disabled={disabled || capturing} aria-label={playing ? "Pause video" : "Play video"} title={playing ? "Pause video" : "Play video"}>
          {playing ? <Pause aria-hidden="true" size={14} strokeWidth={2.2} /> : <Play aria-hidden="true" size={14} strokeWidth={2.2} />}
        </button>
        <button type="button" className="dance-station-video-frame-player__fullscreen" onClick={() => void toggleFullscreen()} disabled={disabled || capturing} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
          <Maximize2 aria-hidden="true" size={14} strokeWidth={2.1} />
        </button>
        <input
          className="dance-station-video-frame-player__timeline"
          type="range"
          min="0"
          max={Math.max(0, frameCount - 1)}
          step="1"
          value={frameIndex}
          onInput={(event) => seekToFrame(Number((event.currentTarget as HTMLInputElement).value))}
          disabled={disabled || capturing}
          aria-label="Video frame"
        />
      </div>
    </div>
    <canvas ref={canvasRef} className="dance-station-video-frame-player__canvas" aria-hidden="true" />
    <div className="dance-station-video-frame-player__readout">
      <span>{formatTime(frameIndex / source.frameRate)} / {formatTime(duration)}</span>
      <span>Frame {frameIndex + 1}/{frameCount}</span>
    </div>
    <div className="dance-station-video-frame-player__filmstrip-row">
      <button type="button" className="dance-station-video-frame-player__skip" onClick={() => seekToFrame(frameIndex - 1)} disabled={disabled || capturing || !frameCount || frameIndex <= 0} aria-label="Previous frame" title="Previous frame"><ChevronLeft aria-hidden="true" size={20} /></button>
      <div className="dance-station-video-frame-player__filmstrip" aria-label="Video frame preview">
        {thumbnails.length ? thumbnails.map((thumbnail) => {
          const isSelected = Math.abs(frameIndex - thumbnail.frameIndex) <= Math.max(1, Math.round(frameCount / 12));
          return <button type="button" key={thumbnail.frameIndex} className={`dance-station-video-frame-player__thumbnail${isSelected ? " is-selected" : ""}`} onClick={() => seekToFrame(thumbnail.frameIndex)} disabled={disabled || capturing} aria-label={`Seek to frame ${thumbnail.frameIndex + 1}`}><img src={thumbnail.dataUrl} alt="" /></button>;
        }) : Array.from({ length: 5 }, (_, index) => <span key={index} className="dance-station-video-frame-player__thumbnail is-placeholder" aria-hidden="true" />)}
        <span className="dance-station-video-frame-player__filmstrip-playhead" style={{ left: `${frameCount > 1 ? (frameIndex / (frameCount - 1)) * 100 : 0}%` }} aria-hidden="true" />
      </div>
      <button type="button" className="dance-station-video-frame-player__skip" onClick={() => seekToFrame(frameIndex + 1)} disabled={disabled || capturing || !frameCount || frameIndex >= frameCount - 1} aria-label="Next frame" title="Next frame"><ChevronRight aria-hidden="true" size={20} /></button>
    </div>
    <div className="dance-station-video-frame-player__actions">
      <button type="button" className="dance-station-video-frame-player__action dance-station-video-frame-player__action--primary" onClick={() => void captureCurrentFrame()} disabled={disabled || capturing}>
        <ScanLine aria-hidden="true" size={17} strokeWidth={2} />
        {capturing ? "Capturing frame" : "Use as first frame"}
      </button>
      <button type="button" className="dance-station-video-frame-player__action dance-station-video-preview__download" onClick={() => void downloadVideo()} disabled={disabled || capturing || downloading}>
        <Download aria-hidden="true" size={17} strokeWidth={2} />{downloading ? "Downloading..." : "Download video"}
      </button>
    </div>
    {error ? <p className="dance-station-error" role="alert">{error}</p> : null}
  </div>;
}
