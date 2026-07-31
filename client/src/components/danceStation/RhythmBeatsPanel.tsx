import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Activity, Check, Download, FileAudio, Globe2, ImagePlus, LoaderCircle, Music2, Pause, Play, Save, Trash2, Upload, Waves, X } from "lucide-preact";
import {
  api,
  type LibraryItem,
  type RemoteGenerationInput,
  type RemoteGenerationRequest,
  type RemoteJob,
  type RemoteArtifact,
  type RemotePaymentCurrency,
  type RemotePricingConfig,
  type RemotePricingQuote,
} from "../../lib/api";
import { sendRemoteGenerationPayment, sendRemoteGenerationSolPayment, signRemoteGenerationPayment } from "../../lib/remoteGenerationPayment";
import { calculateRemotePricing, createFreeMarketPrice, fetchOnChainMarketPrice, holderFreeForRequest, type RemoteMarketPrice } from "../../lib/remoteGenerationPricing";
import { saveWorkspaceItem, type BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import type { SessionState } from "../../hooks/useSession";
import { GAME_DIFFICULTIES, type GameDifficulty } from "../../game/lib/game/difficultyCharts";
import { AudioPlayButton } from "../audio/SiteAudioPlayer";

interface Props {
  session: SessionState;
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  onWorkspaceChanged?: () => void | Promise<void>;
  onPublishAsset?: (item: BrowserWorkspaceItem) => Promise<void>;
}

const MAX_DURATION_SECONDS = 360;
const DEFAULT_ROW_STRENGTH = 0.08;
const MIN_CHART_WIDTH = 1400;
const PIXELS_PER_SECOND = 22;
const CHART_LABEL_WIDTH = 190;
const CHART_HORIZONTAL_PADDING = 10;
const STEMS = [
  ["vocals", "Vocals"],
  ["backing_vocals", "Backing vocals"],
  ["drums", "Drums"],
  ["bass", "Bass"],
  ["guitar", "Guitar"],
  ["keyboard", "Keyboard"],
  ["percussion", "Percussion"],
  ["strings", "Strings"],
  ["synth", "Synth"],
  ["fx", "FX"],
  ["brass", "Brass"],
  ["woodwinds", "Woodwinds"],
] as const;
const DEFAULT_REANALYZE_STEM_ORDER: RhythmStem[] = ["vocals", "drums", "bass", "guitar", "keyboard"];
const ACTIVE_STATUSES = new Set(["created", "awaiting_payment", "queued", "starting", "running", "uploading", "cancel_requested"]);

type RhythmStem = (typeof STEMS)[number][0];
type StemMode = "all" | "selected";
type ChartEventKind = "beats" | "events" | "sustains";
type RhythmGameMode = "step_arrows" | "orb_beat";
type RhythmDifficultySelections = Partial<Record<GameDifficulty, string[]>>;
type UserRhythmGameVolume = {
  volumeId: string;
  volumeLabel: string;
  volumeSlug: string;
  officialVolume: false;
  sortOrder: number;
};
type RhythmBeatAssetSaveOptions = {
  title: string;
  imageFile?: File;
  gameModes: RhythmGameMode[];
  volume: UserRhythmGameVolume;
  rangeSelections: RhythmRangeSelection[];
  difficultySelections: RhythmDifficultySelections;
  difficultyRangeSelections: RhythmDifficultyRangeSelections;
};
type ChartEventRecord = {
  timeSeconds?: number;
  startSeconds?: number;
  endSeconds?: number;
  durationSeconds?: number;
  strength?: number;
  kind?: string;
  pitchMidi?: number | null;
};
type ChartAnalysis = {
  stem?: string;
  majorBeats?: ChartEventRecord[];
  bandBeats?: Record<string, ChartEventRecord[]>;
  beats?: ChartEventRecord[];
  events?: ChartEventRecord[];
  sustains?: ChartEventRecord[];
};
type ChartManifest = {
  combined?: { durationSeconds?: number; tempoBpm?: number; majorBeats?: ChartEventRecord[]; bandBeats?: Record<string, ChartEventRecord[]>; beats?: ChartEventRecord[]; analyses?: ChartAnalysis[] };
  analyses?: ChartAnalysis[];
};

type RhythmChartEvent = {
  id: string;
  stem: RhythmStem;
  kind: ChartEventKind;
  startSeconds: number;
  endSeconds: number;
  strength: number;
  pitchMidi?: number | null;
};
type RhythmRowThresholds = Partial<Record<RhythmStem, number>>;
type RhythmDragSelection = { stem: RhythmStem; startSeconds: number; endSeconds: number };
type RhythmRangeSelection = RhythmDragSelection & { id: string };
type RhythmDifficultyRangeSelections = Partial<Record<GameDifficulty, RhythmRangeSelection[]>>;
type RhythmHistoryJob = RemoteJob & {
  reanalysisChildren?: RemoteJob[];
  reanalysisBaseJob?: RemoteJob;
  reanalysisState?: "active" | "failed";
};

const EVENT_KIND_LABELS: Array<[ChartEventKind, string]> = [["beats", "Beats"], ["events", "Onsets"], ["sustains", "Sustains"]];
const RHYTHM_GAME_MODE_LABELS: Array<[RhythmGameMode, string]> = [["step_arrows", "Arrow / Wizard"], ["orb_beat", "Orb Beat"]];
const RHYTHM_DIFFICULTY_LABELS: Array<[GameDifficulty, string]> = [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]];
const OFFICIAL_RHYTHM_VOLUME_ID = "faceless-volume-1";
const CREATE_RHYTHM_VOLUME_ID = "__create_user_volume__";

function rhythmDifficultySelectionsFromMetadata(metadata: Record<string, unknown> | undefined): RhythmDifficultySelections {
  const selections: RhythmDifficultySelections = {};
  const raw = metadata?.difficultySelectedEventIds;
  const hasDifficultyMatrix = Boolean(raw && typeof raw === "object");
  if (raw && typeof raw === "object") {
    for (const difficulty of GAME_DIFFICULTIES) {
      const ids = (raw as Record<string, unknown>)[difficulty];
      if (Array.isArray(ids)) {
        selections[difficulty] = ids.filter((id): id is string => typeof id === "string");
      }
    }
  }
  if (!hasDifficultyMatrix && Array.isArray(metadata?.selectedEventIds)) {
    selections.normal = metadata.selectedEventIds.filter((id): id is string => typeof id === "string");
  }
  return selections;
}

function rhythmDifficultySelectionEntries(selections: RhythmDifficultySelections): Array<[GameDifficulty, string[]]> {
  return GAME_DIFFICULTIES
    .map((difficulty) => [difficulty, selections[difficulty] ?? []] as [GameDifficulty, string[]])
    .filter(([, eventIds]) => eventIds.length > 0);
}

function userRhythmVolumeFromMetadata(metadata: Record<string, unknown>): UserRhythmGameVolume | null {
  const volumeId = typeof metadata.volumeId === "string" ? metadata.volumeId.trim() : "";
  const volumeLabel = typeof metadata.volumeLabel === "string" ? metadata.volumeLabel.trim() : "";
  const volumeSlug = typeof metadata.volumeSlug === "string" ? metadata.volumeSlug.trim() : "";
  if (!volumeId || !volumeLabel || !volumeSlug || volumeId === OFFICIAL_RHYTHM_VOLUME_ID || metadata.officialVolume === true || metadata.official_volume === true) {
    return null;
  }
  return {
    volumeId,
    volumeLabel,
    volumeSlug,
    officialVolume: false,
    sortOrder: typeof metadata.sortOrder === "number" && Number.isFinite(metadata.sortOrder) ? Math.max(0, Math.trunc(metadata.sortOrder)) : 0,
  };
}

function userRhythmVolumes(items: BrowserWorkspaceItem[]): UserRhythmGameVolume[] {
  const volumes = new Map<string, UserRhythmGameVolume>();
  items.forEach((item) => {
    if (item.kind !== "rhythm_game") return;
    const volume = userRhythmVolumeFromMetadata(item.metadata);
    if (volume && !volumes.has(volume.volumeId)) volumes.set(volume.volumeId, volume);
  });
  return [...volumes.values()].sort((left, right) => left.volumeLabel.localeCompare(right.volumeLabel));
}

function workspaceItemHasCover(item: BrowserWorkspaceItem | undefined): boolean {
  if (!item) return false;
  const cardImageBlob = item.metadata.cardImageBlob;
  if (cardImageBlob && typeof cardImageBlob === "object" && "size" in cardImageBlob && Number(cardImageBlob.size) > 0) return true;
  return typeof item.metadata.cardImageFileName === "string" && item.metadata.cardImageFileName.trim().length > 0;
}

function parseRhythmRangeSelections(raw: unknown): RhythmRangeSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const stem = record.stem;
    const startSeconds = Number(record.startSeconds);
    const endSeconds = Number(record.endSeconds);
    if (!STEMS.some(([candidate]) => candidate === stem) || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return [];
    return [{
      id: typeof record.id === "string" && record.id.trim() ? record.id : `saved-range-${index}`,
      stem: stem as RhythmStem,
      startSeconds: Math.max(0, startSeconds),
      endSeconds: Math.max(0, endSeconds),
    }];
  });
}

function rhythmRangeSelectionsFromMetadata(item: BrowserWorkspaceItem | undefined): RhythmRangeSelection[] {
  return parseRhythmRangeSelections(item?.metadata.rangeSelections);
}

function rhythmDifficultyRangeSelectionsFromMetadata(item: BrowserWorkspaceItem | undefined): RhythmDifficultyRangeSelections {
  const selections: RhythmDifficultyRangeSelections = {};
  const raw = item?.metadata.difficultyRangeSelections;
  if (raw && typeof raw === "object") {
    for (const difficulty of GAME_DIFFICULTIES) {
      const ranges = parseRhythmRangeSelections((raw as Record<string, unknown>)[difficulty]);
      if (ranges.length) selections[difficulty] = ranges;
    }
  }
  return selections;
}

function rhythmRangeSelectionsEqual(left: RhythmRangeSelection[], right: RhythmRangeSelection[]): boolean {
  return left.length === right.length && left.every((range, index) => {
    const other = right[index];
    return Boolean(other)
      && range.id === other.id
      && range.stem === other.stem
      && range.startSeconds === other.startSeconds
      && range.endSeconds === other.endSeconds;
  });
}

function inferLegacyRangeDifficulty(
  ranges: RhythmRangeSelection[],
  selections: RhythmDifficultySelections,
  events: RhythmChartEvent[],
): GameDifficulty | null {
  const rangedEventIds = new Set(
    events
      .filter((event) => ranges.some((range) => range.stem === event.stem && event.endSeconds >= range.startSeconds && event.startSeconds <= range.endSeconds))
      .map((event) => event.id),
  );
  if (!rangedEventIds.size) return null;

  let bestDifficulty: GameDifficulty | null = null;
  let bestScore = 0;
  for (const difficulty of GAME_DIFFICULTIES) {
    const selectedIds = new Set(selections[difficulty] ?? []);
    if (!selectedIds.size) continue;
    const intersection = [...selectedIds].filter((id) => rangedEventIds.has(id)).length;
    const union = new Set([...selectedIds, ...rangedEventIds]).size;
    const score = union ? intersection / union : 0;
    if (score > bestScore) {
      bestScore = score;
      bestDifficulty = difficulty;
    }
  }
  return bestDifficulty;
}

function resolvedRhythmDifficultyRangeSelections(
  item: BrowserWorkspaceItem | undefined,
  events: RhythmChartEvent[],
): RhythmDifficultyRangeSelections {
  const explicit = rhythmDifficultyRangeSelectionsFromMetadata(item);
  if (Object.keys(explicit).length > 0) return explicit;
  const legacyRanges = rhythmRangeSelectionsFromMetadata(item);
  if (!legacyRanges.length) return explicit;

  const difficultySelections = rhythmDifficultySelectionsFromMetadata(item?.metadata);
  const rawDifficultySelections = item?.metadata.difficultySelectedEventIds;
  const hasDifficultySelections = Boolean(rawDifficultySelections && typeof rawDifficultySelections === "object");
  if (!hasDifficultySelections) return { normal: legacyRanges };
  if (!events.length) return {};
  const inferredDifficulty = hasDifficultySelections
    ? inferLegacyRangeDifficulty(legacyRanges, difficultySelections, events)
    : null;
  return inferredDifficulty ? { [inferredDifficulty]: legacyRanges } : {};
}

function createUserRhythmVolume(label: string): UserRhythmGameVolume | null {
  const volumeLabel = label.trim();
  if (!volumeLabel) return null;
  const slugBase = volumeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "rhythm-volume";
  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    volumeId: `user-volume-${suffix}`,
    volumeLabel,
    volumeSlug: `${slugBase}-${suffix}`,
    officialVolume: false,
    sortOrder: 0,
  };
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function chartEvents(manifest: ChartManifest): RhythmChartEvent[] {
  const analyses = manifest.combined?.analyses ?? manifest.analyses ?? [];
  const events: RhythmChartEvent[] = [];
  analyses.forEach((analysis) => {
    const stem = STEMS.some(([candidate]) => candidate === analysis.stem) ? analysis.stem as RhythmStem : undefined;
    if (!stem) return;
    const eventSets: Array<[ChartEventKind, ChartEventRecord[]]> = [
      ["beats", analysis.majorBeats ?? analysis.beats ?? []],
      // New hybrid artifacts expose majorBeats as the active combined onset
      // stream. Legacy artifacts continue to expose their events stream.
      ["events", analysis.majorBeats ? [] : analysis.events ?? []],
      ["sustains", analysis.sustains ?? []],
    ];
    eventSets.forEach(([kind, entries]) => {
      entries.forEach((entry, index) => {
        const startSeconds = Math.max(0, finiteNumber(entry.startSeconds ?? entry.timeSeconds));
        const durationSeconds = Math.max(0.04, finiteNumber(entry.durationSeconds, kind === "sustains" ? 0.12 : 0.08));
        const endSeconds = Math.max(startSeconds + 0.04, finiteNumber(entry.endSeconds, startSeconds + durationSeconds));
        events.push({
          id: `${stem}:${kind}:${index}`,
          stem,
          kind,
          startSeconds,
          endSeconds,
          strength: Math.max(0, Math.min(1, finiteNumber(entry.strength, 0.5))),
          pitchMidi: entry.pitchMidi,
        });
      });
    });
  });
  if (events.length) return events.sort((a, b) => a.startSeconds - b.startSeconds || a.id.localeCompare(b.id));

  return (manifest.combined?.majorBeats ?? manifest.combined?.beats ?? []).map((entry, index) => {
    const startSeconds = Math.max(0, finiteNumber(entry.timeSeconds));
    return {
      id: `combined:beats:${index}`,
      stem: "drums",
      kind: "beats",
      startSeconds,
      endSeconds: startSeconds + 0.08,
      strength: Math.max(0, Math.min(1, finiteNumber(entry.strength, 0.5))),
    };
  });
}

function chartDuration(manifest: ChartManifest, events: RhythmChartEvent[]): number {
  return Math.max(
    finiteNumber(manifest.combined?.durationSeconds),
    ...events.map((event) => event.endSeconds),
    1,
  );
}

function stemLabel(stem: string): string {
  return STEMS.find(([candidate]) => candidate === stem)?.[1] ?? stem;
}

function defaultJobStems(job: RemoteJob): RhythmStem[] {
  const requested = job.request.parameters.selected_stems;
  if (Array.isArray(requested)) {
    const valid = requested.filter((stem): stem is RhythmStem => typeof stem === "string" && STEMS.some(([candidate]) => candidate === stem));
    if (valid.length) return valid;
  }
  return STEMS.map(([stem]) => stem);
}

function artifactStemNames(job: RemoteJob): RhythmStem[] {
  const names = new Set<RhythmStem>();
  job.artifacts.forEach((artifact) => {
    const match = /^(?:stem-audio|stem-chart):(.+)$/.exec(artifact.variant ?? "");
    const stem = match?.[1];
    if (stem && STEMS.some(([candidate]) => candidate === stem)) names.add(stem as RhythmStem);
  });
  return STEMS.map(([stem]) => stem).filter((stem) => names.has(stem));
}

function availableStemsForJob(job: RemoteJob): RhythmStem[] {
  const artifacts = artifactStemNames(job);
  return artifacts.length ? artifacts : defaultJobStems(job);
}

function missingStemsForJob(job: RemoteJob): RhythmStem[] {
  const available = new Set(availableStemsForJob(job));
  return STEMS.map(([stem]) => stem).filter((stem) => !available.has(stem));
}

function defaultReanalysisStems(missingStems: RhythmStem[], baseStemCount: number): RhythmStem[] {
  const ordered = [
    ...DEFAULT_REANALYZE_STEM_ORDER.filter((stem) => missingStems.includes(stem)),
    ...missingStems.filter((stem) => !DEFAULT_REANALYZE_STEM_ORDER.includes(stem)),
  ];
  return ordered.slice(0, Math.max(0, Math.round(baseStemCount)));
}

function chartArtifactCandidates(job: RemoteJob) {
  const chartArtifacts = job.artifacts.filter((artifact) => artifact.role === "chart" && artifact.objectPath);
  return [
    ...chartArtifacts.filter((artifact) => artifact.variant === "stem-chart:combined"),
    ...chartArtifacts.filter((artifact) => artifact.variant?.startsWith("stem-chart:") && artifact.variant !== "stem-chart:combined"),
    ...chartArtifacts.filter((artifact) => !artifact.variant?.startsWith("stem-chart:")),
  ];
}

function uniquePublicArtifacts(artifacts: RemoteArtifact[]): RemoteArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (!artifact.publicUrl) return false;
    const variant = String(artifact.variant ?? "").replace(/^stem-(?:audio|chart):/, "").trim();
    const identity = variant ? `${artifact.role}:${variant}` : `${artifact.role}:${artifact.publicUrl}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function artifactDownloadLabel(artifact: RemoteArtifact, kind: "audio" | "chart"): string {
  const variant = String(artifact.variant ?? "").replace(/^stem-(?:audio|chart):/, "").trim();
  if (kind === "audio") return variant || "Audio";
  if (variant === "combined") return "Download chart";
  return variant ? `${variant} chart` : "Download chart";
}

function chartPlaybackSource(job: RemoteJob) {
  return job.request.inputs.find((input) => (input.role === "source" || input.role === "src_audio") && Boolean(input.sourceUrl));
}

function combinedChartArtifact(job: RemoteJob) {
  return chartArtifactCandidates(job)[0];
}

function normalizeChartManifest(value: unknown): ChartManifest {
  const record = value && typeof value === "object" ? value as ChartManifest & ChartAnalysis & { durationSeconds?: number; tempoBpm?: number } : {};
  if (record.combined || Array.isArray(record.analyses)) return record;
  if (record.stem) {
    const analysis: ChartAnalysis = {
      stem: record.stem,
      majorBeats: record.majorBeats,
      bandBeats: record.bandBeats,
      beats: record.beats,
      events: record.events,
      sustains: record.sustains,
    };
    return {
      analyses: [analysis],
      combined: {
        durationSeconds: record.durationSeconds,
        tempoBpm: record.tempoBpm,
        majorBeats: record.majorBeats,
        bandBeats: record.bandBeats,
        beats: record.beats,
        analyses: [analysis],
      },
    };
  }
  return {};
}

function mergeChartManifests(manifests: ChartManifest[]): ChartManifest {
  const analysesByStem = new Map<string, ChartAnalysis>();
  manifests.flatMap((manifest) => manifest.combined?.analyses ?? manifest.analyses ?? []).forEach((analysis) => {
    if (typeof analysis.stem === "string") analysesByStem.set(analysis.stem, analysis);
  });
  const analyses = [...analysesByStem.values()];
  const durations = manifests.map((manifest) => manifest.combined?.durationSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const tempos = manifests.map((manifest) => manifest.combined?.tempoBpm).filter((value): value is number => typeof value === "number" && value > 0);
  const beats = [...new Map(analyses.flatMap((analysis) => (analysis.majorBeats ?? analysis.beats ?? []).map((beat) => {
    const timeSeconds = finiteNumber(beat.timeSeconds);
    return [`${timeSeconds.toFixed(6)}`, { ...beat, timeSeconds }];
  }))).values()].sort((a, b) => finiteNumber(a.timeSeconds) - finiteNumber(b.timeSeconds));
  const bandBeats = Object.fromEntries(["low", "mid", "high", "combined"].map((band) => [band, [...new Map(analyses.flatMap((analysis) => (analysis.bandBeats?.[band] ?? []).map((beat) => {
    const timeSeconds = finiteNumber(beat.timeSeconds);
    return [`${timeSeconds.toFixed(6)}`, { ...beat, timeSeconds }];
  }))).values()].sort((a, b) => finiteNumber(a.timeSeconds) - finiteNumber(b.timeSeconds))])) as Record<string, ChartEventRecord[]>;
  const durationSeconds = durations.length ? Math.max(...durations) : undefined;
  return {
    analyses,
    combined: {
      durationSeconds,
      tempoBpm: tempos.length ? tempos.reduce((sum, value) => sum + value, 0) / tempos.length : 0,
      majorBeats: beats,
      bandBeats,
      beats,
      analyses,
    },
  };
}

function buildSelectedChart(manifest: ChartManifest, events: RhythmChartEvent[], selectedLayers: RhythmStem[], selectedEventKinds: ChartEventKind[], selectedEventIds: string[], rowThresholds: RhythmRowThresholds) {
  const layers = new Set(selectedLayers);
  const kinds = new Set(selectedEventKinds);
  const ids = new Set(selectedEventIds);
  const selected = events.filter((event) => layers.has(event.stem) && kinds.has(event.kind) && ids.has(event.id) && event.strength >= (rowThresholds[event.stem] ?? DEFAULT_ROW_STRENGTH));
  const mapped = selected.map((event) => ({
    id: event.id,
    source: event.stem,
    kind: event.kind,
    startSeconds: event.startSeconds,
    endSeconds: event.endSeconds,
    durationSeconds: Math.max(0.04, event.endSeconds - event.startSeconds),
    strength: event.strength,
    pitchMidi: event.pitchMidi ?? null,
  }));
  return {
    schemaVersion: 1,
    runtime: "rhythm-beats",
    durationSeconds: chartDuration(manifest, events),
    tempoBpm: finiteNumber(manifest.combined?.tempoBpm),
    selectedStems: selectedLayers,
    selectedEventKinds,
    events: mapped,
    beats: mapped.filter((event) => event.kind === "beats"),
    sustains: mapped.filter((event) => event.kind === "sustains"),
  };
}

function buildGameModeChart(selectedChart: ReturnType<typeof buildSelectedChart>, gameMode: RhythmGameMode, updatedAt: string) {
  const gameBeats = selectedChart.events.map((event) => ({
    timeSeconds: event.startSeconds,
    strength: event.strength,
  }));
  const gameNotes = selectedChart.events.map((event) => ({
    timeSeconds: event.startSeconds,
    endSeconds: event.endSeconds,
    strength: event.strength,
    source: event.source,
  }));
  return {
    gameBeats,
    gameNotes,
    gameBeatSelections: selectedChart.events.map((event) => ({
      source: event.source,
      startSeconds: event.startSeconds,
      endSeconds: event.endSeconds,
      minStrength: event.strength,
    })),
    gameBeatConfig: {
      gameMode,
      mergeWindowSeconds: 0,
    },
    gameBeatsUpdatedAtIso: updatedAt,
  };
}

function formatTokenAmount(amountAtomic: string, decimals: number): string {
  const value = Number(amountAtomic) / 10 ** decimals;
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : amountAtomic;
}

function formatDuration(value?: number): string {
  if (!value || !Number.isFinite(value)) return "Duration unavailable";
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatPlaybackTime(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "0:00.00";
  const hundredths = Math.floor((value % 1) * 100);
  const wholeSeconds = Math.floor(value);
  return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function readAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    const finish = (duration?: number) => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
      audio.load();
      resolve(duration && Number.isFinite(duration) && duration > 0 ? duration : undefined);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(audio.duration);
    audio.onerror = () => finish();
    audio.src = objectUrl;
  });
}

function remoteAudioInput(item: { title: string; kind: string; metadata?: Record<string, unknown>; files?: Array<Record<string, unknown>> }): RemoteGenerationInput | null {
  const directUrl = typeof item.metadata?.publicUrl === "string" ? item.metadata.publicUrl : "";
  const directMime = typeof item.metadata?.mimeType === "string" ? item.metadata.mimeType : "audio/mpeg";
  const duration = typeof item.metadata?.durationSeconds === "number" ? item.metadata.durationSeconds : undefined;
  if (directUrl && (directMime.startsWith("audio/") || item.kind === "audio")) {
    return { role: "source", sourceUrl: directUrl, mimeType: directMime, fileName: typeof item.metadata?.fileName === "string" ? item.metadata.fileName : item.title, sizeBytes: typeof item.metadata?.sizeBytes === "number" ? item.metadata.sizeBytes : undefined, sha256: typeof item.metadata?.sha256 === "string" ? item.metadata.sha256 : undefined, durationSeconds: duration };
  }
  const file = (item.files ?? []).find((candidate) => typeof candidate.publicUrl === "string" && candidate.publicUrl && candidate.role !== "cover" && (String(candidate.mimeType ?? "").startsWith("audio/") || candidate.role === "audio" || item.kind === "audio"));
  if (!file || typeof file.publicUrl !== "string") return null;
  const metadata = file.metadata && typeof file.metadata === "object" ? file.metadata as Record<string, unknown> : {};
  return { role: "source", sourceUrl: file.publicUrl, mimeType: typeof file.mimeType === "string" ? file.mimeType : "audio/mpeg", fileName: typeof metadata.originalName === "string" ? metadata.originalName : item.title, sizeBytes: typeof file.sizeBytes === "number" ? file.sizeBytes : undefined, sha256: typeof file.sha256 === "string" ? file.sha256 : undefined, durationSeconds: typeof metadata.durationSeconds === "number" ? metadata.durationSeconds : undefined };
}

function reanalysisParentId(job: RemoteJob): string | undefined {
  const value = job.request.metadata?.reanalysisOfJobId;
  return typeof value === "string" && value ? value : undefined;
}

function baseHistoryJob(job: RhythmHistoryJob): RemoteJob {
  return job.reanalysisBaseJob ?? job;
}

function childHistoryJobs(job: RhythmHistoryJob): RemoteJob[] {
  return job.reanalysisChildren ?? [];
}

function mergeArtifacts(jobs: RemoteJob[]): RemoteArtifact[] {
  const artifacts = new Map<string, RemoteArtifact>();
  jobs.flatMap((job) => job.artifacts).forEach((artifact) => {
    const key = artifact.id || `${artifact.objectPath}:${artifact.variant ?? ""}`;
    artifacts.set(key, artifact);
  });
  return [...artifacts.values()];
}

function mergeEvents(jobs: RemoteJob[]) {
  const events = new Map<string, RemoteJob["events"][number]>();
  jobs.flatMap((job) => job.events).forEach((event) => events.set(event.id, event));
  return [...events.values()];
}

function aggregateRhythmJobs(current: Array<RemoteJob | RhythmHistoryJob>, incoming: RemoteJob[]): RhythmHistoryJob[] {
  const baseJobs = new Map<string, RemoteJob>();
  const childrenByParent = new Map<string, Map<string, RemoteJob>>();
  const addJob = (job: RemoteJob | RhythmHistoryJob): void => {
    const historyJob = job as RhythmHistoryJob;
    const base = baseHistoryJob(historyJob);
    const existingChildren = childHistoryJobs(historyJob);
    if (reanalysisParentId(base)) {
      const parentId = reanalysisParentId(base)!;
      const children = childrenByParent.get(parentId) ?? new Map<string, RemoteJob>();
      children.set(base.id, base);
      childrenByParent.set(parentId, children);
    } else {
      baseJobs.set(base.id, base);
    }
    existingChildren.forEach((child) => {
      const parentId = reanalysisParentId(child);
      if (!parentId) return;
      const children = childrenByParent.get(parentId) ?? new Map<string, RemoteJob>();
      children.set(child.id, child);
      childrenByParent.set(parentId, children);
    });
  };
  current.filter((job) => job.runtime === "rhythm-beats").forEach(addJob);
  incoming.filter((job) => job.runtime === "rhythm-beats").forEach(addJob);

  const rows: RhythmHistoryJob[] = [];
  baseJobs.forEach((base) => {
    const children = [...(childrenByParent.get(base.id)?.values() ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const activeChild = [...children].reverse().find((child) => ACTIVE_STATUSES.has(child.status));
    const latestChild = children.at(-1);
    const failedChild = latestChild && ["failed", "cancelled", "expired"].includes(latestChild.status) ? latestChild : undefined;
    const relatedJobs = [base, ...children];
    const latest = relatedJobs.reduce((latestJob, job) => job.updatedAt > latestJob.updatedAt ? job : latestJob, base);
    rows.push({
      ...base,
      artifacts: mergeArtifacts(relatedJobs),
      events: mergeEvents(relatedJobs),
      updatedAt: latest.updatedAt,
      progress: activeChild?.progress ?? base.progress,
      reanalysisChildren: children,
      reanalysisBaseJob: base,
      reanalysisState: activeChild ? "active" : failedChild ? "failed" : undefined,
    });
  });

  // Keep an orphan child visible until its parent is loaded from a paged response.
  // The next merge will fold it into the parent without creating a duplicate row.
  const orphanChildren = [...childrenByParent.entries()]
    .filter(([parentId]) => !baseJobs.has(parentId))
    .flatMap(([, children]) => [...children.values()]);
  return [...rows, ...(orphanChildren as RhythmHistoryJob[])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function mergeJobs(current: Array<RemoteJob | RhythmHistoryJob>, incoming: RemoteJob[]): RhythmHistoryJob[] {
  return aggregateRhythmJobs(current, incoming);
}

function jobTitle(job: RemoteJob): string {
  return job.request.metadata?.title?.trim() || "Rhythm Beat Set";
}

function rhythmAssetIsPublished(item: BrowserWorkspaceItem | undefined, publicItems: LibraryItem[] = []): boolean {
  if (!item) return false;
  const metadata = item.metadata;
  const status = typeof metadata.publicLibraryStatus === "string"
    ? metadata.publicLibraryStatus
    : typeof metadata.libraryItemStatus === "string"
      ? metadata.libraryItemStatus
      : "";
  if (status.trim().toLowerCase() === "published") return true;

  const publicLibrary = metadata.publicLibrary;
  if (publicLibrary && typeof publicLibrary === "object") {
    const record = publicLibrary as Record<string, unknown>;
    if (typeof record.status === "string" && record.status.trim().toLowerCase() === "published") return true;
    const nestedItem = record.item;
    if (nestedItem && typeof nestedItem === "object" && typeof (nestedItem as Record<string, unknown>).status === "string" && (nestedItem as Record<string, unknown>).status.trim().toLowerCase() === "published") return true;
  }

  const libraryItemId = typeof metadata.libraryItemId === "string" ? metadata.libraryItemId.trim() : "";
  if (libraryItemId && publicItems.some((publicItem) => publicItem.id === libraryItemId && publicItem.status === "published")) return true;

  const remoteJobId = typeof metadata.remoteJobId === "string" ? metadata.remoteJobId.trim() : "";
  return publicItems.some((publicItem) => {
    if (publicItem.status !== "published") return false;
    const localId = typeof publicItem.sourceLineage?.localId === "string" ? publicItem.sourceLineage.localId : "";
    const publicRemoteJobId = typeof publicItem.metadata?.remoteJobId === "string" ? publicItem.metadata.remoteJobId : "";
    return localId === item.id || Boolean(remoteJobId && publicRemoteJobId === remoteJobId);
  });
}

function rhythmWorkspaceItemForJob(items: BrowserWorkspaceItem[], jobId: string): BrowserWorkspaceItem | undefined {
  return items.find((item) => {
    if (item.id === `rhythm-beats-${jobId}`) return true;
    return item.kind === "rhythm_game" && item.metadata.remoteJobId === jobId;
  });
}

function jobStatus(job: RhythmHistoryJob): string {
  if (job.reanalysisState === "active") return "Generating";
  if (job.reanalysisState === "failed") return "Re-analysis error";
  if (["failed", "cancelled", "expired"].includes(job.status)) return "Error generating";
  if (job.status === "succeeded") return "Completed";
  if (["created", "awaiting_payment", "queued", "starting"].includes(job.status)) return "Queued";
  return "Generating";
}

function jobProgressLabel(job: RhythmHistoryJob): string {
  const progress = job.progress;
  if (!progress) return jobStatus(job);
  if (progress.stage) return progress.stage;
  if (progress.phase === "analyzing") return "Analyzing stems";
  if (progress.phase === "packaging") return "Packaging chart";
  if (progress.progress !== null) return `${Math.round(progress.progress * 100)}%`;
  return jobStatus(job);
}

function hasActiveRhythmWork(job: RhythmHistoryJob): boolean {
  return ACTIVE_STATUSES.has(job.status) || childHistoryJobs(job).some((child) => ACTIVE_STATUSES.has(child.status));
}

function sourceChoices(workspaceItems: BrowserWorkspaceItem[], publicItems: LibraryItem[]): Array<{ id: string; title: string; input: RemoteGenerationInput }> {
  const choices: Array<{ id: string; title: string; input: RemoteGenerationInput }> = [];
  const importedLibraryIds = new Set(workspaceItems.map((item) => String(item.metadata.libraryItemId ?? "")));
  workspaceItems.forEach((item) => {
    const input = remoteAudioInput({ title: item.title, kind: item.kind, metadata: item.metadata, files: Array.isArray(item.metadata.files) ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object")) : [] });
    if (input) choices.push({ id: item.id, title: item.title, input });
  });
  publicItems.forEach((item) => {
    if (importedLibraryIds.has(item.id)) return;
    const input = remoteAudioInput({ title: item.title, kind: item.kind, files: item.files.map((file) => file as unknown as Record<string, unknown>) });
    if (input) choices.push({ id: `public-${item.id}`, title: item.title, input });
  });
  return choices;
}

function customerPaymentError(error: unknown): string {
  const body = error instanceof Error ? (error as Error & { body?: { refund?: { status?: string } } }).body : undefined;
  const refund = body?.refund?.status;
  if (refund === "manual_review") return "Payment received. Refund requires support review.";
  if (refund && refund !== "confirmed") return "Payment received. Automatic refund is pending.";
  return "There was an error processing the Rhythm Beats request. Please try again.";
}

export function RhythmBeatsPanel({ session, workspaceItems, publicItems, onWorkspaceChanged, onPublishAsset }: Props): JSX.Element {
  const [healthReady, setHealthReady] = useState<boolean | null>(null);
  const [pricingConfig, setPricingConfig] = useState<RemotePricingConfig | null>(null);
  const [marketPrice, setMarketPrice] = useState<RemoteMarketPrice | null>(null);
  const [pricing, setPricing] = useState<RemotePricingQuote | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [sourceMode, setSourceMode] = useState<"private" | "disk">("private");
  const [sourceId, setSourceId] = useState("");
  const [diskInput, setDiskInput] = useState<RemoteGenerationInput | null>(null);
  const [diskFileName, setDiskFileName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [stemMode, setStemMode] = useState<StemMode>("selected");
  const [selectedStems, setSelectedStems] = useState<RhythmStem[]>(["vocals", "drums", "bass", "guitar", "keyboard"]);
  const [inferenceSteps, setInferenceSteps] = useState(80);
  const [title, setTitle] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState<RemotePaymentCurrency>("FACELESS");
  const [jobs, setJobs] = useState<RhythmHistoryJob[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("Ready");
  const [error, setError] = useState("");
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [charts, setCharts] = useState<Record<string, ChartManifest | null>>({});
  const [chartLoading, setChartLoading] = useState<Record<string, boolean>>({});
  const [selectedLayers, setSelectedLayers] = useState<Record<string, RhythmStem[]>>({});
  const [selectedEventKinds, setSelectedEventKinds] = useState<Record<string, ChartEventKind[]>>({});
  const [selectedEventIds, setSelectedEventIds] = useState<Record<string, string[]>>({});
  const [rowThresholds, setRowThresholds] = useState<Record<string, RhythmRowThresholds>>({});
  const jobsRef = useRef<RhythmHistoryJob[]>([]);
  const historyInitializedRef = useRef(false);
  const chartReanalysisFingerprintRef = useRef<Record<string, string>>({});
  const marketRefreshRef = useRef(false);
  jobsRef.current = jobs;

  const choices = useMemo(() => sourceChoices(workspaceItems, publicItems), [publicItems, workspaceItems]);
  const ownedVolumes = useMemo(() => userRhythmVolumes(workspaceItems), [workspaceItems]);
  const selectedChoice = choices.find((choice) => choice.id === sourceId);
  const sourceInput = sourceMode === "private" ? selectedChoice?.input : diskInput;
  const request = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "rhythm-beats",
    modelRevision: "acestep-v15-base",
    inputs: sourceInput ? [sourceInput] : [],
    priority: "standard",
    paymentCurrency,
    metadata: { title: title.trim() || "Rhythm Beat Set" },
    parameters: {
      task_type: "rhythm_beats",
      model: "acestep-v15-base",
      audio_format: "flac",
      stem_mode: stemMode,
      ...(stemMode === "selected" ? { selected_stems: selectedStems } : {}),
      inference_steps: inferenceSteps,
      guidance_scale: 1,
      shift: 1,
      infer_method: "sde",
      use_tiled_decode: true,
      dcw_enabled: false,
      source_duration_seconds: sourceInput?.durationSeconds,
    },
  }), [inferenceSteps, paymentCurrency, selectedStems, sourceInput, stemMode, title]);

  const holderFreeAvailable = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, request));
  const hasActiveJobs = jobs.some(hasActiveRhythmWork);

  useEffect(() => {
    let cancelled = false;
    void api.remoteGenerationHealth().then((value) => { if (!cancelled) setHealthReady(Boolean(value.enabled && value.ok)); }).catch(() => { if (!cancelled) setHealthReady(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.remoteGenerationPricingConfig()
      .then(async (config) => ({ config, market: config.paymentMode === "free-signature" || (session.isHolder && holderFreeForRequest(config, request)) ? createFreeMarketPrice(config, config.paymentMode === "free-signature" ? "free-signature" : "holder-free") : await fetchOnChainMarketPrice(config) }))
      .then(({ config, market }) => { if (cancelled) return; setPricingConfig(config); setMarketPrice(market); })
      .catch(() => { if (!cancelled) setPricingError("Pricing is temporarily unavailable. Please try again shortly."); });
    return () => { cancelled = true; };
  }, [session.isHolder]);

  useEffect(() => {
    const effectiveMarketPrice = marketPrice ?? (pricingConfig && holderFreeAvailable ? createFreeMarketPrice(pricingConfig, "holder-free") : null);
    if (!pricingConfig || !effectiveMarketPrice || !sourceInput || (sourceInput.durationSeconds ?? 0) > MAX_DURATION_SECONDS || (stemMode === "selected" && !selectedStems.length)) {
      setPricing(null);
      return;
    }
    try {
      const nextPricing = calculateRemotePricing(pricingConfig, request, effectiveMarketPrice, { freeForHolder: holderFreeAvailable });
      setPricing(nextPricing);
      if (holderFreeAvailable && marketPrice?.source === "holder-free" && nextPricing.priceUsd > 0) {
        void fetchOnChainMarketPrice(pricingConfig)
          .then((nextMarketPrice) => setMarketPrice(nextMarketPrice))
          .catch(() => {
            setPricing(null);
            setPricingError("Pricing is temporarily unavailable. Please try again shortly.");
          });
      }
      setPricingError("");
    } catch (nextError) {
      setPricing(null);
      setPricingError(nextError instanceof Error ? nextError.message : "Pricing is temporarily unavailable. Please try again shortly.");
    }
  }, [holderFreeAvailable, marketPrice, pricingConfig, request, selectedStems, sourceInput, stemMode]);

  const refreshMarketPrice = async (): Promise<void> => {
    if (marketRefreshRef.current) return;
    marketRefreshRef.current = true;
    try {
      const nextConfig = await api.remoteGenerationPricingConfig();
      const nextMarketPrice = nextConfig.paymentMode === "free-signature" || (session.isHolder && holderFreeForRequest(nextConfig, request))
        ? createFreeMarketPrice(nextConfig, nextConfig.paymentMode === "free-signature" ? "free-signature" : "holder-free")
        : await fetchOnChainMarketPrice(nextConfig);
      setPricingConfig(nextConfig);
      setMarketPrice(nextMarketPrice);
      setPricingError("");
    } catch {
      setPricingError("Pricing is temporarily unavailable. Please try again shortly.");
    } finally {
      marketRefreshRef.current = false;
    }
  };

  useEffect(() => {
    if (!session.authenticated) {
      setJobs([]);
      setCursor(undefined);
      historyInitializedRef.current = false;
      setLoadingHistory(false);
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    const load = async (initial: boolean) => {
      if (inFlight || (document.visibilityState === "hidden" && !initial)) return;
      inFlight = true;
      try {
        const knownJobIds = jobsRef.current.flatMap((job) => [
          ...(ACTIVE_STATUSES.has(job.status) ? [job.id] : []),
          ...childHistoryJobs(job).filter((child) => ACTIVE_STATUSES.has(child.status)).map((child) => child.id),
        ]);
        const page = await api.remoteJobs({ limit: 30, activeOnly: !initial, knownJobIds, runtime: "rhythm-beats" });
        if (cancelled) return;
        setJobs((current) => mergeJobs(current, page.jobs));
        if (initial) {
          historyInitializedRef.current = true;
          setCursor(page.nextCursor);
        }
        setLoadingHistory(false);
      } catch (nextError) {
        if (!cancelled && initial) setError(nextError instanceof Error ? nextError.message : "Could not load Rhythm Beats history.");
      } finally {
        inFlight = false;
        if (!cancelled && jobsRef.current.some(hasActiveRhythmWork)) timer = window.setTimeout(() => void load(false), 3000);
      }
    };
    void load(!historyInitializedRef.current);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [hasActiveJobs, session.authenticated, session.publicKey]);

  const uploadSource = async (file?: File) => {
    if (!file) return;
    if (!session.authenticated) { setError("Connect your wallet before uploading source audio."); return; }
    setUploading(true);
    setError("");
    setDiskFileName(file.name);
    setDiskInput(null);
    try {
      const durationSeconds = await readAudioDuration(file);
      if (durationSeconds && durationSeconds > MAX_DURATION_SECONDS) throw new Error(`Source audio must be ${MAX_DURATION_SECONDS} seconds or shorter.`);
      const response = await api.uploadRemoteGenerationSource(file);
      setDiskInput({ ...response.input, durationSeconds });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not upload the source audio.");
    } finally {
      setUploading(false);
    }
  };

  const submitRequest = async (nextRequest: RemoteGenerationRequest, logLabel = "rhythm-beats") => {
    if (busy) return;
    if (!session.authenticated) { setError("Connect and verify your wallet before generating."); return; }
    setBusy(true);
    setError("");
    try {
      setPhase("Checking availability");
      const intent = await api.createRemotePaymentIntent(nextRequest);
      setPhase(intent.paymentMode === "free-signature" ? "Opening wallet" : "Preparing wallet payment");
      const signature = intent.paymentMode === "free-signature"
        ? intent.paymentMessage ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage, onStatus: setPhase }) : (() => { throw new Error("Wallet authorization was not provided."); })()
        : intent.currency === "SOL"
          ? await sendRemoteGenerationSolPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference, onStatus: setPhase })
          : await sendRemoteGenerationPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, tokenMint: intent.tokenMint, tokenDecimals: intent.tokenDecimals, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference, onStatus: setPhase });
      setPhase("Verifying payment");
      const paid = await api.verifyRemotePayment(intent.id, signature);
      setPhase("Submitting");
      const job = await api.createRemoteJob(paid.id, nextRequest);
      setJobs((current) => mergeJobs(current, [job]));
      setPhase("Queued");
    } catch (nextError) {
      console.error(`[${logLabel}] submission failed`, nextError);
      setError(customerPaymentError(nextError));
      setPhase("Failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (!session.authenticated) { setError("Connect and verify your wallet before generating."); return; }
    if (!sourceInput) { setError(sourceMode === "private" ? "Choose a private audio asset." : "Upload a source audio file."); return; }
    if ((sourceInput.durationSeconds ?? 0) > MAX_DURATION_SECONDS) { setError(`Source audio must be ${MAX_DURATION_SECONDS} seconds or shorter.`); return; }
    if (stemMode === "selected" && !selectedStems.length) { setError("Select at least one stem."); return; }
    await submitRequest(request);
  };

  const submitReanalysis = async (nextRequest: RemoteGenerationRequest) => {
    const parentId = typeof nextRequest.metadata?.reanalysisOfJobId === "string" ? nextRequest.metadata.reanalysisOfJobId : undefined;
    const parent = parentId ? jobsRef.current.find((job) => job.id === parentId) : undefined;
    if (parent?.reanalysisState === "active") {
      setError("This Rhythm Beat set is already being re-analyzed.");
      return;
    }
    await submitRequest(nextRequest, "rhythm-beats-reanalysis");
  };

  const loadOlder = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.remoteJobs({ limit: 30, cursor, runtime: "rhythm-beats" });
      setJobs((current) => mergeJobs(current, page.jobs));
      setCursor(page.nextCursor);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load older Rhythm Beats history.");
    } finally {
      setLoadingMore(false);
    }
  };

  const loadChart = async (job: RhythmHistoryJob): Promise<void> => {
    const chartCandidates = chartArtifactCandidates(job);
    if (!chartCandidates.length) return;
    setChartLoading((current) => ({ ...current, [job.id]: true }));
    try {
      const manifests: ChartManifest[] = [];
      for (const chart of chartCandidates) {
        try {
          const manifest = normalizeChartManifest(await api.remoteChart(chart.objectPath));
          manifests.push(manifest);
        } catch {
          // An older stem chart may be missing even when the other chart artifacts are usable.
        }
      }
      const manifest = manifests.length > 1 ? mergeChartManifests(manifests) : manifests[0];
      if (!manifest) throw new Error("No readable rhythm chart artifact was found.");
      const events = chartEvents(manifest);
      setCharts((current) => ({ ...current, [job.id]: manifest }));
      const analyzedStems = [...new Set(events.map((event) => event.stem))];
      setSelectedLayers((current) => ({ ...current, [job.id]: [...new Set([...(current[job.id] ?? defaultJobStems(job)), ...analyzedStems])] }));
      const availableEventKinds = EVENT_KIND_LABELS.filter(([kind]) => events.some((event) => event.kind === kind)).map(([kind]) => kind);
      setSelectedEventKinds((current) => {
        const existing = current[job.id];
        const next = existing ? existing.filter((kind) => availableEventKinds.includes(kind)) : availableEventKinds;
        return { ...current, [job.id]: next.length ? next : availableEventKinds };
      });
      const savedAsset = rhythmWorkspaceItemForJob(workspaceItems, job.id);
      const savedSelections = rhythmDifficultySelectionsFromMetadata(savedAsset?.metadata);
      const savedEventIds = savedSelections.normal ?? [];
      setSelectedEventIds((current) => {
        if (current[job.id] !== undefined) return current;
        const eventIds = savedEventIds.length
          ? events.filter((event) => savedEventIds.includes(event.id)).map((event) => event.id)
          : events.map((event) => event.id);
        return { ...current, [job.id]: eventIds };
      });
    } catch {
      setCharts((current) => ({ ...current, [job.id]: null }));
    } finally {
      setChartLoading((current) => ({ ...current, [job.id]: false }));
    }
  };

  const toggleExpanded = async (job: RhythmHistoryJob) => {
    const expanded = expandedJobs.has(job.id);
    setExpandedJobs((current) => {
      const next = new Set(current);
      if (expanded) next.delete(job.id); else next.add(job.id);
      return next;
    });
    if (expanded || charts[job.id] !== undefined) return;
    await loadChart(job);
  };

  useEffect(() => {
    jobs.forEach((job) => {
      if (!expandedJobs.has(job.id) || charts[job.id] === undefined || chartLoading[job.id]) return;
      const completedChildren = childHistoryJobs(job).filter((child) => child.status === "succeeded");
      if (!completedChildren.length) return;
      const fingerprint = completedChildren.map((child) => `${child.id}:${child.updatedAt}`).join("|");
      if (chartReanalysisFingerprintRef.current[job.id] === fingerprint) return;
      chartReanalysisFingerprintRef.current[job.id] = fingerprint;
      void loadChart(job);
    });
  }, [chartLoading, charts, expandedJobs, jobs]);

  const saveBeatAsset = async (job: RhythmHistoryJob, options: RhythmBeatAssetSaveOptions, existingOverride?: BrowserWorkspaceItem): Promise<BrowserWorkspaceItem> => {
    const chart = combinedChartArtifact(job);
    if (!chart?.publicUrl) { const message = "This result does not have chart data to save."; setError(message); throw new Error(message); }
    const manifest = charts[job.id];
    if (!manifest) { const message = "Open the completed result and wait for its chart data to load first."; setError(message); throw new Error(message); }
    const assetTitle = options.title.trim();
    if (!assetTitle) { const message = "Enter a name for the beat asset."; setError(message); throw new Error(message); }
    if (!options.gameModes.length) { const message = "Select at least one game type for this beat asset."; setError(message); throw new Error(message); }
    const events = chartEvents(manifest);
    const stems = selectedLayers[job.id] ?? defaultJobStems(job);
    const eventKinds = selectedEventKinds[job.id] ?? EVENT_KIND_LABELS.map(([kind]) => kind);
    const eventIds = selectedEventIds[job.id] ?? events.map((event) => event.id);
    const thresholds = rowThresholds[job.id] ?? {};
    const difficultySelections = {
      ...options.difficultySelections,
      normal: options.difficultySelections.normal ?? eventIds,
    };
    const difficultyCharts = rhythmDifficultySelectionEntries(difficultySelections)
      .map(([difficulty, difficultyEventIds]) => ({
        difficulty,
        eventIds: difficultyEventIds,
        chart: buildSelectedChart(manifest, events, stems, eventKinds, difficultyEventIds, thresholds),
      }))
      .filter((entry) => entry.chart.events.length > 0);
    if (!difficultyCharts.length) { const message = "Select at least one chart event before saving this beat asset."; setError(message); throw new Error(message); }
    const now = new Date().toISOString();
    const existing = existingOverride ?? rhythmWorkspaceItemForJob(workspaceItems, job.id);
    const existingMetadata = existing?.metadata ?? {};
    if (!options.imageFile && !workspaceItemHasCover(existing)) { const message = "Add a cover image for this game beat asset."; setError(message); throw new Error(message); }
    const source = chartPlaybackSource(job);
    const modeCharts = Object.fromEntries(options.gameModes.map((gameMode) => [
      gameMode,
      Object.fromEntries(difficultyCharts.map(({ difficulty, chart: difficultyChart }) => [difficulty, buildGameModeChart(difficultyChart, gameMode, now)])),
    ])) as Partial<Record<RhythmGameMode, Partial<Record<GameDifficulty, ReturnType<typeof buildGameModeChart>>>>>;
    const primaryDifficulty = (["normal", "easy", "hard"] as GameDifficulty[]).find((difficulty) => difficultyCharts.some((entry) => entry.difficulty === difficulty));
    const primaryEntry = difficultyCharts.find((entry) => entry.difficulty === primaryDifficulty) ?? difficultyCharts[0];
    const primaryChart = primaryEntry ? buildGameModeChart(primaryEntry.chart, options.gameModes[0], now) : undefined;
    const primarySelectedEventIds = primaryEntry?.chart.events.map((event) => event.id) ?? [];
    const savedDifficultySelections = Object.fromEntries(difficultyCharts.map(({ difficulty, chart: difficultyChart }) => [difficulty, difficultyChart.events.map((event) => event.id)]));
    const savedDifficultyRangeSelections = Object.fromEntries(difficultyCharts.map(({ difficulty }) => [difficulty, options.difficultyRangeSelections[difficulty] ?? []]));
    const workspaceItem: BrowserWorkspaceItem = {
        id: `rhythm-beats-${job.id}`,
        title: assetTitle,
        kind: "rhythm_game",
        source: "private",
        createdAt: existing?.createdAt ?? job.createdAt,
        updatedAt: now,
        metadata: {
          ...existingMetadata,
          storage: "remote-cdn",
          sourceTool: "rhythm-beats",
          category: "rhythm_game",
          gameEnabled: true,
          ...options.volume,
          supportedGameModes: {
            stepArrows: options.gameModes.includes("step_arrows"),
            orbBeat: options.gameModes.includes("orb_beat"),
            laserShoot: false,
          },
          availableGameModes: options.gameModes,
          availableDifficulties: difficultyCharts.map(({ difficulty }) => difficulty),
          modeDifficultyCharts: modeCharts,
          difficultySelectedEventIds: savedDifficultySelections,
          difficultyRangeSelections: savedDifficultyRangeSelections,
          modeDifficultyBeatCounts: Object.fromEntries(options.gameModes.map((gameMode) => [gameMode, Object.fromEntries(difficultyCharts.map(({ difficulty, chart: difficultyChart }) => [difficulty, difficultyChart.events.length]))])),
          ...(primaryChart ? primaryChart : {}),
          remoteJobId: job.id,
          chartUrl: chart.publicUrl,
          chartObjectPath: chart.objectPath,
          chartData: primaryEntry?.chart,
          selectedStems: stems,
          selectedEventKinds: eventKinds,
          selectedEventIds: primarySelectedEventIds,
          rangeSelections: primaryDifficulty ? (options.difficultyRangeSelections[primaryDifficulty] ?? options.rangeSelections) : options.rangeSelections,
          ...(source ? {
            publicUrl: source.sourceUrl,
            mimeType: source.mimeType,
            fileName: source.fileName,
            sizeBytes: source.sizeBytes,
            sha256: source.sha256,
            durationSeconds: source.durationSeconds,
            sourceAudio: {
              publicUrl: source.sourceUrl,
              mimeType: source.mimeType,
              fileName: source.fileName,
              sizeBytes: source.sizeBytes,
              sha256: source.sha256,
              durationSeconds: source.durationSeconds,
            },
          } : {}),
          audioArtifacts: job.artifacts.filter((artifact) => artifact.role === "audio" && artifact.publicUrl).map((artifact) => ({ variant: artifact.variant, publicUrl: artifact.publicUrl, objectPath: artifact.objectPath, mimeType: artifact.mimeType })),
          ...(options.imageFile ? {
            cardImageBlob: options.imageFile,
            cardImageFileName: options.imageFile.name,
            cardImageMimeType: options.imageFile.type,
          } : {}),
        },
      };
    try {
      await saveWorkspaceItem(workspaceItem);
      setError("");
      return workspaceItem;
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Could not save the selected rhythm chart.";
      setError(message);
      throw nextError;
    }
  };

  const selectedCount = stemMode === "all" ? STEMS.length : selectedStems.length;
  const holderBaseOnlyFree = holderFreeAvailable && (!pricing || pricing.priceUsd === 0);
  const costLabel = holderBaseOnlyFree ? "Free · signature required" : pricing ? `${formatTokenAmount(pricing.amountAtomic, pricing.tokenDecimals)} ${paymentCurrency === "FACELESS" ? "$FACELESS" : "SOL"}${holderFreeAvailable ? " · base waived" : ""}` : `— ${paymentCurrency === "FACELESS" ? "$FACELESS" : "SOL"}`;
  const sourceLabel = sourceMode === "private" ? selectedChoice?.title ?? "Choose a private audio asset" : diskInput ? `${diskFileName} · ${formatDuration(diskInput.durationSeconds)}` : "Choose an audio file from disk";

  return (
    <section className="dance-station-tool-panel rhythm-beats-panel">
      <div className="rhythm-beats-heading">
        <div><p className="home-v2-kicker">Dance Station</p><h2><Waves aria-hidden="true" size={19} /> Rhythm Beats</h2><p>Separate the source into usable stems and turn the musical events into a rhythm-game chart.</p></div>
        <span className={`rhythm-beats-ready${healthReady ? " is-ready" : healthReady === false ? " is-error" : ""}`}><Activity aria-hidden="true" size={13} />{healthReady === null ? "Checking" : healthReady ? "Ready" : "Unavailable"}</span>
      </div>

      <div className="rhythm-beats-workspace">
        <section className="rhythm-beats-builder">
          <div className="rhythm-beats-section-heading"><span>Build chart</span><small>Base extraction + event analysis</small></div>
          <label className="rhythm-beats-title-field"><span>Title</span><input value={title} maxLength={120} placeholder="Rhythm Beat Set" onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} disabled={busy} /></label>
          <div className="rhythm-beats-source-block">
            <div className="rhythm-beats-label-row"><span>Source audio</span><small>Maximum {MAX_DURATION_SECONDS} seconds</small></div>
            <div className="rhythm-beats-source-tabs" role="radiogroup" aria-label="Source audio mode">
              <label className={sourceMode === "private" ? "is-active" : ""}><input type="radio" checked={sourceMode === "private"} onChange={() => setSourceMode("private")} disabled={busy || uploading} />Private Asset</label>
              <label className={sourceMode === "disk" ? "is-active" : ""}><input type="radio" checked={sourceMode === "disk"} onChange={() => setSourceMode("disk")} disabled={busy || uploading} />From Disk</label>
            </div>
            {sourceMode === "private" ? <select value={sourceId} onChange={(event) => setSourceId((event.currentTarget as HTMLSelectElement).value)} disabled={busy || !choices.length}><option value="">{choices.length ? "Choose an audio asset" : "No audio assets available"}</option>{choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}{choice.input.durationSeconds ? ` · ${formatDuration(choice.input.durationSeconds)}` : ""}</option>)}</select> : <label className="rhythm-beats-upload"><input type="file" accept="audio/*" onChange={(event) => void uploadSource((event.currentTarget as HTMLInputElement).files?.[0])} disabled={busy || uploading} /><span><Upload aria-hidden="true" size={15} />{uploading ? "Uploading" : "Upload source"}</span><small>{sourceLabel}</small></label>}
            {sourceMode === "private" && selectedChoice ? <div className="rhythm-beats-source-confirmed"><FileAudio aria-hidden="true" size={14} />{sourceLabel}{selectedChoice.input.durationSeconds ? ` · ${formatDuration(selectedChoice.input.durationSeconds)}` : ""}</div> : null}
          </div>

          <div className="rhythm-beats-stem-block">
            <div className="rhythm-beats-label-row"><span>Stem layers</span><small>{selectedCount} layers will be extracted and analyzed</small></div>
            <div className="rhythm-beats-segmented" role="radiogroup" aria-label="Stem layers"><label className={stemMode === "all" ? "is-active" : ""}><input type="radio" checked={stemMode === "all"} onChange={() => setStemMode("all")} disabled={busy} />All stems</label><label className={stemMode === "selected" ? "is-active" : ""}><input type="radio" checked={stemMode === "selected"} onChange={() => setStemMode("selected")} disabled={busy} />Select layers</label></div>
            {stemMode === "selected" ? <div className="rhythm-beats-stem-grid" role="group" aria-label="Select stem layers">{STEMS.map(([stem, label]) => <label key={stem} className={selectedStems.includes(stem) ? "is-selected" : ""}><input type="checkbox" checked={selectedStems.includes(stem)} onChange={(event) => setSelectedStems((current) => (event.currentTarget as HTMLInputElement).checked ? [...current, stem] : current.filter((item) => item !== stem))} disabled={busy} />{label}</label>)}</div> : <p className="rhythm-beats-note">All twelve standalone extraction layers will be returned with individual chart data.</p>}
          </div>

          <div className="rhythm-beats-controls"><label><span>Inference steps</span><input type="number" min="1" max="200" value={inferenceSteps} onInput={(event) => setInferenceSteps(Math.max(1, Math.min(200, Number((event.currentTarget as HTMLInputElement).value) || 1)))} disabled={busy} /></label><span className="rhythm-beats-control-note">Base model · 80 steps default</span></div>
          <div className="rhythm-beats-payment"><span>{holderBaseOnlyFree ? "Holder benefit" : holderFreeAvailable ? "Holder base waived · pay add-ons with" : "Pay with"}</span>{holderBaseOnlyFree ? <label className="is-active"><input type="radio" checked readOnly disabled={busy} />Free for holders</label> : (["FACELESS", "SOL"] as const).map((currency) => <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}><input type="radio" checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} disabled={busy} />{currency === "FACELESS" ? "$FACELESS" : "SOL"}</label>)}</div>
          <button type="button" className="rhythm-beats-submit" onClick={() => void submit()} disabled={busy || uploading || !pricing || healthReady === false}><span>{busy ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <Waves aria-hidden="true" size={16} />}</span><strong>{busy ? phase : "Create beat set"}</strong><small>{busy ? "" : costLabel}</small></button>
          {pricingError ? <p className="rhythm-beats-error" role="status">{pricingError}</p> : null}
          {error ? <p className="rhythm-beats-error" role="alert">{error}</p> : null}
        </section>

        <section className="rhythm-beats-guide"><div className="rhythm-beats-section-heading"><span>Workflow</span><small>What you receive</small></div><div className="rhythm-beats-guide-step"><strong>01</strong><div><b>Separate and Analyze</b><span>Select the stems you want to separate and run the generation to get your beats.</span></div></div><div className="rhythm-beats-guide-step"><strong>02</strong><div><b>Assemble</b><span>Use the Beat Graph to select the beats you want to be used in the Rhythm Game.</span></div></div><div className="rhythm-beats-guide-step"><strong>03</strong><div><b>Save and Publish</b><span>Save your selected beats, choose or create a volume for your tracks, and upload an image for your song. Then Publish so your Creation shows up in Dance Stage.</span></div></div><div className="rhythm-beats-info"><Music2 aria-hidden="true" size={15} /><span>Every stem audio file and chart file remains available in the completed result.</span></div></section>
      </div>

      <section className="rhythm-beats-history"><div className="rhythm-beats-history-heading"><div><span className="rhythm-beats-eyebrow">Private results</span><h3>Rhythm Beats History <small>{jobs.length}</small></h3></div><span className="rhythm-beats-history-status">{phase}</span></div>{loadingHistory ? <div className="rhythm-beats-empty"><LoaderCircle className="is-spinning" aria-hidden="true" size={18} />Loading Rhythm Beats history</div> : !jobs.length ? <div className="rhythm-beats-empty"><Waves aria-hidden="true" size={20} />Your Rhythm Beat sets will appear here.</div> : <div className="rhythm-beats-job-list">{jobs.map((job) => { const savedAsset = rhythmWorkspaceItemForJob(workspaceItems, job.id); const savedVolume = savedAsset ? userRhythmVolumeFromMetadata(savedAsset.metadata) : null; const savedRangeSelections = rhythmRangeSelectionsFromMetadata(savedAsset); return <RhythmBeatsJobCard key={job.id} job={job} savedAsset={savedAsset} expanded={expandedJobs.has(job.id)} chart={charts[job.id]} chartLoading={Boolean(chartLoading[job.id])} selectedLayers={selectedLayers[job.id] ?? defaultJobStems(job)} selectedEventKinds={selectedEventKinds[job.id] ?? EVENT_KIND_LABELS.map(([kind]) => kind)} selectedEventIds={selectedEventIds[job.id] ?? (charts[job.id] ? chartEvents(charts[job.id]!).map((event) => event.id) : [])} rowThresholds={rowThresholds[job.id] ?? {}} savedAssetTitle={savedAsset?.title} savedAssetPublished={rhythmAssetIsPublished(savedAsset, publicItems)} savedRangeSelections={savedRangeSelections} savedAssetHasSelection={Array.isArray(savedAsset?.metadata.selectedEventIds)} savedAssetVolumeId={savedVolume?.volumeId} savedAssetHasCover={workspaceItemHasCover(savedAsset)} ownedVolumes={ownedVolumes} pricingConfig={pricingConfig} marketPrice={marketPrice} paymentCurrency={paymentCurrency} isHolder={session.isHolder} defaultInferenceSteps={inferenceSteps} busy={busy} onToggle={() => void toggleExpanded(job)} onLayerChange={(layers) => setSelectedLayers((current) => ({ ...current, [job.id]: layers }))} onEventKindsChange={(kinds) => setSelectedEventKinds((current) => ({ ...current, [job.id]: kinds }))} onEventIdsChange={(ids) => setSelectedEventIds((current) => ({ ...current, [job.id]: ids }))} onThresholdChange={(stem, threshold) => setRowThresholds((current) => ({ ...current, [job.id]: { ...(current[job.id] ?? {}), [stem]: threshold } }))} onSave={(options, existing) => saveBeatAsset(job, options, existing)} onPublishAsset={onPublishAsset} onReanalyze={(nextRequest) => void submitReanalysis(nextRequest)} onRefreshMarketPrice={() => void refreshMarketPrice()} />; })}</div>}{cursor ? <button type="button" className="rhythm-beats-load-more" onClick={() => void loadOlder()} disabled={loadingMore}>{loadingMore ? "Loading" : "Load older results"}</button> : null}</section>
    </section>
  );
}

function RhythmBeatsJobCard({ job, savedAsset, expanded, chart, chartLoading, selectedLayers, selectedEventKinds, selectedEventIds, rowThresholds, savedAssetTitle, savedAssetPublished, savedRangeSelections, savedAssetHasSelection, savedAssetVolumeId, savedAssetHasCover, ownedVolumes, pricingConfig, marketPrice, paymentCurrency, isHolder, defaultInferenceSteps, busy, onToggle, onLayerChange, onEventKindsChange, onEventIdsChange, onThresholdChange, onSave, onPublishAsset, onReanalyze, onRefreshMarketPrice }: { job: RhythmHistoryJob; savedAsset?: BrowserWorkspaceItem; expanded: boolean; chart: ChartManifest | null | undefined; chartLoading: boolean; selectedLayers: RhythmStem[]; selectedEventKinds: ChartEventKind[]; selectedEventIds: string[]; rowThresholds: RhythmRowThresholds; savedAssetTitle?: string; savedAssetPublished: boolean; savedRangeSelections: RhythmRangeSelection[]; savedAssetHasSelection: boolean; savedAssetVolumeId?: string; savedAssetHasCover: boolean; ownedVolumes: UserRhythmGameVolume[]; pricingConfig: RemotePricingConfig | null; marketPrice: RemoteMarketPrice | null; paymentCurrency: RemotePaymentCurrency; isHolder: boolean; defaultInferenceSteps: number; busy: boolean; onToggle: () => void; onLayerChange: (layers: RhythmStem[]) => void; onEventKindsChange: (kinds: ChartEventKind[]) => void; onEventIdsChange: (ids: string[]) => void; onThresholdChange: (stem: RhythmStem, threshold: number) => void; onSave: (options: RhythmBeatAssetSaveOptions, existing?: BrowserWorkspaceItem) => Promise<BrowserWorkspaceItem>; onPublishAsset?: (item: BrowserWorkspaceItem) => Promise<void>; onReanalyze: (request: RemoteGenerationRequest) => void; onRefreshMarketPrice: () => void }): JSX.Element {
  const [dragSelection, setDragSelection] = useState<RhythmDragSelection | null>(null);
  const [rangeSelections, setRangeSelections] = useState<RhythmRangeSelection[]>(() => {
    const saved = rhythmDifficultyRangeSelectionsFromMetadata(savedAsset);
    const hasDifficultySelections = Boolean(savedAsset?.metadata.difficultySelectedEventIds && typeof savedAsset.metadata.difficultySelectedEventIds === "object");
    return saved.normal ?? (hasDifficultySelections ? [] : savedRangeSelections);
  });
  const [difficultyRangeSelections, setDifficultyRangeSelections] = useState<RhythmDifficultyRangeSelections>(() => {
    const saved = rhythmDifficultyRangeSelectionsFromMetadata(savedAsset);
    const hasDifficultySelections = Boolean(savedAsset?.metadata.difficultySelectedEventIds && typeof savedAsset.metadata.difficultySelectedEventIds === "object");
    if (!saved.normal && savedRangeSelections.length && !hasDifficultySelections) saved.normal = [...savedRangeSelections];
    return saved;
  });
  const [selectedRangeId, setSelectedRangeId] = useState<string | null>(null);
  const [eventSelectionTouched, setEventSelectionTouched] = useState(false);
  const [savePanelOpen, setSavePanelOpen] = useState(false);
  const [assetTitle, setAssetTitle] = useState(savedAssetTitle?.trim() || jobTitle(job));
  const [assetImage, setAssetImage] = useState<File | null>(null);
  const [assetGameModes, setAssetGameModes] = useState<RhythmGameMode[]>(["step_arrows", "orb_beat"]);
  const [activeDifficulty, setActiveDifficulty] = useState<GameDifficulty>("normal");
  const [difficultySelections, setDifficultySelections] = useState<RhythmDifficultySelections>(() => {
    const saved = rhythmDifficultySelectionsFromMetadata(savedAsset?.metadata);
    if (!saved.normal && selectedEventIds.length) saved.normal = [...selectedEventIds];
    return saved;
  });
  const [assetVolumeId, setAssetVolumeId] = useState(savedAssetVolumeId && ownedVolumes.some((volume) => volume.volumeId === savedAssetVolumeId) ? savedAssetVolumeId : CREATE_RHYTHM_VOLUME_ID);
  const [newVolumeLabel, setNewVolumeLabel] = useState("");
  const [savingAsset, setSavingAsset] = useState(false);
  const [assetAction, setAssetAction] = useState<"save" | "publish">("save");
  const [saveError, setSaveError] = useState("");
  const [publishedLocally, setPublishedLocally] = useState(false);
  const [savedAssetOverride, setSavedAssetOverride] = useState<BrowserWorkspaceItem | undefined>(savedAsset);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const dragSelectionRef = useRef<RhythmDragSelection | null>(null);
  const seekingRef = useRef(false);
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const baseStemCount = pricingConfig?.defaults.rhythmBeatsBaseStemCount ?? 5;
  const [reanalyzeStems, setReanalyzeStems] = useState<RhythmStem[]>(() => defaultReanalysisStems(missingStemsForJob(job), baseStemCount));
  const [reanalyzeSteps, setReanalyzeSteps] = useState(() => {
    const value = Number(job.request.parameters.inference_steps);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : defaultInferenceSteps;
  });
  const complete = job.status === "succeeded";
  const failed = ["failed", "cancelled", "expired"].includes(job.status);
  const reanalysisActive = job.reanalysisState === "active";
  const reanalysisFailed = job.reanalysisState === "failed";
  const audioArtifacts = uniquePublicArtifacts(job.artifacts.filter((artifact) => artifact.role === "audio"));
  const playbackSource = chartPlaybackSource(job);
  const playbackUrl = playbackSource?.sourceUrl ?? "";
  const chartArtifacts = uniquePublicArtifacts(job.artifacts.filter((artifact) => artifact.role === "chart" || artifact.variant?.startsWith("stem-chart:")));
  const events = chart ? chartEvents(chart) : [];
  const selected = new Set(selectedLayers);
  const eventKinds = new Set(selectedEventKinds);
  const selectedIds = new Set(selectedEventIds);
  const availableStems = [...new Set(events.map((event) => event.stem))];
  const eventKindOptions = EVENT_KIND_LABELS.filter(([kind]) => events.some((event) => event.kind === kind));
  const analyzedChartStems = (chart?.combined?.analyses ?? chart?.analyses ?? [])
    .map((analysis) => analysis.stem)
    .filter((stem): stem is RhythmStem => typeof stem === "string" && STEMS.some(([candidate]) => candidate === stem));
  const resultStemSet = new Set<RhythmStem>([...availableStemsForJob(job), ...analyzedChartStems]);
  const availableResultStems = STEMS.map(([stem]) => stem).filter((stem) => resultStemSet.has(stem));
  const missingResultStems = STEMS.map(([stem]) => stem).filter((stem) => !resultStemSet.has(stem));
  const lanes = availableStems.filter((stem) => selected.has(stem));
  const thresholdFor = (stem: RhythmStem): number => rowThresholds[stem] ?? DEFAULT_ROW_STRENGTH;
  const visibleEvents = events.filter((event) => selected.has(event.stem) && eventKinds.has(event.kind) && event.strength >= thresholdFor(event.stem));
  const visibleEventIds = new Set(visibleEvents.map((event) => event.id));
  const selectedVisibleCount = visibleEvents.filter((event) => selectedIds.has(event.id)).length;
  const selectedChartEventCount = chart
    ? buildSelectedChart(chart, events, selectedLayers, selectedEventKinds, selectedEventIds, rowThresholds).events.length
    : 0;
  const duration = chart ? chartDuration(chart, events) : 1;
  const timelineWidth = Math.max(MIN_CHART_WIDTH, Math.ceil(duration * PIXELS_PER_SECOND));
  const trackWidth = Math.max(240, timelineWidth - CHART_LABEL_WIDTH - CHART_HORIZONTAL_PADDING * 2);
  const toggleLayer = (stem: RhythmStem) => onLayerChange(selected.has(stem) ? selectedLayers.filter((item) => item !== stem) : [...selectedLayers, stem]);
  const toggleEventKind = (kind: ChartEventKind) => onEventKindsChange(eventKinds.has(kind) ? selectedEventKinds.filter((item) => item !== kind) : [...selectedEventKinds, kind]);
  const selectVisible = () => {
    const baseSelection = eventSelectionTouched ? selectedEventIds : [];
    onEventIdsChange([...new Set([...baseSelection, ...visibleEventIds])]);
    setEventSelectionTouched(true);
  };
  const clearVisible = () => {
    const baseSelection = eventSelectionTouched ? selectedEventIds : events.map((event) => event.id);
    onEventIdsChange(baseSelection.filter((id) => !visibleEventIds.has(id)));
    setEventSelectionTouched(true);
  };
  const reanalysisSource = job.request.inputs.find((input) => input.role === "source" || input.role === "src_audio") ?? job.request.inputs[0];
  const reanalysisRequest = useMemo<RemoteGenerationRequest | null>(() => {
    if (!reanalysisSource || !reanalyzeStems.length) return null;
    return {
      ...job.request,
      paymentCurrency,
      metadata: { ...(job.request.metadata ?? {}), title: jobTitle(job), reanalysisOfJobId: job.id },
      parameters: {
        ...job.request.parameters,
        task_type: "rhythm_beats",
        stem_mode: "selected",
        selected_stems: reanalyzeStems,
        inference_steps: reanalyzeSteps,
      },
    };
  }, [job, paymentCurrency, reanalysisSource, reanalyzeSteps, reanalyzeStems]);
  const reanalysisHolderFree = Boolean(isHolder && pricingConfig && reanalysisRequest && holderFreeForRequest(pricingConfig, reanalysisRequest));
  const reanalysisMarket = marketPrice ?? (pricingConfig && reanalysisHolderFree ? createFreeMarketPrice(pricingConfig, "holder-free") : null);
  const reanalysisPricing = useMemo<RemotePricingQuote | null>(() => {
    if (!pricingConfig || !reanalysisMarket || !reanalysisRequest) return null;
    try {
      return calculateRemotePricing(pricingConfig, reanalysisRequest, reanalysisMarket, { freeForHolder: reanalysisHolderFree });
    } catch {
      return null;
    }
  }, [pricingConfig, reanalysisHolderFree, reanalysisMarket, reanalysisRequest]);
  const reanalysisCostLabel = reanalysisPricing
    ? reanalysisPricing.priceUsd === 0
      ? "Free · signature required"
      : `${formatTokenAmount(reanalysisPricing.amountAtomic, reanalysisPricing.tokenDecimals)} ${paymentCurrency === "FACELESS" ? "$FACELESS" : "SOL"}${reanalysisHolderFree ? " · base waived" : ""}`
    : "Pricing unavailable";

  const effectiveSavedAsset = savedAssetOverride ?? savedAsset;
  const effectiveSavedAssetTitle = effectiveSavedAsset?.title ?? savedAssetTitle;
  const effectiveSavedVolume = effectiveSavedAsset ? userRhythmVolumeFromMetadata(effectiveSavedAsset.metadata) : null;
  const effectiveSavedAssetVolumeId = effectiveSavedVolume?.volumeId ?? savedAssetVolumeId;
  const effectiveSavedAssetHasCover = effectiveSavedAsset ? workspaceItemHasCover(effectiveSavedAsset) : savedAssetHasCover;

  useEffect(() => {
    const saved = rhythmDifficultySelectionsFromMetadata(savedAsset?.metadata);
    if (!saved.normal && selectedEventIds.length) saved.normal = [...selectedEventIds];
    const savedRanges = resolvedRhythmDifficultyRangeSelections(savedAsset, events);
    setDifficultySelections(saved);
    setDifficultyRangeSelections(savedRanges);
    setActiveDifficulty("normal");
    setRangeSelections(savedRanges.normal ?? savedRangeSelections);
    setSelectedRangeId(null);
  }, [chart, job.id, savedAsset?.id, savedAsset?.updatedAt]);

  useEffect(() => {
    setDifficultySelections((current) => {
      const previous = current[activeDifficulty] ?? [];
      if (previous.length === selectedEventIds.length && previous.every((id, index) => id === selectedEventIds[index])) return current;
      return { ...current, [activeDifficulty]: [...selectedEventIds] };
    });
  }, [activeDifficulty, selectedEventIds]);

  useEffect(() => {
    setDifficultyRangeSelections((current) => {
      const previous = current[activeDifficulty] ?? [];
      if (rhythmRangeSelectionsEqual(previous, rangeSelections)) return current;
      return { ...current, [activeDifficulty]: [...rangeSelections] };
    });
  }, [activeDifficulty, rangeSelections]);

  useEffect(() => {
    setSavedAssetOverride(savedAsset);
  }, [savedAsset]);

  useEffect(() => {
    setAssetTitle(effectiveSavedAssetTitle?.trim() || jobTitle(job));
    setAssetImage(null);
    setAssetGameModes(["step_arrows", "orb_beat"]);
    setAssetVolumeId(effectiveSavedAssetVolumeId && ownedVolumes.some((volume) => volume.volumeId === effectiveSavedAssetVolumeId) ? effectiveSavedAssetVolumeId : CREATE_RHYTHM_VOLUME_ID);
    setNewVolumeLabel(effectiveSavedAssetVolumeId ? "" : "");
    setAssetAction("save");
    setSavePanelOpen(false);
    setSaveError("");
  }, [effectiveSavedAssetTitle, effectiveSavedAssetVolumeId, job.id, ownedVolumes]);

  const openSavePanel = (): void => {
    setAssetTitle(effectiveSavedAssetTitle?.trim() || jobTitle(job));
    setAssetImage(null);
    setAssetGameModes(["step_arrows", "orb_beat"]);
    setAssetVolumeId(effectiveSavedAssetVolumeId && ownedVolumes.some((volume) => volume.volumeId === effectiveSavedAssetVolumeId) ? effectiveSavedAssetVolumeId : CREATE_RHYTHM_VOLUME_ID);
    setNewVolumeLabel(effectiveSavedAssetVolumeId ? "" : "");
    setAssetAction("save");
    setSaveError("");
    setSavePanelOpen(true);
  };

  const toggleAssetGameMode = (gameMode: RhythmGameMode): void => {
    setAssetGameModes((current) => current.includes(gameMode) ? current.filter((value) => value !== gameMode) : [...current, gameMode]);
  };

  const switchDifficulty = (difficulty: GameDifficulty): void => {
    if (difficulty === activeDifficulty) return;
    const nextSelections: RhythmDifficultySelections = {
      ...difficultySelections,
      [activeDifficulty]: [...selectedEventIds],
    };
    const nextRangeSelections: RhythmDifficultyRangeSelections = {
      ...difficultyRangeSelections,
      [activeDifficulty]: [...rangeSelections],
    };
    const nextSelection = nextSelections[difficulty] ?? [...selectedEventIds];
    const nextRanges = nextRangeSelections[difficulty] ?? [];
    nextSelections[difficulty] = nextSelection;
    nextRangeSelections[difficulty] = nextRanges;
    setDifficultySelections(nextSelections);
    setDifficultyRangeSelections(nextRangeSelections);
    setActiveDifficulty(difficulty);
    setEventSelectionTouched(true);
    setRangeSelections(nextRanges);
    setSelectedRangeId(null);
    setDragSelection(null);
    dragSelectionRef.current = null;
    onEventIdsChange(nextSelection);
  };

  const saveDifficultySelections: RhythmDifficultySelections = {
    ...difficultySelections,
    [activeDifficulty]: [...selectedEventIds],
  };
  const saveDifficultyRangeSelections: RhythmDifficultyRangeSelections = {
    ...difficultyRangeSelections,
    [activeDifficulty]: [...rangeSelections],
  };
  const configuredDifficultyEntries = rhythmDifficultySelectionEntries(saveDifficultySelections);
  const configuredDifficultySummary = configuredDifficultyEntries.length
    ? configuredDifficultyEntries.map(([difficulty, eventIds]) => `${difficulty}: ${eventIds.length}`).join(" · ")
    : "No difficulty selections yet";

  const canSubmitAsset = assetGameModes.length > 0
    && configuredDifficultyEntries.length > 0
    && Boolean(assetImage || effectiveSavedAssetHasCover)
    && (assetVolumeId !== CREATE_RHYTHM_VOLUME_ID || Boolean(newVolumeLabel.trim()));

  const assetSaveOptions = (): RhythmBeatAssetSaveOptions | null => {
    const nextTitle = assetTitle.trim();
    if (!nextTitle) { setSaveError("Enter a name for the beat asset."); return null; }
    if (!assetGameModes.length) { setSaveError("Select at least one game type."); return null; }
    if (!configuredDifficultyEntries.length) { setSaveError("Select at least one chart event for a difficulty before saving this beat asset."); return null; }
    if (!assetImage && !effectiveSavedAssetHasCover) { setSaveError("Add a cover image for this game beat asset."); return null; }
    const volume = assetVolumeId === CREATE_RHYTHM_VOLUME_ID
      ? createUserRhythmVolume(newVolumeLabel)
      : ownedVolumes.find((candidate) => candidate.volumeId === assetVolumeId) ?? null;
    if (!volume) { setSaveError("Create or select a user-owned game volume."); return null; }
    return { title: nextTitle, imageFile: assetImage ?? undefined, gameModes: assetGameModes, volume, rangeSelections, difficultySelections: saveDifficultySelections, difficultyRangeSelections: saveDifficultyRangeSelections };
  };

  const submitAssetSave = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const options = assetSaveOptions();
    if (!options) return;
    setAssetAction("save");
    setSavingAsset(true);
    setSaveError("");
    try {
      const savedItem = await onSave(options, effectiveSavedAsset);
      setSavedAssetOverride(savedItem);
      setSavePanelOpen(false);
      await onWorkspaceChanged?.();
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Could not save the beat asset.");
    } finally {
      setSavingAsset(false);
    }
  };

  const submitAssetPublish = async (): Promise<void> => {
    const options = assetSaveOptions();
    if (!options || !onPublishAsset) return;
    setAssetAction("publish");
    setSavingAsset(true);
    setSaveError("");
    try {
      const savedItem = await onSave(options, effectiveSavedAsset);
      setSavedAssetOverride(savedItem);
      await onPublishAsset(savedItem);
      await saveWorkspaceItem({
        ...savedItem,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...savedItem.metadata,
          publicLibraryStatus: "published",
        },
      });
      await onWorkspaceChanged?.();
      setPublishedLocally(true);
      setSavePanelOpen(false);
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Could not publish the beat asset.");
    } finally {
      setSavingAsset(false);
    }
  };

  useEffect(() => {
    setReanalyzeStems(defaultReanalysisStems(missingResultStems, baseStemCount));
    const value = Number(job.request.parameters.inference_steps);
    setReanalyzeSteps(Number.isFinite(value) && value > 0 ? Math.round(value) : defaultInferenceSteps);
  }, [baseStemCount, chart, defaultInferenceSteps, job.id, job.updatedAt]);

  useEffect(() => {
    const savedRanges = resolvedRhythmDifficultyRangeSelections(savedAsset, events);
    setDifficultyRangeSelections(savedRanges);
    setRangeSelections(savedRanges.normal ?? savedRangeSelections);
    setSelectedRangeId(null);
    setDragSelection(null);
    dragSelectionRef.current = null;
    setIsPlaying(false);
    setPlayheadSeconds(0);
    setAudioDuration(0);
  }, [chart]);

  useEffect(() => {
    if (chart && selectedEventIds.length > 0 && selectedEventIds.length < events.length) {
      setEventSelectionTouched(true);
    }
  }, [chart, events.length, selectedEventIds.length]);

  useEffect(() => {
    if (!chart || !savedAssetHasSelection || savedRangeSelections.length || rangeSelections.length || !selectedEventIds.length || selectedEventIds.length >= events.length) return;
    const selectedIds = new Set(selectedEventIds);
    const inferredRanges = STEMS.flatMap(([stem]) => {
      const stemEvents = events.filter((event) => event.stem === stem && selectedIds.has(event.id));
      if (!stemEvents.length) return [];
      return [{
        id: `restored-range-${stem}`,
        stem,
        startSeconds: Math.min(...stemEvents.map((event) => event.startSeconds)),
        endSeconds: Math.max(...stemEvents.map((event) => event.endSeconds)),
      }];
    });
    if (inferredRanges.length) setRangeSelections(inferredRanges);
  }, [chart, events.length, rangeSelections.length, savedAssetHasSelection, savedRangeSelections.length, selectedEventIds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setIsPlaying(false);
    setPlayheadSeconds(0);
  }, [playbackUrl]);

  const togglePlayback = (): void => {
    const audio = audioRef.current;
    if (!audio || !playbackUrl) return;
    if (audio.paused) {
      void audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  const toggleRangeSelection = (rangeId: string): void => setSelectedRangeId((current) => current === rangeId ? null : rangeId);

  const removeRangeEvents = (): void => {
    const rangeToRemove = rangeSelections.find((range) => range.id === selectedRangeId);
    if (!rangeToRemove) return;
    const rangeMatches = (event: RhythmChartEvent): boolean => rangeToRemove.stem === event.stem && event.endSeconds >= Math.min(rangeToRemove.startSeconds, rangeToRemove.endSeconds) && event.startSeconds <= Math.max(rangeToRemove.startSeconds, rangeToRemove.endSeconds);
    const baseSelection = eventSelectionTouched ? selectedEventIds : events.map((event) => event.id);
    onEventIdsChange(baseSelection.filter((id) => !events.some((event) => event.id === id && rangeMatches(event))));
    setEventSelectionTouched(true);
    setRangeSelections((current) => current.filter((range) => range.id !== rangeToRemove.id));
    setSelectedRangeId(null);
  };

  const clearRangeSelections = (): void => {
    setRangeSelections([]);
    setSelectedRangeId(null);
  };

  const chartPointer = (event: PointerEvent): { stem: RhythmStem; timeSeconds: number } | null => {
    const wrapper = chartScrollRef.current;
    if (!wrapper || !lanes.length || duration <= 0) return null;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, input")) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const x = event.clientX - wrapperRect.left + wrapper.scrollLeft - CHART_HORIZONTAL_PADDING - CHART_LABEL_WIDTH;
    const timeSeconds = Math.max(0, Math.min(duration, x / trackWidth * duration));
    const laneElement = [...wrapper.querySelectorAll<HTMLElement>("[data-chart-stem]")].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    const stem = laneElement?.dataset.chartStem as RhythmStem | undefined;
    return stem && lanes.includes(stem) ? { stem, timeSeconds } : null;
  };

  const updateDragSelection = (event: PointerEvent): void => {
    const current = dragSelectionRef.current;
    const wrapper = chartScrollRef.current;
    if (!current || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const edge = 34;
    if (event.clientX <= rect.left + edge) wrapper.scrollLeft = Math.max(0, wrapper.scrollLeft - 24);
    if (event.clientX >= rect.right - edge) wrapper.scrollLeft = Math.min(wrapper.scrollWidth, wrapper.scrollLeft + 24);
    const pointer = chartPointer(event);
    if (!pointer) return;
    const next = { ...current, endSeconds: pointer.timeSeconds };
    dragSelectionRef.current = next;
    setDragSelection(next);
  };

  const seekPlayback = (event: PointerEvent): void => {
    const pointer = chartPointer(event);
    const audio = audioRef.current;
    if (!pointer || !audio) return;
    audio.currentTime = pointer.timeSeconds;
    setPlayheadSeconds(pointer.timeSeconds);
  };

  const startPlaybackSeek = (event: PointerEvent): void => {
    if (!playbackUrl || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    seekingRef.current = true;
    seekPlayback(event);
    chartRef.current?.setPointerCapture(event.pointerId);
  };

  const startDragSelection = (event: PointerEvent): void => {
    if (!chart || event.button !== 0) return;
    const pointer = chartPointer(event);
    if (!pointer) return;
    event.preventDefault();
    const next = { stem: pointer.stem, startSeconds: pointer.timeSeconds, endSeconds: pointer.timeSeconds };
    dragSelectionRef.current = next;
    setDragSelection(next);
    chartRef.current?.setPointerCapture(event.pointerId);
  };

  const finishDragSelection = (event: PointerEvent): void => {
    if (seekingRef.current) {
      seekingRef.current = false;
      if (chartRef.current?.hasPointerCapture(event.pointerId)) chartRef.current.releasePointerCapture(event.pointerId);
      return;
    }
    const current = dragSelectionRef.current;
    if (!current) return;
    const startSeconds = Math.min(current.startSeconds, current.endSeconds);
    const endSeconds = Math.max(current.startSeconds, current.endSeconds);
    if (endSeconds - startSeconds >= 0.02) {
      const picked = visibleEvents.filter((item) => item.stem === current.stem && item.endSeconds >= startSeconds && item.startSeconds <= endSeconds);
      const baseSelection = eventSelectionTouched ? selectedEventIds : [];
      onEventIdsChange([...new Set([...baseSelection, ...picked.map((item) => item.id)])]);
      setEventSelectionTouched(true);
      const rangeId = `${current.stem}:${Date.now()}:${startSeconds.toFixed(3)}:${endSeconds.toFixed(3)}`;
      setRangeSelections((currentRanges) => [...currentRanges, { id: rangeId, stem: current.stem, startSeconds, endSeconds }]);
      setSelectedRangeId(rangeId);
    }
    dragSelectionRef.current = null;
    setDragSelection(null);
    if (chartRef.current?.hasPointerCapture(event.pointerId)) chartRef.current.releasePointerCapture(event.pointerId);
  };

  const statusLabel = (savedAssetPublished || publishedLocally) && complete && !reanalysisActive && !reanalysisFailed ? "Published" : jobStatus(job);
  const progressLabel = jobProgressLabel(job);
  const progressPercent = job.progress?.progress !== null && job.progress?.progress !== undefined ? Math.round(job.progress.progress * 100) : null;
  return <article className={`rhythm-beats-job${failed || reanalysisFailed ? " is-error" : ""}${expanded ? " is-expanded" : ""}`}>
    <button type="button" className="rhythm-beats-job-summary" onClick={onToggle}>
      <span className="rhythm-beats-job-icon"><Waves aria-hidden="true" size={18} /></span>
      <span className="rhythm-beats-job-copy"><strong>{jobTitle(job)}</strong><small>{new Date(job.createdAt).toLocaleString()} · {progressLabel}</small></span>
      <span className={`rhythm-beats-job-status ${complete && !reanalysisFailed && !reanalysisActive ? "is-complete" : failed || reanalysisFailed ? "is-failed" : ""}`}>{statusLabel}{progressPercent !== null && !complete && !failed ? ` · ${progressPercent}%` : ""}</span>
      <span className="rhythm-beats-job-chevron">{expanded ? "−" : "+"}</span>
    </button>
    {expanded ? <div className="rhythm-beats-job-details">{complete ? <>
      <div className="rhythm-beats-artifact-grid">{audioArtifacts.map((artifact) => <div className="rhythm-beats-artifact" key={artifact.id}><div><FileAudio aria-hidden="true" size={15} /><strong>{artifact.variant?.replace(/^stem-audio:/, "") || "Audio"}</strong></div><AudioPlayButton track={{ id: artifact.id, title: `${jobTitle(job)} ${artifact.variant ?? "audio"}`, url: artifact.publicUrl!, mimeType: artifact.mimeType }} /></div>)}</div>
      <details className="rhythm-beats-reanalyze" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) onRefreshMarketPrice(); }}>
        <summary className="rhythm-beats-reanalyze-toggle" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <span className="rhythm-beats-reanalyze-toggle-copy"><Activity aria-hidden="true" size={15} /><span><strong>Re-analyze</strong><small>Extract and analyze stems not already in this result.</small></span></span>
          <span className="rhythm-beats-reanalyze-count">{missingResultStems.length ? `${missingResultStems.length} available` : "Complete"}</span>
          <span className="rhythm-beats-reanalyze-chevron" aria-hidden="true" />
        </summary>
        <div className="rhythm-beats-reanalyze-body">
          <div className="rhythm-beats-reanalyze-summary"><div><span>Already available</span><div className="rhythm-beats-reanalyze-tags">{availableResultStems.length ? availableResultStems.map((stem) => <span key={stem}>{stemLabel(stem)}</span>) : <small>No stem artifacts found</small>}</div></div><small>The original source audio will be reused.</small></div>
          {missingResultStems.length ? <>
            <div className="rhythm-beats-reanalyze-field"><div><strong>Stems to add</strong><small>Only stems not already returned can be selected.</small></div><div className="rhythm-beats-reanalyze-stem-grid">{missingResultStems.map((stem) => <label key={stem} className={reanalyzeStems.includes(stem) ? "is-selected" : ""}><input type="checkbox" checked={reanalyzeStems.includes(stem)} onChange={(event) => setReanalyzeStems((current) => (event.currentTarget as HTMLInputElement).checked ? [...current, stem] : current.filter((item) => item !== stem))} disabled={reanalysisActive || busy} />{stemLabel(stem)}</label>)}</div></div>
            <div className="rhythm-beats-reanalyze-controls"><label><span>Inference steps</span><input type="number" min="1" max="200" value={reanalyzeSteps} onInput={(event) => setReanalyzeSteps(Math.max(1, Math.min(200, Number((event.currentTarget as HTMLInputElement).value) || 1)))} disabled={reanalysisActive || busy} /></label><span>{reanalysisPricing ? `Selected stems: ${reanalyzeStems.length}` : "Pricing will appear when available"}</span></div>
            <div className="rhythm-beats-reanalyze-action"><span>{reanalysisActive ? "Re-analysis in progress" : reanalysisCostLabel}</span><button type="button" className="rhythm-beats-secondary-button" onClick={() => { if (reanalysisRequest) onReanalyze(reanalysisRequest); }} disabled={busy || reanalysisActive || !reanalysisRequest || !reanalysisPricing}>{busy ? <LoaderCircle className="is-spinning" aria-hidden="true" size={14} /> : <Waves aria-hidden="true" size={14} />}<strong>{busy ? "Submitting" : reanalysisActive ? "Re-analysis running" : "Re-analyze selected stems"}</strong></button></div>
          </> : <div className="rhythm-beats-reanalyze-complete"><Check aria-hidden="true" size={15} />All supported stems are already available for this result.</div>}
        </div>
      </details>
      <div className="rhythm-beats-chart-tools">
        <div className="rhythm-beats-chart-tool-group"><span>Chart layers</span><div className="rhythm-beats-option-grid">{(availableStems.length ? availableStems : STEMS.map(([stem]) => stem)).map((stem) => <label key={stem}><input type="checkbox" checked={selected.has(stem)} onChange={() => toggleLayer(stem)} />{stemLabel(stem)}</label>)}</div></div>
        <div className="rhythm-beats-chart-tool-group"><span>Event types</span><div className="rhythm-beats-option-grid rhythm-beats-option-grid--events">{eventKindOptions.map(([kind, label]) => <label key={kind}><input type="checkbox" checked={eventKinds.has(kind)} onChange={() => toggleEventKind(kind)} />{label}</label>)}</div></div>
      </div>
      {chartLoading ? <div className="rhythm-beats-chart-loading"><LoaderCircle className="is-spinning" aria-hidden="true" size={14} />Loading beat chart</div> : chart ? <>
        <div className="rhythm-beats-difficulty-control" role="group" aria-label="Rhythm game difficulty selection">
          <div className="rhythm-beats-difficulty-heading"><span>Difficulty selection</span><small>Choose a tab, then select the beats for that level.</small></div>
          <div className="rhythm-beats-difficulty-tabs" role="tablist" aria-label="Beat difficulty">
            {RHYTHM_DIFFICULTY_LABELS.map(([difficulty, label]) => {
              const count = difficulty === activeDifficulty ? selectedChartEventCount : difficultySelections[difficulty]?.length ?? 0;
              return <button type="button" key={difficulty} role="tab" aria-selected={activeDifficulty === difficulty} className={activeDifficulty === difficulty ? "is-active" : ""} onClick={() => switchDifficulty(difficulty)} disabled={savingAsset}>{label}<small>{count ? `${count} beats` : "Not set"}</small></button>;
            })}
          </div>
        </div>
        <audio ref={audioRef} className="rhythm-beats-chart-audio" src={playbackUrl || undefined} preload="metadata" onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) setAudioDuration(nextDuration); }} onTimeUpdate={(event) => setPlayheadSeconds(event.currentTarget.currentTime)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={() => { setIsPlaying(false); setPlayheadSeconds(0); }} />
        <div className="rhythm-beats-chart-selection"><div className="rhythm-beats-chart-selection-status"><button type="button" className="rhythm-beats-chart-play-button" onClick={togglePlayback} disabled={!playbackUrl} title={playbackUrl ? `${isPlaying ? "Pause" : "Play"} original source` : "Original source is unavailable for playback"} aria-label={playbackUrl ? `${isPlaying ? "Pause" : "Play"} original source` : "Original source is unavailable for playback"}>{isPlaying ? <Pause aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={14} />}</button><span><strong>{formatPlaybackTime(playheadSeconds)}</strong> / {formatDuration(audioDuration || duration)} · <strong>{selectedVisibleCount}</strong> of {visibleEvents.length} visible events selected · <strong>{selectedRangeId ? 1 : 0}</strong> range selected</span></div><div><button type="button" onClick={selectVisible} disabled={!visibleEvents.length}>Select visible</button><button type="button" onClick={clearVisible} disabled={!selectedVisibleCount}>Clear visible</button><button type="button" onClick={removeRangeEvents} disabled={!selectedRangeId} title="Remove events in the selected range"><Trash2 aria-hidden="true" size={13} />Remove selected</button><button type="button" onClick={clearRangeSelections} disabled={!rangeSelections.length}>Clear ranges</button></div></div>
        <div ref={chartScrollRef} className="rhythm-beats-chart-scroll" role="region" aria-label={`Rhythm chart for ${jobTitle(job)}`}>
          <div ref={chartRef} className="rhythm-beats-chart" style={{ width: `${timelineWidth}px` }} onPointerDown={startDragSelection} onPointerMove={(event) => { if (seekingRef.current) seekPlayback(event); else updateDragSelection(event); }} onPointerUp={finishDragSelection} onPointerCancel={finishDragSelection}>
            <div className="rhythm-beats-chart-axis"><span aria-hidden="true" /><div><span>0:00</span><span>{formatDuration(duration / 2)}</span><span>{formatDuration(duration)}</span></div></div>
            {!lanes.length ? <div className="rhythm-beats-chart-empty">Select a chart layer to view its events.</div> : lanes.map((stem) => { const rowEvents = visibleEvents.filter((event) => event.stem === stem); const threshold = thresholdFor(stem); const rangeStart = dragSelection?.stem === stem ? Math.min(dragSelection.startSeconds, dragSelection.endSeconds) : 0; const rangeEnd = dragSelection?.stem === stem ? Math.max(dragSelection.startSeconds, dragSelection.endSeconds) : 0; const rangeLeft = rangeStart / duration * 100; const rangeWidth = (rangeEnd - rangeStart) / duration * 100; const playheadLeft = Math.max(0, Math.min(100, playheadSeconds / duration * 100)); return <div className="rhythm-beats-chart-lane" key={stem}><div className="rhythm-beats-chart-lane-header"><div><strong>{stemLabel(stem)}</strong><small>{rowEvents.length} visible</small></div><label title="Minimum normalized strength to include this row"><span>{Math.round(threshold * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={threshold} onInput={(event) => onThresholdChange(stem, Math.max(0, Math.min(1, Number((event.currentTarget as HTMLInputElement).value))))} /></label></div><div className="rhythm-beats-chart-track" data-chart-stem={stem}>{rangeSelections.filter((range) => range.stem === stem).map((range) => { const selectionStart = Math.min(range.startSeconds, range.endSeconds); const selectionEnd = Math.max(range.startSeconds, range.endSeconds); const isRangeSelected = selectedRangeId === range.id; return <button type="button" key={range.id} className={`rhythm-beats-chart-selection-range is-persistent${isRangeSelected ? " is-range-selected" : ""}`} style={{ left: `${selectionStart / duration * 100}%`, width: `${Math.max(0.15, (selectionEnd - selectionStart) / duration * 100)}%` }} title={`${isRangeSelected ? "Deselect" : "Select"} ${stemLabel(stem)} range · ${selectionStart.toFixed(2)}s to ${selectionEnd.toFixed(2)}s`} aria-label={`${isRangeSelected ? "Deselect" : "Select"} ${stemLabel(stem)} selection from ${selectionStart.toFixed(2)} to ${selectionEnd.toFixed(2)} seconds`} aria-pressed={isRangeSelected} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); toggleRangeSelection(range.id); }} />; })}{dragSelection?.stem === stem && rangeWidth > 0 ? <span className="rhythm-beats-chart-selection-range is-draft" style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }} aria-hidden="true" /> : null}{playbackUrl ? <span className={`rhythm-beats-chart-playhead${isPlaying ? " is-playing" : ""}`} style={{ left: `${playheadLeft}%` }} aria-hidden="true" onPointerDown={startPlaybackSeek} /> : null}{rowEvents.map((item) => { const left = Math.max(0, Math.min(100, item.startSeconds / duration * 100)); const width = Math.max(0.12, Math.min(100 - left, (item.endSeconds - item.startSeconds) / duration * 100)); const isSelected = selectedIds.has(item.id); return <span key={item.id} className={`rhythm-beats-chart-event rhythm-beats-chart-event--${item.kind}${isSelected ? " is-selected" : " is-excluded"}`} style={{ left: `${left}%`, width: `${width}%`, opacity: `${0.45 + item.strength * 0.55}` }} title={`${stemLabel(item.stem)} · ${item.kind} · ${item.startSeconds.toFixed(3)}s · strength ${Math.round(item.strength * 100)}%${item.pitchMidi ? ` · MIDI ${item.pitchMidi}` : ""}`} aria-hidden="true" />; })}</div></div>; })}
          </div>
        </div>
        <div className="rhythm-beats-chart-summary"><span>{chart.combined?.beats?.length ?? 0} beats detected</span><span>{chart.combined?.tempoBpm ? `${Math.round(chart.combined.tempoBpm)} BPM` : "Tempo unavailable"}</span><span>{availableStems.length} analyzed layers</span><span>Drag across a row to select events</span></div>
      </> : <div className="rhythm-beats-chart-summary"><span>Chart manifest is not available yet.</span></div>}
      {savePanelOpen ? <form className="rhythm-beats-save-panel" onSubmit={(event) => void submitAssetSave(event)}>
        <div className="rhythm-beats-save-panel-heading"><div><strong>{assetAction === "publish" ? "Publish beat asset" : "Save beat asset"}</strong><small>{assetAction === "publish" ? "Save the selected beats and make them available in the game." : "Store the selected beats as a playable private game asset."}</small></div><button type="button" className="rhythm-beats-save-panel-close" onClick={() => setSavePanelOpen(false)} disabled={savingAsset} aria-label="Close save beat asset form"><X aria-hidden="true" size={15} /></button></div>
        <label className="rhythm-beats-save-field"><span>Asset name</span><input value={assetTitle} maxLength={120} onInput={(event) => setAssetTitle((event.currentTarget as HTMLInputElement).value)} placeholder="Rhythm Beat Set" disabled={savingAsset} /></label>
        <div className="rhythm-beats-save-field"><span>Game types</span><div className="rhythm-beats-save-mode-grid">{RHYTHM_GAME_MODE_LABELS.map(([gameMode, label]) => <label key={gameMode} className={assetGameModes.includes(gameMode) ? "is-selected" : ""}><input type="checkbox" checked={assetGameModes.includes(gameMode)} onChange={() => toggleAssetGameMode(gameMode)} disabled={savingAsset} />{label}</label>)}</div></div>
        <div className="rhythm-beats-save-field"><span>Game volume</span><select value={assetVolumeId} onChange={(event) => { const nextVolumeId = (event.currentTarget as HTMLSelectElement).value; setAssetVolumeId(nextVolumeId); if (nextVolumeId !== CREATE_RHYTHM_VOLUME_ID) setNewVolumeLabel(""); }} disabled={savingAsset}><option value={CREATE_RHYTHM_VOLUME_ID}>Create new volume</option>{ownedVolumes.map((volume) => <option key={volume.volumeId} value={volume.volumeId}>{volume.volumeLabel}</option>)}</select>{assetVolumeId === CREATE_RHYTHM_VOLUME_ID ? <input value={newVolumeLabel} maxLength={160} onInput={(event) => setNewVolumeLabel((event.currentTarget as HTMLInputElement).value)} placeholder="New volume name" disabled={savingAsset} /> : <small className="rhythm-beats-save-volume-note">User-owned volume · official volumes are not available here</small>}</div>
        <label className={`rhythm-beats-save-image${!assetImage && !effectiveSavedAssetHasCover ? " is-required" : ""}`}><input type="file" accept="image/*" required={!effectiveSavedAssetHasCover} onChange={(event) => setAssetImage((event.currentTarget as HTMLInputElement).files?.[0] ?? null)} disabled={savingAsset} /><span><ImagePlus aria-hidden="true" size={15} />{assetImage ? assetImage.name : effectiveSavedAssetHasCover ? "Keep current cover or choose a replacement" : "Add cover image (required)"}</span><small>{effectiveSavedAssetHasCover ? "Required for game selection · current cover will be kept" : "Required for game selection"}</small></label>
        <div className="rhythm-beats-save-panel-footer"><span>{configuredDifficultySummary} · {assetGameModes.length} game types</span><div><button type="button" className="rhythm-beats-secondary-button" onClick={() => setSavePanelOpen(false)} disabled={savingAsset}>Cancel</button><button type="submit" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary" disabled={savingAsset || !canSubmitAsset}>{savingAsset && assetAction === "save" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={14} /> : <Save aria-hidden="true" size={14} />} {savingAsset && assetAction === "save" ? "Saving" : "Save asset"}</button>{onPublishAsset ? <button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--publish" onClick={() => void submitAssetPublish()} disabled={savingAsset || !canSubmitAsset}>{savingAsset && assetAction === "publish" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={14} /> : <Globe2 aria-hidden="true" size={14} />} {savingAsset && assetAction === "publish" ? "Publishing" : "Publish asset"}</button> : null}</div></div>
        {saveError ? <p className="rhythm-beats-error" role="alert">{saveError}</p> : null}
      </form> : null}
      <div className="rhythm-beats-result-actions"><div className="rhythm-beats-save-action-row"><button type="button" className="rhythm-beats-secondary-button" onClick={openSavePanel} disabled={!chart || !chartArtifacts.length}><Save aria-hidden="true" size={14} />Save selected beat asset</button>{onPublishAsset ? <button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--publish" onClick={() => { openSavePanel(); setAssetAction("publish"); }} disabled={!chart || !chartArtifacts.length}><Globe2 aria-hidden="true" size={14} />Publish beat asset</button> : null}</div>{audioArtifacts.length || chartArtifacts.length ? <div className="rhythm-beats-download-action-row">{audioArtifacts.map((artifact) => <a key={`download-${artifact.publicUrl}`} className="rhythm-beats-secondary-button" href={artifact.publicUrl} download><Download aria-hidden="true" size={14} />{artifactDownloadLabel(artifact, "audio")}</a>)}{chartArtifacts.map((artifact) => <a key={`download-${artifact.publicUrl}`} className="rhythm-beats-secondary-button" href={artifact.publicUrl} download><Download aria-hidden="true" size={14} />{artifactDownloadLabel(artifact, "chart")}</a>)}</div> : null}</div>
    </> : <div className="rhythm-beats-job-message">{failed ? "The Rhythm Beats request could not be completed." : "This result is still being processed."}</div>}</div> : null}
  </article>;
}
