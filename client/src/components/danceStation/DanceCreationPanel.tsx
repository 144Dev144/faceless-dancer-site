import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AudioLines, CheckCircle2, FileVideo, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2, Upload, WandSparkles } from "lucide-preact";
import type { DanceMotionClip, DanceMotionComposition, DanceMotionCompositionSegment, DanceMotionJob } from "@faceless/shared";
import { api, type LibraryItem, type RemoteGenerationInput, type RemoteGenerationRequest, type RemoteJob, type RemotePaymentCurrency, type RemotePricingConfig, type RemotePricingQuote } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import type { BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import { saveWorkspaceItem } from "../../lib/danceStationWorkspace";
import { fetchFaceLESSWalletBalance, fetchSolWalletBalance, type FaceLESSWalletBalance } from "../../lib/facelessBalance";
import { sendRemoteGenerationPayment, sendRemoteGenerationSolPayment, signRemoteGenerationPayment } from "../../lib/remoteGenerationPayment";
import { calculateRemotePricing, createFreeMarketPrice, fetchOnChainMarketPrice, holderFreeForRequest, type RemoteMarketPrice } from "../../lib/remoteGenerationPricing";
import { DanceEngineCanvas } from "../../game/dance-engine/DanceEngineCanvas";
import { composeDanceMotion, createCompositionSegment } from "../../game/dance-engine/motionComposition";
import type { CanonicalRigProfile } from "../../game/dance-engine/canonicalRigProfile";
import { parseDanceModelManifest } from "../../game/dance-engine/modelManifest";
import type { DanceModelManifest, DanceModelPreset, DanceRuntimeOptions, DanceRuntimeSnapshot } from "../../game/dance-engine/types";
import { DanceMotionCapturePanel } from "../dance-engine/DanceMotionCapturePanel";
import { RigAdjustmentPanel } from "../dance-engine/RigAdjustmentPanel";

interface Props {
  session: SessionState;
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  onWorkspaceChanged?: () => void;
  onPublishAsset?: (item: BrowserWorkspaceItem) => Promise<void>;
}

const DEFAULT_OPTIONS: DanceRuntimeOptions = {
  energy: 0.72,
  variety: 0.65,
  bpmScale: 1,
  style: "balanced",
  liveAccents: true,
  reducedQuality: false,
  minBeatStrength: 0.1,
  seed: 17,
};

function artifactUrl(job: RemoteJob, test: (artifact: RemoteJob["artifacts"][number]) => boolean): string | null {
  return job.artifacts.find((artifact) => test(artifact))?.publicUrl ?? null;
}

function isModelArtifact(artifact: RemoteJob["artifacts"][number]): boolean {
  return artifact.mimeType === "model/gltf-binary" || artifact.mimeType === "model/gltf+json" || /\.glb$|\.gltf$/i.test(artifact.objectPath) || artifact.variant === "avatar-output";
}

function isManifestArtifact(artifact: RemoteJob["artifacts"][number]): boolean {
  return artifact.mimeType.includes("json") || /manifest\.json$/i.test(artifact.objectPath);
}

function inputFromWorkspace(item: BrowserWorkspaceItem, role: "mesh" | "manifest" | "reference-image"): { file: File | null; url: string; role: "mesh" | "manifest" | "reference-image" } {
  const metadata = item.metadata;
  const files = Array.isArray(metadata.files) ? metadata.files.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const wantedRole = role === "mesh" ? ["model", "metadata"] : role === "manifest" ? ["rig_manifest", "metadata"] : ["cover", "preview"];
  const record = files.find((file) => wantedRole.includes(String(file.role))) ?? files[0];
  const blob = metadata.blob instanceof Blob ? metadata.blob : null;
  const publicUrl = typeof record?.publicUrl === "string" ? record.publicUrl : typeof metadata.publicUrl === "string" ? metadata.publicUrl : "";
  const fileName = typeof record?.fileName === "string" ? record.fileName : typeof metadata.fileName === "string" ? metadata.fileName : `${item.title}.${role === "mesh" ? "glb" : role === "manifest" ? "json" : "png"}`;
  const mimeType = typeof record?.mimeType === "string" ? record.mimeType : typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
  return { file: blob ? new File([blob], fileName, { type: mimeType }) : null, url: publicUrl, role };
}

function inputFromLibrary(item: LibraryItem, role: "mesh" | "manifest"): { file: File | null; url: string; role: "mesh" | "manifest" } {
  const wantedRoles = role === "mesh" ? ["model", "metadata"] : ["rig_manifest", "metadata"];
  const record = item.files.find((file) => wantedRoles.includes(file.role));
  const publicUrl = record ? record.publicUrl || `/api/library/${encodeURIComponent(item.id)}/files/${encodeURIComponent(record.id)}` : "";
  return { file: null, url: publicUrl, role };
}

async function fileFromUrl(url: string, name: string, mimeType: string): Promise<File> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Could not read ${name} from the asset store.`);
  return new File([await response.blob()], name, { type: mimeType });
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Could not load ${url}.`);
  return response.json() as Promise<T>;
}

function publicLibraryForWorkspace(item: BrowserWorkspaceItem): LibraryItem | null {
  const value = item.metadata.publicLibrary;
  return value && typeof value === "object" ? value as LibraryItem : null;
}

function compositionFromItem(item: BrowserWorkspaceItem | LibraryItem): DanceMotionComposition | null {
  const metadata = item.metadata as Record<string, unknown>;
  const value = metadata.composition;
  if (!value || typeof value !== "object") return null;
  const composition = value as DanceMotionComposition;
  return composition.format === "faceless-dance-composition" && Array.isArray(composition.segments) ? composition : null;
}

function formatPaymentToken(amountAtomic: string, decimals: number): string {
  const amount = Number(amountAtomic) / 10 ** decimals;
  if (!Number.isFinite(amount)) return amountAtomic;
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function DanceCreationPanel({ session, workspaceItems, publicItems, onWorkspaceChanged, onPublishAsset }: Props): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const modelObjectUrlRef = useRef<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [model, setModel] = useState<DanceModelPreset | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [profile, setProfile] = useState<CanonicalRigProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<CanonicalRigProfile | null>(null);
  const [avatarJob, setAvatarJob] = useState<RemoteJob | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<RemotePaymentCurrency>("FACELESS");
  const [pricingConfig, setPricingConfig] = useState<RemotePricingConfig | null>(null);
  const [marketPrice, setMarketPrice] = useState<RemoteMarketPrice | null>(null);
  const [pricing, setPricing] = useState<RemotePricingQuote | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [walletBalance, setWalletBalance] = useState<FaceLESSWalletBalance | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletBalanceRefreshKey, setWalletBalanceRefreshKey] = useState(0);
  const [captureJob, setCaptureJob] = useState<DanceMotionJob | null>(null);
  const [captureClip, setCaptureClip] = useState<DanceMotionClip | null>(null);
  const [segments, setSegments] = useState<DanceMotionCompositionSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [compositionTitle, setCompositionTitle] = useState("My Dance Motion");
  const [savedItem, setSavedItem] = useState<BrowserWorkspaceItem | null>(null);
  const [compositionMessage, setCompositionMessage] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [snapshot, setSnapshot] = useState<DanceRuntimeSnapshot | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [loadedCompositionId, setLoadedCompositionId] = useState("");
  const [trackAssetId, setTrackAssetId] = useState("");

  const avatarRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "avatar",
    modelRevision: "avatar-runtime-v1",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: prompt.trim().slice(0, 120) || "Avatar generation" },
    parameters: { task_type: "avatar", description: prompt.trim(), quality: "runtime", max_attempts: 2 },
  }), [paymentCurrency, prompt]);

  const holderFreeAvailable = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, avatarRequest));

  useEffect(() => {
    let cancelled = false;
    void api.remoteGenerationPricingConfig()
      .then((nextConfig) => {
        if (nextConfig.paymentMode === "free-signature" || (session.isHolder && holderFreeForRequest(nextConfig, avatarRequest))) {
          return { nextConfig, nextMarketPrice: createFreeMarketPrice(nextConfig, nextConfig.paymentMode === "free-signature" ? "free-signature" : "holder-free") };
        }
        return fetchOnChainMarketPrice(nextConfig).then((nextMarketPrice) => ({ nextConfig, nextMarketPrice }));
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
  }, [avatarRequest.parameters.task_type, session.isHolder]);

  useEffect(() => {
    const effectiveMarketPrice = marketPrice ?? (pricingConfig && holderFreeAvailable ? createFreeMarketPrice(pricingConfig, "holder-free") : null);
    if (!pricingConfig || !effectiveMarketPrice) {
      setPricing(null);
      return;
    }
    try {
      setPricing(calculateRemotePricing(pricingConfig, avatarRequest, effectiveMarketPrice, { freeForHolder: holderFreeAvailable }));
    } catch {
      setPricing(null);
    }
  }, [avatarRequest, holderFreeAvailable, marketPrice, pricingConfig]);

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
        const network = { network: pricingConfig.network, rpcUrl: pricingConfig.market.rpcUrl };
        const nextBalance = paymentCurrency === "SOL"
          ? await fetchSolWalletBalance(session.publicKey, network)
          : await fetchFaceLESSWalletBalance(
            session.publicKey,
            pricing?.tokenMint ?? pricingConfig.currencies.FACELESS.tokenMint,
            pricing?.tokenDecimals ?? pricingConfig.currencies.FACELESS.tokenDecimals,
            network,
          );
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

  const composed = useMemo<DanceMotionComposition>(() => ({
    format: "faceless-dance-composition",
    version: 1,
    title: compositionTitle.trim() || "My Dance Motion",
    durationSeconds: Math.max(0.01, ...segments.map((segment) => segment.offsetSeconds + Math.max(0, segment.trimEndSeconds - segment.trimStartSeconds))),
    segments,
    ...(captureJob?.artifacts.find((artifact) => artifact.kind === "source-video") ? {
      audioSource: {
        url: captureJob.artifacts.find((artifact) => artifact.kind === "source-video")!.url,
        fileName: captureJob.originalFileName,
        mimeType: captureJob.mimeType,
      },
    } : {}),
    createdAt: savedItem?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [captureJob, compositionTitle, savedItem, segments]);
  const composedClip = useMemo(() => composeDanceMotion(composed), [composed]);
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? null;

  useEffect(() => () => {
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
  }, []);

  useEffect(() => {
    const item = workspaceItems.find((candidate) => candidate.kind === "dance_motion" && candidate.id === loadedCompositionId);
    const publicItem = publicItems.find((candidate) => candidate.kind === "dance_motion" && candidate.id === loadedCompositionId);
    const nextComposition = item ? compositionFromItem(item) : publicItem ? compositionFromItem(publicItem) : null;
    if (!nextComposition) return;
    setCompositionTitle(nextComposition.title);
    setSegments(nextComposition.segments);
    setSelectedSegmentId(nextComposition.segments[0]?.id ?? null);
    setMotionEnabled(true);
  }, [loadedCompositionId, publicItems, workspaceItems]);

  const applyAvatarArtifacts = useCallback(async (job: RemoteJob): Promise<void> => {
    const modelUrl = artifactUrl(job, isModelArtifact);
    const manifestUrl = artifactUrl(job, isManifestArtifact);
    if (!modelUrl) throw new Error("The avatar worker finished without returning a GLB model.");
    let manifest: DanceModelManifest | undefined;
    if (manifestUrl) {
      const parsed = parseDanceModelManifest(await fetchJson<unknown>(manifestUrl));
      manifest = { ...parsed.manifest, modelFile: modelUrl };
      setProfile(parsed.manifest.canonicalProfile ?? null);
      setOriginalProfile(parsed.manifest.canonicalProfile ?? null);
      setAvatarMessage(parsed.warnings.length ? `Avatar ready with ${parsed.warnings.length} rig warning${parsed.warnings.length === 1 ? "" : "s"}.` : "Avatar model and rig are ready.");
    } else {
      setProfile(null);
      setOriginalProfile(null);
      setAvatarMessage("Avatar model is ready. Load its canonical manifest to adjust the rig.");
    }
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
    modelObjectUrlRef.current = null;
    setModelFile(null);
    setModel({ id: `remote-avatar-${job.id}`, label: job.request.metadata?.title ?? "Generated avatar", url: modelUrl, clipNames: { idle: "Idle" }, source: "Remote avatar worker", manifest });
    setAvatarJob(job);
  }, []);

  const submitAvatarRequest = async (request: RemoteGenerationRequest): Promise<RemoteJob> => {
    if (!session.authenticated) throw new Error("Connect and verify your wallet before generating an avatar.");
    const intent = await api.createRemotePaymentIntent(request);
    const signature = intent.paymentMode === "free-signature"
      ? intent.paymentMessage ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage }) : (() => { throw new Error("The launch server did not provide the wallet authorization message."); })()
      : intent.currency === "SOL"
        ? await sendRemoteGenerationSolPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference })
        : await sendRemoteGenerationPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, tokenMint: intent.tokenMint, tokenDecimals: intent.tokenDecimals, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference });
    const paid = await api.verifyRemotePayment(intent.id, signature);
    const queued = await api.createRemoteJob(paid.id, request);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const current = await api.remoteJob(queued.id);
      setAvatarJob(current);
      if (["completed", "failed", "cancelled", "refunded"].includes(current.status)) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
    throw new Error("The avatar generation is still running. Check the generation history for its result.");
  };

  const generateAvatar = async () => {
    if (!prompt.trim() || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage(null);
    try {
      const inputs: RemoteGenerationInput[] = [];
      if (referenceImage) inputs.push((await api.uploadRemoteGenerationAvatarSource(referenceImage, "reference-image")).input);
      const job = await submitAvatarRequest({ ...avatarRequest, inputs });
      if (job.status !== "completed") throw new Error(job.errorMessage || "The avatar worker could not complete this model.");
      await applyAvatarArtifacts(job);
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "Avatar generation failed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const loadModelFile = async (file: File, manifestFile?: File, label = file.name, source = "Saved avatar asset") => {
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    modelObjectUrlRef.current = url;
    let manifest: DanceModelManifest | undefined;
    if (manifestFile) {
      const parsed = parseDanceModelManifest(JSON.parse(await manifestFile.text()));
      manifest = { ...parsed.manifest, modelFile: url };
      setProfile(parsed.manifest.canonicalProfile ?? null);
      setOriginalProfile(parsed.manifest.canonicalProfile ?? null);
    }
    setModelFile(file);
    setModel({ id: `asset-avatar-${file.name}`, label, url, clipNames: { idle: "Idle" }, source, manifest });
    setAvatarMessage(manifest ? "Avatar loaded with its canonical rig." : "This avatar is missing its canonical manifest, so rig adjustment is unavailable.");
  };

  const reskin = async () => {
    if (!profile || !model || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage("Preparing canonical reskin...");
    try {
      const mesh = modelFile ?? await fileFromUrl(model.url, "avatar.glb", "model/gltf-binary");
      const manifestValue = { ...(model.manifest ?? {}), schemaVersion: 1, modelId: model.manifest?.modelId ?? model.id, label: model.manifest?.label ?? model.label, skeletonId: "humanoid-v1", modelFile: mesh.name, bones: model.manifest?.bones ?? {}, requiredBones: model.manifest?.requiredBones ?? [], canonicalProfile: profile };
      const manifestFile = new File([JSON.stringify(manifestValue)], "canonical-profile.json", { type: "application/json" });
      const meshInput = (await api.uploadRemoteGenerationAvatarSource(mesh, "mesh")).input;
      const manifestInput = (await api.uploadRemoteGenerationAvatarSource(manifestFile, "manifest")).input;
      const job = await submitAvatarRequest({
        ...avatarRequest,
        inputs: [meshInput, manifestInput],
        metadata: { title: `${model.label} reskin` },
        parameters: { task_type: "avatar_reskin", quality: "runtime", max_attempts: 2 },
      });
      if (job.status !== "completed") throw new Error(job.errorMessage || "The avatar reskin could not complete.");
      await applyAvatarArtifacts(job);
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "Avatar reskin failed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const addCaptureToTrack = () => {
    if (!captureClip) return;
    const offset = segments.reduce((end, segment) => Math.max(end, segment.offsetSeconds + segment.trimEndSeconds - segment.trimStartSeconds), 0);
    const next = createCompositionSegment(captureClip, captureJob?.originalFileName ?? "Captured dance", captureJob?.id, offset);
    setSegments((current) => [...current, next]);
    setSelectedSegmentId(next.id);
    setMotionEnabled(true);
    setCompositionMessage("Capture added to the motion track.");
  };

  const compositionForId = (id: string): DanceMotionComposition | null => {
    const workspaceItem = workspaceItems.find((item) => item.id === id);
    if (workspaceItem) return compositionFromItem(workspaceItem);
    const publicItem = publicItems.find((item) => item.id === id);
    return publicItem ? compositionFromItem(publicItem) : null;
  };

  const addLibraryDanceToTrack = () => {
    const source = compositionForId(trackAssetId);
    if (!source?.segments.length) return;
    const offset = segments.reduce((end, segment) => Math.max(end, segment.offsetSeconds + segment.trimEndSeconds - segment.trimStartSeconds), 0);
    const sourceStart = Math.min(...source.segments.map((segment) => segment.offsetSeconds));
    const additions = source.segments.map((segment) => ({
      ...segment,
      id: `motion-segment-${crypto.randomUUID()}`,
      offsetSeconds: offset + Math.max(0, segment.offsetSeconds - sourceStart),
    }));
    setSegments((current) => [...current, ...additions]);
    setSelectedSegmentId(additions[0]?.id ?? null);
    setMotionEnabled(true);
    setCompositionMessage("Saved dance appended to the motion track.");
  };

  const updateSelectedSegment = (change: Partial<Pick<DanceMotionCompositionSegment, "offsetSeconds" | "trimStartSeconds" | "trimEndSeconds">>) => {
    if (!selectedSegmentId) return;
    setSegments((current) => current.map((segment) => segment.id === selectedSegmentId ? { ...segment, ...change } : segment));
  };

  const saveComposition = async () => {
    if (!segments.length) {
      setCompositionMessage("Add at least one captured dance before saving.");
      return;
    }
    const now = new Date().toISOString();
    const item: BrowserWorkspaceItem = {
      id: savedItem?.id ?? `private-dance-motion-${crypto.randomUUID()}`,
      title: composed.title,
      kind: "dance_motion",
      source: "private",
      createdAt: savedItem?.createdAt ?? now,
      updatedAt: now,
      metadata: { storage: "browser", sourceTool: "dance-creation", composition: composed },
    };
    await saveWorkspaceItem(item);
    setSavedItem(item);
    setCompositionMessage("Dance motion saved to Private Assets.");
    onWorkspaceChanged?.();
  };

  const publishComposition = async () => {
    if (!savedItem || !onPublishAsset) {
      setCompositionMessage("Save the dance motion once before publishing it.");
      return;
    }
    try {
      await onPublishAsset(savedItem);
      setCompositionMessage("Dance motion published to the public library.");
    } catch (error: unknown) {
      setCompositionMessage(error instanceof Error ? error.message : "The dance motion could not be published.");
    }
  };

  const preview = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
    } else {
      audio.currentTime = 0;
      void audio.play().then(() => setPreviewPlaying(true)).catch(() => setCompositionMessage("Preview audio could not be started."));
    }
  };

  const loadWorkspaceAvatar = async (item: BrowserWorkspaceItem) => {
    const mesh = inputFromWorkspace(item, "mesh");
    const manifest = inputFromWorkspace(item, "manifest");
    const meshFile = mesh.file ?? (mesh.url ? await fileFromUrl(mesh.url, `${item.title}.glb`, "model/gltf-binary") : null);
    if (!meshFile) {
      setAvatarMessage("This avatar asset is missing its model file.");
      return;
    }
    const manifestFile = manifest.file ?? (manifest.url ? await fileFromUrl(manifest.url, "manifest.json", "application/json") : undefined);
    await loadModelFile(meshFile, manifestFile, item.title, "Private avatar asset");
  };

  const loadPublicAvatar = async (item: LibraryItem) => {
    const mesh = inputFromLibrary(item, "mesh");
    const manifest = inputFromLibrary(item, "manifest");
    if (!mesh.url || mesh.url.endsWith("/")) {
      setAvatarMessage("This avatar asset is missing its model file.");
      return;
    }
    const meshFile = await fileFromUrl(mesh.url, `${item.title}.glb`, "model/gltf-binary");
    const manifestFile = manifest.url && !manifest.url.endsWith("/")
      ? await fileFromUrl(manifest.url, "manifest.json", "application/json")
      : undefined;
    await loadModelFile(meshFile, manifestFile, item.title, "Public avatar asset");
  };

  const motionItems = workspaceItems.filter((item) => item.kind === "dance_motion");
  const publicMotionItems = publicItems.filter((item) => item.kind === "dance_motion");
  const avatarOptions = [
    ...workspaceItems.filter((item) => item.kind === "avatar").map((item) => ({ id: `private:${item.id}`, label: `Private · ${item.title}`, source: "private" as const, item })),
    ...publicItems.filter((item) => item.kind === "avatar").map((item) => ({ id: `public:${item.id}`, label: `Public · ${item.title}`, source: "public" as const, item })),
  ];
  const options = DEFAULT_OPTIONS;
  const sourceVideo = captureJob?.artifacts.find((artifact) => artifact.kind === "source-video");
  const currencyLabel = paymentCurrency === "FACELESS" ? "$FACELESS" : "SOL";
  const currentPricing = pricing?.currency === paymentCurrency ? pricing : null;
  const holderBaseOnlyFree = holderFreeAvailable && (!currentPricing || currentPricing.priceUsd === 0);
  const costLabel = holderBaseOnlyFree
    ? "Free for holders · signature required"
    : currentPricing
      ? `${formatPaymentToken(currentPricing.amountAtomic, currentPricing.tokenDecimals)} ${currencyLabel}`
      : pricingConfig
        ? "Checking price..."
        : "Price unavailable";
  const walletBalanceLabel = !session.authenticated
    ? "Connect wallet"
    : walletBalance
      ? `${formatPaymentToken(walletBalance.amountAtomic, walletBalance.tokenDecimals)} ${currencyLabel}`
      : walletBalanceLoading
        ? "Checking..."
        : "Unavailable";

  return (
    <div className="dance-creation-workspace">
      <header className="dance-creation-header">
        <div><p className="home-v2-kicker">Dance Creation</p><h2>Build a dance asset from avatars and captured motion</h2><p>Generate or load a humanoid, preview a motion clip, then assemble captures into a reusable private dance asset.</p></div>
        <span className="dance-creation-badge"><Sparkles size={14} aria-hidden="true" /> Canonical motion</span>
      </header>

      <section className="dance-creation-upper-grid">
        <div className="dance-creation-card dance-creation-avatar-form">
          <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><WandSparkles size={14} aria-hidden="true" /> Avatar generation</span><h3>Create a dancer</h3></div><span className="dance-creation-step">01</span></div>
          <label className="dance-creation-field"><span>Character description</span><textarea value={prompt} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder="A purple horse wearing a baseball cap" rows={3} /></label>
          <label className="dance-creation-file rhythm-beats-secondary-button"><Upload size={15} aria-hidden="true" /><span>{referenceImage ? referenceImage.name : "Optional reference image"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setReferenceImage(event.currentTarget.files?.[0] ?? null)} /></label>
          <div className="dance-creation-payment" aria-label="Avatar generation payment">
            <div className="dance-creation-payment-heading">
              <span>Wallet balance</span>
              <strong>{walletBalanceLabel}</strong>
              <button type="button" className="dance-station-cost-estimator__refresh" aria-label="Refresh wallet balance" title="Refresh wallet balance" disabled={!session.authenticated || !pricingConfig || walletBalanceLoading} onClick={() => setWalletBalanceRefreshKey((value) => value + 1)}>
                <RefreshCw aria-hidden="true" size={14} className={walletBalanceLoading ? "is-spinning" : ""} />
              </button>
            </div>
            <div className="dance-station-payment-currency" role="radiogroup" aria-label={holderBaseOnlyFree ? "Holder payment benefit" : "Payment currency"}>
              {holderBaseOnlyFree ? <label className="is-active"><input type="radio" checked readOnly disabled={avatarBusy} /><span>Free for holders</span></label> : (["FACELESS", "SOL"] as const).map((currency) => (
                <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}>
                  <input type="radio" name="avatar-payment-currency" value={currency} checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} disabled={avatarBusy} />
                  <span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span>
                </label>
              ))}
            </div>
            <div className="dance-creation-price-row"><span>Avatar generation</span><strong>{costLabel}</strong></div>
          </div>
          <button type="button" className="rhythm-beats-submit" disabled={avatarBusy || !prompt.trim() || !currentPricing} onClick={() => void generateAvatar()}>{avatarBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Working</> : <><WandSparkles size={15} aria-hidden="true" /> Generate avatar</>}</button>
          {pricingError ? <p className="dance-creation-status dance-creation-status--error" role="status">{pricingError}</p> : null}
          {avatarMessage ? <p className="dance-creation-status" role="status">{avatarMessage}</p> : null}
          {avatarJob ? <small className="dance-creation-job">{avatarJob.status} · {avatarJob.id.slice(0, 8)}</small> : null}
        </div>

        <div className="dance-creation-card dance-creation-model-card">
          <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><RotateCcw size={14} aria-hidden="true" /> Avatar and rig</span><h3>{model?.label ?? "No avatar selected"}</h3></div><span className="dance-creation-step">02</span></div>
          <label className="dance-creation-field"><span>Dance avatar</span><select value={selectedAvatarId} onChange={(event) => { const value = event.currentTarget.value; setSelectedAvatarId(value); const option = avatarOptions.find((candidate) => candidate.id === value); if (!option) return; if (option.source === "private") void loadWorkspaceAvatar(option.item); else void loadPublicAvatar(option.item); }}><option value="">Choose an avatar asset</option>{avatarOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
          {profile && model ? <><RigAdjustmentPanel model={model} profile={profile} originalProfile={originalProfile} onProfileChange={setProfile} onLoadProfile={(next) => { setProfile(next); setOriginalProfile(next); }} /><button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary dance-creation-reskin" disabled={avatarBusy || !currentPricing} onClick={() => void reskin()}><RefreshCw size={15} aria-hidden="true" /> Reskin with adjusted rig</button></> : <p className="dance-creation-empty">Generate or load an avatar model and its canonical manifest to adjust the rig.</p>}
        </div>

          <div className="dance-creation-card dance-creation-preview-card">
            <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><Play size={14} aria-hidden="true" /> Preview</span><h3>Model performance</h3></div><span className="dance-creation-step">03</span></div>
          <label className="dance-creation-field dance-creation-preview-select"><span>Preview a saved dance</span><select value={loadedCompositionId} onChange={(event) => setLoadedCompositionId(event.currentTarget.value)}><option value="">Current motion track</option>{motionItems.map((item) => <option value={item.id} key={item.id}>Private · {item.title}</option>)}{publicMotionItems.map((item) => <option value={item.id} key={item.id}>Public · {item.title}</option>)}</select></label>
          {sourceVideo ? <audio ref={audioRef} src={sourceVideo.url} onEnded={() => setPreviewPlaying(false)} /> : <audio ref={audioRef} onEnded={() => setPreviewPlaying(false)} />}
          {model ? <DanceEngineCanvas audioRef={audioRef} beats={[]} bpm={120} model={model} options={options} capturedMotion={composedClip} capturedMotionEnabled={motionEnabled && Boolean(composedClip)} onSnapshot={setSnapshot} onError={setAvatarMessage} /> : <div className="dance-creation-preview-empty"><Upload size={22} aria-hidden="true" /><strong>Avatar preview</strong><span>Generate an avatar or load a model to begin.</span></div>}
          <div className="dance-creation-preview-actions"><button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary" disabled={!model || !composedClip} onClick={preview}>{previewPlaying ? "Pause preview" : "Play preview"}</button><span>{snapshot ? `${snapshot.rigCoverage * 100 | 0}% rig · ${snapshot.fps.toFixed(0)} fps` : "Waiting for an avatar model"}</span></div>
        </div>
      </section>

      <section className="dance-creation-lower-grid">
        <div className="dance-creation-card dance-creation-capture-card"><div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><FileVideo size={14} aria-hidden="true" /> Pose extraction</span><h3>Capture a dance video</h3></div><span className="dance-creation-step">04</span></div><DanceMotionCapturePanel motionApplied={motionEnabled} onMotionClip={setCaptureClip} onApplyMotion={() => { if (captureClip) setMotionEnabled(true); }} onUseProcedural={() => setMotionEnabled(false)} onJob={setCaptureJob} /><button type="button" className="rhythm-beats-secondary-button dance-creation-add-capture" disabled={!captureClip} onClick={addCaptureToTrack}><Plus size={15} aria-hidden="true" /> Add current capture to track</button></div>
        <div className="dance-creation-card dance-creation-track-card"><div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><AudioLines size={14} aria-hidden="true" /> Motion composition</span><h3>Assemble the full dance</h3></div><span className="dance-creation-step">05</span></div><p className="dance-creation-help">Add captures, set their order and timing, then preview the combined wireframe or avatar movement.</p><div className="dance-creation-track">{segments.length ? segments.map((segment, index) => <button type="button" key={segment.id} className={`dance-creation-track-segment${selectedSegmentId === segment.id ? " is-selected" : ""}`} style={{ left: `${Math.max(0, segment.offsetSeconds) * 30}px`, width: `${Math.max(72, (segment.trimEndSeconds - segment.trimStartSeconds) * 30)}px` }} title={`${segment.title} · ${(segment.trimEndSeconds - segment.trimStartSeconds).toFixed(2)} seconds`} onClick={() => setSelectedSegmentId(segment.id)}><strong>{index + 1}</strong><span>{segment.title}</span></button>) : <span className="dance-creation-track-empty">Your motion clips will appear here.</span>}</div>{selectedSegment ? <div className="dance-creation-segment-controls"><label><span>Start</span><input type="number" min="0" step="0.01" value={selectedSegment.offsetSeconds} onInput={(event) => updateSelectedSegment({ offsetSeconds: Number(event.currentTarget.value) })} /></label><label><span>Trim in</span><input type="number" min="0" step="0.01" value={selectedSegment.trimStartSeconds} onInput={(event) => updateSelectedSegment({ trimStartSeconds: Number(event.currentTarget.value) })} /></label><label><span>Trim out</span><input type="number" min={selectedSegment.trimStartSeconds + 0.01} step="0.01" value={selectedSegment.trimEndSeconds} onInput={(event) => updateSelectedSegment({ trimEndSeconds: Number(event.currentTarget.value) })} /></label><button type="button" className="icon-button" title="Remove selected capture" aria-label="Remove selected capture" onClick={() => { setSegments((current) => current.filter((segment) => segment.id !== selectedSegment.id)); setSelectedSegmentId(null); }}><Trash2 size={15} aria-hidden="true" /></button></div> : null}<div className="dance-creation-track-library"><select value={trackAssetId} onChange={(event) => setTrackAssetId(event.currentTarget.value)}><option value="">Append a saved dance asset</option>{motionItems.map((item) => <option value={item.id} key={item.id}>Private · {item.title}</option>)}{publicMotionItems.map((item) => <option value={item.id} key={item.id}>Public · {item.title}</option>)}</select><button type="button" className="rhythm-beats-secondary-button" disabled={!trackAssetId} onClick={addLibraryDanceToTrack}><Plus size={15} aria-hidden="true" /> Add to track</button></div><div className="dance-creation-track-footer"><label className="dance-creation-title-field"><span>Asset name</span><input value={compositionTitle} onInput={(event) => setCompositionTitle(event.currentTarget.value)} /></label><span>{segments.length} clips · {composed.durationSeconds.toFixed(2)} seconds</span><button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary" disabled={!segments.length} onClick={() => void saveComposition()}><Save size={15} aria-hidden="true" /> Save private</button><button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--publish" disabled={!savedItem} onClick={() => void publishComposition()}><CheckCircle2 size={15} aria-hidden="true" /> Publish</button></div>{compositionMessage ? <p className="dance-creation-status" role="status">{compositionMessage}</p> : null}</div>
      </section>
    </div>
  );
}
