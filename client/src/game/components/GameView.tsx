import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { CSSProperties } from "preact/compat";
import { runtimeConfig } from "../config/runtime";
import gameTitleImage from "../../assets/game/game-title.png";
import { createPrecisePlaybackEngine, type PrecisePlaybackEngine } from "../lib/audio/precisePlaybackEngine";
import {
  buildFallbackEntryFromBeats,
  buildGameNotesFromEntry,
  type GameLane,
  type MelodyNote,
  type OrbBeatLane,
  type StepArrowLane,
} from "../lib/game/melodyChartService";
import type { SavedBeatEntry } from "../types/beat";
import {
  GAME_DIFFICULTIES,
  GAME_MODES,
  type GameDifficulty,
  type GameMode,
  getModeDifficultyChart,
} from "../lib/game/difficultyCharts";
import { LyricsSubtitle } from "./LyricsSubtitle";
import { rhythmWizardsConfig } from "../lib/rhythmWizards/balance";
import { buildBeatTimelineFromNoteTimes, evaluateBeatSync } from "../lib/rhythmWizards/beatSync";
import { getDamageTier, rhythmWizardsAssets, selectObstacleSprite, selectWizardSprite } from "../lib/rhythmWizards/assets";
import { castSpell, createRhythmWizardsState, stepRhythmWizardsState } from "../lib/rhythmWizards/simulation";
import type { MoveDirection, RhythmWizardsState, WizardAiDifficulty } from "../lib/rhythmWizards/types";

interface GameViewProps {
  apiBaseUrl: string;
  canSubmitHolderScore: boolean;
  holderPublicKey?: string;
  homeHref?: string;
  onModeChange?: (mode: ViewMode) => void;
}

interface HybridAnalysisResult {
  majorBeats?: Array<{ timeSeconds: number; strength: number }>;
}

interface EnabledSongSummary {
  beatEntryId: string;
  title: string;
  majorBeatCount: number;
  gameBeatCount: number;
  coverImageUrl: string | null;
  availableGameModes: GameMode[];
  availableDifficulties: GameDifficulty[];
  difficultyBeatCounts: Partial<Record<GameDifficulty, number>>;
  modeDifficultyBeatCounts: Partial<Record<GameMode, Partial<Record<GameDifficulty, number>>>>;
  volumeId: string;
  volumeLabel: string;
  volumeSlug: string;
  officialVolume: boolean;
  creatorName: string;
}

interface SongVolumeSummary {
  volumeId: string;
  volumeLabel: string;
  volumeSlug: string;
  officialVolume: boolean;
  songCount: number;
}

interface EnabledSongsResponse {
  songs: EnabledSongSummary[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
  selectedVolumeId: string;
  volumes: SongVolumeSummary[];
}

interface SongLeaderboardRow {
  displayName: string;
  publicKey: string;
  gameMode: GameMode;
  difficulty: GameDifficulty;
  score: number;
}

interface OverallLeaderboardRow {
  displayName: string;
  publicKey: string;
  totalScore: number;
  songsCount: number;
}

interface DanceOffMatchPayload {
  id: string;
  beatEntryId: string;
  gameMode: GameMode;
  difficulty: GameDifficulty;
}

interface DanceOffParticipantSummary {
  userId: string;
  publicKey: string;
  displayName: string | null;
  finalScore: number | null;
  finalAccuracy: number | null;
}

interface DanceOffCompletionPayload {
  id: string;
  winnerUserId: string | null;
  isDraw: boolean;
  cancelReason: string | null;
  participants: DanceOffParticipantSummary[];
}

interface DanceOffLinkStatePayload {
  linked: boolean;
  danceOffId: string | null;
  status: "waiting" | "ready_check" | "countdown" | "active" | "completed" | "cancelled" | null;
}

type ViewMode = "menu" | "play" | "scores";
type PlayPhase = "idle" | "countdown" | "running" | "finished";
type Judgement = "perfect" | "great" | "good" | "poor" | "miss";
type RhythmBonusJudgement = "perfect" | "great" | "good";

interface GameNoteState extends MelodyNote {
  judged: boolean;
  holdStarted: boolean;
  holding: boolean;
  lastHeldSeconds: number;
}

interface ScoreState {
  combo: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  poor: number;
  miss: number;
}

function createLaneState(): Record<GameLane, boolean> {
  return {
    left: false,
    down: false,
    up: false,
    right: false,
    l1: false,
    l2: false,
    l3: false,
    r1: false,
    r2: false,
    r3: false
  };
}

const stepArrowLaneOrder: StepArrowLane[] = ["left", "down", "up", "right"];
const orbBeatLaneOrder: OrbBeatLane[] = ["l1", "l2", "l3", "r1", "r2", "r3"];
const controlArrowImages: Record<StepArrowLane, string> = {
  left: "/game-graphics/controls/left.png",
  down: "/game-graphics/controls/down.png",
  up: "/game-graphics/controls/up.png",
  right: "/game-graphics/controls/right.png"
};
const beatArrowImages: Record<StepArrowLane, string> = {
  left: "/game-graphics/beats/left.png",
  down: "/game-graphics/beats/down.png",
  up: "/game-graphics/beats/up.png",
  right: "/game-graphics/beats/right.png"
};
const orbControlLabels: Record<OrbBeatLane, string> = {
  l1: "L1",
  l2: "L2",
  l3: "L3",
  r1: "R1",
  r2: "R2",
  r3: "R3"
};

function formatGameModeLabel(gameMode: GameMode): string {
  if (gameMode === "orb_beat") return "Orb Beat";
  if (gameMode === "laser_shoot") return "Rhythm Wizards";
  return "Step Arrows";
}
const HOLD_MIN_SECONDS = 0.14;
const HOLD_BONUS_POINTS = 120;
const HOLD_BONUS_EASY_RELEASE_SECONDS = 0.5;
const SONG_PAGE_SIZE = 10;
const MENU_PREVIEW_SAMPLE_SECONDS = 15;
const MENU_PREVIEW_FADE_SECONDS = 1.2;
const MENU_PREVIEW_MAX_VOLUME = 0.5;
const MENU_PREVIEW_SWITCH_FADE_OUT_MS = 90;
const MENU_PREVIEW_METADATA_WAIT_MS = 50;
const WIZARD_AI_DIFFICULTIES: WizardAiDifficulty[] = ["novice", "apprentice", "adept", "master", "archmage"];

function createInitialScore(): ScoreState {
  return { combo: 0, maxCombo: 0, perfect: 0, great: 0, good: 0, poor: 0, miss: 0 };
}

function holderName(publicKey: string | undefined): string {
  const key = String(publicKey ?? "").trim();
  return key.length >= 10 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "Holder";
}

function danceOffParticipantLabel(participant: DanceOffParticipantSummary): string {
  const displayName = String(participant.displayName ?? "").trim();
  if (displayName) {
    return displayName;
  }
  const key = String(participant.publicKey ?? "").trim();
  return key.length >= 10 ? `${key.slice(0, 6)}...${key.slice(-4)}` : key || "Unknown";
}

function estimateBeatSeconds(notes: GameNoteState[]): number {
  if (notes.length < 2) return 0.5;
  const sorted = [...notes].sort((a, b) => a.timeSeconds - b.timeSeconds);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i].timeSeconds - sorted[i - 1].timeSeconds;
    if (Number.isFinite(d) && d >= 0.08 && d <= 1.2) diffs.push(d);
    if (diffs.length >= 24) break;
  }
  if (diffs.length === 0) return 0.5;
  diffs.sort((a, b) => a - b);
  return Math.max(0.35, Math.min(0.85, diffs[Math.floor(diffs.length / 2)]));
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...(init ?? {}) });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

function classifyJudgement(deltaSeconds: number, windows: { perfect: number; great: number; good: number; poor: number }): Judgement {
  const absDelta = Math.abs(deltaSeconds);
  if (absDelta <= windows.perfect) return "perfect";
  if (absDelta <= windows.great) return "great";
  if (absDelta <= windows.good) return "good";
  if (absDelta <= windows.poor) return "poor";
  return "miss";
}

function createStableSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function spriteStyle(src: string, frames?: number, frameDurationMs?: number): CSSProperties {
  return {
    backgroundImage: `url("${src}")`,
    "--rw-frames": String(Math.max(1, Math.floor(frames ?? 1))),
    "--rw-frame-ms": `${Math.max(16, Math.floor(frameDurationMs ?? 100))}ms`,
  } as CSSProperties;
}

export function GameView({ apiBaseUrl, canSubmitHolderScore, holderPublicKey, homeHref = "/", onModeChange }: GameViewProps): JSX.Element {
  const engineRef = useRef<PrecisePlaybackEngine | null>(null);
  const loopRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const rolodexRef = useRef<HTMLDivElement | null>(null);
  const rolodexRafRef = useRef<number | null>(null);
  const menuPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const menuPreviewLoopRef = useRef<number | null>(null);
  const menuPreviewTokenRef = useRef(0);
  const menuPreviewEntryIdRef = useRef("");
  const selectedIdRef = useRef("");
  const judgementTimeoutRef = useRef<number | null>(null);
  const notesRef = useRef<GameNoteState[]>([]);
  const heldLanesRef = useRef<Record<GameLane, boolean>>(createLaneState());
  const lastTouchInputAtRef = useRef(0);
  const finalizedRef = useRef(false);
  const forfeitedRef = useRef(false);
  const runStartedRef = useRef(false);
  const endSignaledRef = useRef(false);
  const previousTimeRef = useRef(0);
  const activeDanceOffIdRef = useRef<string | null>(null);
  const scoreRef = useRef<ScoreState>(createInitialScore());
  const totalScoreRef = useRef(0);

  const [mode, setMode] = useState<ViewMode>("menu");
  const [phase, setPhase] = useState<PlayPhase>("idle");
  const [countdownBeats, setCountdownBeats] = useState(0);
  const [activeDanceOffId, setActiveDanceOffId] = useState<string | null>(null);
  const [linkedDanceOffState, setLinkedDanceOffState] = useState<DanceOffLinkStatePayload>({
    linked: false,
    danceOffId: null,
    status: null,
  });

  const [songs, setSongs] = useState<EnabledSongSummary[]>([]);
  const [songVolumes, setSongVolumes] = useState<SongVolumeSummary[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [songsTotal, setSongsTotal] = useState(0);
  const [songsHasMore, setSongsHasMore] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<SavedBeatEntry | null>(null);
  const [analysisMajorBeats, setAnalysisMajorBeats] = useState<Array<{ timeSeconds: number; strength: number }> | null>(null);
  const [selectedGameMode, setSelectedGameMode] = useState<GameMode>("step_arrows");
  const [selectedDifficulty, setSelectedDifficulty] = useState<GameDifficulty>("normal");
  const [selectedWizardAiDifficulty, setSelectedWizardAiDifficulty] = useState<WizardAiDifficulty>("adept");
  const [isLandscape, setIsLandscape] = useState(false);

  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingMoreSongs, setLoadingMoreSongs] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [menuAudioEnabled, setMenuAudioEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [score, setScore] = useState<ScoreState>(createInitialScore);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [songEndedSignal, setSongEndedSignal] = useState(0);
  const [lastJudgement, setLastJudgement] = useState<Judgement | null>(null);
  const [judgementEventId, setJudgementEventId] = useState(0);
  const [pressedLanes, setPressedLanes] = useState<Record<GameLane, boolean>>(createLaneState);
  const [heldLanes, setHeldLanes] = useState<Record<GameLane, boolean>>(createLaneState);

  const [songLeaderboard, setSongLeaderboard] = useState<SongLeaderboardRow[]>([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState<OverallLeaderboardRow[]>([]);
  const [holdBonusPoints, setHoldBonusPoints] = useState(0);
  const [chartRevision, setChartRevision] = useState(0);
  const [resultsModal, setResultsModal] = useState<{
    visible: boolean;
    score: number;
    percentage: number;
    rank: number | null;
    message: string;
    canExit: boolean;
    details: string[];
  }>({ visible: false, score: 0, percentage: 0, rank: null, message: "", canExit: true, details: [] });
  const rhythmWizardsRef = useRef<RhythmWizardsState | null>(null);
  const rhythmWizardsBeatTimelineRef = useRef<number[]>([]);
  const rhythmWizardsMoveInputRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const lastRhythmWizardsHeardRef = useRef(0);
  const [rhythmWizardsState, setRhythmWizardsState] = useState<RhythmWizardsState | null>(null);
  const [rhythmWizardsAimPoint, setRhythmWizardsAimPoint] = useState<{ x: number; y: number; id: number } | null>(null);
  const [rhythmWizardsBurst, setRhythmWizardsBurst] = useState<{
    x: number;
    y: number;
    judgement: RhythmBonusJudgement;
    id: number;
  } | null>(null);
  const [rhythmWizardsImpact, setRhythmWizardsImpact] = useState<{
    x: number;
    y: number;
    kind: "wizard" | "obstacle";
    id: number;
  } | null>(null);
  const [rhythmWizardsMoveButtons, setRhythmWizardsMoveButtons] = useState({ left: false, right: false });
  const [rhythmWizardsSyncPulseId, setRhythmWizardsSyncPulseId] = useState(0);
  const rhythmWizardsFxIdRef = useRef(0);
  const windows = useMemo(() => {
    const perfect = runtimeConfig.gamePerfectWindowSeconds;
    const great = Math.max(perfect, runtimeConfig.gameGreatWindowSeconds);
    const good = Math.max(great, runtimeConfig.gameGoodWindowSeconds);
    const poor = Math.max(good, runtimeConfig.gamePoorWindowSeconds);
    return { perfect, great, good, poor };
  }, []);

  const totalScore = useMemo(() => {
    const value = score.perfect * 1000 + score.great * 700 + score.good * 400 + score.poor * 100 - score.miss * 50 + holdBonusPoints;
    return Math.max(0, value);
  }, [score, holdBonusPoints]);

  const lifePercent = useMemo(() => {
    if (selectedGameMode === "laser_shoot" && rhythmWizardsState) {
      return Math.max(0, Math.min(100, (rhythmWizardsState.player.health / Math.max(1, rhythmWizardsState.player.maxHealth)) * 100));
    }
    const life = 50 + score.perfect * 2 + score.great * 1 + score.good * 0.35 - score.poor * 1.5 - score.miss * 3;
    return Math.max(0, Math.min(100, life));
  }, [score, selectedGameMode, rhythmWizardsState]);
  const rhythmWizardsPlayerHealthPercent = rhythmWizardsState
    ? Math.max(0, Math.min(100, (rhythmWizardsState.player.health / Math.max(1, rhythmWizardsState.player.maxHealth)) * 100))
    : 100;
  const rhythmWizardsEnemyHealthPercent = rhythmWizardsState
    ? Math.max(0, Math.min(100, (rhythmWizardsState.enemy.health / Math.max(1, rhythmWizardsState.enemy.maxHealth)) * 100))
    : 100;

  const isBlockedByLinkedDanceOff = useMemo(() => {
    if (!linkedDanceOffState.linked) {
      return false;
    }
    return (
      linkedDanceOffState.status === "waiting" ||
      linkedDanceOffState.status === "ready_check" ||
      linkedDanceOffState.status === "countdown" ||
      linkedDanceOffState.status === "active"
    );
  }, [linkedDanceOffState]);

  const stopLoop = (): void => {
    if (loopRef.current !== null) {
      window.clearInterval(loopRef.current);
      loopRef.current = null;
    }
  };

  const stopCountdown = (): void => {
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setCountdownBeats(0);
  };

  const applyJudgement = (judgement: Judgement): void => {
    if (judgementTimeoutRef.current !== null) window.clearTimeout(judgementTimeoutRef.current);
    setLastJudgement(judgement);
    setJudgementEventId((value) => value + 1);
    judgementTimeoutRef.current = window.setTimeout(() => setLastJudgement(null), 1500);
    setScore((prev) => {
      const next = { ...prev };
      if (judgement === "perfect") next.perfect += 1;
      if (judgement === "great") next.great += 1;
      if (judgement === "good") next.good += 1;
      if (judgement === "poor") next.poor += 1;
      if (judgement === "miss") next.miss += 1;
      if (judgement === "miss") next.combo = 0;
      else {
        next.combo += 1;
        next.maxCombo = Math.max(next.maxCombo, next.combo);
      }
      return next;
    });
  };

  const rebuildChart = (
    entryOverride?: SavedBeatEntry | null,
    analysisOverride?: Array<{ timeSeconds: number; strength: number }> | null,
    gameModeOverride?: GameMode,
    difficultyOverride?: GameDifficulty
  ): void => {
    const entry = entryOverride ?? selectedEntry;
    const analysis = analysisOverride ?? analysisMajorBeats;
    const gameMode = gameModeOverride ?? selectedGameMode;
    const difficulty = difficultyOverride ?? selectedDifficulty;
    if (!entry) {
      notesRef.current = [];
      return;
    }
    const chart = getModeDifficultyChart(entry, gameMode, difficulty);
    const chartedEntry: SavedBeatEntry =
      chart
        ? {
            ...entry,
            gameBeats: chart.gameBeats ?? [],
            gameNotes: chart.gameNotes ?? [],
            gameBeatSelections: chart.gameBeatSelections ?? [],
            gameBeatConfig: { ...(chart.gameBeatConfig ?? {}), gameMode }
          }
        : entry;
    const baseEntry: SavedBeatEntry =
      chart && (chart.gameBeats?.length ?? 0) > 0
        ? buildFallbackEntryFromBeats(chartedEntry, chart.gameBeats ?? [], gameMode)
        : analysis &&
            analysis.length > 0 &&
            (gameMode === "step_arrows" || gameMode === "laser_shoot") &&
            difficulty === "normal"
          ? buildFallbackEntryFromBeats(chartedEntry, analysis, gameMode)
          : chartedEntry;
    notesRef.current = buildGameNotesFromEntry(baseEntry, gameMode).map((note) => ({
      ...note,
      judged: false,
      holdStarted: false,
      holding: false,
      lastHeldSeconds: note.timeSeconds
    }));
    setScore(createInitialScore());
    setHoldBonusPoints(0);
    setLastJudgement(null);
    setChartRevision((value) => value + 1);
    heldLanesRef.current = createLaneState();
    setHeldLanes(createLaneState());
    setPressedLanes(createLaneState());
    rhythmWizardsMoveInputRef.current = { left: false, right: false };
    setRhythmWizardsMoveButtons({ left: false, right: false });
    setRhythmWizardsAimPoint(null);
    setRhythmWizardsBurst(null);
    setRhythmWizardsImpact(null);
    const beatTimeline = buildBeatTimelineFromNoteTimes(
      notesRef.current.map((note) => note.timeSeconds)
    );
    rhythmWizardsBeatTimelineRef.current = beatTimeline;
    if (gameMode === "laser_shoot") {
      const seedSource = `${entry.id}:${entry.savedAtIso}:${difficulty}`;
      const initialized = createRhythmWizardsState(selectedWizardAiDifficulty, createStableSeed(seedSource));
      rhythmWizardsRef.current = initialized;
      setRhythmWizardsState(initialized);
      lastRhythmWizardsHeardRef.current = 0;
    } else {
      rhythmWizardsRef.current = null;
      setRhythmWizardsState(null);
    }
  };

  const tick = (): void => {
    const engine = engineRef.current;
    if (!engine) return;
    const heard = engine.getCurrentHeardTime();
    const runActive = runStartedRef.current && !forfeitedRef.current && !finalizedRef.current;
    if (selectedGameMode === "laser_shoot" && rhythmWizardsRef.current && runActive) {
      const previousHeard = lastRhythmWizardsHeardRef.current || heard;
      const dtSeconds = Math.max(0.001, Math.min(0.05, heard - previousHeard));
      lastRhythmWizardsHeardRef.current = heard;
      const moveDir: MoveDirection = rhythmWizardsMoveInputRef.current.left === rhythmWizardsMoveInputRef.current.right
        ? 0
        : rhythmWizardsMoveInputRef.current.left
          ? -1
          : 1;
      let stepped: ReturnType<typeof stepRhythmWizardsState>;
      try {
        stepped = stepRhythmWizardsState(
          rhythmWizardsRef.current,
          { dtSeconds, heardTimeSeconds: heard, playerMoveDir: moveDir },
          rhythmWizardsBeatTimelineRef.current
        );
      } catch (error) {
        setError(error instanceof Error ? error.message : "Rhythm Wizards simulation failed.");
        setPlaying(false);
        stopLoop();
        return;
      }
      const impactEvent = stepped.events.find(
        (event) =>
          (event.type === "projectile_hit_obstacle" || event.type === "player_hit_enemy" || event.type === "enemy_hit_player") &&
          typeof event.x === "number" &&
          typeof event.y === "number"
      );
      if (impactEvent && typeof impactEvent.x === "number" && typeof impactEvent.y === "number") {
        const impactId = ++rhythmWizardsFxIdRef.current;
        setRhythmWizardsImpact({
          x: impactEvent.x,
          y: impactEvent.y,
          kind: impactEvent.type === "projectile_hit_obstacle" ? "obstacle" : "wizard",
          id: impactId,
        });
        window.setTimeout(() => {
          setRhythmWizardsImpact((previous) => (previous && previous.id === impactId ? null : previous));
        }, 260);
      }
      rhythmWizardsRef.current = stepped.state;
      setRhythmWizardsState(stepped.state);
      if (!endSignaledRef.current && stepped.state.ended) {
        endSignaledRef.current = true;
        setSongEndedSignal((value) => value + 1);
      }
      setCurrentTimeSeconds(heard);
      if (!engine.isPlaying()) {
        setPlaying(false);
        stopLoop();
      }
      return;
    }
    for (const note of notesRef.current) {
      if (note.judged) continue;
      const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
      if (!isHold && heard - note.timeSeconds > windows.poor) {
        note.judged = true;
        applyJudgement("miss");
        continue;
      }
      if (isHold && !note.holdStarted && heard - note.timeSeconds > windows.poor) {
        note.judged = true;
        applyJudgement("miss");
        continue;
      }
      if (!isHold || !note.holdStarted) continue;
      if (heldLanesRef.current[note.lane]) note.lastHeldSeconds = heard;
      if (heard >= note.endSeconds) {
        note.judged = true;
        const releaseLead = Math.max(0, note.endSeconds - note.lastHeldSeconds);
        if (releaseLead <= HOLD_BONUS_EASY_RELEASE_SECONDS) setHoldBonusPoints((v) => v + HOLD_BONUS_POINTS);
      }
    }
    setCurrentTimeSeconds(heard);
    lastRhythmWizardsHeardRef.current = heard;
    if (!endSignaledRef.current) {
      const finalNoteSeconds = notesRef.current.reduce((maxSeconds, note) => Math.max(maxSeconds, note.endSeconds), 0);
      if (finalNoteSeconds > 0 && heard >= finalNoteSeconds + 1.5) {
        endSignaledRef.current = true;
        setSongEndedSignal((value) => value + 1);
      }
    }
    if (!engine.isPlaying()) {
      setPlaying(false);
      stopLoop();
    }
  };

  const loadSongs = async (options?: {
    reset?: boolean;
    volumeId?: string;
    offset?: number;
  }): Promise<void> => {
    const reset = options?.reset ?? true;
    const requestedVolumeId = options?.volumeId ?? selectedVolumeId;
    const offset = options?.offset ?? 0;
    if (reset) {
      setLoadingSongs(true);
    } else {
      setLoadingMoreSongs(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(SONG_PAGE_SIZE),
        offset: String(offset),
      });
      if (requestedVolumeId) {
        params.set("volumeId", requestedVolumeId);
      }
      const result = await fetchJson<EnabledSongsResponse>(`${apiBaseUrl}/api/public/songs/enabled?${params.toString()}`);
      const next = result.songs ?? [];
      setSongVolumes(result.volumes ?? []);
      setSelectedVolumeId(result.selectedVolumeId || requestedVolumeId || result.volumes?.[0]?.volumeId || "");
      setSongsTotal(result.total ?? next.length);
      setSongsHasMore(Boolean(result.hasMore));
      setSongs((previous) => (reset ? next : [...previous, ...next]));
      setSelectedId((previous) => {
        if (!reset) {
          return previous || next[0]?.beatEntryId || "";
        }
        if (previous && next.some((song) => song.beatEntryId === previous)) {
          return previous;
        }
        return next[0]?.beatEntryId || "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load songs.");
    } finally {
      if (reset) {
        setLoadingSongs(false);
      } else {
        setLoadingMoreSongs(false);
      }
    }
  };

  const selectedSongSummary = useMemo(
    () => songs.find((song) => song.beatEntryId === selectedId) ?? null,
    [selectedId, songs]
  );

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    totalScoreRef.current = totalScore;
  }, [totalScore]);

  const clearMenuPreviewLoop = (): void => {
    if (menuPreviewLoopRef.current !== null) {
      window.clearInterval(menuPreviewLoopRef.current);
      menuPreviewLoopRef.current = null;
    }
  };

  const previewLog = (_action: string, _details?: Record<string, unknown>): void => {};

  const fadeAudioVolume = async (audio: HTMLAudioElement, target: number, durationMs: number): Promise<void> =>
    new Promise((resolve) => {
      const startVolume = Number.isFinite(audio.volume) ? audio.volume : 0;
      const clampedTarget = Math.max(0, Math.min(1, target));
      const startAt = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - startAt) / Math.max(1, durationMs));
        audio.volume = startVolume + (clampedTarget - startVolume) * progress;
        if (progress < 1) {
          window.requestAnimationFrame(step);
          return;
        }
        resolve();
      };
      window.requestAnimationFrame(step);
    });

  const stopMenuPreview = async (): Promise<void> => {
    previewLog("stop-begin");
    clearMenuPreviewLoop();
    const audio = menuPreviewAudioRef.current;
    if (!audio) return;
    const token = ++menuPreviewTokenRef.current;
    previewLog("stop-token", { token, paused: audio.paused, currentTime: audio.currentTime, volume: audio.volume });
    if (!audio.paused) {
      await fadeAudioVolume(audio, 0, 180).catch(() => undefined);
      previewLog("stop-fade-complete", { token, currentTime: audio.currentTime, volume: audio.volume });
    }
    if (token !== menuPreviewTokenRef.current) return;
    audio.pause();
    audio.currentTime = 0;
    menuPreviewEntryIdRef.current = "";
    previewLog("stop-complete", { token });
  };

  const startMenuPreview = async (entryId: string): Promise<void> => {
    previewLog("start-request", { entryId });
    if (!entryId) return;
    if (!menuAudioEnabled) {
      previewLog("start-skipped-audio-disabled", { entryId });
      return;
    }
    const token = ++menuPreviewTokenRef.current;
    previewLog("start-token", { token, entryId });
    clearMenuPreviewLoop();
    let audio = menuPreviewAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      audio.playsInline = true;
      audio.loop = true;
      const events: Array<keyof HTMLMediaElementEventMap> = [
        "loadstart",
        "loadedmetadata",
        "loadeddata",
        "canplay",
        "canplaythrough",
        "play",
        "playing",
        "pause",
        "waiting",
        "stalled",
        "suspend",
        "seeking",
        "seeked",
        "timeupdate",
        "progress",
        "durationchange",
        "ended",
        "emptied",
        "abort",
        "error"
      ];
      for (const eventName of events) {
        audio.addEventListener(eventName, () => {
          previewLog(`audio-event:${eventName}`, {
            token: menuPreviewTokenRef.current,
            src: audio?.src,
            readyState: audio?.readyState,
            networkState: audio?.networkState,
            currentTime: audio?.currentTime,
            duration: audio?.duration,
            paused: audio?.paused,
            volume: audio?.volume,
            muted: audio?.muted,
            errorCode: audio?.error?.code ?? null
          });
        });
      }
      menuPreviewAudioRef.current = audio;
      previewLog("audio-created");
    }

    if (menuPreviewEntryIdRef.current === entryId && !audio.paused) {
      previewLog("start-skip-already-playing", { token, entryId, currentTime: audio.currentTime });
      return;
    }

    if (!audio.paused) {
      previewLog("start-fade-out-current", { token, currentEntry: menuPreviewEntryIdRef.current, currentTime: audio.currentTime });
      await fadeAudioVolume(audio, 0, MENU_PREVIEW_SWITCH_FADE_OUT_MS).catch(() => undefined);
      if (token !== menuPreviewTokenRef.current) return;
      audio.pause();
      previewLog("start-fade-out-complete", { token, currentTime: audio.currentTime });
    }

    const previewSrc = `${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/preview`;
    const fallbackSrc = `${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/audio`;
    const nextSrc = previewSrc;
    const isNewSource = menuPreviewEntryIdRef.current !== entryId || audio.src !== nextSrc;
    previewLog("start-source-check", {
      token,
      entryId,
      nextSrc,
      currentSrc: audio.src,
      currentEntry: menuPreviewEntryIdRef.current,
      isNewSource
    });
    if (isNewSource) {
      audio.src = nextSrc;
      audio.currentTime = 0;
      audio.volume = 0;
      audio.loop = true;
      menuPreviewEntryIdRef.current = entryId;
      audio.load();
      previewLog("start-source-loaded", { token, entryId, src: nextSrc });
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-source", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }

    audio.muted = true;
    previewLog("start-play-attempt", {
      token,
      entryId,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState
    });
    try {
      await audio.play();
    } catch {
      if (audio.src === previewSrc) {
        previewLog("start-preview-fallback-audio", { token, entryId, previewSrc, fallbackSrc });
        audio.src = fallbackSrc;
        audio.currentTime = 0;
        audio.volume = 0;
        audio.load();
        try {
          await audio.play();
        } catch {
          previewLog("start-fallback-play-failed", {
            token,
            entryId,
            readyState: audio.readyState,
            networkState: audio.networkState,
            errorCode: audio.error?.code ?? null
          });
          return;
        }
      } else {
      previewLog("start-play-failed", {
        token,
        entryId,
        readyState: audio.readyState,
        networkState: audio.networkState,
        errorCode: audio.error?.code ?? null
      });
      return;
      }
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-play", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }
    audio.muted = false;
    previewLog("start-play-success", {
      token,
      entryId,
      currentTime: audio.currentTime,
      readyState: audio.readyState,
      networkState: audio.networkState
    });

    if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
      previewLog("start-wait-metadata", { token, entryId, duration: audio.duration });
      await Promise.race([
        new Promise<void>((resolve) => {
          const complete = () => {
            audio?.removeEventListener("loadedmetadata", complete);
            resolve();
          };
          audio.addEventListener("loadedmetadata", complete, { once: true });
        }),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, MENU_PREVIEW_METADATA_WAIT_MS);
        })
      ]);
      previewLog("start-wait-metadata-complete", { token, entryId, duration: audio.duration });
    }
    if (token !== menuPreviewTokenRef.current || mode !== "menu" || selectedIdRef.current !== entryId) {
      previewLog("start-abort-after-metadata", {
        token,
        activeToken: menuPreviewTokenRef.current,
        selectedRef: selectedIdRef.current,
        entryId,
        mode
      });
      return;
    }

    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const segmentLength = Math.max(4, Math.min(MENU_PREVIEW_SAMPLE_SECONDS, duration > 0 ? duration : MENU_PREVIEW_SAMPLE_SECONDS));
    const segmentStart =
      duration > segmentLength
        ? Math.min(runtimeConfig.menuPreviewStartSeconds, Math.max(0, duration - segmentLength))
        : 0;
    const segmentEnd = duration > 0 ? Math.max(segmentStart + 0.5, Math.min(duration, segmentStart + segmentLength)) : segmentStart + segmentLength;
    previewLog("start-segment-computed", { token, duration, segmentLength, segmentStart, segmentEnd });
    try {
      if (segmentStart > 0 && audio.readyState >= 2) {
        audio.currentTime = segmentStart;
        previewLog("start-seek-applied", { token, segmentStart, currentTime: audio.currentTime });
      } else if (segmentStart <= 0) {
        audio.currentTime = 0;
        previewLog("start-seek-zero", { token, currentTime: audio.currentTime });
      }
    } catch {
      previewLog("start-seek-failed", { token, readyState: audio.readyState, currentTime: audio.currentTime });
    }

    menuPreviewLoopRef.current = window.setInterval(() => {
      const currentAudio = menuPreviewAudioRef.current;
      if (!currentAudio) return;
      if (menuPreviewTokenRef.current !== token || mode !== "menu" || selectedIdRef.current !== entryId) {
        previewLog("loop-skip-token-or-selection", {
          token,
          activeToken: menuPreviewTokenRef.current,
          selectedRef: selectedIdRef.current,
          entryId,
          mode
        });
        return;
      }
      let current = currentAudio.currentTime;
      const segmentDuration = Math.max(0.001, segmentEnd - segmentStart);
      const fadeSeconds = Math.min(MENU_PREVIEW_FADE_SECONDS, segmentDuration * 0.35);
      if (segmentStart > 0 && current < segmentStart - 0.1) {
        const previous = current;
        try {
          currentAudio.currentTime = segmentStart;
          current = currentAudio.currentTime;
          previewLog("loop-correct-prestart", { token, from: previous, to: segmentStart });
        } catch {
          previewLog("loop-correct-prestart-failed", { token, from: previous, to: segmentStart });
        }
      }
      const segmentPosition = Math.max(0, Math.min(segmentDuration, current - segmentStart));
      const fadeInEnd = fadeSeconds;
      const fadeOutStart = segmentDuration - fadeSeconds;
      let volume = MENU_PREVIEW_MAX_VOLUME;
      if (current >= segmentStart) {
        if (segmentPosition <= fadeInEnd) {
          volume = MENU_PREVIEW_MAX_VOLUME * Math.max(0, segmentPosition / Math.max(0.001, fadeSeconds));
        } else if (segmentPosition >= fadeOutStart) {
          volume =
            MENU_PREVIEW_MAX_VOLUME *
            Math.max(0, (segmentDuration - segmentPosition) / Math.max(0.001, fadeSeconds));
        }
      }
      currentAudio.volume = Math.max(0, Math.min(MENU_PREVIEW_MAX_VOLUME, volume));
      previewLog("loop-tick", {
        token,
        current,
        segmentPosition,
        segmentStart,
        segmentEnd,
        fadeInEnd,
        fadeOutStart,
        volume: currentAudio.volume,
        paused: currentAudio.paused,
        readyState: currentAudio.readyState,
        networkState: currentAudio.networkState
      });
    }, 60);
    previewLog("loop-started", { token, intervalMs: 60 });
  };

  const updateSelectedSongFromRolodex = (): void => {
    const container = rolodexRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".game-song-card[data-song-id]"));
    if (cards.length === 0) return;
    const centerY = container.scrollTop + container.clientHeight * 0.5;
    let bestId = selectedId;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const cardCenter = card.offsetTop + card.offsetHeight * 0.5;
      const distance = Math.abs(cardCenter - centerY);
      const normalized = Math.max(-1.25, Math.min(1.25, (cardCenter - centerY) / (container.clientHeight * 0.5)));
      const distanceNorm = Math.min(1, Math.abs(normalized));
      const rotateX = normalized * -48;
      const rotateY = normalized * -10;
      const depth = 72 - distanceNorm * 112;
      const lift = normalized * 24;
      const scale = 1 - distanceNorm * 0.18;
      const opacity = 1 - distanceNorm * 0.58;
      const saturation = 1.18 - distanceNorm * 0.34;
      const brightness = 1.08 - distanceNorm * 0.26;
      card.style.setProperty("--card-rotate-x", `${rotateX.toFixed(2)}deg`);
      card.style.setProperty("--card-rotate-y", `${rotateY.toFixed(2)}deg`);
      card.style.setProperty("--card-z", `${depth.toFixed(2)}px`);
      card.style.setProperty("--card-shift-y", `${lift.toFixed(2)}px`);
      card.style.setProperty("--card-scale", scale.toFixed(3));
      card.style.setProperty("--card-opacity", opacity.toFixed(3));
      card.style.setProperty("--card-saturation", saturation.toFixed(3));
      card.style.setProperty("--card-brightness", brightness.toFixed(3));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = card.dataset.songId || bestId;
      }
    }
    if (bestId && bestId !== selectedId) {
      previewLog("selection-from-scroll", { previousSelectedId: selectedId, nextSelectedId: bestId });
      setSelectedId(bestId);
      if (mode === "menu") {
        void startMenuPreview(bestId);
      }
    }
  };

  const handleRolodexScroll = (): void => {
    updateSelectedSongFromRolodex();
    const container = rolodexRef.current;
    if (
      container &&
      songsHasMore &&
      !loadingSongs &&
      !loadingMoreSongs &&
      container.scrollTop + container.clientHeight >= container.scrollHeight - 220
    ) {
      void loadSongs({
        reset: false,
        volumeId: selectedVolumeId,
        offset: songs.length,
      });
    }
    if (rolodexRafRef.current !== null) {
      window.cancelAnimationFrame(rolodexRafRef.current);
    }
    rolodexRafRef.current = window.requestAnimationFrame(() => {
      rolodexRafRef.current = null;
      updateSelectedSongFromRolodex();
    });
  };

  const focusSongCard = (songId: string, smooth = false): void => {
    setSelectedId(songId);
    const container = rolodexRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLButtonElement>(".game-song-card[data-song-id]"));
    const card = cards.find((item) => item.dataset.songId === songId);
    if (!card) return;
    const targetScrollTop = card.offsetTop - (container.clientHeight - card.offsetHeight) * 0.5;
    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: smooth ? "smooth" : "auto"
    });
    handleRolodexScroll();
  };

  const loadLeaderboards = async (
    entryId: string,
    gameMode: GameMode,
    difficulty: GameDifficulty
  ): Promise<void> => {
    try {
      const [songData, overallData] = await Promise.all([
        fetchJson<{ leaderboard: SongLeaderboardRow[] }>(
          `${apiBaseUrl}/api/scores/song/${encodeURIComponent(entryId)}?gameMode=${encodeURIComponent(gameMode)}&difficulty=${encodeURIComponent(difficulty)}`
        ),
        fetchJson<{ leaderboard: OverallLeaderboardRow[] }>(`${apiBaseUrl}/api/scores/overall`)
      ]);
      setSongLeaderboard(songData.leaderboard ?? []);
      setOverallLeaderboard(overallData.leaderboard ?? []);
    } catch {
      setSongLeaderboard([]);
      setOverallLeaderboard([]);
    }
  };

  const loadSelectedEntry = async (
    entryId: string,
    gameModeOverride?: GameMode,
    difficultyOverride?: GameDifficulty
  ): Promise<{ entry: SavedBeatEntry; analysisMajorBeats: Array<{ timeSeconds: number; strength: number }> | null } | null> => {
    const engine = engineRef.current;
    if (!engine) return null;
    setLoadingEntry(true);
    setError(null);
    setPlaying(false);
    stopLoop();
    stopCountdown();
    engine.pause();
    engine.seek(0);
    setCurrentTimeSeconds(0);
    try {
      const detail = await fetchJson<{ ok: boolean; entry: SavedBeatEntry }>(`${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}`);
      const audioResponse = await fetch(`${apiBaseUrl}/api/public/beats/${encodeURIComponent(entryId)}/audio`, { credentials: "include" });
      if (!audioResponse.ok) throw new Error("Failed to load song audio.");
      const audioBytes = await audioResponse.arrayBuffer();
      await engine.loadFromArrayBuffer(audioBytes);
      setDurationSeconds(engine.getDurationSeconds() || detail.entry.entry.durationSeconds);
      setSelectedEntry(detail.entry);
      let loadedAnalysis: Array<{ timeSeconds: number; strength: number }> | null = null;
      try {
        const analysis = await fetchJson<{ ok: boolean; result: HybridAnalysisResult }>(`${apiBaseUrl}/api/public/analyze/${encodeURIComponent(entryId)}/result`);
        const beats = Array.isArray(analysis.result?.majorBeats) ? analysis.result.majorBeats : [];
        loadedAnalysis = beats.length > 0 ? beats : null;
        setAnalysisMajorBeats(loadedAnalysis);
      } catch {
        loadedAnalysis = null;
        setAnalysisMajorBeats(null);
      }
      await loadLeaderboards(entryId, gameModeOverride ?? selectedGameMode, difficultyOverride ?? selectedDifficulty);
      return { entry: detail.entry, analysisMajorBeats: loadedAnalysis };
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load selected song.");
      setSelectedEntry(null);
      setAnalysisMajorBeats(null);
      notesRef.current = [];
      return null;
    } finally {
      setLoadingEntry(false);
    }
  };
  const finalizeRun = async (): Promise<void> => {
    if (!selectedEntry || forfeitedRef.current) return;
    const liveScore = scoreRef.current;
    const liveTotalScore = totalScoreRef.current;
    const totalNotes =
      selectedGameMode === "laser_shoot"
        ? Math.max(1, liveScore.perfect + liveScore.great + liveScore.good + liveScore.poor + liveScore.miss)
        : Math.max(1, notesRef.current.length);
    const weighted = liveScore.perfect + liveScore.great * 0.75 + liveScore.good * 0.5 + liveScore.poor * 0.25;
    const percentage = Math.max(0, Math.min(100, (weighted / totalNotes) * 100));
    const activeDanceOffId = activeDanceOffIdRef.current;

    if (activeDanceOffId) {
      setPhase("finished");
      setResultsModal({
        visible: true,
        score: liveTotalScore,
        percentage,
        rank: null,
        message: "Dance-Off result submitted. Waiting for all players to finish.",
        canExit: false,
        details: [],
      });
      window.dispatchEvent(
        new CustomEvent("danceoff:match-result", {
          detail: {
            danceOffId: activeDanceOffId,
            score: liveTotalScore,
            accuracy: percentage,
          },
        })
      );
      return;
    }

    let rank: number | null = null;
    let message = "";

    if (canSubmitHolderScore) {
      try {
        await fetchJson<{ saved: boolean }>(`${apiBaseUrl}/api/scores/song/${encodeURIComponent(selectedEntry.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName: holderName(holderPublicKey),
            gameMode: selectedGameMode,
            difficulty: selectedDifficulty,
            score: liveTotalScore,
            maxCombo: liveScore.maxCombo,
            perfect: liveScore.perfect,
            great: liveScore.great,
            good: liveScore.good,
            poor: liveScore.poor,
            miss: liveScore.miss
          })
        });
        const latestSong = await fetchJson<{ leaderboard: SongLeaderboardRow[] }>(
          `${apiBaseUrl}/api/scores/song/${encodeURIComponent(selectedEntry.id)}?gameMode=${encodeURIComponent(selectedGameMode)}&difficulty=${encodeURIComponent(selectedDifficulty)}`
        );
        setSongLeaderboard(latestSong.leaderboard ?? []);
        rank = (latestSong.leaderboard ?? []).filter((row) => row.score > liveTotalScore).length + 1;
        message = `Holder rank: #${rank}`;
      } catch {
        message = "Could not submit or rank this run.";
      }
    } else {
      message = "Connect your wallet that holds the Faceless Dancer token so you can rank in the high scores.";
    }

    setPhase("finished");
    setResultsModal({ visible: true, score: liveTotalScore, percentage, rank, message, canExit: true, details: [] });
  };

  const startAfterCountdown = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine || forfeitedRef.current) {
      setPhase("idle");
      return;
    }
    setPhase("running");
    try {
      engine.seek(0);
      await engine.play();
      setPlaying(true);
      runStartedRef.current = true;
      if (loopRef.current === null) loopRef.current = window.setInterval(tick, 16);
    } catch {
      setPlaying(false);
      setPhase("idle");
      setError("Audio start was blocked. Click Start Game again.");
    }
  };

  const beginRun = (
    loadedEntry: SavedBeatEntry,
    loadedAnalysis: Array<{ timeSeconds: number; strength: number }> | null,
    gameMode: GameMode,
    difficulty: GameDifficulty
  ): void => {
    forfeitedRef.current = false;
    finalizedRef.current = false;
    runStartedRef.current = false;
    endSignaledRef.current = false;
    previousTimeRef.current = 0;
    setSongEndedSignal(0);
    setResultsModal({ visible: false, score: 0, percentage: 0, rank: null, message: "", canExit: true, details: [] });
    rebuildChart(loadedEntry, loadedAnalysis, gameMode, difficulty);
    lastRhythmWizardsHeardRef.current = 0;
    rhythmWizardsMoveInputRef.current = { left: false, right: false };
    setRhythmWizardsMoveButtons({ left: false, right: false });
    let beatsLeft = 3;
    const beatSeconds = estimateBeatSeconds(notesRef.current);
    stopCountdown();
    setCountdownBeats(beatsLeft);
    setPhase("countdown");
    setMode("play");
    countdownRef.current = window.setInterval(() => {
      beatsLeft -= 1;
      if (beatsLeft <= 0) {
        stopCountdown();
        void startAfterCountdown().catch(() => {
          setError("Tap Start Game again to begin playback.");
          setPhase("idle");
        });
        return;
      }
      setCountdownBeats(beatsLeft);
    }, Math.round(beatSeconds * 1000));
  };

  const startSoloGame = async (): Promise<void> => {
    if (isBlockedByLinkedDanceOff) {
      setError("You are already linked to a Dance-Off. Wait for it to finish or leave/cancel it first.");
      return;
    }
    if (!selectedId) {
      return;
    }
    try {
      await engineRef.current?.unlock();
    } catch {
      // Ignore unlock failures; playback attempt below will surface any issues.
    }
    const loaded = await loadSelectedEntry(selectedId);
    if (!loaded) return;
    activeDanceOffIdRef.current = null;
    setActiveDanceOffId(null);
    beginRun(loaded.entry, loaded.analysisMajorBeats, selectedGameMode, selectedDifficulty);
  };

  const startDanceOffMatch = async (payload: DanceOffMatchPayload): Promise<void> => {
    if (
      activeDanceOffIdRef.current === payload.id &&
      mode === "play" &&
      (phase === "countdown" || phase === "running")
    ) {
      return;
    }
    const matchSongId = String(payload.beatEntryId || "").trim();
    if (!matchSongId) {
      return;
    }
    try {
      await engineRef.current?.unlock();
    } catch {
      // Browser policies can still block audio; startAfterCountdown handles final failure.
    }
    setSelectedGameMode(payload.gameMode);
    setSelectedDifficulty(payload.difficulty);
    setSelectedId(matchSongId);
    const loaded = await loadSelectedEntry(matchSongId, payload.gameMode, payload.difficulty);
    if (!loaded) {
      setError("Failed to load Dance-Off song.");
      return;
    }
    activeDanceOffIdRef.current = payload.id;
    setActiveDanceOffId(payload.id);
    beginRun(loaded.entry, loaded.analysisMajorBeats, payload.gameMode, payload.difficulty);
  };

  const goToMenu = (): void => {
    const activeDanceOffId = activeDanceOffIdRef.current;
    if (activeDanceOffId && phase === "running" && !finalizedRef.current) {
      window.dispatchEvent(new CustomEvent("danceoff:match-abort", { detail: { danceOffId: activeDanceOffId } }));
    }
    forfeitedRef.current = true;
    finalizedRef.current = true;
    runStartedRef.current = false;
    endSignaledRef.current = false;
    activeDanceOffIdRef.current = null;
    setActiveDanceOffId(null);
    const engine = engineRef.current;
    if (engine) {
      engine.pause();
      engine.seek(0);
    }
    stopLoop();
    stopCountdown();
    setPlaying(false);
    setCurrentTimeSeconds(0);
    previousTimeRef.current = 0;
    lastRhythmWizardsHeardRef.current = 0;
    rhythmWizardsMoveInputRef.current = { left: false, right: false };
    setSongEndedSignal(0);
    setPhase("idle");
    setLastJudgement(null);
    setRhythmWizardsAimPoint(null);
    setRhythmWizardsBurst(null);
    setRhythmWizardsImpact(null);
    setResultsModal({ visible: false, score: 0, percentage: 0, rank: null, message: "", canExit: true, details: [] });
    setMode("menu");
  };

  const handleLaneInput = (lane: GameLane): void => {
    if (phase !== "running") return;
    if (selectedGameMode === "laser_shoot") return;
    heldLanesRef.current = { ...heldLanesRef.current, [lane]: true };
    setHeldLanes((prev) => ({ ...prev, [lane]: true }));
    setPressedLanes((prev) => ({ ...prev, [lane]: true }));
    window.setTimeout(() => setPressedLanes((prev) => ({ ...prev, [lane]: false })), 70);

    const engine = engineRef.current;
    const heardTime = engine ? engine.getCurrentHeardTime() : currentTimeSeconds;
    let candidate: GameNoteState | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const note of notesRef.current) {
      if (note.judged || note.lane !== lane || note.holdStarted) continue;
      const absDelta = Math.abs(heardTime - note.timeSeconds);
      if (absDelta > windows.poor) continue;
      if (absDelta < bestDelta) {
        candidate = note;
        bestDelta = absDelta;
      }
    }
    if (!candidate) {
      applyJudgement("miss");
      return;
    }
    const judgement = classifyJudgement(heardTime - candidate.timeSeconds, windows);
    const isHold = candidate.type === "hold" && candidate.endSeconds - candidate.timeSeconds >= HOLD_MIN_SECONDS;
    if (judgement === "miss") {
      candidate.judged = true;
      applyJudgement("miss");
      return;
    }
    applyJudgement(judgement);
    if (!isHold) {
      candidate.judged = true;
      return;
    }
    candidate.holdStarted = true;
    candidate.holding = true;
    candidate.lastHeldSeconds = heardTime;
  };

  const releaseLane = (lane: GameLane): void => {
    heldLanesRef.current = { ...heldLanesRef.current, [lane]: false };
    setHeldLanes((prev) => ({ ...prev, [lane]: false }));
  };

  const handleLaneTouchStart = (event: Event, lane: GameLane): void => {
    event.preventDefault();
    lastTouchInputAtRef.current = performance.now();
    handleLaneInput(lane);
  };

  const handleLaneMouseDown = (lane: GameLane): void => {
    // Mobile browsers can emit a synthetic mouse event after touch.
    // Ignore that duplicate so a single tap cannot score then immediately miss.
    if (performance.now() - lastTouchInputAtRef.current < 700) {
      return;
    }
    handleLaneInput(lane);
  };

  const setRhythmWizardsMoveInput = (direction: "left" | "right", active: boolean): void => {
    const next = {
      ...rhythmWizardsMoveInputRef.current,
      [direction]: active,
    };
    rhythmWizardsMoveInputRef.current = next;
    setRhythmWizardsMoveButtons(next);
  };

  const handleRhythmWizardsCast = (targetX: number, targetY: number): void => {
    if (phase !== "running" || selectedGameMode !== "laser_shoot") return;
    const currentState = rhythmWizardsRef.current;
    if (!currentState || currentState.ended || currentState.player.defeated) return;
    if (currentState.player.cooldownRemainingSeconds > 0) return;
    if (currentState.player.action === "attack" || currentState.player.action === "stagger" || currentState.player.action === "death") return;
    const engine = engineRef.current;
    const heardTimeSeconds = engine ? engine.getCurrentHeardTime() : currentTimeSeconds;
    const aimId = ++rhythmWizardsFxIdRef.current;
    setRhythmWizardsAimPoint({ x: targetX, y: targetY, id: aimId });
    window.setTimeout(() => {
      setRhythmWizardsAimPoint((previous) => (previous && previous.id === aimId ? null : previous));
    }, 180);
    const sync = evaluateBeatSync(
      heardTimeSeconds,
      rhythmWizardsBeatTimelineRef.current,
      windows,
      rhythmWizardsConfig.beatBonusDamageMultiplier,
      rhythmWizardsConfig.beatAoeRadius
    );
    if (sync.judgement === "perfect" || sync.judgement === "great" || sync.judgement === "good") {
      applyJudgement(sync.judgement);
    }
    const casted = castSpell(currentState, {
      owner: "player",
      targetX,
      targetY,
      heardTimeSeconds,
      judgement: sync.judgement,
      bonusMultiplier: sync.bonusMultiplier,
      aoeRadius: sync.aoeRadius,
    });
    if (casted.events.some((event) => event.type === "player_cast")) {
      setRhythmWizardsSyncPulseId((value) => value + 1);
    }
    if (sync.judgement === "perfect" || sync.judgement === "great" || sync.judgement === "good") {
      const burstId = ++rhythmWizardsFxIdRef.current;
      setRhythmWizardsBurst({
        x: targetX,
        y: targetY,
        judgement: sync.judgement as RhythmBonusJudgement,
        id: burstId,
      });
      window.setTimeout(() => {
        setRhythmWizardsBurst((previous) =>
          previous && previous.id === burstId ? null : previous
        );
      }, 230);
    }
    rhythmWizardsRef.current = casted.state;
    setRhythmWizardsState(casted.state);
  };

  const handleRhythmWizardsFieldPointerDown = (event: Event): void => {
    if (selectedGameMode !== "laser_shoot" || phase !== "running") return;
    const pointerEvent = event as PointerEvent;
    const element = pointerEvent.currentTarget as HTMLElement | null;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (pointerEvent.clientY - rect.top) / rect.height));
    if (y > 0.94) {
      return;
    }
    handleRhythmWizardsCast(x, y);
  };

  useEffect(() => {
    const engine = createPrecisePlaybackEngine();
    engine.setOnEnded(() => {
      setPlaying(false);
      setCurrentTimeSeconds(engine.getDurationSeconds());
      stopLoop();
      if (!endSignaledRef.current && runStartedRef.current && !finalizedRef.current && !forfeitedRef.current) {
        endSignaledRef.current = true;
        setSongEndedSignal((value) => value + 1);
      }
    });
    engineRef.current = engine;
    return () => {
      stopLoop();
      stopCountdown();
      if (judgementTimeoutRef.current !== null) window.clearTimeout(judgementTimeoutRef.current);
      engine.dispose().catch(() => undefined);
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadSongs().catch(() => undefined);
  }, []);

  useEffect(() => {
    const syncOrientation = (): void => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    syncOrientation();
    window.addEventListener("resize", syncOrientation);
    window.addEventListener("orientationchange", syncOrientation);
    return () => {
      window.removeEventListener("resize", syncOrientation);
      window.removeEventListener("orientationchange", syncOrientation);
    };
  }, []);

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  useEffect(() => {
    const onDanceOffLinkState = (event: Event): void => {
      const detail = (event as CustomEvent<DanceOffLinkStatePayload>).detail;
      setLinkedDanceOffState({
        linked: Boolean(detail?.linked),
        danceOffId: detail?.danceOffId ?? null,
        status: detail?.status ?? null,
      });
    };
    window.addEventListener("danceoff:self-link-state", onDanceOffLinkState as EventListener);
    return () => {
      window.removeEventListener("danceoff:self-link-state", onDanceOffLinkState as EventListener);
    };
  }, []);

  useEffect(() => {
    const onMatchStart = (event: Event): void => {
      const detail = (event as CustomEvent<DanceOffMatchPayload>).detail;
      if (!detail?.id || !detail?.beatEntryId) {
        return;
      }
      void startDanceOffMatch({
        id: detail.id,
        beatEntryId: detail.beatEntryId,
        gameMode:
          detail.gameMode === "orb_beat" || detail.gameMode === "laser_shoot"
            ? detail.gameMode
            : "step_arrows",
        difficulty: detail.difficulty === "easy" || detail.difficulty === "hard" ? detail.difficulty : "normal",
      });
    };

    const onMatchCancelled = (event: Event): void => {
      const detail = (event as CustomEvent<{ danceOffId?: string; message?: string; danceOff?: DanceOffCompletionPayload }>).detail;
      if (!detail?.danceOffId || activeDanceOffIdRef.current !== detail.danceOffId) {
        return;
      }
      const engine = engineRef.current;
      if (engine) {
        engine.pause();
      }
      stopLoop();
      stopCountdown();
      setPlaying(false);
      setPhase("finished");
      const cancelMessage = detail.message || "Dance-Off was cancelled.";
      setResultsModal((current) => ({
        ...current,
        visible: true,
        canExit: true,
        message: cancelMessage,
      }));
      activeDanceOffIdRef.current = null;
      setActiveDanceOffId(null);
    };

    const onMatchCompleted = (event: Event): void => {
      const detail = (event as CustomEvent<{ danceOffId?: string; danceOff?: DanceOffCompletionPayload }>).detail;
      if (!detail?.danceOffId || activeDanceOffIdRef.current !== detail.danceOffId) {
        return;
      }
      const completedDanceOff = detail.danceOff;
      const hasAllFinalResults =
        Boolean(completedDanceOff) &&
        (completedDanceOff?.participants?.length ?? 0) > 0 &&
        completedDanceOff!.participants.every(
          (participant) => participant.finalScore !== null && participant.finalAccuracy !== null
        );
      if (!hasAllFinalResults) {
        setResultsModal((current) => ({
          ...current,
          visible: true,
          canExit: false,
          message: "Dance-Off result submitted. Waiting for all players to finish.",
        }));
        return;
      }
      const sortedParticipants = [...(completedDanceOff?.participants ?? [])].sort(
        (a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0)
      );
      const details = sortedParticipants.map((participant) => {
        const scoreValue = participant.finalScore ?? 0;
        const accuracyValue = participant.finalAccuracy ?? 0;
        return `${danceOffParticipantLabel(participant)}: ${scoreValue} (${accuracyValue.toFixed(2)}%)`;
      });
      const winner = completedDanceOff?.participants.find((participant) => participant.userId === completedDanceOff.winnerUserId);
      const summaryMessage = completedDanceOff?.isDraw
        ? "Dance-Off result: Draw"
        : winner
          ? `Winner: ${danceOffParticipantLabel(winner)}`
          : "Dance-Off complete";
      setResultsModal((current) => ({
        ...current,
        visible: true,
        canExit: true,
        message: summaryMessage,
        details,
      }));
      setPhase("finished");
      activeDanceOffIdRef.current = null;
      setActiveDanceOffId(null);
    };

    window.addEventListener("danceoff:match-start", onMatchStart as EventListener);
    window.addEventListener("danceoff:match-cancelled", onMatchCancelled as EventListener);
    window.addEventListener("danceoff:match-completed", onMatchCompleted as EventListener);
    return () => {
      window.removeEventListener("danceoff:match-start", onMatchStart as EventListener);
      window.removeEventListener("danceoff:match-cancelled", onMatchCancelled as EventListener);
      window.removeEventListener("danceoff:match-completed", onMatchCompleted as EventListener);
    };
  }, [mode, phase]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    return () => {
      if (rolodexRafRef.current !== null) {
        window.cancelAnimationFrame(rolodexRafRef.current);
      }
      clearMenuPreviewLoop();
      const audio = menuPreviewAudioRef.current;
      if (audio) {
        audio.pause();
        audio.src = "";
      }
      menuPreviewEntryIdRef.current = "";
    };
  }, []);

  useEffect(() => {
    if (mode !== "menu" || songs.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      const focusId = selectedId && songs.some((song) => song.beatEntryId === selectedId)
        ? selectedId
        : songs[0].beatEntryId;
      focusSongCard(focusId, false);
    });
    const onResize = () => handleRolodexScroll();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, [mode, selectedId, songs]);

  useEffect(() => {
    if (!selectedId || mode !== "scores") return;
    loadLeaderboards(selectedId, selectedGameMode, selectedDifficulty).catch(() => undefined);
  }, [mode, selectedDifficulty, selectedGameMode, selectedId]);

  useEffect(() => {
    if (mode !== "menu") {
      previewLog("effect-mode-not-menu-stop");
      void stopMenuPreview();
      return;
    }
    const entryId = selectedId || songs[0]?.beatEntryId || "";
    previewLog("effect-menu-selection", { entryId, selectedId, songsCount: songs.length });
    if (!entryId) return;
    if (!selectedId) {
      previewLog("effect-auto-select-first-song", { entryId });
      setSelectedId(entryId);
    }
    if (menuAudioEnabled) {
      previewLog("effect-start-preview", { entryId });
      void startMenuPreview(entryId);
    } else {
      previewLog("effect-preview-skipped-audio-disabled", { entryId });
    }
  }, [mode, selectedId, songs, menuAudioEnabled]);

  useEffect(() => {
    rebuildChart();
  }, [selectedDifficulty, selectedGameMode, selectedEntry?.id, analysisMajorBeats?.length]);

  useEffect(() => {
    if (songs.length === 0) {
      if (selectedId) {
        setSelectedId("");
      }
      return;
    }
    if (!songs.some((song) => song.beatEntryId === selectedId)) {
      setSelectedId(songs[0].beatEntryId);
    }
  }, [selectedId, songs]);

  useEffect(() => {
    if (!selectedSongSummary) {
      return;
    }
    const availableModes = selectedSongSummary.availableGameModes ?? [];
    if (availableModes.length === 0) {
      setSelectedGameMode("step_arrows");
      setSelectedDifficulty("normal");
      return;
    }
    if (!availableModes.includes(selectedGameMode)) {
      setSelectedGameMode(availableModes.includes("step_arrows") ? "step_arrows" : availableModes[0]);
      return;
    }
    const availableDifficulties = Object.keys(
      selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode] ?? {}
    ) as GameDifficulty[];
    if (availableDifficulties.length === 0) {
      setSelectedDifficulty("normal");
      return;
    }
    if (!availableDifficulties.includes(selectedDifficulty)) {
      setSelectedDifficulty(
        availableDifficulties.includes("normal") ? "normal" : availableDifficulties[0]
      );
    }
  }, [selectedDifficulty, selectedGameMode, selectedSongSummary]);

  useEffect(() => {
    if (mode !== "play" || phase !== "running") return;
    if (!runStartedRef.current) return;
    if (songEndedSignal === 0) return;
    if (finalizedRef.current || forfeitedRef.current) return;
    finalizedRef.current = true;
    setPlaying(false);
    stopLoop();
    void finalizeRun();
  }, [mode, phase, songEndedSignal]);

  useEffect(() => {
    if (mode !== "play" || phase !== "running" || !runStartedRef.current) {
      previousTimeRef.current = currentTimeSeconds;
      return;
    }
    const previousTime = previousTimeRef.current;
    if (
      !endSignaledRef.current &&
      !finalizedRef.current &&
      !forfeitedRef.current &&
      previousTime >= 0.75 &&
      currentTimeSeconds <= 0.05
    ) {
      endSignaledRef.current = true;
      setSongEndedSignal((value) => value + 1);
    }
    previousTimeRef.current = currentTimeSeconds;
  }, [mode, phase, currentTimeSeconds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (mode !== "play" || phase !== "running" || event.repeat) return;
      if (selectedGameMode === "laser_shoot") {
        if (event.key === "ArrowLeft") {
          setRhythmWizardsMoveInput("left", true);
          event.preventDefault();
        }
        if (event.key === "ArrowRight") {
          setRhythmWizardsMoveInput("right", true);
          event.preventDefault();
        }
        return;
      }
      if (selectedGameMode === "orb_beat") {
        if (event.key === "7") { handleLaneInput("l1"); event.preventDefault(); }
        if (event.key === "4") { handleLaneInput("l2"); event.preventDefault(); }
        if (event.key === "1") { handleLaneInput("l3"); event.preventDefault(); }
        if (event.key === "9") { handleLaneInput("r1"); event.preventDefault(); }
        if (event.key === "6") { handleLaneInput("r2"); event.preventDefault(); }
        if (event.key === "3") { handleLaneInput("r3"); event.preventDefault(); }
        return;
      }
      if (event.key === "ArrowLeft") { handleLaneInput("left"); event.preventDefault(); }
      if (event.key === "ArrowDown") { handleLaneInput("down"); event.preventDefault(); }
      if (event.key === "ArrowUp") { handleLaneInput("up"); event.preventDefault(); }
      if (event.key === "ArrowRight") { handleLaneInput("right"); event.preventDefault(); }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (selectedGameMode === "laser_shoot") {
        if (event.key === "ArrowLeft") setRhythmWizardsMoveInput("left", false);
        if (event.key === "ArrowRight") setRhythmWizardsMoveInput("right", false);
        return;
      }
      if (selectedGameMode === "orb_beat") {
        if (event.key === "7") releaseLane("l1");
        if (event.key === "4") releaseLane("l2");
        if (event.key === "1") releaseLane("l3");
        if (event.key === "9") releaseLane("r1");
        if (event.key === "6") releaseLane("r2");
        if (event.key === "3") releaseLane("r3");
        return;
      }
      if (event.key === "ArrowLeft") {
        releaseLane("left");
      }
      if (event.key === "ArrowDown") {
        releaseLane("down");
      }
      if (event.key === "ArrowUp") {
        releaseLane("up");
      }
      if (event.key === "ArrowRight") {
        releaseLane("right");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, phase, selectedGameMode]);

  useEffect(() => {
    if (mode === "play" && phase === "running" && selectedGameMode === "laser_shoot") {
      return;
    }
    rhythmWizardsMoveInputRef.current = { left: false, right: false };
    setRhythmWizardsMoveButtons({ left: false, right: false });
  }, [mode, phase, selectedGameMode]);

  const visibleNotes = useMemo(() => {
    const startWindow = currentTimeSeconds - windows.poor - 0.05;
    const endWindow = currentTimeSeconds + runtimeConfig.gameApproachSeconds + 0.25;
    return notesRef.current.filter((note) => note.timeSeconds <= endWindow && Math.max(note.timeSeconds, note.endSeconds) >= startWindow);
  }, [chartRevision, currentTimeSeconds, windows.poor]);

  const activeLanes = selectedGameMode === "orb_beat" ? orbBeatLaneOrder : stepArrowLaneOrder;
  const rhythmWizardsPlayerTier = rhythmWizardsState
    ? getDamageTier(rhythmWizardsState.player.health, rhythmWizardsState.player.maxHealth, rhythmWizardsState.player.defeated)
    : "healthy";
  const rhythmWizardsEnemyTier = rhythmWizardsState
    ? getDamageTier(rhythmWizardsState.enemy.health, rhythmWizardsState.enemy.maxHealth, rhythmWizardsState.enemy.defeated)
    : "healthy";
  const rhythmWizardsEnemySprite = rhythmWizardsState
    ? selectWizardSprite("enemy", rhythmWizardsState.enemy.action)
    : selectWizardSprite("enemy", "idle");
  const rhythmWizardsPlayerSprite = rhythmWizardsState
    ? selectWizardSprite("player", rhythmWizardsState.player.action)
    : selectWizardSprite("player", "idle");
  const rhythmWizardsEnemyFrames = Math.max(1, Math.floor(rhythmWizardsEnemySprite.animation?.frames ?? 1));
  const rhythmWizardsPlayerFrames = Math.max(1, Math.floor(rhythmWizardsPlayerSprite.animation?.frames ?? 1));
  const rhythmWizardsEnemyAnimClass =
    rhythmWizardsEnemyFrames > 1
      ? (rhythmWizardsEnemySprite.animation?.loop ? "anim-loop" : "anim-once")
      : "";
  const rhythmWizardsPlayerAnimClass =
    rhythmWizardsPlayerFrames > 1
      ? (rhythmWizardsPlayerSprite.animation?.loop ? "anim-loop" : "anim-once")
      : "";
  const rhythmWizardsBeatMarkers = useMemo(() => {
    if (selectedGameMode !== "laser_shoot") return [];
    const timeline = rhythmWizardsBeatTimelineRef.current;
    if (timeline.length === 0) return [];
    const syncX = 0.14;
    const minX = 0.02;
    const maxX = 0.98;
    const lookAheadSeconds = 2.3;
    const lookBehindSeconds = 0.28;
    const markers: Array<{ key: string; x: number; opacity: number; scale: number }> = [];
    for (let index = 0; index < timeline.length; index += 1) {
      const beatSeconds = timeline[index];
      const delta = beatSeconds - currentTimeSeconds;
      if (delta < -lookBehindSeconds) continue;
      if (delta > lookAheadSeconds) break;
      let x: number;
      if (delta >= 0) {
        x = syncX + (delta / lookAheadSeconds) * (maxX - syncX);
      } else {
        x = syncX + (delta / lookBehindSeconds) * (syncX - minX);
      }
      const proximity = 1 - Math.min(1, Math.abs(delta) / lookAheadSeconds);
      markers.push({
        key: `rw-beat-${beatSeconds.toFixed(3)}-${index}`,
        x: Math.max(minX, Math.min(maxX, x)),
        opacity: 0.22 + proximity * 0.78,
        scale: 0.62 + proximity * 0.52,
      });
    }
    return markers;
  }, [selectedGameMode, chartRevision, currentTimeSeconds]);

  const enableMenuAudio = (): void => {
    previewLog("audio-enable-clicked", { alreadyEnabled: menuAudioEnabled });
    if (menuAudioEnabled) return;
    setMenuAudioEnabled(true);
    const entryId = selectedId || songs[0]?.beatEntryId || "";
    previewLog("audio-enable-after-set", { entryId });
    if (entryId) {
      void startMenuPreview(entryId);
    }
  };

  if (mode === "menu") {
    return (
      <section className="game-view-shell game-view-shell--menu">
        <header className="game-ui-header">
          <a className="game-ui-link" href={homeHref}>Back Home</a>
          <h2 className="game-menu-title">
            <img src={gameTitleImage} alt="Faceless Dance Stage" draggable={false} />
          </h2>
          <button
            type="button"
            onClick={() => loadSongs({ reset: true, volumeId: selectedVolumeId, offset: 0 })}
            disabled={loadingSongs}
          >
            {loadingSongs ? "Refreshing..." : "Refresh Songs"}
          </button>
        </header>

        <div className="game-menu-screen game-menu-screen--arc">
          <div className="game-menu-heading">
            <h3>Select Your Beat</h3>
            <div className="game-menu-heading-actions">
              <label className="game-menu-volume-field">
                <span>Volume</span>
                <select
                  value={selectedVolumeId}
                  onChange={(event) => {
                    const nextVolumeId = event.currentTarget.value;
                    setSelectedVolumeId(nextVolumeId);
                    setSongs([]);
                    setSelectedId("");
                    void loadSongs({ reset: true, volumeId: nextVolumeId, offset: 0 });
                  }}
                  disabled={loadingSongs || songVolumes.length === 0}
                >
                  {songVolumes.map((volume) => (
                    <option key={volume.volumeId} value={volume.volumeId}>
                      {volume.volumeLabel} ({volume.songCount})
                    </option>
                  ))}
                </select>
                <small>
                  Loaded {songs.length} of {songsTotal}
                </small>
              </label>
              <button
                type="button"
                className={`game-menu-audio-toggle${menuAudioEnabled ? " enabled" : " secondary"}`}
                onClick={enableMenuAudio}
              >
                {menuAudioEnabled ? "Audio Enabled" : "Enable Audio"}
              </button>
            </div>
          </div>

          <div className="game-menu-arc-layout">
            <div className="game-menu-arc-stage">
              <div className="game-song-rolodex" ref={rolodexRef} onScroll={handleRolodexScroll}>
                {loadingSongs ? (
                  <div className="game-song-loading" aria-live="polite" aria-label="Loading songs">
                    <span className="game-song-loading-spinner" aria-hidden="true" />
                    <strong>Loading</strong>
                  </div>
                ) : songs.length === 0 ? (
                  <div className="game-song-loading game-song-loading--empty" aria-live="polite">
                    <strong>No songs in this volume yet.</strong>
                  </div>
                ) : (
                  <>
                    {songs.map((song) => (
                      <button
                        key={song.beatEntryId}
                        type="button"
                        data-song-id={song.beatEntryId}
                        className={`game-song-card${selectedId === song.beatEntryId ? " selected" : ""}`}
                        onClick={() => focusSongCard(song.beatEntryId, true)}
                      >
                        {song.coverImageUrl ? (
                          <img className="game-song-card-bg" src={song.coverImageUrl} alt="" draggable={false} />
                        ) : null}
                        <div className="game-song-card-overlay" />
                        <div className="game-song-card-glare" />
                        <strong>{song.title}</strong>
                        <span>
                          {song.availableDifficulties?.length > 0
                            ? `${song.availableDifficulties.join(", ")}`
                            : `${song.gameBeatCount || song.majorBeatCount} notes`}
                        </span>
                        <span>{song.creatorName}</span>
                      </button>
                    ))}
                    {loadingMoreSongs ? (
                      <div className="game-song-loading game-song-loading--more" aria-live="polite">
                        <span className="game-song-loading-spinner" aria-hidden="true" />
                        <strong>Loading more</strong>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <aside className="game-menu-control-panel">
              {selectedSongSummary ? (
                <>
                  <div className="game-menu-control-group">
                    <p className="game-menu-group-label">Game Mode</p>
                    <div className="game-menu-actions game-menu-actions--group">
                      {GAME_MODES.map((gameMode) => {
                        const available = (selectedSongSummary.availableGameModes ?? []).includes(gameMode);
                        return (
                          <button
                            key={gameMode}
                            type="button"
                            className={selectedGameMode === gameMode ? "" : "secondary"}
                            disabled={!available}
                            onClick={() => setSelectedGameMode(gameMode)}
                          >
                            {formatGameModeLabel(gameMode)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="game-menu-control-group">
                    <p className="game-menu-group-label">Difficulty</p>
                    <div className="game-menu-actions game-menu-actions--group">
                      {GAME_DIFFICULTIES.map((difficulty) => {
                        const available =
                          (selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[difficulty] ?? 0) > 0;
                        return (
                          <button
                            key={difficulty}
                            type="button"
                            className={selectedDifficulty === difficulty ? "" : "secondary"}
                            disabled={!available}
                            onClick={() => setSelectedDifficulty(difficulty)}
                          >
                            {difficulty} ({selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[difficulty] ?? 0})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {selectedGameMode === "laser_shoot" ? (
                    <div className="game-menu-control-group">
                      <p className="game-menu-group-label">Wizard AI</p>
                      <div className="game-menu-actions game-menu-actions--group">
                        {WIZARD_AI_DIFFICULTIES.map((difficulty) => (
                          <button
                            key={difficulty}
                            type="button"
                            className={selectedWizardAiDifficulty === difficulty ? "" : "secondary"}
                            onClick={() => setSelectedWizardAiDifficulty(difficulty)}
                          >
                            {difficulty}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <p className="small game-menu-meta">
                    {selectedSongSummary.volumeLabel} | {formatGameModeLabel(selectedGameMode)} | {selectedDifficulty} | notes{" "}
                    {selectedSongSummary.modeDifficultyBeatCounts?.[selectedGameMode]?.[selectedDifficulty] ?? 0}
                    {selectedGameMode === "laser_shoot" ? ` | AI ${selectedWizardAiDifficulty}` : ""}
                  </p>
                </>
              ) : null}
              <div className="game-menu-actions game-menu-actions--cta">
                <button
                  type="button"
                  disabled={
                    isBlockedByLinkedDanceOff ||
                    !selectedId ||
                    loadingEntry ||
                    ((selectedSongSummary?.modeDifficultyBeatCounts?.[selectedGameMode]?.[selectedDifficulty] ?? 0) <= 0 &&
                      !(
                        (selectedGameMode === "step_arrows" || selectedGameMode === "laser_shoot") &&
                        selectedDifficulty === "normal" &&
                        (selectedSongSummary?.majorBeatCount ?? 0) > 0
                      ))
                  }
                  onClick={() => startSoloGame()}
                >
                  {loadingEntry ? "Loading Song..." : "Start Game"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    isBlockedByLinkedDanceOff ||
                    !selectedId ||
                    loadingEntry ||
                    ((selectedSongSummary?.modeDifficultyBeatCounts?.[selectedGameMode]?.[selectedDifficulty] ?? 0) <= 0 &&
                      !(
                        (selectedGameMode === "step_arrows" || selectedGameMode === "laser_shoot") &&
                        selectedDifficulty === "normal" &&
                        (selectedSongSummary?.majorBeatCount ?? 0) > 0
                      ))
                  }
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("danceoff:create-request", {
                        detail: {
                          beatEntryId: selectedId,
                          gameMode: selectedGameMode,
                          difficulty: selectedDifficulty,
                        },
                      })
                    );
                    window.dispatchEvent(new CustomEvent("danceoff:panel:open"));
                  }}
                >
                  Dance-Off (PVP)
                </button>
                <button type="button" className="secondary" disabled={!selectedId} onClick={() => setMode("scores")}>View High Scores</button>
              </div>
              {isBlockedByLinkedDanceOff ? (
                <p className="small game-menu-meta">You are already linked to a Dance-Off. Leave/cancel or finish it before starting another song.</p>
              ) : null}
            </aside>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {songs.length === 0 && !loadingSongs ? <p>No enabled songs available yet.</p> : null}
        </div>
      </section>
    );
  }

  if (mode === "scores") {
    return (
      <section className="game-view-shell">
        <header className="game-ui-header">
          <a className="game-ui-link" href={homeHref}>Back Home</a>
          <h2>High Scores</h2>
          <button type="button" className="secondary" onClick={() => setMode("menu")}>Back To Game Menu</button>
        </header>
        <div className="game-scores-screen">
          <section className="game-score-panel">
            <h3>Song High Scores ({formatGameModeLabel(selectedGameMode)} | {selectedDifficulty})</h3>
            {songLeaderboard.length === 0 ? <p>No scores yet for this track.</p> : (
              <ol>
                {songLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong className="game-score-number">{row.score}</strong></li>
                ))}
              </ol>
            )}
          </section>
          <section className="game-score-panel">
            <h3>Overall High Scores</h3>
            {overallLeaderboard.length === 0 ? <p>No overall scores yet.</p> : (
              <ol>
                {overallLeaderboard.slice(0, 20).map((row) => (
                  <li key={`${row.publicKey}-${row.displayName}`}><span>{row.displayName}</span><strong className="game-score-number">{row.totalScore}</strong></li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="game-view-shell game-mode-active">
      <div
        className={`ddr-field${
          selectedGameMode === "orb_beat"
            ? ` orb-field${isLandscape ? " landscape" : " portrait"}`
            : selectedGameMode === "laser_shoot"
              ? " rw-field"
              : ""
        }`}
      >
        <div className="game-play-overlay">
          <div className="game-play-topbar">
            <button type="button" className="secondary game-play-exit" onClick={() => goToMenu()}>Exit</button>
            <div className="game-play-title-block">
              <div className="game-play-title">
                {songs.find((song) => song.beatEntryId === selectedId)?.title ?? "Gameplay"}
              </div>
              <div className="game-play-subtitle">
                {formatGameModeLabel(selectedGameMode)} | {selectedDifficulty}
                {selectedGameMode === "laser_shoot" ? ` | AI ${selectedWizardAiDifficulty}` : ""}
              </div>
            </div>
            <div className="game-top-status">
              {phase === "finished"
                ? "Complete"
                : phase === "running"
                  ? activeDanceOffId
                    ? "Dance-Off Live"
                    : "Live"
                  : ""}
            </div>
          </div>
          <div className={`game-play-hud${selectedGameMode === "laser_shoot" ? " rw-hud" : ""}`}>
            {selectedGameMode === "laser_shoot" ? (
              <>
                <div className="ddr-life">
                  <span>PLAYER HP</span>
                  <div className="ddr-life-bar">
                    <div className="ddr-life-fill" style={{ width: `${rhythmWizardsPlayerHealthPercent}%` }} />
                  </div>
                </div>
                <div className="ddr-life">
                  <span>ENEMY HP</span>
                  <div className="ddr-life-bar">
                    <div className="ddr-life-fill enemy-hp" style={{ width: `${rhythmWizardsEnemyHealthPercent}%` }} />
                  </div>
                </div>
                <div className="rw-beat-stream" aria-hidden="true">
                  <div className="rw-beat-track">
                    <span
                      key={`rw-sync-line-${rhythmWizardsSyncPulseId}`}
                      className={`rw-beat-sync-line${rhythmWizardsSyncPulseId > 0 ? " pulse" : ""}`}
                    />
                    {rhythmWizardsBeatMarkers.map((marker) => (
                      <span
                        key={marker.key}
                        className="rw-beat-dot"
                        style={{
                          left: `${marker.x * 100}%`,
                          opacity: marker.opacity,
                          transform: `translate(-50%, -50%) scale(${marker.scale})`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="ddr-life"><span>LIFE</span><div className="ddr-life-bar"><div className="ddr-life-fill" style={{ width: `${lifePercent}%` }} /></div></div>
                <div className="ddr-score-stack"><span className="ddr-score-label">SCORE</span><strong className="game-score-number">{totalScore}</strong></div>
                <div className="ddr-score-stack"><span className="ddr-score-label">COMBO</span><strong className="game-score-number">{score.combo}</strong></div>
              </>
            )}
          </div>
        </div>

        <div className="game-play-stage">
          {selectedGameMode === "laser_shoot" ? (
            <>
              <div className="rw-battlefield" onPointerDown={handleRhythmWizardsFieldPointerDown}>
                <img src={rhythmWizardsAssets.battlefield.src} alt="" className="rw-battlefield-bg" draggable={false} />
                {rhythmWizardsState?.obstacles.map((obstacle, index) => {
                  const tier = getDamageTier(obstacle.health, obstacle.maxHealth, obstacle.destroyed);
                  const sprite = selectObstacleSprite(index, tier);
                  return (
                    <div
                      key={obstacle.id}
                      className={`rw-obstacle tier-${tier}${obstacle.hitFlashRemainingSeconds > 0 ? " hit-flash" : ""}`}
                      style={{
                        left: `${obstacle.x * 100}%`,
                        top: `${obstacle.y * 100}%`,
                        width: `${obstacle.width * 100}%`,
                        height: `${obstacle.height * 100}%`,
                      }}
                    >
                      <img src={sprite.src} alt="" draggable={false} />
                    </div>
                  );
                })}

                {rhythmWizardsState?.projectiles.map((projectile) => (
                  <div
                    key={projectile.id}
                    className={`rw-projectile ${projectile.owner === "player" ? "owner-player" : "owner-enemy"} judgement-${projectile.beatJudgement}`}
                    style={{
                      left: `${projectile.x * 100}%`,
                      top: `${projectile.y * 100}%`,
                    }}
                  >
                    <span className="rw-projectile-tail" />
                    <span className="rw-projectile-core" />
                  </div>
                ))}

                {rhythmWizardsAimPoint ? (
                  <div
                    key={`rw-aim-${rhythmWizardsAimPoint.id}`}
                    className="rw-aim-point"
                    style={{ left: `${rhythmWizardsAimPoint.x * 100}%`, top: `${rhythmWizardsAimPoint.y * 100}%` }}
                  />
                ) : null}

                {rhythmWizardsBurst ? (
                  <div
                    key={`rw-burst-${rhythmWizardsBurst.id}`}
                    className={`rw-burst judgement-${rhythmWizardsBurst.judgement}`}
                    style={{ left: `${rhythmWizardsBurst.x * 100}%`, top: `${rhythmWizardsBurst.y * 100}%` }}
                  >
                    <span>{rhythmWizardsBurst.judgement.toUpperCase()}</span>
                  </div>
                ) : null}
                {rhythmWizardsImpact ? (
                  <div
                    key={`rw-impact-${rhythmWizardsImpact.id}`}
                    className={`rw-impact ${rhythmWizardsImpact.kind}`}
                    style={{ left: `${rhythmWizardsImpact.x * 100}%`, top: `${rhythmWizardsImpact.y * 100}%` }}
                  />
                ) : null}

                <div className={`rw-wizard rw-wizard-enemy tier-${rhythmWizardsEnemyTier}${rhythmWizardsState?.enemy.hitFlashRemainingSeconds ? " hit-flash" : ""}${rhythmWizardsState?.enemy.defeated ? " defeated" : ""}`}
                  style={{
                    left: `${(rhythmWizardsState?.enemy.x ?? 0.5) * 100}%`,
                    top: `${(rhythmWizardsState?.enemy.y ?? 0.12) * 100}%`,
                  }}
                >
                  <div
                    key={`enemy-sprite-${rhythmWizardsState?.enemy.actionToken ?? 0}`}
                    className={`rw-sprite frames-${rhythmWizardsEnemyFrames} ${rhythmWizardsEnemyAnimClass}`.trim()}
                    style={spriteStyle(
                      rhythmWizardsEnemySprite.src,
                      rhythmWizardsEnemySprite.animation?.frames,
                      rhythmWizardsEnemySprite.animation?.frameDurationMs
                    )}
                  />
                  <div className="rw-health">
                    <div
                      className="rw-health-fill enemy"
                      style={{
                        width: `${Math.max(0, Math.min(100, ((rhythmWizardsState?.enemy.health ?? 0) / Math.max(1, rhythmWizardsState?.enemy.maxHealth ?? 100)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>

                <div className={`rw-wizard rw-wizard-player tier-${rhythmWizardsPlayerTier}${rhythmWizardsState?.player.hitFlashRemainingSeconds ? " hit-flash" : ""}${rhythmWizardsState?.player.defeated ? " defeated" : ""}`}
                  style={{
                    left: `${(rhythmWizardsState?.player.x ?? 0.5) * 100}%`,
                    top: `${(rhythmWizardsState?.player.y ?? 0.9) * 100}%`,
                  }}
                >
                  <div
                    key={`player-sprite-${rhythmWizardsState?.player.actionToken ?? 0}`}
                    className={`rw-sprite frames-${rhythmWizardsPlayerFrames} ${rhythmWizardsPlayerAnimClass}`.trim()}
                    style={spriteStyle(
                      rhythmWizardsPlayerSprite.src,
                      rhythmWizardsPlayerSprite.animation?.frames,
                      rhythmWizardsPlayerSprite.animation?.frameDurationMs
                    )}
                  />
                  <div className="rw-health">
                    <div className="rw-health-fill player" style={{ width: `${rhythmWizardsPlayerHealthPercent}%` }} />
                  </div>
                </div>

                <div className="rw-controls">
                  <button
                    type="button"
                    className={`rw-move-button${rhythmWizardsMoveButtons.left ? " held" : ""}`}
                    disabled={phase !== "running"}
                    onMouseDown={() => setRhythmWizardsMoveInput("left", true)}
                    onMouseUp={() => setRhythmWizardsMoveInput("left", false)}
                    onMouseLeave={() => setRhythmWizardsMoveInput("left", false)}
                    onTouchStart={() => setRhythmWizardsMoveInput("left", true)}
                    onTouchEnd={() => setRhythmWizardsMoveInput("left", false)}
                    onTouchCancel={() => setRhythmWizardsMoveInput("left", false)}
                  >
                    <img src={rhythmWizardsAssets.controls.left.src} alt="Move left" draggable={false} />
                  </button>
                  <button
                    type="button"
                    className={`rw-move-button${rhythmWizardsMoveButtons.right ? " held" : ""}`}
                    disabled={phase !== "running"}
                    onMouseDown={() => setRhythmWizardsMoveInput("right", true)}
                    onMouseUp={() => setRhythmWizardsMoveInput("right", false)}
                    onMouseLeave={() => setRhythmWizardsMoveInput("right", false)}
                    onTouchStart={() => setRhythmWizardsMoveInput("right", true)}
                    onTouchEnd={() => setRhythmWizardsMoveInput("right", false)}
                    onTouchCancel={() => setRhythmWizardsMoveInput("right", false)}
                  >
                    <img src={rhythmWizardsAssets.controls.right.src} alt="Move right" draggable={false} />
                  </button>
                </div>
              </div>
            </>
          ) : selectedGameMode === "orb_beat" ? (
            <>
              <div className="orb-core" />
              <div className="orb-lanes">
                {activeLanes.map((lane) => {
                  const laneNotes = visibleNotes.filter((note) => note.lane === lane);
                  return (
                    <div key={lane} className={`orb-lane lane-${lane}`}>
                      {laneNotes.map((note) => {
                        const timeUntilHit = note.timeSeconds - currentTimeSeconds;
                        const progress = 1 - timeUntilHit / Math.max(0.05, runtimeConfig.gameApproachSeconds);
                        const distancePercent = Math.max(0, Math.min(100, progress * 100));
                        const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
                        const tailScale = Math.max(
                          0.4,
                          Math.min(2.5, (note.endSeconds - note.timeSeconds) / Math.max(0.08, runtimeConfig.gameApproachSeconds))
                        );
                        return (
                          <div
                            key={note.id}
                            className={`orb-note lane-${note.lane}${note.judged ? " judged" : ""}${note.holdStarted && !note.judged ? " holding" : ""}${isHold ? " hold-note" : ""}`}
                            style={{
                              "--orb-progress": `${distancePercent}%`,
                              "--orb-tail-scale": String(tailScale)
                            } as CSSProperties}
                          >
                            <span className="orb-note-core" />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="orb-control-grid">
                {activeLanes.map((lane) => (
                  <div key={lane} className={`orb-control-anchor lane-${lane}`}>
                    <button
                      type="button"
                      disabled={phase !== "running"}
                      className={`orb-control lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${heldLanes[lane] ? " held" : ""}`}
                      onMouseDown={() => handleLaneMouseDown(lane)}
                      onMouseUp={() => releaseLane(lane)}
                      onMouseLeave={() => releaseLane(lane)}
                      onTouchStart={(event) => handleLaneTouchStart(event, lane)}
                      onTouchEnd={() => releaseLane(lane)}
                      onTouchCancel={() => releaseLane(lane)}
                    >
                      <span>{orbControlLabels[lane as OrbBeatLane]}</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="ddr-lanes">
                {stepArrowLaneOrder.map((lane) => (
                  <div key={lane} className={`ddr-lane lane-${lane}`}>
                    {visibleNotes.filter((note) => note.lane === lane).map((note) => {
                      const timeUntilHit = note.timeSeconds - currentTimeSeconds;
                      const progress = 1 - timeUntilHit / Math.max(0.05, runtimeConfig.gameApproachSeconds);
                      const topPercent = 92 - progress * 87;
                      const isHold = note.type === "hold" && note.endSeconds - note.timeSeconds >= HOLD_MIN_SECONDS;
                      const tailSeconds = Math.max(0, note.endSeconds - note.timeSeconds);
                      const holdHeightPx = Math.max(58, (tailSeconds / Math.max(0.05, runtimeConfig.gameApproachSeconds)) * 240);
                      return (
                        <div key={note.id} className={`ddr-note lane-${note.lane}${note.judged ? " judged" : ""}${note.holdStarted && !note.judged ? " holding" : ""}${isHold ? " hold-note" : ""}`} style={{ top: `${topPercent}%`, ...(isHold ? { height: `${holdHeightPx}px` } : null) } as CSSProperties}>
                          <img className={`ddr-arrow-graphic beat ${isHold ? "top-cap" : "single"}`} src={beatArrowImages[note.lane as StepArrowLane]} alt="" draggable={false} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="ddr-step-zone">
                {stepArrowLaneOrder.map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    disabled={phase !== "running"}
                    className={`ddr-receptor lane-${lane}${pressedLanes[lane] ? " pressed" : ""}${heldLanes[lane] ? " held" : ""}`}
                    onMouseDown={() => handleLaneMouseDown(lane)}
                    onMouseUp={() => releaseLane(lane)}
                    onMouseLeave={() => releaseLane(lane)}
                    onTouchStart={(event) => handleLaneTouchStart(event, lane)}
                    onTouchEnd={() => releaseLane(lane)}
                    onTouchCancel={() => releaseLane(lane)}
                  >
                    <img className="ddr-arrow-graphic control" src={controlArrowImages[lane]} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            </>
          )}

          {lastJudgement && selectedGameMode !== "laser_shoot" ? (
            <div key={`${lastJudgement}-${judgementEventId}`} className={`ddr-judge-popup ${lastJudgement}`}>
              {lastJudgement.toUpperCase()}
            </div>
          ) : null}
          {selectedGameMode !== "laser_shoot" && score.combo > 1 ? <div className="ddr-combo-popup"><span className="game-score-number">{score.combo}</span> COMBO</div> : null}
          {phase === "countdown" && countdownBeats > 0 ? <div className="game-countdown-overlay">{countdownBeats}</div> : null}
          {phase === "running" || phase === "finished" ? (
            <LyricsSubtitle
              lyrics={selectedEntry?.lyrics ?? null}
              currentTimeSeconds={currentTimeSeconds}
              className="lyrics-subtitle--game"
            />
          ) : null}

          {resultsModal.visible ? (
            <div className="game-results-modal" role="dialog" aria-modal="true">
              <h3>Song Complete</h3>
              <p className="result-line">Score: <strong className="game-score-number">{resultsModal.score}</strong></p>
              <p className="result-line">Accuracy: <strong className="game-score-number">{resultsModal.percentage.toFixed(2)}%</strong></p>
              {canSubmitHolderScore && resultsModal.rank ? <p className="result-line">Rank: <strong className="game-score-number">#{resultsModal.rank}</strong></p> : null}
              <p className="small">{resultsModal.message}</p>
              {resultsModal.details.length > 0 ? (
                <div className="game-results-details">
                  {resultsModal.details.map((line) => (
                    <p key={line} className="small">{line}</p>
                  ))}
                </div>
              ) : null}
              {resultsModal.canExit ? <button type="button" onClick={() => goToMenu()}>Back To Menu</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
