import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { runtimeConfig } from "../../game/config/runtime";
import {
  buildPublicAudioUrl,
  fetchEnabledSongs,
  fetchPublicBeatEntry,
  resolveAccentBeats,
} from "../lib/publicSongApi";
import { useMeydaFeatures } from "../hooks/useMeydaFeatures";
import type {
  MeydaFrame,
  PlaygroundSongSummary,
  PlaygroundTab,
  RhythmFlameAudioControl,
  RhythmFlameAudioFrame,
  PlaygroundTrackData,
  RhythmFlameConfig,
  RhythmFlameMode,
  VisualizerMode,
} from "../types";
import { renderVisualizer } from "../visualizers/renderers";
import { RhythmFlameStage } from "./RhythmFlameStage";

interface PlaygroundVisualizerProps {
  homeHref: string;
}

const VISUALIZER_MODES: Array<{ id: VisualizerMode; label: string }> = [
  { id: "prism_bloom", label: "Prism Bloom" },
  { id: "nebula_ribbons", label: "Nebula Ribbons" },
  { id: "pulse_tunnel", label: "Pulse Tunnel" },
  { id: "lattice_dream", label: "Lattice Dream" },
  { id: "fractal_atlas", label: "Fractal Atlas" },
  { id: "celestial_gyroscope", label: "Celestial Gyroscope" },
  { id: "chaos_bloom", label: "Chaos Bloom" },
  { id: "quantum_veil", label: "Quantum Veil" },
  { id: "spectral_superformula", label: "Spectral Superformula" },
  { id: "harmonic_lissajous_manifold", label: "Harmonic Lissajous Manifold" },
  { id: "attractor_phase_weave", label: "Spectral Moire Tensor" },
  { id: "spectral_implicit_isolines", label: "Spectral Implicit Isolines" },
];

const PLAYGROUND_TABS: Array<{ id: PlaygroundTab; label: string }> = [
  { id: "visualizer", label: "Visualizer" },
  { id: "rhythm_flame", label: "Rhythm Flame" },
];

const RHYTHM_FLAME_MODES: Array<{ id: RhythmFlameMode; label: string }> = [
  { id: "flame", label: "Flame" },
  { id: "flame_ring", label: "Flame Ring" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTimeLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatRatioLabel(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function normalizeFlameAudioFrame(
  frame: MeydaFrame,
  beatPulse: number,
  beatImpulse: number
): RhythmFlameAudioFrame {
  const rms = 1 - Math.exp(-Math.max(0, frame.rms) * 20);
  const flux = 1 - Math.exp(-Math.max(0, frame.spectralFlux) * 26);
  const bass = clamp(frame.energyBass / 48, 0, 1);
  const mid = clamp(frame.energyMid / 42, 0, 1);
  const treble = clamp(frame.energyTreble / 36, 0, 1);
  const pulse = clamp(beatPulse / 1.8, 0, 1);
  const impulse = clamp(beatImpulse, 0, 1);
  return { rms, flux, bass, mid, treble, beatPulse: pulse, beatImpulse: impulse };
}

function findNextBeatIndex(
  beats: Array<{ timeSeconds: number; strength: number }>,
  timeSeconds: number
): number {
  let low = 0;
  let high = beats.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (beats[mid].timeSeconds < timeSeconds) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function positiveMod(value: number, divisor: number): number {
  if (!Number.isFinite(divisor) || divisor <= 0) return 0;
  const wrapped = value % divisor;
  return wrapped < 0 ? wrapped + divisor : wrapped;
}

function hashStringToUnit(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

function estimateTempoBpm(
  beats: Array<{ timeSeconds: number; strength: number }>,
  fallbackBpm: number
): number {
  if (beats.length < 3) {
    return fallbackBpm;
  }
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const delta = beats[i].timeSeconds - beats[i - 1].timeSeconds;
    if (Number.isFinite(delta) && delta >= 0.2 && delta <= 2) {
      intervals.push(delta);
    }
  }
  if (intervals.length < 2) {
    return fallbackBpm;
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] ?? 0;
  if (!Number.isFinite(median) || median <= 0) {
    return fallbackBpm;
  }
  return clamp(60 / median, 60, 220);
}

export function PlaygroundVisualizer({ homeHref }: PlaygroundVisualizerProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const beatPulseRef = useRef(0);
  const currentTimeStateRef = useRef(0);
  const durationStateRef = useRef(0);
  const renderSizeRef = useRef({ width: window.innerWidth, height: window.innerHeight });
  const pixelRatioRef = useRef(window.devicePixelRatio || 1);

  const [songs, setSongs] = useState<PlaygroundSongSummary[]>([]);
  const [selectedSongId, setSelectedSongId] = useState("");
  const [trackData, setTrackData] = useState<PlaygroundTrackData | null>(null);
  const [activeTab, setActiveTab] = useState<PlaygroundTab>("visualizer");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [mode, setMode] = useState<VisualizerMode>(runtimeConfig.playgroundDefaultMode);
  const [flameConfig, setFlameConfig] = useState<RhythmFlameConfig>({
    mode: runtimeConfig.playgroundRhythmFlameDefaultMode,
    extension: runtimeConfig.playgroundRhythmFlameDefaultExtension,
    intensity: runtimeConfig.playgroundRhythmFlameDefaultIntensity,
    chaos: runtimeConfig.playgroundRhythmFlameDefaultChaos,
    directionDegrees: runtimeConfig.playgroundRhythmFlameDefaultDirectionDegrees,
    coreColor: runtimeConfig.playgroundRhythmFlameDefaultCoreColor,
    midColor: runtimeConfig.playgroundRhythmFlameDefaultMidColor,
    edgeColor: runtimeConfig.playgroundRhythmFlameDefaultEdgeColor,
  });
  const [flameAudioControl, setFlameAudioControl] = useState<RhythmFlameAudioControl>({
    audioMaster: runtimeConfig.playgroundRhythmFlameAudioMasterDefault,
    meydaInfluence: runtimeConfig.playgroundRhythmFlameMeydaInfluenceDefault,
    beatInfluence: runtimeConfig.playgroundRhythmFlameBeatInfluenceDefault,
  });
  const [flameAudioFrame, setFlameAudioFrame] = useState<RhythmFlameAudioFrame>({
    rms: 0,
    flux: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beatPulse: 0,
    beatImpulse: 0,
  });
  const lastFlameAudioUiUpdateRef = useRef(0);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [songsPanelOpen, setSongsPanelOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const tempoBpm = useMemo(() => {
    const beats = trackData?.accentBeats ?? [];
    return estimateTempoBpm(beats, runtimeConfig.playgroundTempoDefaultBpm);
  }, [trackData]);

  const beatPeriodSeconds = useMemo(() => {
    const bpm = Math.max(1, tempoBpm);
    return 60 / bpm;
  }, [tempoBpm]);

  const beatAnchorSeconds = useMemo(() => {
    const beats = trackData?.accentBeats ?? [];
    return beats.length > 0 ? beats[0].timeSeconds : 0;
  }, [trackData]);

  const baseVariationSeed = useMemo(() => {
    if (!selectedSongId) return 0.5;
    return hashStringToUnit(selectedSongId);
  }, [selectedSongId]);

  const bindAudioElement = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  const audioUrl = useMemo(() => {
    if (!selectedSongId) return "";
    return buildPublicAudioUrl(runtimeConfig.beatApiBaseUrl, selectedSongId);
  }, [selectedSongId]);

  const selectedSong = useMemo(
    () => songs.find((song) => song.beatEntryId === selectedSongId) ?? null,
    [songs, selectedSongId]
  );

  const { featuresRef, resumeAudio, startAnalyzing, stopAnalyzing } = useMeydaFeatures(
    audioElement,
    {
      bufferSize: runtimeConfig.playgroundMeydaBufferSize,
      smoothing: runtimeConfig.playgroundFeatureSmoothing,
    }
  );

  useEffect(() => {
    let cancelled = false;
    const loadSongs = async () => {
      setLoadingSongs(true);
      setLoadError(null);
      try {
        const nextSongs = await fetchEnabledSongs(runtimeConfig.beatApiBaseUrl);
        if (cancelled) return;
        setSongs(nextSongs);
        setSelectedSongId((prev) => prev || nextSongs[0]?.beatEntryId || "");
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load songs.");
      } finally {
        if (!cancelled) setLoadingSongs(false);
      }
    };

    void loadSongs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSongId) {
      setTrackData(null);
      return;
    }
    const song = songs.find((row) => row.beatEntryId === selectedSongId);
    if (!song) {
      setTrackData(null);
      return;
    }

    let cancelled = false;
    const loadTrack = async () => {
      setLoadingTrack(true);
      setLoadError(null);
      try {
        const entry = await fetchPublicBeatEntry(runtimeConfig.beatApiBaseUrl, selectedSongId);
        if (cancelled) return;
        setTrackData({
          song,
          entry,
          accentBeats: resolveAccentBeats(entry).sort((a, b) => a.timeSeconds - b.timeSeconds),
        });
        beatIndexRef.current = 0;
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load song beats.");
      } finally {
        if (!cancelled) setLoadingTrack(false);
      }
    };

    void loadTrack();
    return () => {
      cancelled = true;
    };
  }, [selectedSongId, songs]);

  useEffect(() => {
    const handleResize = () => {
      renderSizeRef.current = { width: window.innerWidth, height: window.innerHeight };
      pixelRatioRef.current = window.devicePixelRatio || 1;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tick = (nowMs: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }

      const { width, height } = renderSizeRef.current;
      const pixelRatio = pixelRatioRef.current;
      const displayWidth = Math.max(1, Math.floor(width));
      const displayHeight = Math.max(1, Math.floor(height));
      const bufferWidth = Math.max(1, Math.floor(displayWidth * pixelRatio));
      const bufferHeight = Math.max(1, Math.floor(displayHeight * pixelRatio));

      if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
        canvas.width = bufferWidth;
        canvas.height = bufferHeight;
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }

      const audio = audioRef.current;
      const currentTime = audio?.currentTime ?? 0;
      const duration = Number.isFinite(audio?.duration) ? audio?.duration ?? 0 : 0;
      const beats = trackData?.accentBeats ?? [];

      if (duration > 0 && Math.abs(duration - durationStateRef.current) > 0.04) {
        durationStateRef.current = duration;
        setDurationSeconds(duration);
      }
      if (Math.abs(currentTime - currentTimeStateRef.current) > 0.05) {
        currentTimeStateRef.current = currentTime;
        setCurrentTimeSeconds(currentTime);
      }

      if (beats.length > 0) {
        const lastTickTime = lastTickTimeRef.current;
        if (currentTime + 0.05 < lastTickTime) {
          beatIndexRef.current = findNextBeatIndex(
            beats,
            Math.max(0, currentTime - runtimeConfig.playgroundBeatLookbackSeconds)
          );
        }
        while (
          beatIndexRef.current < beats.length &&
          beats[beatIndexRef.current].timeSeconds <=
            currentTime + runtimeConfig.playgroundBeatLookaheadSeconds
        ) {
          const beat = beats[beatIndexRef.current];
          const beatStrength = clamp(beat.strength, 0, 1);
          beatPulseRef.current = Math.max(
            beatPulseRef.current,
            0.5 + beatStrength * runtimeConfig.playgroundBeatStrengthBoost
          );
          beatIndexRef.current += 1;
        }
      }

      beatPulseRef.current = Math.max(
        0,
        beatPulseRef.current * runtimeConfig.playgroundBeatPulseDecay
      );
      lastTickTimeRef.current = currentTime;

      const songProgress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
      const beatPhase =
        positiveMod(currentTime - beatAnchorSeconds, beatPeriodSeconds) / beatPeriodSeconds;
      const barPhase =
        positiveMod(currentTime - beatAnchorSeconds, beatPeriodSeconds * 4) /
        (beatPeriodSeconds * 4);
      const beatImpulse = (() => {
        const beats = trackData?.accentBeats ?? [];
        if (beats.length === 0) return 0;
        const nextBeatTime = beats[beatIndexRef.current]?.timeSeconds;
        const prevBeatTime = beats[Math.max(0, beatIndexRef.current - 1)]?.timeSeconds;
        const deltaNext =
          Number.isFinite(nextBeatTime) && nextBeatTime !== undefined
            ? Math.abs(nextBeatTime - currentTime)
            : Number.POSITIVE_INFINITY;
        const deltaPrev =
          Number.isFinite(prevBeatTime) && prevBeatTime !== undefined
            ? Math.abs(prevBeatTime - currentTime)
            : Number.POSITIVE_INFINITY;
        const nearestDelta = Math.min(deltaNext, deltaPrev);
        const window = Math.max(0.03, beatPeriodSeconds * runtimeConfig.playgroundBeatImpulseWindowRatio);
        const normalizedDistance = clamp(1 - nearestDelta / window, 0, 1);
        return normalizedDistance * normalizedDistance;
      })();
      if (activeTab === "rhythm_flame" && nowMs - lastFlameAudioUiUpdateRef.current >= 50) {
        lastFlameAudioUiUpdateRef.current = nowMs;
        setFlameAudioFrame(
          normalizeFlameAudioFrame(featuresRef.current, beatPulseRef.current, beatImpulse)
        );
      }

      if (activeTab === "rhythm_flame") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, displayWidth, displayHeight);
      } else {
        renderVisualizer(mode, {
          ctx,
          width: displayWidth,
          height: displayHeight,
          timeSeconds: nowMs / 1000,
          frame: featuresRef.current,
          beatPulse: beatPulseRef.current,
          songProgress,
          tempoBpm,
          tempoNorm: clamp((tempoBpm - 80) / 100, 0, 1),
          beatPhase,
          barPhase,
          beatImpulse,
          variationAmount: runtimeConfig.playgroundVisualizerVariationAmount,
          variationSeed:
            baseVariationSeed +
            hashStringToUnit(
              `${selectedSongId}:${Math.floor(currentTime / Math.max(0.2, beatPeriodSeconds * 4))}`
            ),
          overscanRatio: runtimeConfig.playgroundVisualizerOverscanRatio,
        });
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    activeTab,
    baseVariationSeed,
    beatAnchorSeconds,
    beatPeriodSeconds,
    featuresRef,
    mode,
    selectedSongId,
    tempoBpm,
    trackData,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      setIsPlaying(true);
      setSongsPanelOpen(false);
      startAnalyzing();
    };
    const onPause = () => {
      setIsPlaying(false);
      stopAnalyzing();
    };
    const onEnded = () => {
      setIsPlaying(false);
      stopAnalyzing();
      const endedDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      currentTimeStateRef.current = endedDuration;
      setCurrentTimeSeconds(endedDuration);
    };
    const syncFromElement = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const nextTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      durationStateRef.current = nextDuration;
      currentTimeStateRef.current = nextTime;
      setDurationSeconds(nextDuration);
      setCurrentTimeSeconds(nextTime);
    };
    const onLoadedMetadata = () => {
      syncFromElement();
      beatIndexRef.current = findNextBeatIndex(trackData?.accentBeats ?? [], audio.currentTime || 0);
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", syncFromElement);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("durationchange", syncFromElement);
    audio.addEventListener("canplay", syncFromElement);
    audio.addEventListener("seeked", syncFromElement);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", syncFromElement);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("durationchange", syncFromElement);
      audio.removeEventListener("canplay", syncFromElement);
      audio.removeEventListener("seeked", syncFromElement);
    };
  }, [trackData, startAnalyzing, stopAnalyzing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopAnalyzing();
    setIsPlaying(false);
    audio.currentTime = 0;
    audio.load();
    setCurrentTimeSeconds(0);
    setDurationSeconds(0);
    currentTimeStateRef.current = 0;
    durationStateRef.current = 0;
    beatIndexRef.current = 0;
    beatPulseRef.current = 0;
    lastTickTimeRef.current = 0;
  }, [audioUrl, stopAnalyzing]);

  const handleTogglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (audio.paused) {
        await resumeAudio();
        await audio.play();
        startAnalyzing();
      } else {
        audio.pause();
        stopAnalyzing();
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Playback failed to start.");
    }
  };

  const handleStopPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    stopAnalyzing();
    audio.currentTime = 0;
    currentTimeStateRef.current = 0;
    setCurrentTimeSeconds(0);
    beatIndexRef.current = 0;
    beatPulseRef.current = 0;
    lastTickTimeRef.current = 0;
  };

  const handleSeek = (nextTimeSeconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const safe = clamp(nextTimeSeconds, 0, durationSeconds || 0);
    audio.currentTime = safe;
    currentTimeStateRef.current = safe;
    setCurrentTimeSeconds(safe);
    beatIndexRef.current = findNextBeatIndex(trackData?.accentBeats ?? [], safe);
    beatPulseRef.current = 0;
    lastTickTimeRef.current = safe;
  };

  const updateFlameConfigNumber =
    (field: "extension" | "intensity" | "chaos" | "directionDegrees", min: number, max: number) =>
    (event: Event) => {
      const value = Number.parseFloat((event.currentTarget as HTMLInputElement).value);
      setFlameConfig((previous) => ({
        ...previous,
        [field]: clamp(Number.isFinite(value) ? value : min, min, max),
      }));
    };

  const updateFlameConfigColor =
    (field: "coreColor" | "midColor" | "edgeColor") => (event: Event) => {
      const value = (event.currentTarget as HTMLInputElement).value;
      setFlameConfig((previous) => ({
        ...previous,
        [field]: value,
      }));
    };

  const updateFlameAudioControlNumber =
    (field: "audioMaster" | "meydaInfluence" | "beatInfluence") => (event: Event) => {
      const value = Number.parseFloat((event.currentTarget as HTMLInputElement).value);
      setFlameAudioControl((previous) => ({
        ...previous,
        [field]: clamp(Number.isFinite(value) ? value : 0, 0, 1),
      }));
    };

  return (
    <section className="playground-shell">
      <canvas ref={canvasRef} className="playground-canvas" />
      <audio ref={bindAudioElement} src={audioUrl} preload="metadata" />
      {activeTab === "rhythm_flame" ? (
        <RhythmFlameStage
          config={flameConfig}
          audioControl={flameAudioControl}
          audioFrame={flameAudioFrame}
          isPlaying={isPlaying}
        />
      ) : null}

      <header className="playground-overlay">
        <div className="playground-topbar">
          <a className="playground-link" href={homeHref}>
            Back Home
          </a>
          <div className="playground-title-block">
            <p className="playground-kicker">Faceless Playground</p>
            <h1>{activeTab === "rhythm_flame" ? "Rhythm Flame Playground" : "Realtime Audio Visualizer"}</h1>
            {selectedSong ? (
              <span className="playground-chip playground-active-song-chip">
                {selectedSong.title} · {trackData?.accentBeats.length ?? 0} saved beats
              </span>
            ) : null}
          </div>
          <div className="playground-topbar-tools">
            <div className="playground-tabs">
              {PLAYGROUND_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`playground-tab${activeTab === tab.id ? " active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {activeTab === "visualizer" ? (
              <div className="playground-mode">
                <label htmlFor="playground-mode-select">Visualizer Mode</label>
                <select
                  id="playground-mode-select"
                  value={mode}
                  onChange={(event) => setMode(event.currentTarget.value as VisualizerMode)}
                >
                  {VISUALIZER_MODES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="playground-topbar-actions">
                <div className="playground-mode">
                  <label htmlFor="playground-flame-mode-select">Flame Mode</label>
                  <select
                    id="playground-flame-mode-select"
                    value={flameConfig.mode}
                    onChange={(event) =>
                      setFlameConfig((previous) => ({
                        ...previous,
                        mode: event.currentTarget.value as RhythmFlameMode,
                      }))
                    }
                  >
                    {RHYTHM_FLAME_MODES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="secondary playground-controls-toggle"
                  onClick={() => setControlsVisible((previous) => !previous)}
                >
                  {controlsVisible ? "Hide Controls" : "Show Controls"}
                </button>
              </div>
            )}
          </div>
        </div>

        {controlsVisible ? (
          <>
            <div className="playground-controls">
              <button type="button" onClick={() => void handleTogglePlayback()} disabled={!audioUrl}>
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleStopPlayback}
                disabled={!audioUrl}
              >
                Stop
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(durationSeconds, 0)}
                step={0.01}
                value={Math.min(currentTimeSeconds, Math.max(durationSeconds, 0))}
                onInput={(event) => handleSeek(Number.parseFloat(event.currentTarget.value))}
                disabled={!audioUrl || durationSeconds <= 0}
              />
              <span className="playground-time">
                {formatTimeLabel(currentTimeSeconds)} / {formatTimeLabel(durationSeconds)}
              </span>
            </div>

            {activeTab === "rhythm_flame" ? (
              <div className="playground-flame-panel">
                <div className="playground-flame-grid">
                  <label>
                    Extension
                    <span>{formatRatioLabel(flameConfig.extension)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameConfig.extension}
                      onInput={updateFlameConfigNumber("extension", 0, 1)}
                    />
                  </label>
                  <label>
                    Intensity
                    <span>{formatRatioLabel(flameConfig.intensity)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameConfig.intensity}
                      onInput={updateFlameConfigNumber("intensity", 0, 1)}
                    />
                  </label>
                  <label>
                    Chaos
                    <span>{formatRatioLabel(flameConfig.chaos)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameConfig.chaos}
                      onInput={updateFlameConfigNumber("chaos", 0, 1)}
                    />
                  </label>
                  <label>
                    Relative Direction
                    <span>{Math.round(flameConfig.directionDegrees)}°</span>
                    <input
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={flameConfig.directionDegrees}
                      onInput={updateFlameConfigNumber("directionDegrees", -180, 180)}
                    />
                  </label>
                </div>
                <div className="playground-flame-colors">
                  <label>
                    Core
                    <input
                      type="color"
                      value={flameConfig.coreColor}
                      onInput={updateFlameConfigColor("coreColor")}
                    />
                  </label>
                  <label>
                    Mid
                    <input
                      type="color"
                      value={flameConfig.midColor}
                      onInput={updateFlameConfigColor("midColor")}
                    />
                  </label>
                  <label>
                    Edge
                    <input
                      type="color"
                      value={flameConfig.edgeColor}
                      onInput={updateFlameConfigColor("edgeColor")}
                    />
                  </label>
                </div>
                <div className="playground-flame-audio">
                  <label>
                    Audio Master
                    <span>{formatRatioLabel(flameAudioControl.audioMaster)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameAudioControl.audioMaster}
                      onInput={updateFlameAudioControlNumber("audioMaster")}
                    />
                  </label>
                  <label>
                    Meyda Influence
                    <span>{formatRatioLabel(flameAudioControl.meydaInfluence)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameAudioControl.meydaInfluence}
                      onInput={updateFlameAudioControlNumber("meydaInfluence")}
                    />
                  </label>
                  <label>
                    Beat Influence
                    <span>{formatRatioLabel(flameAudioControl.beatInfluence)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={flameAudioControl.beatInfluence}
                      onInput={updateFlameAudioControlNumber("beatInfluence")}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {songsPanelOpen ? (
              <div className="playground-song-panel">
                <div className="playground-song-panel__header">
                  <button
                    type="button"
                    className="secondary playground-songs-toggle"
                    onClick={() => setSongsPanelOpen((previous) => !previous)}
                  >
                    Collapse Songs
                  </button>
                </div>

                <div className="playground-song-strip">
                  {loadingSongs ? <span className="playground-chip">Loading songs...</span> : null}
                  {!loadingSongs && songs.length === 0 ? (
                    <span className="playground-chip">
                      No enabled songs available. Enable songs in Admin Game Builder.
                    </span>
                  ) : null}
                  {songs.map((song) => (
                    <button
                      key={song.beatEntryId}
                      type="button"
                      className={`playground-song-card${
                        selectedSongId === song.beatEntryId ? " active" : ""
                      }`}
                      onClick={() => setSelectedSongId(song.beatEntryId)}
                    >
                      {song.coverImageUrl ? (
                        <img src={song.coverImageUrl} alt="" aria-hidden="true" />
                      ) : (
                        <div className="playground-song-card__placeholder" />
                      )}
                      <strong>{song.title}</strong>
                      <span>{song.gameBeatCount || song.majorBeatCount} beats</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="secondary playground-songs-toggle"
                onClick={() => setSongsPanelOpen(true)}
              >
                Expand Songs
              </button>
            )}

            <div className="playground-status">
              {loadingTrack ? <span className="playground-chip">Loading song data...</span> : null}
              {loadError ? <span className="playground-chip error">{loadError}</span> : null}
            </div>
          </>
        ) : null}
      </header>
    </section>
  );
}
