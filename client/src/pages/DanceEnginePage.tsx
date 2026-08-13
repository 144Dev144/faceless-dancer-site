import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Activity, ArrowLeft, AudioLines, ExternalLink, Gauge, RefreshCw, Sparkles } from "lucide-preact";
import type { DanceMotionClip } from "@faceless/shared";
import { runtimeConfig } from "../game/config/runtime";
import { DanceEngineCanvas } from "../game/dance-engine/DanceEngineCanvas";
import type { CanonicalRigProfile } from "../game/dance-engine/canonicalRigProfile";
import { estimateBpm, styleLabel } from "../game/dance-engine/motionGraph";
import type { DanceBeat, DanceModelPreset, DanceRuntimeOptions, DanceRuntimeSnapshot, DanceStyle } from "../game/dance-engine/types";
import { parseDanceModelManifest } from "../game/dance-engine/modelManifest";
import { DanceMotionCapturePanel } from "../components/dance-engine/DanceMotionCapturePanel";
import { DanceClipExportPanel } from "../components/dance-engine/DanceClipExportPanel";
import { RigAdjustmentPanel } from "../components/dance-engine/RigAdjustmentPanel";

interface CatalogSong {
  beatEntryId: string;
  title: string;
  durationSeconds: number;
  majorBeatCount: number;
  gameBeatCount: number;
  coverImageUrl: string | null;
  availableGameModes: string[];
  availableDifficulties: string[];
  volumeLabel: string;
  creatorName: string;
}

interface CatalogResponse {
  songs: CatalogSong[];
  total: number;
  volumes: Array<{ volumeId: string; volumeLabel: string; songCount: number }>;
}

interface PublicBeatPoint {
  timeSeconds?: number;
  time?: number;
  strength?: number;
}

interface PublicChart {
  gameBeats?: PublicBeatPoint[];
  gameNotes?: Array<{ timeSeconds?: number; strength?: number }>;
}

interface PublicBeatEntry {
  entry?: { durationSeconds?: number };
  durationSeconds?: number;
  majorBeats?: PublicBeatPoint[];
  gameBeats?: PublicBeatPoint[];
  gameBeatConfig?: { bpm?: number };
  difficultyCharts?: Record<string, PublicChart>;
  modeDifficultyCharts?: Record<string, Record<string, PublicChart>>;
}

const MODEL_PRESETS: DanceModelPreset[] = [
  {
    id: "robot-expressive",
    label: "Robot Expressive",
    url: "https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb",
    clipNames: { idle: "Idle" },
    baseClipName: "Dance",
    source: "Three.js example asset"
  },
  {
    id: "soldier",
    label: "Soldier",
    url: "https://threejs.org/examples/models/gltf/Soldier.glb",
    clipNames: { idle: "Idle" },
    baseClipName: "Idle",
    source: "Three.js example asset"
  }
];

const API_BASE = runtimeConfig.beatApiBaseUrl;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function normalizeBeats(points: PublicBeatPoint[] | undefined): DanceBeat[] {
  return (points ?? [])
    .map((point) => ({
      timeSeconds: Number(point.timeSeconds ?? point.time ?? 0),
      strength: clamp(Number(point.strength ?? 0.6), 0, 1)
    }))
    .filter((point) => Number.isFinite(point.timeSeconds) && point.timeSeconds >= 0)
    .sort((a, b) => a.timeSeconds - b.timeSeconds)
    .filter((point, index, values) => index === 0 || point.timeSeconds - values[index - 1].timeSeconds > 0.01);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || `Request failed (${response.status})`);
  return body as T;
}

function extractBeats(entry: PublicBeatEntry): DanceBeat[] {
  const normal = entry.modeDifficultyCharts?.step_arrows?.normal ?? entry.difficultyCharts?.normal;
  const chartBeats = normalizeBeats(normal?.gameBeats ?? entry.gameBeats);
  if (chartBeats.length) return chartBeats;
  return normalizeBeats(entry.majorBeats);
}

export function DanceEnginePage(): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [songs, setSongs] = useState<CatalogSong[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [beats, setBeats] = useState<DanceBeat[]>([]);
  const [bpm, setBpm] = useState(120);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingSong, setLoadingSong] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState(MODEL_PRESETS[0].id);
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [customModel, setCustomModel] = useState<DanceModelPreset | null>(null);
  const [localManifest, setLocalManifest] = useState<DanceModelPreset["manifest"]>();
  const [originalOrientationYawRadians, setOriginalOrientationYawRadians] = useState(0);
  const [canonicalProfile, setCanonicalProfile] = useState<CanonicalRigProfile | null>(null);
  const [originalCanonicalProfile, setOriginalCanonicalProfile] = useState<CanonicalRigProfile | null>(null);
  const [localModelName, setLocalModelName] = useState("");
  const [localManifestName, setLocalManifestName] = useState("");
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const localModelUrlRef = useRef<string | null>(null);
  const [style, setStyle] = useState<DanceStyle>("balanced");
  const [energy, setEnergy] = useState(0.72);
  const [variety, setVariety] = useState(0.65);
  const [bpmScale, setBpmScale] = useState(1);
  const [minBeatStrength, setMinBeatStrength] = useState(0.1);
  const [liveAccents, setLiveAccents] = useState(true);
  const [reducedQuality, setReducedQuality] = useState(false);
  const [seed, setSeed] = useState(17);
  const [snapshot, setSnapshot] = useState<DanceRuntimeSnapshot | null>(null);
  const [capturedMotion, setCapturedMotion] = useState<DanceMotionClip | null>(null);
  const [capturedMotionEnabled, setCapturedMotionEnabled] = useState(false);
  const [stageCanvas, setStageCanvas] = useState<HTMLCanvasElement | null>(null);

  const handleMotionClip = useCallback((clip: DanceMotionClip | null) => {
    setCapturedMotion(clip);
    if (!clip) setCapturedMotionEnabled(false);
  }, []);

  const handleStageCanvasReady = useCallback((canvas: HTMLCanvasElement | null) => {
    setStageCanvas(canvas);
  }, []);

  useEffect(() => () => {
    if (localModelUrlRef.current) URL.revokeObjectURL(localModelUrlRef.current);
  }, []);

  const selectedSong = useMemo(() => songs.find((song) => song.beatEntryId === selectedId) ?? null, [selectedId, songs]);
  const selectedModel = customModel && modelId === customModel.id
    ? customModel
    : MODEL_PRESETS.find((model) => model.id === modelId) ?? MODEL_PRESETS[0];
  const activeBeats = useMemo(() => beats.filter((beat) => beat.strength >= minBeatStrength), [beats, minBeatStrength]);
  const options = useMemo<DanceRuntimeOptions>(() => ({
    energy,
    variety,
    bpmScale,
    style,
    liveAccents,
    reducedQuality,
    minBeatStrength,
    seed
  }), [energy, variety, bpmScale, style, liveAccents, reducedQuality, minBeatStrength, seed]);

  useEffect(() => {
    let cancelled = false;
    setLoadingCatalog(true);
    void fetchJson<CatalogResponse>(`${API_BASE}/api/public/songs/enabled?limit=60&offset=0`)
      .then((result) => {
        if (cancelled) return;
        setSongs(result.songs ?? []);
        setSelectedId((current) => current || result.songs?.[0]?.beatEntryId || "");
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load the public song catalog.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoadingSong(true);
    setError(null);
    void fetchJson<{ ok?: boolean; entry: PublicBeatEntry }>(`${API_BASE}/api/public/beats/${encodeURIComponent(selectedId)}`)
      .then((detail) => {
        if (cancelled) return;
        const nextBeats = extractBeats(detail.entry);
        const configuredBpm = Number(detail.entry.gameBeatConfig?.bpm ?? 0);
        setBeats(nextBeats);
        setBpm(configuredBpm > 0 ? configuredBpm : estimateBpm(nextBeats));
        setAudioUrl(`${API_BASE}/api/public/beats/${encodeURIComponent(selectedId)}/audio`);
        setDuration(Number(detail.entry.durationSeconds ?? detail.entry.entry?.durationSeconds ?? selectedSong?.durationSeconds ?? 0));
        setCurrentTime(0);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load the selected rhythm beat set.");
      })
      .finally(() => {
        if (!cancelled) setLoadingSong(false);
      });
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => {
      setCurrentTime(audio.currentTime);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : duration);
    };
    const interval = window.setInterval(update, 180);
    audio.addEventListener("timeupdate", update);
    audio.addEventListener("loadedmetadata", update);
    return () => {
      window.clearInterval(interval);
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("loadedmetadata", update);
    };
  }, [audioUrl, duration]);

  const applyCustomModel = () => {
    const url = customModelUrl.trim();
    if (!url) return;
    const next: DanceModelPreset = {
      id: "custom-model",
      label: "Custom GLB",
      url,
      clipNames: { idle: "Idle", groove: "Dance", step: "Walk", accent: "Run" },
      source: "Custom URL"
    };
    setCustomModel(next);
    setModelId(next.id);
    setModelNotice("Loaded a remote GLB with heuristic bone mapping. Add a humanoid-v1 manifest for deterministic rig mapping.");
  };

  const loadLocalModel = (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (localModelUrlRef.current) URL.revokeObjectURL(localModelUrlRef.current);
    const url = URL.createObjectURL(file);
    localModelUrlRef.current = url;
    const next: DanceModelPreset = {
      id: `local-model-${file.lastModified}-${file.size}`,
      label: file.name.replace(/\.(glb|gltf)$/i, "") || "Local GLB",
      url,
      clipNames: { idle: "Idle", groove: "Dance", step: "Walk", accent: "Run" },
      source: "Local file",
      manifest: localManifest
    };
    const profile = localManifest?.canonicalProfile ?? null;
    setCanonicalProfile(profile);
    setOriginalCanonicalProfile(profile);
    setOriginalOrientationYawRadians(localManifest?.orientation?.yawRadians ?? 0);
    setCustomModel(next);
    setModelId(next.id);
    setLocalModelName(file.name);
    setModelNotice(localManifest ? "Loaded local GLB with the supplied humanoid-v1 manifest." : "Loaded local GLB. Add its humanoid-v1 manifest to validate exact bone mapping.");
  };

  const loadLocalManifest = async (event: Event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed = parseDanceModelManifest(JSON.parse(await file.text()));
      setLocalManifest(parsed.manifest);
      setCanonicalProfile(parsed.manifest.canonicalProfile ?? null);
      setOriginalCanonicalProfile(parsed.manifest.canonicalProfile ?? null);
      setOriginalOrientationYawRadians(parsed.manifest.orientation?.yawRadians ?? 0);
      setLocalManifestName(file.name);
      setModelNotice(parsed.warnings.length ? parsed.warnings.join(" ") : "Manifest validated for humanoid-v1.");
      if (customModel?.source === "Local file") {
        const next = { ...customModel, id: `${customModel.id}-manifest`, manifest: parsed.manifest };
        setCustomModel(next);
        setModelId(next.id);
      }
    } catch (manifestError: unknown) {
      setLocalManifest(undefined);
      setModelNotice(manifestError instanceof Error ? manifestError.message : "Unable to read the model manifest.");
    }
  };

  const loadStandaloneProfile = (profile: CanonicalRigProfile, fileName: string) => {
    setCanonicalProfile(profile);
    setOriginalCanonicalProfile(profile);
    setLocalManifestName(fileName);
    setLocalManifest((current) => current ? { ...current, canonicalProfile: profile } : current);
    setCustomModel((current) => current?.manifest ? { ...current, manifest: { ...current.manifest, canonicalProfile: profile } } : current);
    setModelNotice("Canonical profile loaded. Adjust it against the avatar, then export it for worker reskinning.");
  };

  const updateCanonicalProfile = (profile: CanonicalRigProfile) => {
    setCanonicalProfile(profile);
    setLocalManifest((current) => current ? { ...current, canonicalProfile: profile } : current);
    setCustomModel((current) => current?.manifest ? { ...current, manifest: { ...current.manifest, canonicalProfile: profile } } : current);
  };

  const updateOrientation = (yawRadians: number) => {
    setLocalManifest((current) => current ? { ...current, orientation: { yawRadians } } : current);
    setCustomModel((current) => current?.manifest ? { ...current, manifest: { ...current.manifest, orientation: { yawRadians } } } : current);
  };

  const seek = (event: Event) => {
    const next = Number((event.currentTarget as HTMLInputElement).value);
    if (audioRef.current) audioRef.current.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <main className="dance-engine-page">
      <header className="dance-engine-header">
        <a href="/" className="dance-engine-back"><ArrowLeft size={16} aria-hidden="true" /> Back home</a>
        <div>
          <span className="dance-engine-eyebrow"><Sparkles size={14} aria-hidden="true" /> Proof of concept</span>
          <h1>Dance Engine Lab</h1>
          <p>Test beat-synchronized motion, model loading, and low-resource rendering against the public rhythm catalog.</p>
        </div>
        <span className="dance-engine-doc-link" title="The engine architecture is documented in docs/instructions/danceenginearchitecture.md"><Activity size={15} aria-hidden="true" /> Architecture documented</span>
      </header>

      <DanceMotionCapturePanel
        motionApplied={capturedMotionEnabled}
        onMotionClip={handleMotionClip}
        onApplyMotion={() => setCapturedMotionEnabled(Boolean(capturedMotion))}
        onUseProcedural={() => setCapturedMotionEnabled(false)}
      />

      <section className="dance-engine-workspace">
        <aside className="dance-engine-controls">
          <div className="dance-engine-section-title"><span>Source</span><small>{songs.length ? `${songs.length} public songs loaded` : "Production catalog"}</small></div>
          <label className="dance-engine-field"><span>Rhythm beat set</span><select value={selectedId} onChange={(event) => setSelectedId(event.currentTarget.value)} disabled={loadingCatalog || loadingSong || !songs.length}><option value="">Select a song</option>{songs.map((song) => <option key={song.beatEntryId} value={song.beatEntryId}>{song.title} · {song.volumeLabel}</option>)}</select></label>
          {selectedSong ? <div className="dance-engine-song-meta"><strong>{selectedSong.title}</strong><span>{selectedSong.creatorName} · {selectedSong.gameBeatCount || selectedSong.majorBeatCount} beats</span></div> : null}
          <div className="dance-engine-section-title"><span>Choreography</span><small>Beat data is primary</small></div>
          <label className="dance-engine-field"><span>Style <output>{styleLabel(style)}</output></span><select value={style} onChange={(event) => setStyle(event.currentTarget.value as DanceStyle)}><option value="balanced">Balanced</option><option value="groove">Groove</option><option value="energetic">Energetic</option></select></label>
          <label className="dance-engine-range"><span>Energy <output>{energy.toFixed(2)}</output></span><input type="range" min="0.1" max="1" step="0.01" value={energy} onInput={(event) => setEnergy(Number(event.currentTarget.value))} /></label>
          <label className="dance-engine-range"><span>Motion variety <output>{variety.toFixed(2)}</output></span><input type="range" min="0" max="1" step="0.01" value={variety} onInput={(event) => setVariety(Number(event.currentTarget.value))} /></label>
          <label className="dance-engine-range"><span>Beat strength floor <output>{minBeatStrength.toFixed(2)}</output></span><input type="range" min="0" max="0.95" step="0.01" value={minBeatStrength} onInput={(event) => setMinBeatStrength(Number(event.currentTarget.value))} /></label>
          <label className="dance-engine-range"><span>BPM scale <output>{bpmScale.toFixed(2)}x</output></span><input type="range" min="0.5" max="1.5" step="0.01" value={bpmScale} onInput={(event) => setBpmScale(Number(event.currentTarget.value))} /></label>
          <label className="dance-engine-field"><span>Seed</span><input type="number" min="0" max="999999" value={seed} onInput={(event) => setSeed(Number(event.currentTarget.value) || 0)} /></label>
          <div className="dance-engine-section-title"><span>Avatar</span><small>Manifest-driven GLB presets</small></div>
          <label className="dance-engine-field"><span>Model</span><select value={modelId} onChange={(event) => { const nextId = event.currentTarget.value; setModelId(nextId); if (nextId !== customModel?.id) { setCanonicalProfile(null); setOriginalCanonicalProfile(null); } }}>{MODEL_PRESETS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}{customModel ? <option value={customModel.id}>{customModel.label}</option> : null}</select></label>
          <div className="dance-engine-custom-model"><input value={customModelUrl} onInput={(event) => setCustomModelUrl(event.currentTarget.value)} placeholder="Paste a .glb URL" /><button type="button" className="secondary" onClick={applyCustomModel}><ExternalLink size={14} aria-hidden="true" /> Load</button></div>
          <div className="dance-engine-local-model"><label><span>Local rigged GLB</span><input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={loadLocalModel} /></label><label><span>Humanoid manifest</span><input type="file" accept="application/json,.json" onChange={loadLocalManifest} /></label></div>
          {localModelName || localManifestName ? <div className="dance-engine-model-files"><span>{localModelName || "No local GLB"}</span><span>{localManifestName || "No manifest"}</span></div> : null}
          {modelNotice ? <p className="dance-engine-model-notice" role="status">{modelNotice}</p> : null}
          <label className="dance-engine-check"><input type="checkbox" checked={liveAccents} onChange={(event) => setLiveAccents(event.currentTarget.checked)} /> Beat accents</label>
          <label className="dance-engine-check"><input type="checkbox" checked={reducedQuality} onChange={(event) => setReducedQuality(event.currentTarget.checked)} /> Reduced quality</label>
          {error ? <p className="dance-engine-error" role="alert">{error}</p> : null}
        </aside>

        <section className="dance-engine-stage-panel">
          <div className="dance-engine-stage-heading"><div><span className="dance-engine-eyebrow"><Activity size={14} aria-hidden="true" /> Live preview</span><h2>{loadingSong ? "Loading rhythm data" : snapshot?.currentMove === "idle" ? "Ready" : `${snapshot?.currentMove ?? "Ready"} motion`}</h2></div><span className={`dance-engine-status${snapshot?.loaded ? " is-ready" : ""}`}>{snapshot?.loaded ? "Renderer ready" : "Loading"}</span></div>
          <div className="dance-engine-canvas-shell"><DanceEngineCanvas audioRef={audioRef} beats={activeBeats} bpm={bpm} model={selectedModel} options={options} capturedMotion={capturedMotion} capturedMotionEnabled={capturedMotionEnabled} onCanvasReady={handleStageCanvasReady} onSnapshot={setSnapshot} onError={setError} /><div className="dance-engine-canvas-badge"><Gauge size={14} aria-hidden="true" /> {capturedMotionEnabled ? "Captured motion" : snapshot?.renderer ?? "WebGL2"}</div></div>
          <div className="dance-engine-player"><div className="dance-engine-player-title"><AudioLines size={16} aria-hidden="true" /><strong>{selectedSong?.title ?? "Select a rhythm beat set"}</strong><span>{formatTime(currentTime)} / {formatTime(duration)}</span></div><audio ref={audioRef} key={audioUrl} src={audioUrl || undefined} crossOrigin="anonymous" controls preload="metadata" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || duration)} /><input className="dance-engine-scrubber" type="range" min="0" max={Math.max(duration, 0.01)} step="0.01" value={Math.min(currentTime, Math.max(duration, 0.01))} onInput={seek} disabled={!audioUrl} /></div>
          <DanceClipExportPanel audioRef={audioRef} canvas={stageCanvas} audioUrl={audioUrl} songTitle={selectedSong?.title ?? "dance-clip"} duration={duration} currentTime={currentTime} />
        </section>

        <aside className="dance-engine-inspector">
          <div className="dance-engine-section-title"><span>Runtime</span><small>Live diagnostics</small></div>
          <div className="dance-engine-stat-grid"><div><span>Model</span><strong>{snapshot?.modelLabel ?? selectedModel.label}</strong></div><div><span>Rig coverage</span><strong>{snapshot ? `${Math.round(snapshot.rigCoverage * 100)}%` : "--"}</strong></div><div><span>BPM</span><strong>{(snapshot?.bpm ?? bpm).toFixed(1)}</strong></div><div><span>Active beats</span><strong>{activeBeats.length}</strong></div><div><span>Beat</span><strong>{snapshot && snapshot.beatIndex >= 0 ? snapshot.beatIndex + 1 : 0}</strong></div><div><span>FPS</span><strong>{snapshot?.fps.toFixed(0) ?? "--"}</strong></div><div><span>Frame</span><strong>{snapshot ? `${snapshot.frameTimeMs.toFixed(1)} ms` : "--"}</strong></div><div><span>Triangles</span><strong>{snapshot?.triangles.toLocaleString() ?? "--"}</strong></div><div><span>Draw calls</span><strong>{snapshot?.drawCalls ?? "--"}</strong></div></div>
          {snapshot?.rigWarnings.length ? <div className="dance-engine-rig-warnings"><strong>Rig diagnostics</strong>{snapshot.rigWarnings.slice(0, 4).map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
          <div className="dance-engine-section-title"><span>Beat map</span><small>{activeBeats.length} events above threshold</small></div>
          <div className="dance-engine-beat-map" aria-label="Rhythm beat map">{activeBeats.slice(0, 360).map((beat, index) => <span key={`${beat.timeSeconds}-${index}`} className="dance-engine-beat-marker" style={{ left: `${duration > 0 ? (beat.timeSeconds / duration) * 100 : 0}%`, opacity: 0.35 + beat.strength * 0.65 }} />)}<span className="dance-engine-playhead" style={{ left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} /></div>
          <p className="dance-engine-note">A continuous dance phrase drives the body. Beat strength adds timed impulses to the weight shift, steps, arm rises, and head follow-through.</p>
          <button type="button" className="secondary dance-engine-refresh" onClick={() => window.location.reload()}><RefreshCw size={14} aria-hidden="true" /> Refresh catalog</button>
        </aside>
      </section>

      <RigAdjustmentPanel
        model={selectedModel}
        profile={canonicalProfile}
        originalProfile={originalCanonicalProfile}
        orientationYawRadians={selectedModel.manifest?.orientation?.yawRadians ?? 0}
        originalOrientationYawRadians={originalOrientationYawRadians}
        onProfileChange={updateCanonicalProfile}
        onOrientationChange={updateOrientation}
        onLoadProfile={loadStandaloneProfile}
      />
    </main>
  );
}
