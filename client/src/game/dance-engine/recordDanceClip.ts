export interface DanceAudioCaptureRoute {
  audio: HTMLAudioElement;
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  destination: MediaStreamAudioDestinationNode;
}

export interface DanceClipRecordingResult {
  blob: Blob;
  mimeType: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

interface DanceClipRecordingOptions {
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
  route: DanceAudioCaptureRoute;
  startSeconds: number;
  endSeconds: number;
  onProgress?: (elapsedSeconds: number, durationSeconds: number) => void;
}

function audioContextConstructor(): typeof AudioContext | null {
  const browserWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return window.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

export function createDanceAudioCaptureRoute(audio: HTMLAudioElement): DanceAudioCaptureRoute {
  const Constructor = audioContextConstructor();
  if (!Constructor) throw new Error("This browser does not support audio capture.");
  const context = new Constructor({ latencyHint: "interactive" });
  const source = context.createMediaElementSource(audio);
  const destination = context.createMediaStreamDestination();
  source.connect(context.destination);
  source.connect(destination);
  return { audio, context, source, destination };
}

export async function disposeDanceAudioCaptureRoute(route: DanceAudioCaptureRoute | null): Promise<void> {
  if (!route) return;
  route.source.disconnect();
  route.destination.disconnect();
  if (route.context.state !== "closed") await route.context.close();
}

function recordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ].find((value) => MediaRecorder.isTypeSupported(value)) ?? null;
}

function seekAudio(audio: HTMLAudioElement, timeSeconds: number): Promise<void> {
  if (Math.abs(audio.currentTime - timeSeconds) < 0.005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The song could not seek to the selected start time.")); };
    const cleanup = () => {
      audio.removeEventListener("seeked", onSeeked);
      audio.removeEventListener("error", onError);
    };
    audio.addEventListener("seeked", onSeeked, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.currentTime = timeSeconds;
  });
}

export async function recordDanceClip(options: DanceClipRecordingOptions): Promise<DanceClipRecordingResult> {
  const mimeType = recordingMimeType();
  if (!mimeType) throw new Error("This browser cannot record a synchronized dance video.");
  if (!options.canvas.captureStream) throw new Error("This browser cannot capture the dance stage.");
  if (options.route.audio !== options.audio) throw new Error("The song changed. Select the clip again before recording.");

  const duration = Number.isFinite(options.audio.duration) ? options.audio.duration : 0;
  const startSeconds = Math.max(0, options.startSeconds);
  const endSeconds = Math.min(duration, options.endSeconds);
  if (!duration || endSeconds <= startSeconds || endSeconds - startSeconds < 0.05) {
    throw new Error("Choose a clip range that is at least 0.05 seconds long.");
  }

  const canvasStream = options.canvas.captureStream(30);
  const audioTracks = options.route.destination.stream.getAudioTracks();
  if (!audioTracks.length) {
    canvasStream.getTracks().forEach((track) => track.stop());
    throw new Error("The song audio could not be attached to the recording.");
  }
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks.map((track) => track.clone())
  ]);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  const selectedDuration = endSeconds - startSeconds;
  let recorderError: Error | null = null;
  let stopResolve: (() => void) | null = null;
  const stopped = new Promise<void>((resolve) => { stopResolve = resolve; });
  const stopRecorder = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const onData = (event: BlobEvent) => { if (event.data.size) chunks.push(event.data); };
  const onError = (event: Event) => {
    const mediaError = (event as Event & { error?: DOMException }).error;
    recorderError = new Error(mediaError?.message || "The dance video recorder failed.");
    stopRecorder();
  };
  const onStop = () => stopResolve?.();
  const onTimeUpdate = () => {
    const elapsed = Math.max(0, options.audio.currentTime - startSeconds);
    options.onProgress?.(Math.min(selectedDuration, elapsed), selectedDuration);
    if (options.audio.currentTime >= endSeconds - 0.01) stopRecorder();
  };
  let progressTimer: number | null = null;
  recorder.addEventListener("dataavailable", onData);
  recorder.addEventListener("error", onError);
  recorder.addEventListener("stop", onStop, { once: true });
  options.audio.addEventListener("timeupdate", onTimeUpdate);
  try {
    options.audio.pause();
    await seekAudio(options.audio, startSeconds);
    await options.route.context.resume();
    recorder.start(200);
    progressTimer = window.setInterval(onTimeUpdate, 50);
    await options.audio.play();
    await stopped;
    if (recorderError) throw recorderError;
    if (!chunks.length) throw new Error("The dance video did not produce any recorded frames.");
    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      startSeconds,
      endSeconds,
      durationSeconds: selectedDuration
    };
  } finally {
    if (progressTimer !== null) window.clearInterval(progressTimer);
    options.audio.removeEventListener("timeupdate", onTimeUpdate);
    stopRecorder();
    options.audio.pause();
    options.audio.currentTime = Math.min(endSeconds, duration);
    stream.getTracks().forEach((track) => track.stop());
    canvasStream.getTracks().forEach((track) => track.stop());
  }
}
