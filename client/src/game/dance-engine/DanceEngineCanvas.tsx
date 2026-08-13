import { useEffect, useRef } from "preact/hooks";
import type { DanceMotionClip } from "@faceless/shared";
import type { DanceBeat, DanceModelPreset, DanceRuntimeOptions, DanceRuntimeSnapshot } from "./types";
import { DanceRenderer } from "./DanceRenderer";

interface DanceEngineCanvasProps {
  audioRef: { current: HTMLAudioElement | null };
  beats: DanceBeat[];
  bpm: number;
  model: DanceModelPreset;
  options: DanceRuntimeOptions;
  capturedMotion: DanceMotionClip | null;
  capturedMotionEnabled: boolean;
  motionPlaybackPlaying?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
  onSnapshot: (snapshot: DanceRuntimeSnapshot) => void;
  onError: (message: string | null) => void;
}

export function DanceEngineCanvas({
  audioRef,
  beats,
  bpm,
  model,
  options,
  capturedMotion,
  capturedMotionEnabled,
  motionPlaybackPlaying = false,
  onCanvasReady,
  onSnapshot,
  onError
}: DanceEngineCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<DanceRenderer | null>(null);
  const beatsRef = useRef(beats);
  const bpmRef = useRef(bpm);
  const modelRef = useRef(model);
  const optionsRef = useRef(options);
  const onSnapshotRef = useRef(onSnapshot);
  const onErrorRef = useRef(onError);
  const capturedMotionRef = useRef(capturedMotion);
  const capturedMotionEnabledRef = useRef(capturedMotionEnabled);
  const motionPlaybackPlayingRef = useRef(motionPlaybackPlaying);
  const motionPlaybackStartedAtRef = useRef<number | null>(null);

  useEffect(() => { beatsRef.current = beats; }, [beats]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => {
    if (capturedMotionRef.current !== capturedMotion) {
      motionPlaybackStartedAtRef.current = null;
    }
    capturedMotionRef.current = capturedMotion;
  }, [capturedMotion]);
  useEffect(() => { capturedMotionEnabledRef.current = capturedMotionEnabled; }, [capturedMotionEnabled]);
  useEffect(() => {
    motionPlaybackPlayingRef.current = motionPlaybackPlaying;
    if (!motionPlaybackPlaying) motionPlaybackStartedAtRef.current = null;
  }, [motionPlaybackPlaying]);

  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new DanceRenderer(canvas);
    rendererRef.current = renderer;
    let frameId = 0;
    let disposed = false;
    let lastRenderAt = 0;

    const resizeObserver = new ResizeObserver(() => renderer.resize());
    resizeObserver.observe(canvas);

    void renderer.loadModel(modelRef.current).then(() => {
      // Model loading is asynchronous. Reapply motion props here because the
      // React effects can run before DanceRenderer has created its retargeter.
      renderer.setCapturedMotion(capturedMotionRef.current);
      renderer.setCapturedMotionEnabled(capturedMotionEnabledRef.current);
    }).catch((error: unknown) => {
      if (!disposed) onErrorRef.current(error instanceof Error ? error.message : "Unable to load the dance model.");
    });

    const frame = (now: number) => {
      if (disposed) return;
      if (document.visibilityState === "hidden") {
        frameId = window.requestAnimationFrame(frame);
        return;
      }
      const audio = audioRef.current;
      const motionClip = capturedMotionRef.current;
      let songTime = audio?.currentTime ?? 0;
      let isPlaying = Boolean(audio && !audio.paused && !audio.ended);
      if (motionPlaybackPlayingRef.current && motionClip) {
        motionPlaybackStartedAtRef.current ??= now;
        const elapsed = (now - motionPlaybackStartedAtRef.current) / 1000;
        songTime = motionClip.durationSeconds > 0 ? elapsed % motionClip.durationSeconds : 0;
        isPlaying = true;
      }
      const snapshot = renderer.update(
        songTime,
        isPlaying,
        bpmRef.current,
        beatsRef.current,
        optionsRef.current,
        modelRef.current
      );
      renderer.setQuality(optionsRef.current.reducedQuality);
      if (now - lastRenderAt >= 180 || !lastRenderAt) {
        lastRenderAt = now;
        onSnapshotRef.current(snapshot);
      }
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [audioRef]);

  useEffect(() => {
    rendererRef.current?.setCapturedMotion(capturedMotion);
  }, [capturedMotion]);

  useEffect(() => {
    rendererRef.current?.setCapturedMotionEnabled(capturedMotionEnabled);
  }, [capturedMotionEnabled]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const currentYaw = model.manifest?.orientation?.yawRadians ?? 0;
    const loadedYaw = modelRef.current.manifest?.orientation?.yawRadians ?? 0;
    if (!renderer || (model.id === modelRef.current.id && model.url === modelRef.current.url && currentYaw === loadedYaw)) return;
    modelRef.current = model;
    onErrorRef.current(null);
    void renderer.loadModel(model).then(() => {
      renderer.setCapturedMotion(capturedMotionRef.current);
      renderer.setCapturedMotionEnabled(capturedMotionEnabledRef.current);
    }).catch((error: unknown) => {
      onErrorRef.current(error instanceof Error ? error.message : "Unable to load the dance model.");
    });
  }, [model]);

  return <canvas ref={canvasRef} className="dance-engine-canvas" aria-label="Dance engine preview" />;
}
