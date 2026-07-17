import { useRef } from "preact/hooks";

interface WaveformVisualProps {
  seed: string;
  waveformUrl?: string;
  progress?: number;
  interactive?: boolean;
  onSeek?: (ratio: number) => void;
  className?: string;
  ariaLabel?: string;
}

export function WaveformVisual({ seed, waveformUrl, progress, interactive = false, onSeek, className = "", ariaLabel = "Audio progress" }: WaveformVisualProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const progressRatio = clampRatio(progress ?? 0);
  const hasProgress = typeof progress === "number";
  const imageStyle = waveformUrl ? `--audio-waveform-url: url("${waveformUrl.replaceAll('"', '\\"')}")` : undefined;
  const bars = fallbackBars(seed);

  const seekFromPointer = (clientX: number) => {
    if (!interactive || !onSeek) return;
    const bounds = rootRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    onSeek(clampRatio((clientX - bounds.left) / bounds.width));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!interactive || !onSeek) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = progressRatio - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = progressRatio + step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = 1;
    if (next === undefined) return;
    event.preventDefault();
    onSeek(clampRatio(next));
  };

  const shape = (played: boolean) => waveformUrl ? (
    <span className={`audio-waveform-visual__asset${played ? " audio-waveform-visual__asset--played" : ""}`} style={imageStyle} aria-hidden="true" />
  ) : (
    <span className={`audio-waveform-visual__fallback${played ? " audio-waveform-visual__fallback--played" : ""}`} aria-hidden="true">
      {bars.map((height, index) => <i key={index} style={`--audio-waveform-bar-height: ${height}%`} />)}
    </span>
  );

  return (
    <div
      ref={rootRef}
      className={`audio-waveform-visual${interactive ? " audio-waveform-visual--interactive" : ""}${className ? ` ${className}` : ""}`}
      role={interactive ? "slider" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 100 : undefined}
      aria-valuenow={interactive ? Math.round(progressRatio * 100) : undefined}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (!interactive) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        seekFromPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (interactive && event.buttons === 1) seekFromPointer(event.clientX);
      }}
    >
      {shape(false)}
      {hasProgress ? (
        <span
          className="audio-waveform-visual__played"
          style={`clip-path: inset(0 ${100 - progressRatio * 100}% 0 0)`}
          aria-hidden="true"
        >
          {shape(true)}
        </span>
      ) : null}
    </div>
  );
}

function clampRatio(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function fallbackBars(seed: string, count = 64): number[] {
  let value = 0;
  for (const character of seed) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, index) => {
    value = (value * 1664525 + 1013904223 + index) >>> 0;
    return 18 + (value % 72);
  });
}
