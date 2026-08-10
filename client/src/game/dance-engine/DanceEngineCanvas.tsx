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

  useEffect(() => { beatsRef.current = beats; }, [beats]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { onSnapshotRef.current = onSnapshot; }, [onSnapshot]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

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

    void renderer.loadModel(modelRef.current).catch((error: unknown) => {
      if (!disposed) onErrorRef.current(error instanceof Error ? error.message : "Unable to load the dance model.");
    });

    const frame = (now: number) => {
      if (disposed) return;
      if (document.visibilityState === "hidden") {
        frameId = window.requestAnimationFrame(frame);
        return;
      }
      const audio = audioRef.current;
      const songTime = audio?.currentTime ?? 0;
      const isPlaying = Boolean(audio && !audio.paused && !audio.ended);
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
    if (!renderer || model.id === modelRef.current.id) return;
    modelRef.current = model;
    onErrorRef.current(null);
    void renderer.loadModel(model).catch((error: unknown) => {
      onErrorRef.current(error instanceof Error ? error.message : "Unable to load the dance model.");
    });
  }, [model]);

  return <canvas ref={canvasRef} className="dance-engine-canvas" aria-label="Dance engine preview" />;
}
