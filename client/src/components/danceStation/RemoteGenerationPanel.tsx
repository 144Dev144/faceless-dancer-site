import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { AudioWaveform, CalendarDays, CheckCircle2, CircleAlert, Clock3, Download, Info, MoreHorizontal, Music2, Play, RefreshCw, RotateCcw, Search, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-preact";
import {
  api,
  type RemoteGenerationHealth,
  type RemoteGenerationInput,
  type RemoteGenerationRequest,
  type RemoteJob,
  type RemotePaymentCurrency,
  type RemotePaymentIntent,
  type RemotePricingConfig,
  type RemotePricingQuote,
  type RemoteRewardSubmission,
} from "../../lib/api";
import { fetchFaceLESSWalletBalance, fetchSolWalletBalance, type FaceLESSWalletBalance } from "../../lib/facelessBalance";
import { sendRemoteGenerationPayment, sendRemoteGenerationSolPayment, signRemoteGenerationPayment } from "../../lib/remoteGenerationPayment";
import { calculateRemotePricing, createFreeMarketPrice, fetchOnChainMarketPrice, holderFreeForRequest, type RemoteMarketPrice } from "../../lib/remoteGenerationPricing";
import { fallbackGenerationCoverUrl } from "../../lib/remoteGenerationCoverArt";
import { createRemoteAudioWorkspaceItem, listWorkspaceItems, saveWorkspaceItem } from "../../lib/danceStationWorkspace";
import type { BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import type { LibraryItem } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import { AudioPlayButton } from "../audio/SiteAudioPlayer";
import { WaveformVisual } from "../audio/WaveformVisual";
import { TransitionWorkspace, type TransitionAudioChoice, type TransitionWorkspaceValue } from "./TransitionWorkspace";

interface Props {
  session: SessionState;
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  onWorkspaceChanged?: () => void;
}

const activeStatuses = new Set(["created", "awaiting_payment", "queued", "starting", "running", "uploading", "cancel_requested"]);
const extractionTracks = [
  "vocals",
  "backing_vocals",
  "drums",
  "bass",
  "guitar",
  "keyboard",
  "percussion",
  "strings",
  "synth",
  "fx",
  "brass",
  "woodwinds",
] as const;

type GenerationMode = "music" | "extraction" | "voice-change" | "transition";
type ExtractionSourceMode = "private" | "disk";
type RemoteSubmissionStage = "payment-request" | "wallet-payment" | "payment-verification" | "queue-submission";
const MAX_REMOTE_AUDIO_DURATION_SECONDS = 360;

interface RemoteGenerationErrorBody {
  code?: string;
  refund?: {
    status?: string;
    transactionSignature?: string;
  };
}

function remoteGenerationFailureMessage(
  stage: RemoteSubmissionStage,
  generationMode: GenerationMode,
  body?: RemoteGenerationErrorBody,
): string {
  const refundStatus = body?.refund?.status;
  if (refundStatus && ["eligible", "queued", "submitted", "confirming", "failed_retryable"].includes(refundStatus)) {
    return "Payment received. Automatic refund is pending.";
  }
  if (refundStatus === "confirmed") return "Payment received and refunded.";
  if (refundStatus === "manual_review") return "Payment received. Refund requires support review.";
  if (body?.code === "GENERATION_SERVICE_UNAVAILABLE") return "No generation capacity is ready right now. Please try again shortly.";

  switch (stage) {
    case "payment-request":
      return "There was an error preparing the payment request. Please try again.";
    case "wallet-payment":
      return "There was an error processing the payment request. Please try again.";
    case "payment-verification":
      return "We could not verify the payment. Check your wallet activity before trying again.";
    case "queue-submission":
      return `Payment was accepted, but the ${generationMode === "music" ? "music generation" : generationMode === "extraction" ? "music extraction" : generationMode === "transition" ? "music transition" : "voice change"} could not be queued. Please try again.`;
  }
}

function serializeRemoteGenerationErrorValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (depth >= 2) return Object.prototype.toString.call(value);

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => serializeRemoteGenerationErrorValue(item, depth + 1));
  }

  const record: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(value).slice(0, 32)) {
    if (key === "__proto__") continue;
    try {
      record[key] = serializeRemoteGenerationErrorValue((value as Record<string, unknown>)[key], depth + 1);
    } catch (readError) {
      record[key] = `[Unable to read: ${readError instanceof Error ? readError.message : String(readError)}]`;
    }
  }

  if (Object.keys(record).length) return record;
  try {
    const stringValue = String(value);
    if (stringValue !== "[object Object]") return stringValue;
  } catch {
    // Keep the type marker below when even string conversion is unavailable.
  }
  return { type: Object.prototype.toString.call(value) };
}

function remoteGenerationErrorDetails(error: unknown): Record<string, unknown> {
  const serialized = serializeRemoteGenerationErrorValue(error);
  if (serialized && typeof serialized === "object" && !Array.isArray(serialized)) {
    return serialized as Record<string, unknown>;
  }
  return { type: typeof error, value: serialized };
}

interface RemoteAudioChoice {
  id: string;
  title: string;
  creatorName?: string;
  input: RemoteGenerationInput;
}

function generationTitle(job: RemoteJob): string {
  const title = job.request.metadata?.title?.trim();
  const parameters = job.request.parameters;
  const taskType = parameters && typeof parameters.task_type === "string" ? parameters.task_type : "text2music";
  const trackName = parameters && typeof parameters.track_name === "string" ? parameters.track_name.trim().replaceAll("_", " ") : "";
  if (taskType === "voice_change") return title || "Voice change";
  if (taskType === "transition_chain") return title || "Music transition";
  if (title) return taskType === "extract" && trackName ? `${title} · ${trackName}` : title;
  const prompt = parameters && typeof parameters.prompt === "string" ? parameters.prompt.trim() : "";
  if (taskType === "extract" && trackName) return `Extracted ${trackName}`;
  return prompt || "Music generation";
}

function generationPrompt(job: RemoteJob): string {
  const prompt = job.request.parameters?.prompt;
  return typeof prompt === "string" ? prompt.trim() : "";
}

function generationStatus(job: RemoteJob): { label: string; tone: "complete" | "error" | "queued" | "active"; spinning: boolean } {
  if (["failed", "cancelled", "expired"].includes(job.status)) return { label: "Error Generating", tone: "error", spinning: false };
  if (job.status === "succeeded") return { label: "Completed", tone: "complete", spinning: false };
  if (["created", "awaiting_payment", "queued", "starting"].includes(job.status)) return { label: "Queued", tone: "queued", spinning: true };
  if (job.status === "cancel_requested") return { label: "Cancelling", tone: "active", spinning: true };
  return { label: "Generating", tone: "active", spinning: true };
}

function generationParameterNumber(job: RemoteJob, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = job.request.parameters?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function formatGenerationDuration(seconds?: number): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const totalSeconds = Math.round(seconds);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function generationModelLabel(job: RemoteJob): string {
  if (job.runtime === "voice-change") return "UVR + Seed-VC";
  if (job.request.parameters?.task_type === "transition_chain") return "ACE-Step Transition";
  const model = typeof job.request.parameters?.model === "string" ? job.request.parameters.model : job.modelRevision;
  if (model.includes("turbo")) return "ACE-Step Turbo";
  if (model.includes("base")) return "ACE-Step Base";
  return job.modelRevision.replaceAll("-", " ");
}

function generationTags(job: RemoteJob): string[] {
  const parameters = job.request.parameters ?? {};
  const tags: string[] = [];
  if (parameters.instrumental === true || parameters.lyrics === "[Instrumental]") tags.push("Instrumental");
  if (typeof parameters.track_name === "string" && parameters.track_name.trim()) tags.push(parameters.track_name.trim().replaceAll("_", " "));
  return tags.slice(0, 3);
}

function remoteLokrInputs(files: unknown): RemoteGenerationInput[] {
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    if (!file || typeof file !== "object") return [];
    const candidate = file as Record<string, unknown>;
    if (candidate.role === "cover") return [];
    const sourceUrl = typeof candidate.publicUrl === "string" ? candidate.publicUrl : "";
    if (!sourceUrl) return [];
    const metadata = candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata as Record<string, unknown> : null;
    return [{
      role: "lokr",
      sourceUrl,
      mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : "application/octet-stream",
      fileName: metadata && typeof metadata.originalName === "string" ? metadata.originalName : undefined,
      sha256: typeof candidate.sha256 === "string" ? candidate.sha256 : undefined,
      sizeBytes: typeof candidate.sizeBytes === "number" ? candidate.sizeBytes : undefined,
    }];
  });
}

function workspaceLokrInputs(item: BrowserWorkspaceItem): RemoteGenerationInput[] {
  if (item.kind !== "lokr") return [];
  return remoteLokrInputs(item.metadata.files);
}

function publicLokrInputs(item: LibraryItem): RemoteGenerationInput[] {
  if (item.kind !== "lokr") return [];
  return remoteLokrInputs(item.files);
}

function remoteAudioInput(input: {
  id: string;
  title: string;
  kind: string;
  metadata?: Record<string, unknown>;
  files?: Array<Record<string, unknown>>;
}): RemoteGenerationInput | null {
  const directUrl = typeof input.metadata?.publicUrl === "string" ? input.metadata.publicUrl : "";
  const directMime = typeof input.metadata?.mimeType === "string" ? input.metadata.mimeType : "audio/mpeg";
  const metadataDuration = typeof input.metadata?.durationSeconds === "number" && Number.isFinite(input.metadata.durationSeconds) && input.metadata.durationSeconds > 0
    ? input.metadata.durationSeconds
    : undefined;
  if (directUrl && (directMime.startsWith("audio/") || input.kind === "audio")) {
    return {
      role: "source",
      sourceUrl: directUrl,
      mimeType: directMime,
      fileName: typeof input.metadata?.fileName === "string" ? input.metadata.fileName : input.title,
      sha256: typeof input.metadata?.sha256 === "string" ? input.metadata.sha256 : undefined,
      sizeBytes: typeof input.metadata?.sizeBytes === "number" ? input.metadata.sizeBytes : undefined,
      durationSeconds: metadataDuration,
    };
  }
  const audioFile = (input.files ?? []).find((file) => {
    if (file.role === "cover" || typeof file.publicUrl !== "string" || !file.publicUrl) return false;
    const mimeType = typeof file.mimeType === "string" ? file.mimeType : "";
    return mimeType.startsWith("audio/") || file.role === "audio" || input.kind === "audio";
  });
  if (!audioFile || typeof audioFile.publicUrl !== "string") return null;
  const metadata = audioFile.metadata && typeof audioFile.metadata === "object"
    ? audioFile.metadata as Record<string, unknown>
    : null;
  const fileDuration = metadata && typeof metadata.durationSeconds === "number" && Number.isFinite(metadata.durationSeconds) && metadata.durationSeconds > 0
    ? metadata.durationSeconds
    : undefined;
  return {
    role: "source",
    sourceUrl: audioFile.publicUrl,
    mimeType: typeof audioFile.mimeType === "string" ? audioFile.mimeType : "audio/mpeg",
    fileName: metadata && typeof metadata.originalName === "string" ? metadata.originalName : input.title,
    sha256: typeof audioFile.sha256 === "string" ? audioFile.sha256 : undefined,
    sizeBytes: typeof audioFile.sizeBytes === "number" ? audioFile.sizeBytes : undefined,
    durationSeconds: fileDuration,
  };
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

function clampMusicDurationSeconds(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(10, Math.min(MAX_REMOTE_AUDIO_DURATION_SECONDS, value));
}

function mergeJobs(current: RemoteJob[], incoming: RemoteJob[]): RemoteJob[] {
  const jobs = new Map(current.map((job) => [job.id, job]));
  incoming.forEach((job) => jobs.set(job.id, job));
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function formatPaymentToken(amountAtomic: string, decimals: number): string {
  const amount = Number(amountAtomic) / 10 ** decimals;
  if (!Number.isFinite(amount)) return amountAtomic;
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function RemoteGenerationPanel({ session, workspaceItems, publicItems, onWorkspaceChanged }: Props): JSX.Element {
  const [health, setHealth] = useState<RemoteGenerationHealth | null>(null);
  const [generationMode, setGenerationMode] = useState<GenerationMode>("music");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [lyrics, setLyrics] = useState("");
  const [vocalLanguage, setVocalLanguage] = useState("unknown");
  const [durationSeconds, setDurationSeconds] = useState(150);
  const [inferenceSteps, setInferenceSteps] = useState(12);
  const [guidanceScale, setGuidanceScale] = useState(1);
  const [extractionInferenceSteps, setExtractionInferenceSteps] = useState(80);
  const [extractionGuidanceScale, setExtractionGuidanceScale] = useState(1);
  const [transitionInferenceSteps, setTransitionInferenceSteps] = useState(12);
  const [transitionGuidanceScale, setTransitionGuidanceScale] = useState(1);
  const [selectedLokrId, setSelectedLokrId] = useState("");
  const [lokrScale, setLokrScale] = useState(1);
  const [extractionSourceMode, setExtractionSourceMode] = useState<ExtractionSourceMode>("private");
  const [selectedExtractionSourceId, setSelectedExtractionSourceId] = useState("");
  const [diskSourceInput, setDiskSourceInput] = useState<RemoteGenerationInput | null>(null);
  const [diskSourceFileName, setDiskSourceFileName] = useState("");
  const [diskSourceBusy, setDiskSourceBusy] = useState(false);
  const [diskSourceError, setDiskSourceError] = useState("");
  const [voiceSongSourceMode, setVoiceSongSourceMode] = useState<ExtractionSourceMode>("private");
  const [voiceReferenceSourceMode, setVoiceReferenceSourceMode] = useState<ExtractionSourceMode>("private");
  const [voiceSongSourceId, setVoiceSongSourceId] = useState("");
  const [voiceReferenceSourceId, setVoiceReferenceSourceId] = useState("");
  const [voiceSongDiskInput, setVoiceSongDiskInput] = useState<RemoteGenerationInput | null>(null);
  const [voiceReferenceDiskInput, setVoiceReferenceDiskInput] = useState<RemoteGenerationInput | null>(null);
  const [voiceSongFileName, setVoiceSongFileName] = useState("");
  const [voiceReferenceFileName, setVoiceReferenceFileName] = useState("");
  const [voiceUploadBusy, setVoiceUploadBusy] = useState(false);
  const [voiceDiffusionSteps, setVoiceDiffusionSteps] = useState(25);
  const [voiceLengthAdjust, setVoiceLengthAdjust] = useState(1);
  const [voiceCfgRate, setVoiceCfgRate] = useState(0.7);
  const [voiceF0Condition, setVoiceF0Condition] = useState(true);
  const [voiceAutoF0Adjust, setVoiceAutoF0Adjust] = useState(false);
  const [voicePitchShift, setVoicePitchShift] = useState(0);
  const [voiceUvrModel, setVoiceUvrModel] = useState("UVR-MDX-NET-Inst_HQ_3.onnx");
  const [voiceUvrSegmentSize, setVoiceUvrSegmentSize] = useState(256);
  const [voiceUvrOverlap, setVoiceUvrOverlap] = useState(0.25);
  const [voiceUvrDenoise, setVoiceUvrDenoise] = useState(false);
  const [voiceLoudnessOptimization, setVoiceLoudnessOptimization] = useState(false);
  const [extractionTrack, setExtractionTrack] = useState<(typeof extractionTracks)[number]>("vocals");
  const [paymentCurrency, setPaymentCurrency] = useState<RemotePaymentCurrency>("FACELESS");
  const [pricingConfig, setPricingConfig] = useState<RemotePricingConfig | null>(null);
  const [marketPrice, setMarketPrice] = useState<RemoteMarketPrice | null>(null);
  const [pricing, setPricing] = useState<RemotePricingQuote | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [walletBalance, setWalletBalance] = useState<FaceLESSWalletBalance | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletBalanceRefreshKey, setWalletBalanceRefreshKey] = useState(0);
  const [, setPaymentIntent] = useState<RemotePaymentIntent | null>(null);
  const [jobs, setJobs] = useState<RemoteJob[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [rewardSubmissions, setRewardSubmissions] = useState<RemoteRewardSubmission[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "active" | "complete" | "error">("all");
  const [phase, setPhase] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [transitionWorkspace, setTransitionWorkspace] = useState<TransitionWorkspaceValue | null>(null);
  const [transitionDiskChoice, setTransitionDiskChoice] = useState<TransitionAudioChoice | null>(null);
  const [transitionUploadBusy, setTransitionUploadBusy] = useState(false);
  const [transitionUploadError, setTransitionUploadError] = useState("");
  const busyRef = useRef(false);
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const savedRemoteJobsRef = useRef<Set<string>>(new Set());
  const savingRemoteJobsRef = useRef<Set<string>>(new Set());
  const jobsRef = useRef<RemoteJob[]>([]);
  const historyInitializedRef = useRef(false);
  const historyUserRef = useRef<string | undefined>();
  const jobsRequestInFlightRef = useRef(false);
  jobsRef.current = jobs;

  const defaultTitle = `Song ${jobs.length + 1}`;
  const resolvedTitle = title.trim() || defaultTitle;

  const lokrChoices = useMemo(() => {
    const choices = workspaceItems
      .filter((item) => item.kind === "lokr")
      .map((item) => ({ id: item.id, title: item.title, inputs: workspaceLokrInputs(item) }))
      .filter((choice) => choice.inputs.length > 0);
    const importedLibraryIds = new Set(workspaceItems.map((item) => String(item.metadata.libraryItemId ?? "")));
    publicItems.forEach((item) => {
      if (item.kind !== "lokr" || importedLibraryIds.has(item.id)) return;
      const inputs = publicLokrInputs(item);
      if (inputs.length > 0) choices.push({ id: `public-${item.id}`, title: item.title, inputs });
    });
    return choices;
  }, [publicItems, workspaceItems]);

  const selectedLokr = lokrChoices.find((choice) => choice.id === selectedLokrId);

  const audioChoices = useMemo(() => {
    const choices: RemoteAudioChoice[] = [];
    const importedLibraryIds = new Set(workspaceItems.map((item) => String(item.metadata.libraryItemId ?? "")));
    workspaceItems.forEach((item) => {
      const input = remoteAudioInput({
        id: item.id,
        title: item.title,
        kind: item.kind,
        metadata: item.metadata,
        files: Array.isArray(item.metadata.files) ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object")) : [],
      });
      if (input) choices.push({ id: item.id, title: item.title, creatorName: item.creatorName, input });
    });
    publicItems.forEach((item) => {
      if (importedLibraryIds.has(item.id)) return;
      const input = remoteAudioInput({
        id: item.id,
        title: item.title,
        kind: item.kind,
        files: item.files.map((file) => file as unknown as Record<string, unknown>),
      });
      if (input) choices.push({ id: `public-${item.id}`, title: item.title, creatorName: item.creator?.displayName ?? undefined, input });
    });
    return choices;
  }, [publicItems, workspaceItems]);

  const selectedExtractionSource = audioChoices.find((choice) => choice.id === selectedExtractionSourceId);
  const selectedVoiceSongSource = audioChoices.find((choice) => choice.id === voiceSongSourceId);
  const selectedVoiceReferenceSource = audioChoices.find((choice) => choice.id === voiceReferenceSourceId);
  const extractionSourceInput = extractionSourceMode === "private" ? selectedExtractionSource?.input : diskSourceInput;
  const voiceSongInput = voiceSongSourceMode === "private" ? selectedVoiceSongSource?.input : voiceSongDiskInput;
  const voiceReferenceInput = voiceReferenceSourceMode === "private" ? selectedVoiceReferenceSource?.input : voiceReferenceDiskInput;
  const transitionChoices = useMemo<TransitionAudioChoice[]>(() => transitionDiskChoice ? [...audioChoices, transitionDiskChoice] : audioChoices, [audioChoices, transitionDiskChoice]);
  const onTransitionWorkspaceChange = useCallback((value: TransitionWorkspaceValue) => {
    setTransitionWorkspace(value);
    setTransitionInferenceSteps(value.plan.inferenceSteps);
    setTransitionGuidanceScale(value.plan.guidanceScale);
  }, []);
  const uploadTransitionSource = useCallback(async (file: File) => {
    if (!session.authenticated) {
      setTransitionUploadError("Connect your wallet before uploading a source.");
      return undefined;
    }
    setTransitionUploadBusy(true);
    setTransitionUploadError("");
    try {
      const durationSeconds = await readAudioDuration(file);
      if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error("Could not read the duration of that audio file.");
      }
      const response = await api.uploadRemoteGenerationSource(file);
      const choice: TransitionAudioChoice = {
        id: `disk-${Date.now().toString(36)}`,
        title: file.name,
        input: { ...response.input, durationSeconds },
      };
      setTransitionDiskChoice(choice);
      return choice;
    } catch (nextError) {
      setTransitionUploadError(nextError instanceof Error ? nextError.message : "Could not upload the transition source audio");
      return undefined;
    } finally {
      setTransitionUploadBusy(false);
    }
  }, [session.authenticated]);
  const extractionSourceTooLong = typeof extractionSourceInput?.durationSeconds === "number"
    && extractionSourceInput.durationSeconds > MAX_REMOTE_AUDIO_DURATION_SECONDS;

  useEffect(() => {
    if (selectedLokrId && !selectedLokr) setSelectedLokrId("");
  }, [selectedLokr, selectedLokrId]);

  useEffect(() => {
    if (selectedExtractionSourceId && !selectedExtractionSource) setSelectedExtractionSourceId("");
  }, [selectedExtractionSource, selectedExtractionSourceId]);

  const uploadDiskSource = async (file?: File) => {
    if (!file) return;
    if (!session.authenticated) {
      setDiskSourceError("Connect your wallet before uploading a source.");
      return;
    }
    setDiskSourceBusy(true);
    setDiskSourceError("");
    setDiskSourceInput(null);
    setDiskSourceFileName(file.name);
    try {
      const durationSeconds = await readAudioDuration(file);
      if (typeof durationSeconds === "number" && durationSeconds > MAX_REMOTE_AUDIO_DURATION_SECONDS) {
        setDiskSourceError(`Source audio is ${Math.ceil(durationSeconds)} seconds long. Extraction sources must be ${MAX_REMOTE_AUDIO_DURATION_SECONDS} seconds or shorter.`);
        return;
      }
      const response = await api.uploadRemoteGenerationSource(file);
      setDiskSourceInput({ ...response.input, durationSeconds });
    } catch (nextError) {
      setDiskSourceError(nextError instanceof Error ? nextError.message : "Could not upload the source audio");
    } finally {
      setDiskSourceBusy(false);
    }
  };

  const uploadVoiceSource = async (kind: "song" | "reference", file?: File) => {
    if (!file) return;
    if (!session.authenticated) {
      setError("Connect your wallet before uploading audio.");
      return;
    }
    setVoiceUploadBusy(true);
    try {
      const duration = await readAudioDuration(file);
      if (typeof duration === "number" && duration > MAX_REMOTE_AUDIO_DURATION_SECONDS) throw new Error(`Audio sources must be ${MAX_REMOTE_AUDIO_DURATION_SECONDS} seconds or shorter.`);
      const response = await api.uploadRemoteGenerationSource(file);
      const input = { ...response.input, durationSeconds: duration };
      if (kind === "song") { setVoiceSongFileName(file.name); setVoiceSongDiskInput(input); }
      else { setVoiceReferenceFileName(file.name); setVoiceReferenceDiskInput(input); }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not upload the voice-change audio");
    } finally {
      setVoiceUploadBusy(false);
    }
  };

  const request = useMemo<RemoteGenerationRequest>(() => {
    if (generationMode === "transition") {
      const workspace = transitionWorkspace;
      return {
        runtime: "ace-step",
        modelRevision: "ace-step-1.5",
        inputs: workspace?.inputs ?? [],
        priority: "standard",
        paymentCurrency,
        metadata: { title: resolvedTitle },
        parameters: {
          task_type: "transition_chain",
          model: "acestep-v15-turbo",
          audio_format: "flac",
          batch_size: 1,
          inference_steps: transitionInferenceSteps,
          guidance_scale: transitionGuidanceScale,
          thinking: false,
          use_tiled_decode: true,
          dcw_enabled: false,
          infer_method: "ode",
          sampler_mode: "euler",
          transition_plan: workspace?.plan ?? { schemaVersion: 1, sourceClips: [], transitionClips: [], inferenceSteps: 12, guidanceScale: 1 },
        },
      };
    }
    if (generationMode === "voice-change") {
      return {
        runtime: "voice-change",
        modelRevision: "uvr-mdx-seed-vc-singing",
        inputs: [
          ...(voiceSongInput ? [{ ...voiceSongInput, role: "song" }] : []),
          ...(voiceReferenceInput ? [{ ...voiceReferenceInput, role: "reference" }] : []),
        ],
        priority: "standard",
        paymentCurrency,
        metadata: { title: resolvedTitle },
        parameters: {
          task_type: "voice_change",
          mode: "singing",
          diffusion_steps: voiceDiffusionSteps,
          length_adjust: voiceLengthAdjust,
          inference_cfg_rate: voiceCfgRate,
          f0_condition: voiceF0Condition,
          auto_f0_adjust: voiceAutoF0Adjust,
          pitch_shift: voicePitchShift,
          uvr_model: voiceUvrModel,
          uvr_segment_size: voiceUvrSegmentSize,
          uvr_overlap: voiceUvrOverlap,
          uvr_enable_denoise: voiceUvrDenoise,
          loudness_optimization: voiceLoudnessOptimization,
          audio_format: "flac",
        },
      };
    }
    if (generationMode === "extraction") {
      return {
        runtime: "ace-step",
        modelRevision: "ace-step-1.5",
        inputs: extractionSourceInput ? [extractionSourceInput] : [],
        priority: "standard",
        paymentCurrency,
        metadata: { title: resolvedTitle },
        parameters: {
          task_type: "extract",
          model: "acestep-v15-base",
          track_name: extractionTrack,
          prompt: "",
          audio_format: "flac",
          batch_size: 1,
          inference_steps: extractionInferenceSteps,
          guidance_scale: extractionGuidanceScale,
          shift: 1,
          infer_method: "sde",
          use_tiled_decode: true,
          dcw_enabled: false,
          velocity_norm_threshold: 0,
          velocity_ema_factor: 0,
          thinking: false,
        },
      };
    }
    return {
      runtime: "ace-step",
      modelRevision: "ace-step-1.5",
      inputs: selectedLokr?.inputs ?? [],
      priority: "standard",
      paymentCurrency,
      metadata: { title: resolvedTitle },
      parameters: {
        task_type: "text2music",
        model: "acestep-v15-turbo",
        prompt: prompt.trim(),
        lyrics: instrumental ? "[Instrumental]" : lyrics.trim() || "[Instrumental]",
        vocal_language: instrumental ? "unknown" : vocalLanguage,
        audio_duration: durationSeconds,
        audio_format: "flac",
        batch_size: 1,
        inference_steps: inferenceSteps,
        thinking: true,
        use_format: false,
        time_signature: "4",
        bpm: 120,
        key_scale: "",
        lm_model_path: "acestep-5Hz-lm-1.7B",
        lm_temperature: 0.85,
        lm_cfg_scale: 2.5,
        lm_top_p: 0.9,
        lm_negative_prompt: "NO USER INPUT",
        guidance_scale: guidanceScale,
        shift: 3,
        infer_method: "ode",
        sampler_mode: "euler",
        use_adg: false,
        use_tiled_decode: true,
        dcw_enabled: false,
        velocity_norm_threshold: 0,
        velocity_ema_factor: 0,
        ...(selectedLokr ? { lokr_scale: lokrScale } : {}),
      },
    };
  }, [durationSeconds, extractionGuidanceScale, extractionInferenceSteps, extractionSourceInput, extractionTrack, generationMode, guidanceScale, inferenceSteps, instrumental, lokrScale, lyrics, paymentCurrency, prompt, resolvedTitle, selectedLokr, transitionGuidanceScale, transitionInferenceSteps, transitionWorkspace, vocalLanguage, voiceAutoF0Adjust, voiceCfgRate, voiceDiffusionSteps, voiceF0Condition, voiceLoudnessOptimization, voiceLengthAdjust, voicePitchShift, voiceReferenceInput, voiceSongInput, voiceUvrDenoise, voiceUvrModel, voiceUvrOverlap, voiceUvrSegmentSize]);

  const holderFreeAvailable = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, request));

  const hasActiveJobs = jobs.some((candidate) => activeStatuses.has(candidate.status));
  busyRef.current = busy;
  const rewardSubmissionsByJob = useMemo(() => new Map(rewardSubmissions.map((submission) => [submission.jobId, submission])), [rewardSubmissions]);

  const visibleJobs = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      const failed = ["failed", "cancelled", "expired"].includes(job.status);
      const matchesFilter = historyFilter === "all"
        || historyFilter === "active" && activeStatuses.has(job.status)
        || historyFilter === "complete" && job.status === "succeeded"
        || historyFilter === "error" && failed;
      const matchesQuery = !query
        || generationTitle(job).toLowerCase().includes(query)
        || generationPrompt(job).toLowerCase().includes(query)
        || job.status.toLowerCase().includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [historyFilter, historyQuery, jobs]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    const readHealth = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const nextHealth = await api.remoteGenerationHealth();
        if (!cancelled) setHealth(nextHealth);
      } catch {
        if (!cancelled) setHealth({ ok: false, enabled: true });
      } finally {
        inFlight = false;
        if (!cancelled) timer = window.setTimeout(() => void readHealth(), 30_000);
      }
    };
    void readHealth();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    if (!session.authenticated) {
      historyInitializedRef.current = false;
      historyUserRef.current = undefined;
      setHistoryCursor(undefined);
      setJobs([]);
      setRewardSubmissions([]);
      return () => undefined;
    }

    if (historyUserRef.current !== session.publicKey) {
      historyUserRef.current = session.publicKey;
      historyInitializedRef.current = false;
      setHistoryCursor(undefined);
      setJobs([]);
      setRewardSubmissions([]);
    }

    const readJobs = async (initial: boolean) => {
      if (document.visibilityState === "hidden" && !initial) return;
      if (jobsRequestInFlightRef.current) return;
      jobsRequestInFlightRef.current = true;
      try {
        const knownJobIds = initial ? [] : jobsRef.current.filter((job) => activeStatuses.has(job.status)).map((job) => job.id);
        const nextPage = await api.remoteJobs({ limit: 50, activeOnly: !initial, knownJobIds });
        if (cancelled) return;
        setJobs((current) => mergeJobs(current, nextPage.jobs));
        if (initial) {
          historyInitializedRef.current = true;
          setHistoryCursor(nextPage.nextCursor);
          try {
            const nextSubmissions = await api.remoteRewardSubmissions(100);
            if (!cancelled) setRewardSubmissions(nextSubmissions);
          } catch (submissionError) {
            console.warn("[remote-generation] reward submissions unavailable", submissionError);
          }
        }
      } catch (nextError) {
        if (!cancelled && !busyRef.current) {
          setError(nextError instanceof Error ? nextError.message : "Could not load generation history");
        }
      } finally {
        jobsRequestInFlightRef.current = false;
        if (!cancelled && document.visibilityState === "visible" && jobsRef.current.some((job) => activeStatuses.has(job.status))) {
          timer = window.setTimeout(() => void readJobs(false), 3000);
        }
      }
    };

    void readJobs(!historyInitializedRef.current);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        if (historyInitializedRef.current && jobsRef.current.some((job) => activeStatuses.has(job.status))) void readJobs(false);
      } else if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hasActiveJobs, session.authenticated, session.publicKey]);

  const loadOlderHistory = async () => {
    if (!historyCursor || historyLoadingMore || !session.authenticated) return;
    setHistoryLoadingMore(true);
    try {
      const nextPage = await api.remoteJobs({ limit: 50, cursor: historyCursor });
      setJobs((current) => mergeJobs(current, nextPage.jobs));
      setHistoryCursor(nextPage.nextCursor);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load older generation history");
    } finally {
      setHistoryLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!health?.enabled) {
      setPricingConfig(null);
      setMarketPrice(null);
      setPricing(null);
      setPricingError("");
      return undefined;
    }

    void api.remoteGenerationPricingConfig()
      .then((nextConfig) => {
        if (nextConfig.paymentMode === "free-signature" || (session.isHolder && holderFreeForRequest(nextConfig, request))) {
          return { nextConfig, nextMarketPrice: createFreeMarketPrice(nextConfig, nextConfig.paymentMode === "free-signature" ? "free-signature" : "holder-free") };
        }
        return fetchOnChainMarketPrice(nextConfig)
          .then((nextMarketPrice) => ({ nextConfig, nextMarketPrice }));
      })
      .then(({ nextConfig, nextMarketPrice }) => {
        if (cancelled) return;
        setPricingConfig(nextConfig);
        setMarketPrice(nextMarketPrice);
        setPricingError("");
      })
      .catch(() => {
        if (cancelled) return;
        setPricingConfig(null);
        setMarketPrice(null);
        setPricing(null);
        setPricingError("Pricing is temporarily unavailable. Please try again shortly.");
      });

    return () => {
      cancelled = true;
    };
  }, [health?.enabled]);

  useEffect(() => {
    const voiceChangeSourceRateMicros = paymentCurrency === "SOL"
      ? pricingConfig?.settings.solVoiceChangeSourceSecondPriceUsdMicros ?? 0
      : pricingConfig?.settings.facelessVoiceChangeSourceSecondPriceUsdMicros ?? 0;
    const voiceChangeNeedsSongDuration = generationMode === "voice-change"
      && voiceChangeSourceRateMicros > 0
      && !voiceSongInput;
    const effectiveMarketPrice = marketPrice ?? (pricingConfig && holderFreeAvailable ? createFreeMarketPrice(pricingConfig, "holder-free") : null);
    if (!pricingConfig || !effectiveMarketPrice
      || (generationMode === "extraction" && (!extractionSourceInput || extractionSourceTooLong))
      || (generationMode === "transition" && !transitionWorkspace?.valid)
      || voiceChangeNeedsSongDuration) {
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
    } catch {
      setPricing(null);
    }
  }, [extractionSourceInput, extractionSourceTooLong, generationMode, holderFreeAvailable, marketPrice, pricingConfig, request, transitionWorkspace, voiceReferenceInput, voiceSongInput]);

  useEffect(() => {
    let cancelled = false;
    if (!session.authenticated || !session.publicKey || !pricingConfig) {
      setWalletBalance(null);
      setWalletBalanceLoading(false);
      return undefined;
    }

    const readBalance = async () => {
      setWalletBalanceLoading(true);
      try {
        const balanceNetwork = {
          network: pricingConfig.network,
          rpcUrl: pricingConfig.market.rpcUrl,
        };
        const nextBalance = paymentCurrency === "SOL"
          ? await fetchSolWalletBalance(session.publicKey, balanceNetwork)
          : await fetchFaceLESSWalletBalance(session.publicKey, pricing?.tokenMint, pricing?.tokenDecimals, balanceNetwork);
        if (!cancelled) setWalletBalance(nextBalance);
      } catch {
        if (!cancelled) setWalletBalance(null);
      } finally {
        if (!cancelled) setWalletBalanceLoading(false);
      }
    };

    void readBalance();
    return () => {
      cancelled = true;
    };
  }, [paymentCurrency, pricing?.tokenDecimals, pricing?.tokenMint, pricingConfig?.market.rpcUrl, pricingConfig?.network, session.authenticated, session.publicKey, walletBalanceRefreshKey]);

  useEffect(() => {
    jobs.forEach((job) => {
      const audioArtifacts = job.artifacts.filter((candidate) => candidate.role === "audio" && candidate.publicUrl);
      const artifact = audioArtifacts.find((candidate) => candidate.variant === "merged") ?? audioArtifacts[0];
      if (!artifact?.publicUrl || job.status !== "succeeded" || savedRemoteJobsRef.current.has(job.id) || savingRemoteJobsRef.current.has(job.id)) return;
      savingRemoteJobsRef.current.add(job.id);
      void listWorkspaceItems()
        .then((workspace) => {
          const next = createRemoteAudioWorkspaceItem({
            jobId: job.id,
            title: generationTitle(job),
            publicUrl: artifact.publicUrl,
            objectPath: artifact.objectPath,
            mimeType: artifact.mimeType,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
          });
          const existing = workspace.find((item) => item.id === next.id);
          if (!existing) return saveWorkspaceItem(next);

          return saveWorkspaceItem({
            ...next,
            ...existing,
            updatedAt: next.updatedAt,
            metadata: {
              ...next.metadata,
              ...existing.metadata,
            },
          });
        })
        .then(() => {
          savedRemoteJobsRef.current.add(job.id);
          onWorkspaceChanged?.();
        })
        .catch((nextError) => {
          savingRemoteJobsRef.current.delete(job.id);
          console.warn("[remote-generation] browser workspace sync deferred", nextError);
        });
    });
  }, [jobs, onWorkspaceChanged]);

  useEffect(() => {
    if (busy || error) return;
    setPhase(jobs.some((job) => ["created", "awaiting_payment", "queued"].includes(job.status)) ? "Queued" : hasActiveJobs ? "Generating" : "Ready");
  }, [busy, error, hasActiveJobs, jobs]);

  const submitGeneration = async () => {
    if (busy) return;
    if (!session.authenticated) {
      setError("Connect and verify your wallet before generating.");
      return;
    }
    if (generationMode === "music") {
      if (!prompt.trim()) {
        setError("Enter a music prompt.");
        return;
      }
      if (!instrumental && !lyrics.trim()) {
        setError("Enter lyrics or enable Instrumental.");
        return;
      }
    } else if (generationMode === "extraction") {
      if (!extractionSourceInput) {
        setError(extractionSourceMode === "private" ? "Choose a Private Asset before extracting." : "Upload a source audio file before extracting.");
        return;
      }
      if (extractionSourceTooLong) {
        setError(`Source audio must be ${MAX_REMOTE_AUDIO_DURATION_SECONDS} seconds or shorter for extraction.`);
        return;
      }
    } else if (generationMode === "transition") {
      if (!transitionWorkspace?.valid) {
        setError(transitionWorkspace?.errors[0] ?? "Build a valid transition arrangement before generating.");
        return;
      }
    } else {
      if (!voiceSongInput) {
        setError("Choose or upload the song you want to change.");
        return;
      }
      if (!voiceReferenceInput) {
        setError("Choose or upload a reference voice.");
        return;
      }
    }
    setBusy(true);
    setError("");
    setPaymentIntent(null);
    let submittedIntentId: string | undefined;
    let stage: RemoteSubmissionStage = "payment-request";
    try {
      if (health?.launchServer?.payments === "mock") {
        throw new Error("Remote generation payments are in test-only mock mode. Configure wallet signature or token transaction verification before submitting a generation.");
      }
      stage = "payment-request";
      setPhase("Checking availability");
      const intent = await api.createRemotePaymentIntent(request);
      submittedIntentId = intent.id;
      setPaymentIntent(intent);
      setPricing((current) => current ? {
        ...current,
        tokenMint: intent.tokenMint,
        tokenDecimals: intent.tokenDecimals,
        amountAtomic: intent.amountAtomic,
        priceUsd: intent.amountUsdCents / 100,
        priceUsdCents: intent.amountUsdCents,
        tokenPriceUsd: intent.tokenPriceUsd,
        fetchedAt: new Date().toISOString(),
      } : current);
      stage = "wallet-payment";
      setPhase(intent.paymentMode === "free-signature" ? "Opening wallet" : "Preparing wallet payment");
      const signature = intent.paymentMode === "free-signature"
        ? intent.paymentMessage
          ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage, onStatus: setPhase })
          : (() => { throw new Error("Launch server did not provide the wallet authorization message."); })()
        : intent.currency === "SOL"
          ? await sendRemoteGenerationSolPayment({
              walletAddress: session.publicKey,
              recipientAddress: intent.recipientAddress,
              network: intent.network,
              amountAtomic: intent.amountAtomic,
              paymentReference: intent.paymentReference,
              onStatus: setPhase,
            })
          : await sendRemoteGenerationPayment({
              walletAddress: session.publicKey,
              recipientAddress: intent.recipientAddress,
              tokenMint: intent.tokenMint,
              tokenDecimals: intent.tokenDecimals,
              network: intent.network,
              amountAtomic: intent.amountAtomic,
              paymentReference: intent.paymentReference,
              onStatus: setPhase,
            });
      stage = "payment-verification";
      setPhase(intent.paymentMode === "free-signature" ? "Verifying wallet signature" : "Verifying payment");
      const paid = await api.verifyRemotePayment(intent.id, signature);
      setPaymentIntent(paid);
      stage = "queue-submission";
      setPhase("Submitting");
      const queued = await api.createRemoteJob(paid.id, request);
      setJobs((current) => mergeJobs(current, [queued]));
      setPhase("Queued");
    } catch (nextError) {
      const errorBody = nextError instanceof Error
        ? (nextError as Error & { body?: RemoteGenerationErrorBody }).body
        : undefined;
      console.error("[remote-generation] submission failed", {
        stage,
        generationMode,
        paymentCurrency,
        paymentIntentId: submittedIntentId,
        error: remoteGenerationErrorDetails(nextError),
        rawError: nextError,
      });
      if (submittedIntentId) {
        try {
          const latestIntent = await api.remotePaymentIntent(submittedIntentId);
          setPaymentIntent(latestIntent);
        } catch {
          // The original failure remains the useful customer-facing state.
        }
      }
      setError(remoteGenerationFailureMessage(stage, generationMode, errorBody));
      setPhase("Failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleJobDetails = (jobId: string) => {
    setExpandedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const reusePrompt = (job: RemoteJob) => {
    const savedPrompt = generationPrompt(job);
    if (!savedPrompt) {
      setError("This generation does not have a saved prompt.");
      return;
    }
    setPrompt(savedPrompt);
    setError("");
    setPhase("Ready");
  };

  const remoteStatus = health?.ok ? "Ready" : health?.enabled ? "Unavailable" : health ? "Disabled" : "Checking";
  const displayedCurrency = paymentCurrency;
  const currencyLabel = displayedCurrency === "FACELESS" ? "$FACELESS" : "SOL";
  const currentPricing = pricing?.currency === paymentCurrency ? pricing : null;
  const holderBaseOnlyFree = holderFreeAvailable && (!currentPricing || currentPricing.priceUsd === 0);
  const costLabel = holderBaseOnlyFree ? "Free · signature required" : currentPricing ? `${formatPaymentToken(currentPricing.amountAtomic, currentPricing.tokenDecimals)} ${currencyLabel}${holderFreeAvailable ? " · base waived" : ""}` : `— ${currencyLabel}`;
  const walletBalanceLabel = !session.authenticated
    ? "Connect wallet"
    : walletBalance
      ? `${formatPaymentToken(walletBalance.amountAtomic, walletBalance.tokenDecimals)} ${currencyLabel}`
      : walletBalanceLoading
        ? "Checking..."
        : "Unavailable";

  return (
    <section className="dance-station-tool-panel dance-station-remote-generation">
      <div className="dance-station-generation-workspace">
        <section className={`dance-station-generation-builder${generationMode === "transition" ? " is-transition" : ""}`}>
          <div className="dance-station-generation-heading">
            <div className="dance-station-generation-heading__title">
              <span className="dance-station-generation-heading__icon"><Sparkles aria-hidden="true" size={22} strokeWidth={1.8} /></span>
              <div className="dance-station-generation-mode-tabs" role="tablist" aria-label="Generation mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationMode === "music"}
                  className={`dance-station-generation-mode-tab${generationMode === "music" ? " is-active" : ""}`}
                  onClick={() => setGenerationMode("music")}
                  disabled={busy}
                >
                  Create Music
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationMode === "transition"}
                  className={`dance-station-generation-mode-tab${generationMode === "transition" ? " is-active" : ""}`}
                  onClick={() => setGenerationMode("transition")}
                  disabled={busy}
                >
                  Transition
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationMode === "extraction"}
                  className={`dance-station-generation-mode-tab${generationMode === "extraction" ? " is-active" : ""}`}
                  onClick={() => setGenerationMode("extraction")}
                  disabled={busy}
                >
                  Music Extraction
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={generationMode === "voice-change"}
                  className={`dance-station-generation-mode-tab${generationMode === "voice-change" ? " is-active" : ""}`}
                  onClick={() => setGenerationMode("voice-change")}
                  disabled={busy}
                >
                  Voice Change
                </button>
              </div>
            </div>
            <div className="dance-station-generation-heading__summary">
              <div className={`dance-station-system-status${health?.ok ? "" : " is-error"}`}>
                {health?.ok ? <CheckCircle2 aria-hidden="true" size={16} strokeWidth={2.2} /> : <CircleAlert aria-hidden="true" size={16} strokeWidth={2.2} />}
                <span>{busy ? phase : remoteStatus === "Ready" ? "System Ready" : remoteStatus}</span>
              </div>
              <div className="dance-station-cost-estimator" aria-live="polite">
                <span>Total {currencyLabel}</span>
                <strong>{walletBalanceLabel}</strong>
                <button
                  type="button"
                  className="dance-station-cost-estimator__refresh"
                  aria-label="Refresh wallet balance"
                  title="Refresh wallet balance"
                  disabled={!session.authenticated || !pricingConfig || walletBalanceLoading}
                  onClick={() => setWalletBalanceRefreshKey((value) => value + 1)}
                >
                  <RefreshCw aria-hidden="true" size={14} className={walletBalanceLoading ? "is-spinning" : ""} />
                </button>
              </div>
            </div>
          </div>
          <div className="dance-station-generation-builder-body">
            <section className="dance-station-create-panel">
              <div className="dance-station-create-panel__scroll">
                <label>
                  Title <small>(optional)</small>
                  <input type="text" value={title} maxLength={120} placeholder={defaultTitle} onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)} disabled={busy} />
                </label>
                {generationMode === "music" ? (
                  <>
                    <label>
                      <span className="dance-station-field-label-row">Prompt <Info aria-hidden="true" size={13} strokeWidth={2} /></span>
                      <textarea value={prompt} rows={4} placeholder="dark electronic dance music with driving drums and bright synths" onInput={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)} disabled={busy} />
                    </label>
                    <div className="dance-station-prompt-actions">
                      <button type="button" className="dance-station-inline-button" onClick={() => setPrompt("")} disabled={!prompt.trim() || busy}>
                        <Trash2 aria-hidden="true" size={13} strokeWidth={2} />
                        Clear
                      </button>
                    </div>
                    <label className="dance-station-switch-row">
                      <input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental((event.currentTarget as HTMLInputElement).checked)} disabled={busy} />
                      <span className="dance-station-switch" aria-hidden="true"></span>
                      <span>Instrumental <em>(no vocals)</em></span>
                    </label>
                    {!instrumental ? <label>
                      <span className="dance-station-field-label-row">Lyrics <small>(optional)</small></span>
                      <textarea value={lyrics} rows={5} placeholder="Enter lyrics to sing" onInput={(event) => setLyrics((event.currentTarget as HTMLTextAreaElement).value)} disabled={busy} />
                    </label> : null}
                    <div className="dance-station-control-row">
                      <label>
                        Vocal language
                        <select value={vocalLanguage} onChange={(event) => setVocalLanguage((event.currentTarget as HTMLSelectElement).value)} disabled={instrumental || busy}>
                          <option value="unknown">Auto / unknown</option>
                          <option value="en">English</option>
                          <option value="es">Spanish</option>
                          <option value="fr">French</option>
                          <option value="de">German</option>
                          <option value="it">Italian</option>
                          <option value="pt">Portuguese</option>
                          <option value="ja">Japanese</option>
                          <option value="ko">Korean</option>
                          <option value="zh">Chinese</option>
                        </select>
                      </label>
                    </div>
                    <div className="dance-station-control-row">
                      <label>
                        Duration (sec)
                        <input type="number" min="10" max={MAX_REMOTE_AUDIO_DURATION_SECONDS} value={durationSeconds} onInput={(event) => setDurationSeconds(clampMusicDurationSeconds(Number((event.currentTarget as HTMLInputElement).value)))} disabled={busy} />
                      </label>
                      <label>
                        Inference steps
                        <input type="number" min="1" max="200" value={inferenceSteps} onInput={(event) => setInferenceSteps(Number((event.currentTarget as HTMLInputElement).value) || 1)} disabled={busy} />
                      </label>
                      <label>
                        Guidance scale
                        <input type="number" min="0" max="30" step="0.1" value={guidanceScale} onInput={(event) => setGuidanceScale(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} />
                      </label>
                    </div>
                    <div className="dance-station-control-row">
                      <label>
                        LoKr adapter
                        <select value={selectedLokrId} onChange={(event) => setSelectedLokrId((event.currentTarget as HTMLSelectElement).value)} disabled={busy || !lokrChoices.length}>
                          <option value="">No LoKr</option>
                          {lokrChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
                        </select>
                      </label>
                      <label>
                        LoKr strength
                        <input type="number" min="0" max="1" step="0.05" value={lokrScale} onInput={(event) => setLokrScale(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={!selectedLokr || busy} />
                      </label>
                    </div>
                    {!lokrChoices.length ? <p className="dance-station-availability-line">Import a published LoKr adapter into the library to use it remotely.</p> : null}
                  </>
                ) : generationMode === "extraction" ? (
                  <>
                    <div className="dance-station-source-mode" role="radiogroup" aria-label="Source audio">
                      <label className={`dance-station-source-mode__option${extractionSourceMode === "private" ? " is-active" : ""}`}>
                        <input type="radio" name="extraction-source-mode" value="private" checked={extractionSourceMode === "private"} onChange={() => setExtractionSourceMode("private")} disabled={busy || diskSourceBusy} />
                        <span>Private Asset</span>
                      </label>
                      <label className={`dance-station-source-mode__option${extractionSourceMode === "disk" ? " is-active" : ""}`}>
                        <input type="radio" name="extraction-source-mode" value="disk" checked={extractionSourceMode === "disk"} onChange={() => setExtractionSourceMode("disk")} disabled={busy || diskSourceBusy} />
                        <span>From Disk</span>
                      </label>
                    </div>
                    {extractionSourceMode === "private" ? (
                      <>
                        <label>
                          Private Asset
                          <select value={selectedExtractionSourceId} onChange={(event) => setSelectedExtractionSourceId((event.currentTarget as HTMLSelectElement).value)} disabled={busy || !audioChoices.length}>
                            <option value="">Choose an audio asset</option>
                            {audioChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}{choice.creatorName ? ` · ${choice.creatorName}` : ""}</option>)}
                          </select>
                        </label>
                        {!audioChoices.length ? <p className="dance-station-availability-line">Import or publish an audio asset before using remote extraction.</p> : null}
                      </>
                    ) : (
                      <div className="dance-station-source-upload">
                        <input
                          id="dance-station-extraction-source-file"
                          className="dance-station-source-file-input"
                          type="file"
                          accept="audio/*"
                          onChange={(event) => {
                            const fileInput = event.currentTarget as HTMLInputElement;
                            const file = fileInput.files?.[0];
                            fileInput.value = "";
                            void uploadDiskSource(file);
                          }}
                          disabled={busy || diskSourceBusy}
                        />
                        <label className="dance-station-source-upload-button" htmlFor="dance-station-extraction-source-file">
                          <Upload aria-hidden="true" size={14} strokeWidth={2} />
                          <span>{diskSourceBusy ? "Uploading..." : "Upload audio"}</span>
                        </label>
                        {diskSourceFileName ? <span className={`dance-station-source-file-name${diskSourceInput ? " is-ready" : ""}`}>{diskSourceBusy ? `Uploading ${diskSourceFileName}` : diskSourceInput ? diskSourceFileName : `${diskSourceFileName} not uploaded`}</span> : <span className="dance-station-source-file-name">Choose an audio file from disk</span>}
                        {diskSourceError ? <p className="dance-station-error">{diskSourceError}</p> : null}
                      </div>
                    )}
                    {extractionSourceTooLong ? <p className="dance-station-error">This source is {Math.ceil(extractionSourceInput?.durationSeconds ?? 0)} seconds long. Extraction sources must be {MAX_REMOTE_AUDIO_DURATION_SECONDS} seconds or shorter.</p> : null}
                    <div className="dance-station-control-row">
                      <label>
                        Extract track
                        <select value={extractionTrack} onChange={(event) => setExtractionTrack((event.currentTarget as HTMLSelectElement).value as (typeof extractionTracks)[number])} disabled={busy}>
                          {extractionTracks.map((track) => <option key={track} value={track}>{track.replaceAll("_", " ")}</option>)}
                        </select>
                      </label>
                      <label>
                        Inference steps
                        <input type="number" min="1" max="200" value={extractionInferenceSteps} onInput={(event) => setExtractionInferenceSteps(Number((event.currentTarget as HTMLInputElement).value) || 1)} disabled={busy} />
                      </label>
                    </div>
                    <div className="dance-station-control-row">
                      <label>
                        Guidance scale
                        <input type="number" min="0" max="30" step="0.1" value={extractionGuidanceScale} onInput={(event) => setExtractionGuidanceScale(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} />
                      </label>
                    </div>
                  </>
                ) : generationMode === "transition" ? (
                  <div className="dance-station-transition-settings">
                    <p className="dance-station-availability-line">Build a clip chain and define each transition.</p>
                    <div className="dance-station-control-row">
                      <label>Inference steps<input type="number" min="1" max="200" value={transitionInferenceSteps} onInput={(event) => setTransitionInferenceSteps(Number((event.currentTarget as HTMLInputElement).value) || 1)} disabled={busy} /></label>
                      <label>Guidance scale<input type="number" min="0" max="30" step="0.1" value={transitionGuidanceScale} onInput={(event) => setTransitionGuidanceScale(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} /></label>
                    </div>
                  </div>
                ) : (
                  <>
                    <VoiceChangeSourceField
                      label="Song audio"
                      mode={voiceSongSourceMode}
                      onModeChange={setVoiceSongSourceMode}
                      privateValue={voiceSongSourceId}
                      onPrivateChange={setVoiceSongSourceId}
                      privateChoices={audioChoices}
                      diskInput={voiceSongDiskInput}
                      fileName={voiceSongFileName}
                      inputId="dance-station-voice-song-file"
                      onUpload={(file) => void uploadVoiceSource("song", file)}
                      disabled={busy || voiceUploadBusy}
                    />
                    <VoiceChangeSourceField
                      label="Reference voice"
                      mode={voiceReferenceSourceMode}
                      onModeChange={setVoiceReferenceSourceMode}
                      privateValue={voiceReferenceSourceId}
                      onPrivateChange={setVoiceReferenceSourceId}
                      privateChoices={audioChoices}
                      diskInput={voiceReferenceDiskInput}
                      fileName={voiceReferenceFileName}
                      inputId="dance-station-voice-reference-file"
                      onUpload={(file) => void uploadVoiceSource("reference", file)}
                      disabled={busy || voiceUploadBusy}
                    />
                    <div className="dance-station-control-row">
                      <label>Diffusion steps<input type="number" min="1" max="100" value={voiceDiffusionSteps} onInput={(event) => setVoiceDiffusionSteps(Number((event.currentTarget as HTMLInputElement).value) || 1)} disabled={busy} /></label>
                      <label>Length adjust<input type="number" min="0.25" max="4" step="0.05" value={voiceLengthAdjust} onInput={(event) => setVoiceLengthAdjust(Number((event.currentTarget as HTMLInputElement).value) || 1)} disabled={busy} /></label>
                      <label>CFG rate<input type="number" min="0" max="2" step="0.05" value={voiceCfgRate} onInput={(event) => setVoiceCfgRate(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} /></label>
                    </div>
                    <div className="dance-station-control-row">
                      <label>Pitch shift<input type="number" min="-24" max="24" step="1" value={voicePitchShift} onInput={(event) => setVoicePitchShift(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} /></label>
                      <label>UVR model<select value={voiceUvrModel} onChange={(event) => setVoiceUvrModel((event.currentTarget as HTMLSelectElement).value)} disabled={busy}><option value="UVR-MDX-NET-Inst_HQ_3.onnx">MDX Inst HQ 3</option></select></label>
                    </div>
                    <div className="dance-station-control-row">
                      <label>UVR segment<input type="number" min="32" max="512" step="32" value={voiceUvrSegmentSize} onInput={(event) => setVoiceUvrSegmentSize(Number((event.currentTarget as HTMLInputElement).value) || 256)} disabled={busy} /></label>
                      <label>UVR overlap<input type="number" min="0" max="0.99" step="0.05" value={voiceUvrOverlap} onInput={(event) => setVoiceUvrOverlap(Number((event.currentTarget as HTMLInputElement).value) || 0)} disabled={busy} /></label>
                    </div>
                    <label className="dance-station-switch-row"><input type="checkbox" checked={voiceF0Condition} onChange={(event) => setVoiceF0Condition((event.currentTarget as HTMLInputElement).checked)} disabled={busy} /><span className="dance-station-switch" aria-hidden="true"></span><span>F0 conditioning</span></label>
                    <label className="dance-station-switch-row"><input type="checkbox" checked={voiceAutoF0Adjust} onChange={(event) => setVoiceAutoF0Adjust((event.currentTarget as HTMLInputElement).checked)} disabled={busy || !voiceF0Condition} /><span className="dance-station-switch" aria-hidden="true"></span><span>Auto F0 adjust</span></label>
                    <label className="dance-station-switch-row"><input type="checkbox" checked={voiceUvrDenoise} onChange={(event) => setVoiceUvrDenoise((event.currentTarget as HTMLInputElement).checked)} disabled={busy} /><span className="dance-station-switch" aria-hidden="true"></span><span>UVR denoise</span></label>
                    <label className="dance-station-switch-row"><input type="checkbox" checked={voiceLoudnessOptimization} onChange={(event) => setVoiceLoudnessOptimization((event.currentTarget as HTMLInputElement).checked)} disabled={busy} /><span className="dance-station-switch" aria-hidden="true"></span><span>Loudness optimization</span></label>
                  </>
                )}
              </div>
              <div className="dance-station-payment-currency" role="radiogroup" aria-label={holderFreeAvailable ? "Holder payment benefit" : "Payment currency"}>
                {holderBaseOnlyFree ? <label className="is-active"><input type="radio" checked readOnly disabled={busy} /><span>Free for holders</span></label> : (["FACELESS", "SOL"] as const).map((currency) => (
                  <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}>
                    <input type="radio" name="remote-generation-payment-currency" value={currency} checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} disabled={busy} />
                    <span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span>
                  </label>
                ))}
              </div>
              <div className="dance-station-create-panel__footer">
                <button type="button" className="dance-station-generate-button" onClick={() => void submitGeneration()} disabled={busy || diskSourceBusy || voiceUploadBusy || !health?.enabled || !session.authenticated || !currentPricing}>
                  {busy ? <span className="dance-station-generation-spinner" aria-hidden="true" /> : <Sparkles aria-hidden="true" size={17} strokeWidth={2.1} />}
                  <span className="dance-station-generate-button__copy">
                    <strong>{busy ? "Submitting" : generationMode === "music" ? "Create" : generationMode === "extraction" ? "Extract" : generationMode === "transition" ? "Create transition" : "Change voice"}</strong>
                    {!busy ? <small>{costLabel}</small> : null}
                  </span>
                </button>
                {pricingError ? <p className="dance-station-error" role="status">{pricingError}</p> : null}
                {error ? <p className="dance-station-error" role="alert">{error}</p> : null}
              </div>
            </section>

            <section className="dance-station-generation-preview" aria-label="Generation preview">
              <div className={`dance-station-transition-workspace-shell${generationMode === "transition" ? "" : " is-hidden"}`} aria-hidden={generationMode !== "transition"}>
                <TransitionWorkspace choices={transitionChoices} inferenceSteps={transitionInferenceSteps} guidanceScale={transitionGuidanceScale} busy={busy} uploadBusy={transitionUploadBusy} uploadError={transitionUploadError} onUpload={uploadTransitionSource} onChange={onTransitionWorkspaceChange} />
              </div>
              {generationMode !== "transition" ? <div className="dance-station-generation-tips">
                <p>Tips</p>
                <ul>
                  {generationMode === "music" ? <>
                    <li>Be specific with genre, mood, instruments, and energy</li>
                    <li>Use references like “in the style of...” for better results</li>
                    <li>Instrumental mode works best with descriptive prompts</li>
                  </> : generationMode === "extraction" ? <>
                    <li>Choose the source audio asset you want to analyze</li>
                    <li>Select a track layer to isolate from the source</li>
                    <li>Extracted tracks are saved with the shared generation history</li>
                  </> : <>
                    <li>Choose the song and reference voice to transform</li>
                    <li>F0 conditioning is recommended for singing</li>
                    <li>All three returned audio layers remain downloadable</li>
                  </>}
                </ul>
              </div> : null}
            </section>
          </div>
        </section>

        <section className="dance-station-inner-panel dance-station-history-panel">
          <div className="dance-station-history-heading">
            <div className="dance-station-history-heading__title">
              <h3>Generation History</h3>
              <span>{jobs.length}</span>
            </div>
          </div>
          <div className="dance-station-history-toolbar">
            <label className="dance-station-history-search">
              <Search aria-hidden="true" size={15} strokeWidth={2} />
              <span className="sr-only">Search generations</span>
              <input value={historyQuery} onInput={(event) => setHistoryQuery((event.currentTarget as HTMLInputElement).value)} placeholder="Search generations..." />
            </label>
            <label className="dance-station-history-filter">
              <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={2} />
              <span className="sr-only">Filter generations</span>
              <select value={historyFilter} onChange={(event) => setHistoryFilter((event.currentTarget as HTMLSelectElement).value as typeof historyFilter)}>
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="complete">Completed</option>
                <option value="error">Errors</option>
              </select>
            </label>
          </div>
          <div className="dance-station-generation-list" aria-live="polite">
            {visibleJobs.map((candidate) => (
              <RemoteGenerationRow
                key={candidate.id}
                job={candidate}
                rewardSubmission={rewardSubmissionsByJob.get(candidate.id)}
                expanded={expandedJobIds.has(candidate.id)}
                onToggleDetails={() => toggleJobDetails(candidate.id)}
                onReusePrompt={() => reusePrompt(candidate)}
                onRewardSubmitted={(submission) => setRewardSubmissions((current) => [submission, ...current.filter((item) => item.jobId !== submission.jobId)])}
              />
            ))}
            {historyCursor ? (
              <button type="button" className="dance-station-history-load-more" onClick={() => void loadOlderHistory()} disabled={historyLoadingMore}>
                {historyLoadingMore ? "Loading..." : "Load older generations"}
              </button>
            ) : null}
            {!visibleJobs.length ? <div className="dance-station-history-empty"><AudioWaveform aria-hidden="true" size={42} strokeWidth={1.3} /><strong>{jobs.length ? "No generations match" : "Your generations will appear here"}</strong><span>{jobs.length ? "Try another search or filter" : "Start creating music to see your results"}</span></div> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function VoiceChangeSourceField({
  label,
  mode,
  onModeChange,
  privateValue,
  onPrivateChange,
  privateChoices,
  diskInput,
  fileName,
  inputId,
  onUpload,
  disabled,
}: {
  label: string;
  mode: ExtractionSourceMode;
  onModeChange: (mode: ExtractionSourceMode) => void;
  privateValue: string;
  onPrivateChange: (value: string) => void;
  privateChoices: RemoteAudioChoice[];
  diskInput: RemoteGenerationInput | null;
  fileName: string;
  inputId: string;
  onUpload: (file?: File) => void;
  disabled: boolean;
}): JSX.Element {
  return <div className="dance-station-voice-source">
    <span className="dance-station-field-label-row">{label}</span>
    <div className="dance-station-source-mode" role="radiogroup" aria-label={`${label} source`}>
      {(["private", "disk"] as const).map((sourceMode) => <label key={sourceMode} className={`dance-station-source-mode__option${mode === sourceMode ? " is-active" : ""}`}>
        <input type="radio" name={`${inputId}-mode`} checked={mode === sourceMode} onChange={() => onModeChange(sourceMode)} disabled={disabled} />
        <span>{sourceMode === "private" ? "Private Asset" : "From Disk"}</span>
      </label>)}
    </div>
    {mode === "private" ? <select value={privateValue} onChange={(event) => onPrivateChange((event.currentTarget as HTMLSelectElement).value)} disabled={disabled || !privateChoices.length}>
      <option value="">Choose an audio asset</option>
      {privateChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.title}{choice.creatorName ? ` · ${choice.creatorName}` : ""}</option>)}
    </select> : <div className="dance-station-source-upload">
      <input id={inputId} className="dance-station-source-file-input" type="file" accept="audio/*" onChange={(event) => { const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ""; onUpload(file); }} disabled={disabled} />
      <label className="dance-station-source-upload-button" htmlFor={inputId}><Upload aria-hidden="true" size={14} strokeWidth={2} /><span>Upload audio</span></label>
      <span className={`dance-station-source-file-name${diskInput ? " is-ready" : ""}`}>{fileName || "Choose an audio file from disk"}</span>
    </div>}
  </div>;
}

function RemoteGenerationRow({
  job,
  rewardSubmission,
  expanded,
  onToggleDetails,
  onReusePrompt,
  onRewardSubmitted,
}: {
  job: RemoteJob;
  rewardSubmission?: RemoteRewardSubmission;
  expanded: boolean;
  onToggleDetails: () => void;
  onReusePrompt: () => void;
  onRewardSubmitted: (submission: RemoteRewardSubmission) => void;
}): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [rewardPostLink, setRewardPostLink] = useState("");
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardError, setRewardError] = useState("");
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const audioArtifacts = job.artifacts.filter((artifact) => artifact.role === "audio" && artifact.publicUrl);
  const audioArtifact = audioArtifacts.find((artifact) => artifact.variant === "merged") ?? audioArtifacts[0];
  const convertedVocalArtifact = audioArtifacts.find((artifact) => artifact.variant === "converted-vocal");
  const instrumentalArtifact = audioArtifacts.find((artifact) => artifact.variant === "instrumental");
  const waveformArtifact = job.artifacts.find((artifact) => artifact.role === "waveform" && artifact.publicUrl);
  const failed = ["failed", "cancelled", "expired"].includes(job.status);
  const complete = job.status === "succeeded";
  const status = generationStatus(job);
  const prompt = generationPrompt(job);
  const detailsId = `generation-prompt-${job.id}`;
  const coverArtifact = job.artifacts.find((artifact) => artifact.role !== "waveform" && artifact.publicUrl && artifact.mimeType.startsWith("image/"));
  const coverUrl = complete ? coverArtifact?.publicUrl ?? fallbackGenerationCoverUrl(job.id) : coverArtifact?.publicUrl;
  const duration = formatGenerationDuration(generationParameterNumber(job, ["audio_duration", "duration", "duration_seconds"]));
  const tags = generationTags(job);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!optionsButtonRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const updateMenuPosition = () => {
      const button = optionsButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setMenuPosition({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen]);

  const togglePromptDetails = () => {
    onToggleDetails();
    setMenuOpen(false);
  };

  const submitReward = async () => {
    const postLink = rewardPostLink.trim();
    if (!postLink) {
      setRewardError("Add the link to your post before submitting.");
      return;
    }
    setRewardBusy(true);
    setRewardError("");
    try {
      const submission = await api.createRemoteRewardSubmission(job.id, postLink);
      onRewardSubmitted(submission);
      setRewardModalOpen(false);
      setRewardPostLink("");
    } catch (error) {
      setRewardError(error instanceof Error ? error.message : "Could not submit this generation for reward.");
    } finally {
      setRewardBusy(false);
    }
  };

  return (
    <article className={`dance-station-generation-row${expanded ? " dance-station-generation-row--expanded" : ""}${failed ? " dance-station-generation-row--error" : ""}`}>
      <div className={`dance-station-generation-row__artwork${failed ? " dance-station-generation-row__artwork--error" : ""}`} aria-hidden={coverArtifact?.publicUrl ? undefined : "true"}>
        {coverUrl ? <img src={coverUrl} alt="" loading="lazy" decoding="async" /> : <AudioWaveform size={34} strokeWidth={1.2} />}
      </div>
      <div className="dance-station-generation-row__content">
        <div className="dance-station-generation-row__head">
          <div className="dance-station-generation-row__title-line">
            <strong>{generationTitle(job)}</strong>
            <span className={`dance-station-generation-state dance-station-generation-state--${status.tone}`}>
              {status.tone === "complete" ? <CheckCircle2 aria-hidden="true" size={14} strokeWidth={2.2} /> : null}
              {status.tone === "error" ? <CircleAlert aria-hidden="true" size={14} strokeWidth={2.2} /> : null}
              {status.spinning ? <span className="dance-station-generation-spinner" aria-hidden="true" /> : null}
              {status.label}
            </span>
          </div>
          <div className="dance-station-generation-row__meta">
            <span><Music2 aria-hidden="true" size={14} strokeWidth={1.8} />{generationModelLabel(job)}</span>
            <span><CalendarDays aria-hidden="true" size={14} strokeWidth={1.8} />{new Date(job.createdAt).toLocaleString()}</span>
          </div>
        </div>
        {complete && audioArtifact?.publicUrl ? (
          <div className="dance-station-generation-row__audio-meta">
            <WaveformVisual className="dance-station-generation-waveform" seed={job.id} waveformUrl={waveformArtifact?.publicUrl} />
            {duration ? <span className="dance-station-generation-row__duration"><Clock3 aria-hidden="true" size={14} strokeWidth={1.8} />{duration}</span> : null}
          </div>
        ) : null}
        {complete && tags.length ? <div className="dance-station-generation-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
        {!complete && !failed ? (
          <div className="dance-station-generation-progress" aria-label="Generation in progress">
            <span className="dance-station-generation-progress__bar" aria-hidden="true" />
            <span>Processing</span>
          </div>
        ) : null}
        {failed ? <p className="dance-station-generation-row__error-copy">Generation failed. Please try again.</p> : null}
      </div>
      {expanded ? (
        <div id={detailsId} className="dance-station-generation-details">
          <div className="dance-station-generation-details__actions">
            {prompt ? (
              <button type="button" className="dance-station-inline-button" onClick={onReusePrompt}>
                <RotateCcw aria-hidden="true" size={13} strokeWidth={2} />
                Reuse prompt
              </button>
            ) : null}
            <button type="button" className="dance-station-inline-button" onClick={togglePromptDetails}>
              Hide prompt
            </button>
          </div>
          <div className="dance-station-generation-details__prompt">
            <span>Prompt</span>
            <p>{prompt || "No prompt saved."}</p>
          </div>
        </div>
      ) : null}
      <div className="dance-station-generation-media">
        {complete && audioArtifact?.publicUrl ? (
          <AudioPlayButton track={{ id: `remote-generation-${job.id}`, title: generationTitle(job), url: audioArtifact.publicUrl, mimeType: audioArtifact.mimeType, waveformUrl: waveformArtifact?.publicUrl }} />
        ) : (
          <button type="button" className="site-audio-play-button dance-station-generation-play-disabled" disabled aria-label={`${status.label} for ${generationTitle(job)}`}>
            <Play aria-hidden="true" size={18} strokeWidth={2.1} />
          </button>
        )}
        <div className="dance-station-generation-options">
          <button
            type="button"
            className="dance-station-tool-button dance-station-generation-options-button"
            ref={optionsButtonRef}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Options for ${generationTitle(job)}`}
            title="Generation options"
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreHorizontal aria-hidden="true" size={19} strokeWidth={2.2} />
          </button>
        </div>
      </div>
      {menuOpen && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          className="dance-station-generation-options-menu"
          role="menu"
          style={{ top: `${menuPosition.top}px`, right: `${menuPosition.right}px` }}
        >
          <button type="button" role="menuitem" onClick={togglePromptDetails}>
            {expanded ? "Hide prompt" : "Show prompt"}
          </button>
          {complete && audioArtifact?.publicUrl ? (
            <>
              <a role="menuitem" href={audioArtifact.publicUrl} download target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
                <Download aria-hidden="true" size={14} strokeWidth={2} />
                Download
              </a>
              {job.runtime === "voice-change" ? <>
                {convertedVocalArtifact?.publicUrl ? <a role="menuitem" href={convertedVocalArtifact.publicUrl} download target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}><Download aria-hidden="true" size={14} strokeWidth={2} />Download converted vocal</a> : null}
                {instrumentalArtifact?.publicUrl ? <a role="menuitem" href={instrumentalArtifact.publicUrl} download target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}><Download aria-hidden="true" size={14} strokeWidth={2} />Download instrumental</a> : null}
              </> : null}
              {rewardSubmission ? (
                <span className="dance-station-generation-reward-status" role="menuitem">Reward: {rewardSubmission.status}</span>
              ) : (
                <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setRewardModalOpen(true); setRewardError(""); }}>
                  Submit For Reward
                </button>
              )}
            </>
          ) : null}
        </div>,
        document.body,
      ) : null}
      {rewardModalOpen && typeof document !== "undefined" ? createPortal(
        <div className="dance-station-reward-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !rewardBusy) setRewardModalOpen(false); }}>
          <section className="dance-station-reward-modal" role="dialog" aria-modal="true" aria-labelledby={`reward-title-${job.id}`}>
            <div className="dance-station-reward-modal__head">
              <div>
                <span className="dance-station-eyebrow">Reward submission</span>
                <h4 id={`reward-title-${job.id}`}>{generationTitle(job)}</h4>
              </div>
              <button type="button" className="dance-station-tool-button" onClick={() => setRewardModalOpen(false)} disabled={rewardBusy} aria-label="Close reward submission">×</button>
            </div>
            <p>Share the link to your social post so this generation can be reviewed.</p>
            <label className="dance-station-reward-modal__field">
              <span>Link To Post</span>
              <input value={rewardPostLink} onInput={(event) => setRewardPostLink((event.currentTarget as HTMLInputElement).value)} placeholder="https://..." maxLength={2048} autoFocus disabled={rewardBusy} />
            </label>
            {rewardError ? <p className="dance-station-error" role="alert">{rewardError}</p> : null}
            <div className="dance-station-reward-modal__actions">
              <button type="button" className="dance-station-inline-button" onClick={() => setRewardModalOpen(false)} disabled={rewardBusy}>Cancel</button>
              <button type="button" className="dance-station-inline-button dance-station-inline-button--primary" onClick={() => void submitReward()} disabled={rewardBusy || !rewardPostLink.trim()}>{rewardBusy ? "Submitting..." : "Submit"}</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </article>
  );
}
