import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AudioLines, CheckCircle2, Database, FileVideo, LoaderCircle, Play, RefreshCw, RotateCcw, Save, Sparkles, Upload, WandSparkles } from "lucide-preact";
import type { DanceMotionClip, DanceMotionComposition, DanceMotionCompositionSegment, DanceMotionJob } from "@faceless/shared";
import { api, type LibraryItem, type RemoteGenerationInput, type RemoteGenerationRequest, type RemoteJob, type RemotePaymentCurrency, type RemotePricingConfig, type RemotePricingQuote } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import type { BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import { createRemoteAvatarWorkspaceItem, getWorkspaceSetting, normalizeRemoteAvatarMetadata, saveWorkspaceItem, setWorkspaceSetting } from "../../lib/danceStationWorkspace";
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
import { DanceMotionCompositionTrack } from "./DanceMotionCompositionTrack";

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

function remoteArtifactUrl(artifact: RemoteJob["artifacts"][number]): string {
  return `/api/remote-generation/assets/file?path=${encodeURIComponent(artifact.objectPath)}`;
}

function isModelArtifact(artifact: RemoteJob["artifacts"][number]): boolean {
  if (artifact.mimeType.toLowerCase().startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(artifact.objectPath)) return false;
  return artifact.mimeType === "model/gltf-binary" || artifact.mimeType === "model/gltf+json" || /\.glb$|\.gltf$/i.test(artifact.objectPath) || artifact.variant === "avatar-output";
}

function isManifestArtifact(artifact: RemoteJob["artifacts"][number]): boolean {
  return /(?:^|\/)manifest\.json$/i.test(artifact.objectPath) || (artifact.mimeType.toLowerCase().includes("json") && !/\.(png|jpe?g|webp|gif)$/i.test(artifact.objectPath));
}

function artifactFileName(objectPath: string): string {
  return objectPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function remoteArtifactProxyUrl(objectPath: string): string {
  return `/api/remote-generation/assets/file?path=${encodeURIComponent(objectPath)}`;
}

function avatarModelArtifact(job: RemoteJob): RemoteJob["artifacts"][number] | null {
  const finalizedAvatar = job.artifacts.find((artifact) => artifactFileName(artifact.objectPath) === "avatar.glb" && isModelArtifact(artifact));
  if (finalizedAvatar) return finalizedAvatar;
  const explicitModel = job.artifacts.find((artifact) => artifact.mimeType === "model/gltf-binary" || artifact.mimeType === "model/gltf+json" || /\.glb$|\.gltf$/i.test(artifact.objectPath));
  return explicitModel ?? job.artifacts.find(isModelArtifact) ?? null;
}

function avatarManifestArtifact(job: RemoteJob): RemoteJob["artifacts"][number] | null {
  const canonicalManifest = job.artifacts.find((artifact) => /(?:^|\/)manifest\.json$/i.test(artifact.objectPath));
  return canonicalManifest ?? job.artifacts.find(isManifestArtifact) ?? null;
}

function avatarReskinSourceArtifact(job: RemoteJob): RemoteJob["artifacts"][number] | null {
  return job.artifacts.find((artifact) => artifactFileName(artifact.objectPath) === "source-mesh.glb" && isModelArtifact(artifact)) ?? null;
}

const avatarTerminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired", "refunded"]);
const pendingAvatarTitlesSetting = "dance-creation.pending-avatar-titles";
const genericAvatarTitles = new Set(["generated avatar", "generated asset", "avatar generation"]);

type PendingAvatarTitles = Record<string, string>;

async function rememberPendingAvatarTitle(jobId: string, title: string): Promise<void> {
  const current = await getWorkspaceSetting<PendingAvatarTitles>(pendingAvatarTitlesSetting) ?? {};
  await setWorkspaceSetting(pendingAvatarTitlesSetting, { ...current, [jobId]: title });
}

async function consumePendingAvatarTitle(jobId: string): Promise<string | null> {
  const current = await getWorkspaceSetting<PendingAvatarTitles>(pendingAvatarTitlesSetting) ?? {};
  const title = current[jobId] ?? null;
  if (!title) return null;
  const { [jobId]: _consumed, ...remaining } = current;
  await setWorkspaceSetting(pendingAvatarTitlesSetting, remaining);
  return title;
}

function inputFromWorkspace(item: BrowserWorkspaceItem, role: "mesh" | "manifest" | "reference-image"): { file: File | null; url: string; role: "mesh" | "manifest" | "reference-image" } {
  const metadata = item.metadata;
  const files = Array.isArray(metadata.files) ? metadata.files.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const wantedRole = role === "mesh" ? ["model", "metadata"] : role === "manifest" ? ["rig_manifest", "metadata"] : ["cover", "preview"];
  const record = files.find((file) => wantedRole.includes(String(file.role))) ?? files[0];
  const blob = record?.blob instanceof Blob ? record.blob : metadata.blob instanceof Blob ? metadata.blob : null;
  const publicUrl = typeof record?.publicUrl === "string" ? record.publicUrl : typeof metadata.publicUrl === "string" ? metadata.publicUrl : "";
  const fileName = typeof record?.fileName === "string" ? record.fileName : typeof metadata.fileName === "string" ? metadata.fileName : `${item.title}.${role === "mesh" ? "glb" : role === "manifest" ? "json" : "png"}`;
  const mimeType = typeof record?.mimeType === "string" ? record.mimeType : typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
  return { file: blob ? new File([blob], fileName, { type: mimeType }) : null, url: publicUrl, role };
}

function meaningfulAvatarTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const title = value.trim();
  return title && !genericAvatarTitles.has(title.toLowerCase()) ? title : "";
}

function avatarTitleFromItem(item: BrowserWorkspaceItem): string {
  return meaningfulAvatarTitle(item.metadata.avatarTitle) || meaningfulAvatarTitle(item.title);
}

function workspaceFileRecords(item: BrowserWorkspaceItem): Array<Record<string, unknown>> {
  return Array.isArray(item.metadata.files)
    ? item.metadata.files.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
    : [];
}

async function repairLegacyRemoteAvatarItem(item: BrowserWorkspaceItem): Promise<BrowserWorkspaceItem | null> {
  if (item.metadata.sourceTool !== "avatar-generation") return null;
  const remoteJobId = typeof item.metadata.remoteJobId === "string" ? item.metadata.remoteJobId.trim() : "";
  if (!remoteJobId) return null;
  const files = workspaceFileRecords(item);
  const modelRecord = files.find((file) => file.role === "model");
  const modelPath = typeof modelRecord?.objectPath === "string"
    ? modelRecord.objectPath
    : typeof modelRecord?.fileName === "string" ? modelRecord.fileName : "";
  const manifestRecord = files.find((file) => file.role === "rig_manifest");
  const sourceRecord = files.find((file) => file.role === "reskin_source");
  const sourceUrl = typeof sourceRecord?.publicUrl === "string" ? sourceRecord.publicUrl : "";
  const sourceUsesSiteProxy = sourceUrl.startsWith("/api/remote-generation/assets/file?");
  const needsRepair = artifactFileName(modelPath) !== "avatar.glb"
    || item.metadata.avatarActiveConfigVersion !== 2
    || !manifestRecord
    || (!!sourceRecord && !sourceUsesSiteProxy)
    || !avatarTitleFromItem(item);
  if (!needsRepair) return null;

  const job = await api.remoteJob(remoteJobId);
  const recoveredDescription = meaningfulAvatarTitle(job.request.parameters?.description);
  const recoveredTitle = avatarTitleFromItem(item)
    || meaningfulAvatarTitle(job.request.metadata?.title)
    || recoveredDescription
    || "Generated avatar";
  const modelArtifact = avatarModelArtifact(job);
  if (!modelArtifact || artifactFileName(modelArtifact.objectPath) !== "avatar.glb") {
    throw new Error("This avatar asset only has an intermediate mesh; its finalized rigged model is not available.");
  }
  const modelUrl = remoteArtifactUrl(modelArtifact);
  const manifestArtifact = avatarManifestArtifact(job);
  if (!manifestArtifact) throw new Error("This avatar asset is missing the finalized rig manifest.");
  // A saved adjustment is the active manifest for this private asset. Keep it
  // when repairing older records instead of replacing it with the worker's
  // original manifest from the remote job.
  let manifestBlob = manifestRecord?.blob instanceof Blob ? manifestRecord.blob : null;
  if (!manifestBlob) {
    const manifestResponse = await fetch(remoteArtifactUrl(manifestArtifact), { credentials: "include" });
    if (!manifestResponse.ok) throw new Error("The finalized avatar rig manifest could not be loaded.");
    manifestBlob = await manifestResponse.blob();
  }
  const sourceArtifact = avatarReskinSourceArtifact(job);
  const previousSource = files.find((file) => file.role === "reskin_source");
  const finalizedModelRecord = {
    role: "model",
    fileName: "avatar.glb",
    objectPath: modelArtifact.objectPath,
    publicUrl: modelUrl,
    sourcePublicUrl: modelArtifact.publicUrl,
    mimeType: modelArtifact.mimeType,
    sizeBytes: modelArtifact.sizeBytes,
    sha256: modelArtifact.sha256,
  };
  const finalizedManifestRecord = {
    ...(manifestRecord ? Object.fromEntries(Object.entries(manifestRecord).filter(([key]) => key !== "blob")) : {}),
    role: "rig_manifest",
    fileName: "manifest.json",
    objectPath: manifestArtifact.objectPath,
    publicUrl: remoteArtifactUrl(manifestArtifact),
    sourcePublicUrl: manifestArtifact.publicUrl,
    mimeType: manifestArtifact.mimeType,
    sizeBytes: manifestArtifact.sizeBytes,
    sha256: manifestArtifact.sha256,
    blob: manifestBlob,
  };
  const reskinSource = sourceArtifact ? {
    role: "reskin_source",
    fileName: "source-mesh.glb",
    objectPath: sourceArtifact.objectPath,
    publicUrl: remoteArtifactProxyUrl(sourceArtifact.objectPath),
    sourcePublicUrl: sourceArtifact.publicUrl,
    mimeType: sourceArtifact.mimeType,
    sizeBytes: sourceArtifact.sizeBytes,
    sha256: sourceArtifact.sha256,
  } : previousSource;
  const nextFiles = [
    finalizedModelRecord,
    finalizedManifestRecord,
    ...(reskinSource ? [reskinSource] : []),
    ...files.filter((file) => !["model", "rig_manifest", "reskin_source"].includes(String(file.role))),
  ];
  const repairedItem: BrowserWorkspaceItem = {
    ...item,
    title: recoveredTitle,
    updatedAt: new Date().toISOString(),
    metadata: {
      ...normalizeRemoteAvatarMetadata(item.metadata, nextFiles),
      avatarTitle: recoveredTitle,
      remoteJobId,
    },
  };
  await saveWorkspaceItem(repairedItem);
  return repairedItem;
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
  const contentType = response.headers.get("content-type") || "unknown content type";
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Could not load avatar manifest (${response.status}, ${contentType}).`);
  }
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    console.error("[dance-creation] avatar manifest was not valid JSON", {
      url,
      status: response.status,
      contentType,
      preview: body.slice(0, 160),
      error,
    });
    throw new Error(`The avatar worker returned an invalid manifest (${contentType}).`);
  }
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
  const avatarWorkspaceItemRef = useRef<BrowserWorkspaceItem | null>(null);
  const [avatarTitle, setAvatarTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [model, setModel] = useState<DanceModelPreset | null>(null);
  const [originalOrientationYawRadians, setOriginalOrientationYawRadians] = useState(0);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [profile, setProfile] = useState<CanonicalRigProfile | null>(null);
  const [originalProfile, setOriginalProfile] = useState<CanonicalRigProfile | null>(null);
  const [avatarJob, setAvatarJob] = useState<RemoteJob | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [reskinMessage, setReskinMessage] = useState<string | null>(null);
  const restoredAvatarJobRef = useRef<string | null>(null);
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
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureSaveBusy, setCaptureSaveBusy] = useState(false);
  const [segments, setSegments] = useState<DanceMotionCompositionSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [compositionTitle, setCompositionTitle] = useState("My Dance Motion");
  const [savedItem, setSavedItem] = useState<BrowserWorkspaceItem | null>(null);
  const [compositionMessage, setCompositionMessage] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [snapshot, setSnapshot] = useState<DanceRuntimeSnapshot | null>(null);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [previewCompositionId, setPreviewCompositionId] = useState("");
  const [assemblyOpenId, setAssemblyOpenId] = useState("");
  const [trackAssetId, setTrackAssetId] = useState("");
  const [cursorSeconds, setCursorSeconds] = useState(0);

  const avatarRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "avatar",
    modelRevision: "avatar-runtime-v1",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: avatarTitle.trim() || "Avatar generation" },
    parameters: { task_type: "avatar", description: prompt.trim(), quality: "runtime", max_attempts: 2 },
  }), [avatarTitle, paymentCurrency, prompt]);

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
    createdAt: savedItem?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [compositionTitle, savedItem, segments]);
  const composedClip = useMemo(() => composeDanceMotion(composed), [composed]);
  const previewComposition = useMemo(() => {
    if (!previewCompositionId) return null;
    const item = workspaceItems.find((candidate) => candidate.kind === "dance_motion" && candidate.id === previewCompositionId);
    const publicItem = publicItems.find((candidate) => candidate.kind === "dance_motion" && candidate.id === previewCompositionId);
    return item ? compositionFromItem(item) : publicItem ? compositionFromItem(publicItem) : null;
  }, [previewCompositionId, publicItems, workspaceItems]);
  const previewCompositionClip = useMemo(() => previewComposition ? composeDanceMotion(previewComposition) : null, [previewComposition]);
  const previewClip = previewCompositionClip ?? composedClip ?? captureClip;
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? null;

  useEffect(() => () => {
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
  }, []);

  const applyAvatarArtifacts = useCallback(async (job: RemoteJob, orientationOverride?: number, replacementItem?: BrowserWorkspaceItem | null, titleOverride?: string, profileOverride?: CanonicalRigProfile): Promise<void> => {
    const modelArtifact = avatarModelArtifact(job);
    const manifestArtifact = avatarManifestArtifact(job);
    const modelUrl = modelArtifact ? remoteArtifactUrl(modelArtifact) : null;
    const manifestUrl = manifestArtifact ? remoteArtifactUrl(manifestArtifact) : null;
    if (!modelArtifact || !modelUrl) throw new Error("The avatar worker finished without returning a GLB model.");
    const title = avatarTitleFromItem(replacementItem ?? { title: "", metadata: {}, id: "", kind: "avatar", source: "private", createdAt: "", updatedAt: "" }) || meaningfulAvatarTitle(titleOverride) || meaningfulAvatarTitle(job.request.metadata?.title) || "Generated avatar";
    let manifest: DanceModelManifest | undefined;
    if (manifestUrl) {
      const parsed = parseDanceModelManifest(await fetchJson<unknown>(manifestUrl));
      const yawRadians = orientationOverride ?? parsed.manifest.orientation?.yawRadians ?? 0;
      const activeProfile = profileOverride ?? parsed.manifest.canonicalProfile;
      manifest = { ...parsed.manifest, modelFile: modelUrl, orientation: { yawRadians }, canonicalProfile: activeProfile };
      setOriginalOrientationYawRadians(yawRadians);
      setProfile(activeProfile ?? null);
      setOriginalProfile(activeProfile ?? null);
      setAvatarMessage(parsed.warnings.length ? `Avatar ready with ${parsed.warnings.length} rig warning${parsed.warnings.length === 1 ? "" : "s"}.` : "Avatar model and rig are ready.");
    } else {
      setOriginalOrientationYawRadians(0);
      setProfile(null);
      setOriginalProfile(null);
      setAvatarMessage("Avatar model is ready. Load its canonical manifest to adjust the rig.");
    }
    const workspaceItem = createRemoteAvatarWorkspaceItem({
      jobId: job.id,
      title,
      model: modelArtifact,
      reskinSource: avatarReskinSourceArtifact(job) ?? undefined,
      manifest: manifestArtifact ?? undefined,
      manifestOverride: orientationOverride === undefined || !manifest ? undefined : { ...manifest, modelFile: "avatar.glb" },
      modelUrl,
      manifestUrl: manifestArtifact && manifestUrl ? manifestUrl : undefined,
      createdAt: job.createdAt,
      updatedAt: new Date().toISOString(),
      replaceItem: replacementItem ?? undefined,
    });
    await saveWorkspaceItem(workspaceItem);
    avatarWorkspaceItemRef.current = workspaceItem;
    onWorkspaceChanged?.();
    setSelectedAvatarId(`private:${workspaceItem.id}`);
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
    modelObjectUrlRef.current = null;
    setModelFile(null);
    setModel({ id: workspaceItem.id, label: title, url: modelUrl, clipNames: { idle: "Idle" }, source: "Remote avatar worker", manifest });
    setAvatarJob(job);
    setAvatarMessage(manifest ? "Avatar model and rig are ready. Saved to Private Assets." : "Avatar model is ready and saved to Private Assets.");
  }, [onWorkspaceChanged]);

  useEffect(() => {
    if (!session.authenticated || restoredAvatarJobRef.current) return undefined;
    let cancelled = false;
    void api.remoteJobs({ limit: 20, runtime: "avatar" })
      .then(async ({ jobs }) => {
        if (cancelled) return;
        const alreadySaved = new Set(workspaceItems
          .map((item) => typeof item.metadata.remoteJobId === "string" ? item.metadata.remoteJobId : "")
          .filter(Boolean));
        const latestSucceeded = jobs.find((job) => job.status === "succeeded" && !alreadySaved.has(job.id));
        if (!latestSucceeded || cancelled) return;
        restoredAvatarJobRef.current = latestSucceeded.id;
        const pendingTitle = await consumePendingAvatarTitle(latestSucceeded.id);
        await applyAvatarArtifacts(latestSucceeded, undefined, undefined, pendingTitle ?? undefined);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAvatarMessage(error instanceof Error ? error.message : "The completed avatar could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [session.authenticated]);

  const submitAvatarRequest = async (request: RemoteGenerationRequest, onQueued?: (jobId: string) => Promise<void>): Promise<RemoteJob> => {
    if (!session.authenticated) throw new Error("Connect and verify your wallet before generating an avatar.");
    const intent = await api.createRemotePaymentIntent(request);
    const signature = intent.paymentMode === "free-signature"
      ? intent.paymentMessage ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage }) : (() => { throw new Error("The launch server did not provide the wallet authorization message."); })()
      : intent.currency === "SOL"
        ? await sendRemoteGenerationSolPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference })
        : await sendRemoteGenerationPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, tokenMint: intent.tokenMint, tokenDecimals: intent.tokenDecimals, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference });
    const paid = await api.verifyRemotePayment(intent.id, signature);
    const queued = await api.createRemoteJob(paid.id, request);
    await onQueued?.(queued.id);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const current = await api.remoteJob(queued.id);
      setAvatarJob(current);
      if (avatarTerminalStatuses.has(current.status)) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
    throw new Error("The avatar generation is still running. Check the generation history for its result.");
  };

  const generateAvatar = async () => {
    const title = avatarTitle.trim();
    const description = prompt.trim();
    if (!title || !description || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage(null);
    let queuedJobId = "";
    try {
      const inputs: RemoteGenerationInput[] = [];
      if (referenceImage) inputs.push((await api.uploadRemoteGenerationAvatarSource(referenceImage, "reference-image")).input);
      const job = await submitAvatarRequest({ ...avatarRequest, inputs }, async (jobId) => {
        queuedJobId = jobId;
        await rememberPendingAvatarTitle(jobId, title);
      });
      if (job.status !== "succeeded") throw new Error(job.errorMessage || "The avatar worker could not complete this model.");
      await applyAvatarArtifacts(job, undefined, undefined, title);
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "Avatar generation failed.");
    } finally {
      if (queuedJobId) await consumePendingAvatarTitle(queuedJobId).catch(() => undefined);
      setAvatarBusy(false);
    }
  };

  const loadModelFile = async (file: File, manifestFile?: File, label = file.name, source = "Saved avatar asset", modelId = `asset-avatar-${file.name}`) => {
    if (modelObjectUrlRef.current) URL.revokeObjectURL(modelObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    modelObjectUrlRef.current = url;
    let manifest: DanceModelManifest | undefined;
    if (manifestFile) {
      const parsed = parseDanceModelManifest(JSON.parse(await manifestFile.text()));
      manifest = { ...parsed.manifest, modelFile: url };
      setOriginalOrientationYawRadians(parsed.manifest.orientation?.yawRadians ?? 0);
      setProfile(parsed.manifest.canonicalProfile ?? null);
      setOriginalProfile(parsed.manifest.canonicalProfile ?? null);
    } else {
      setOriginalOrientationYawRadians(0);
    }
    setModelFile(file);
    avatarWorkspaceItemRef.current = null;
    setModel({ id: modelId, label, url, clipNames: { idle: "Idle" }, source, manifest });
    setAvatarMessage(manifest ? "Avatar loaded with its canonical rig." : "This avatar is missing its canonical manifest, so rig adjustment is unavailable.");
  };

  const reskin = async () => {
    if (!profile || !model || avatarBusy) return;
    setAvatarBusy(true);
    setReskinMessage("Preparing canonical reskin...");
    try {
      const existingItem = avatarWorkspaceItemRef.current?.id === model.id
        ? avatarWorkspaceItemRef.current
        : workspaceItems.find((item) => item.kind === "avatar" && item.id === model.id) ?? null;
      const sourceRecord = existingItem
        ? workspaceFileRecords(existingItem).find((file) => file.role === "reskin_source")
        : null;
      const sourceObjectPath = typeof sourceRecord?.objectPath === "string" ? sourceRecord.objectPath : "";
      const sourcePublicUrl = typeof sourceRecord?.publicUrl === "string" ? sourceRecord.publicUrl : "";
      const sourceFetchUrl = sourceObjectPath ? remoteArtifactProxyUrl(sourceObjectPath) : sourcePublicUrl;
      const sourceFile = sourceRecord?.blob instanceof Blob
        ? new File([sourceRecord.blob], typeof sourceRecord.fileName === "string" ? sourceRecord.fileName : "source-mesh.glb", { type: typeof sourceRecord.mimeType === "string" ? sourceRecord.mimeType : "model/gltf-binary" })
        : sourceFetchUrl
          ? await fileFromUrl(sourceFetchUrl, typeof sourceRecord?.fileName === "string" ? sourceRecord.fileName : "source-mesh.glb", typeof sourceRecord?.mimeType === "string" ? sourceRecord.mimeType : "model/gltf-binary")
          : null;
      if (!sourceFile) {
        throw new Error("This avatar does not have its original source mesh available for reskinning. Generate a fresh avatar before adjusting and reskinning it.");
      }
      const mesh = sourceFile;
      const orientationYawRadians = model.manifest?.orientation?.yawRadians ?? 0;
      const profileValue = { ...profile, modelFile: mesh.name, orientation: { yawRadians: orientationYawRadians } };
      const manifestFile = new File([JSON.stringify(profileValue)], "canonical-profile.json", { type: "application/json" });
      const meshInput = (await api.uploadRemoteGenerationAvatarSource(mesh, "mesh")).input;
      const manifestInput = {
        ...(await api.uploadRemoteGenerationAvatarSource(manifestFile, "manifest")).input,
        role: "canonical-profile",
      };
      const job = await submitAvatarRequest({
        ...avatarRequest,
        inputs: [meshInput, manifestInput],
        metadata: { title: `${model.label} reskin` },
        parameters: { task_type: "avatar_reskin", quality: "runtime", max_attempts: 2 },
      });
      if (job.status !== "succeeded") throw new Error(job.errorMessage || "The avatar reskin could not complete.");
      await applyAvatarArtifacts(job, orientationYawRadians, existingItem, undefined, profile);
      setReskinMessage("Reskin complete. The updated avatar is selected and saved to Private Assets.");
    } catch (error: unknown) {
      setReskinMessage(error instanceof Error ? error.message : "Avatar reskin failed.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const updateAvatarOrientation = (yawRadians: number) => {
    setModel((current) => current?.manifest
      ? { ...current, manifest: { ...current.manifest, orientation: { yawRadians } } }
      : current);
  };

  const saveAvatarAdjustments = async (nextManifest: DanceModelManifest): Promise<void> => {
    if (!model || !profile) return;
    const existingItem = avatarWorkspaceItemRef.current?.id === model.id
      ? avatarWorkspaceItemRef.current
      : workspaceItems.find((item) => item.kind === "avatar" && item.id === model.id);
    if (!existingItem) throw new Error("Save this avatar from a private asset before adjusting its rig.");
    const files = Array.isArray(existingItem.metadata.files)
      ? existingItem.metadata.files.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"))
      : [];
    const modelRecord = files.find((file) => file.role === "model");
    const modelFileName = typeof modelRecord?.fileName === "string" ? modelRecord.fileName : "avatar.glb";
    const savedManifest = { ...nextManifest, modelFile: modelFileName };
    const manifestBlob = new Blob([JSON.stringify(savedManifest, null, 2)], { type: "application/json" });
    const manifestRecord = {
      ...(files.find((file) => file.role === "rig_manifest") ?? {}),
      role: "rig_manifest",
      fileName: "manifest.json",
      blob: manifestBlob,
      mimeType: "application/json",
      sizeBytes: manifestBlob.size,
    };
    if (!modelRecord) throw new Error("This avatar asset is missing its active model record.");
    const nextFiles = [
      { ...modelRecord, role: "model", fileName: "avatar.glb" },
      manifestRecord,
      ...files.filter((file) => !["model", "rig_manifest"].includes(String(file.role))),
    ];
    const nextItem = {
      ...existingItem,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...normalizeRemoteAvatarMetadata(existingItem.metadata, nextFiles),
        avatarTitle: existingItem.title,
        remoteJobId: typeof existingItem.metadata.remoteJobId === "string" ? existingItem.metadata.remoteJobId : undefined,
      },
    };
    await saveWorkspaceItem(nextItem);
    avatarWorkspaceItemRef.current = nextItem;
    setModel((current) => current?.id === model.id ? { ...current, manifest: savedManifest } : current);
    setOriginalProfile(savedManifest.canonicalProfile ?? profile);
    setOriginalOrientationYawRadians(savedManifest.orientation?.yawRadians ?? 0);
    onWorkspaceChanged?.();
    setAvatarMessage("Avatar rig and facing rotation saved to Private Assets.");
  };

  const handleCaptureClip = (clip: DanceMotionClip | null) => {
    setCaptureClip(clip);
    if (clip && !segments.length) {
      setMotionEnabled(true);
      setCursorSeconds(0);
    }
  };

  const saveCaptureAsset = async () => {
    if (!captureClip) {
      setCompositionMessage("Complete a pose capture before saving it.");
      return;
    }
    const title = captureTitle.trim();
    if (!title) {
      setCompositionMessage("Enter a name for this dance asset.");
      return;
    }
    setCaptureSaveBusy(true);
    try {
      const now = new Date().toISOString();
      const segment = createCompositionSegment(captureClip, title, captureJob?.id, 0);
      const captureComposition: DanceMotionComposition = {
        format: "faceless-dance-composition",
        version: 1,
        title,
        durationSeconds: captureClip.durationSeconds,
        segments: [segment],
        createdAt: now,
        updatedAt: now,
      };
      const item: BrowserWorkspaceItem = {
        id: `private-dance-motion-${crypto.randomUUID()}`,
        title,
        kind: "dance_motion",
        source: "private",
        createdAt: now,
        updatedAt: now,
        metadata: { storage: "browser", sourceTool: "dance-capture", composition: captureComposition },
      };
      await saveWorkspaceItem(item);
      setCaptureTitle(title);
      setCompositionMessage(`${title} saved as a dance asset. It is available in the dance asset list.`);
      onWorkspaceChanged?.();
    } catch (error: unknown) {
      setCompositionMessage(error instanceof Error ? error.message : "The captured dance could not be saved.");
    } finally {
      setCaptureSaveBusy(false);
    }
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

  const openAssembly = (id: string) => {
    setAssemblyOpenId(id);
    setSelectedSegmentId(null);
    setCompositionMessage(null);
    if (!id) {
      setSavedItem(null);
      setCompositionTitle("My Dance Motion");
      setSegments([]);
      setMotionEnabled(false);
      return;
    }
    const workspaceItem = workspaceItems.find((item) => item.kind === "dance_motion" && item.id === id);
    const publicItem = publicItems.find((item) => item.kind === "dance_motion" && item.id === id);
    const sourceItem = workspaceItem ?? publicItem;
    const composition = sourceItem ? compositionFromItem(sourceItem) : null;
    if (!sourceItem || !composition) {
      setCompositionMessage("This dance asset does not contain editable motion clips.");
      return;
    }
    const loadedSegments = composition.segments.map((segment) => ({ ...segment }));
    setSegments(loadedSegments);
    setMotionEnabled(loadedSegments.length > 0);
    if (workspaceItem) {
      setSavedItem(workspaceItem);
      setCompositionTitle(workspaceItem.title);
      setCompositionMessage("Private dance opened. Save changes to update this asset.");
    } else {
      setSavedItem(null);
      setCompositionTitle(`${composition.title} Copy`);
      setCompositionMessage("Public dance opened as a new private copy. Save it to create your own asset.");
    }
  };

  const updateSegment = (id: string, change: Partial<Pick<DanceMotionCompositionSegment, "offsetSeconds" | "trimStartSeconds" | "trimEndSeconds">>) => {
    setSegments((current) => current.map((segment) => segment.id === id ? { ...segment, ...change } : segment));
  };

  const removeSegment = (id: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== id));
    setSelectedSegmentId((current) => current === id ? null : current);
  };

  const cutSelectedAtCursor = () => {
    if (!selectedSegment) return;
    const duration = selectedSegment.trimEndSeconds - selectedSegment.trimStartSeconds;
    const localOffset = cursorSeconds - selectedSegment.offsetSeconds;
    if (localOffset <= 0.08 || localOffset >= duration - 0.08) {
      setCompositionMessage("Move the playhead inside the selected clip to cut it.");
      return;
    }
    const splitSourceTime = selectedSegment.trimStartSeconds + localOffset;
    const first: DanceMotionCompositionSegment = {
      ...selectedSegment,
      id: `motion-segment-${crypto.randomUUID()}`,
      trimEndSeconds: splitSourceTime,
    };
    const second: DanceMotionCompositionSegment = {
      ...selectedSegment,
      id: `motion-segment-${crypto.randomUUID()}`,
      title: `${selectedSegment.title} · 2`,
      offsetSeconds: cursorSeconds,
      trimStartSeconds: splitSourceTime,
    };
    setSegments((current) => current.flatMap((segment) => segment.id === selectedSegment.id ? [first, second] : [segment]));
    setSelectedSegmentId(second.id);
    setCompositionMessage("Clip cut at the playhead.");
  };

  const saveComposition = async () => {
    if (!segments.length) {
      setCompositionMessage("Add at least one saved dance asset before saving the assembly.");
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
      metadata: {
        ...(savedItem?.metadata ?? {}),
        storage: "browser",
        sourceTool: savedItem?.metadata.sourceTool ?? "dance-creation",
        composition: composed,
      },
    };
    await saveWorkspaceItem(item);
    setSavedItem(item);
    setAssemblyOpenId(item.id);
    setCompositionMessage(savedItem ? "Dance Assembly updated in Private Assets." : "Dance Assembly saved to Private Assets.");
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
    if (previewPlaying) {
      setPreviewPlaying(false);
    } else {
      setCursorSeconds(0);
      setPreviewPlaying(true);
    }
  };

  const loadWorkspaceAvatar = async (item: BrowserWorkspaceItem) => {
    let effectiveItem = item;
    let repaired = false;
    try {
      const repairedItem = await repairLegacyRemoteAvatarItem(item);
      if (repairedItem) {
        effectiveItem = repairedItem;
        repaired = true;
        onWorkspaceChanged?.();
      }
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "This avatar's finalized rigged model could not be loaded.");
      return;
    }
    const mesh = inputFromWorkspace(effectiveItem, "mesh");
    const manifest = inputFromWorkspace(effectiveItem, "manifest");
    const meshFile = mesh.file ?? (mesh.url ? await fileFromUrl(mesh.url, `${item.title}.glb`, "model/gltf-binary") : null);
    if (!meshFile) {
      setAvatarMessage("This avatar asset is missing its model file.");
      return;
    }
    avatarWorkspaceItemRef.current = effectiveItem;
    const manifestFile = manifest.file ?? (manifest.url ? await fileFromUrl(manifest.url, "manifest.json", "application/json") : undefined);
    await loadModelFile(meshFile, manifestFile, effectiveItem.title, "Private avatar asset", effectiveItem.id);
    if (repaired) setAvatarMessage("Loaded the finalized rigged avatar and repaired this private asset in place.");
  };

  const loadPublicAvatar = async (item: LibraryItem) => {
    const mesh = inputFromLibrary(item, "mesh");
    const manifest = inputFromLibrary(item, "manifest");
    if (!mesh.url || mesh.url.endsWith("/")) {
      setAvatarMessage("This avatar asset is missing its model file.");
      return;
    }
    avatarWorkspaceItemRef.current = null;
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
        <div><p className="home-v2-kicker">Dance Creation</p><p>Generate Dancers and Extract Dances</p></div>
        <span className="dance-creation-badge"><Sparkles size={14} aria-hidden="true" /> Canonical motion</span>
      </header>

      <section className="dance-creation-upper-grid">
        <div className="dance-creation-card dance-creation-avatar-form">
          <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><WandSparkles size={14} aria-hidden="true" /> Avatar generation</span><h3>Create a dancer</h3></div><span className="dance-creation-step">01</span></div>
          <label className="dance-creation-field"><span>Avatar title</span><input value={avatarTitle} onInput={(event) => setAvatarTitle(event.currentTarget.value)} placeholder="Purple cowboy frog" maxLength={120} required /></label>
          <label className="dance-creation-field"><span>Character description</span><textarea value={prompt} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder="A purple horse wearing a baseball cap" rows={3} required /></label>
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
          <button type="button" className="rhythm-beats-submit" disabled={avatarBusy || !avatarTitle.trim() || !prompt.trim() || !currentPricing} onClick={() => void generateAvatar()}>{avatarBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Working</> : <><WandSparkles size={15} aria-hidden="true" /> Generate avatar</>}</button>
          {pricingError ? <p className="dance-creation-status dance-creation-status--error" role="status">{pricingError}</p> : null}
          {avatarMessage ? <p className="dance-creation-status" role="status">{avatarMessage}</p> : null}
          {avatarJob ? <small className="dance-creation-job">{avatarJob.status} · {avatarJob.id.slice(0, 8)}</small> : null}
        </div>

        <div className="dance-creation-card dance-creation-model-card">
          <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><RotateCcw size={14} aria-hidden="true" /> Avatar and rig</span><h3>{model?.label ?? "No avatar selected"}</h3></div><span className="dance-creation-step">02</span></div>
          <label className="dance-creation-field"><span>Dance avatar</span><select value={selectedAvatarId} onChange={(event) => { const value = event.currentTarget.value; setSelectedAvatarId(value); const option = avatarOptions.find((candidate) => candidate.id === value); if (!option) return; if (option.source === "private") void loadWorkspaceAvatar(option.item); else void loadPublicAvatar(option.item); }}><option value="">Choose an avatar asset</option>{avatarOptions.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
          {profile && model ? <><RigAdjustmentPanel model={model} profile={profile} originalProfile={originalProfile} orientationYawRadians={model.manifest?.orientation?.yawRadians ?? 0} originalOrientationYawRadians={originalOrientationYawRadians} onProfileChange={setProfile} onOrientationChange={updateAvatarOrientation} onSave={saveAvatarAdjustments} onReskin={reskin} reskinBusy={avatarBusy} reskinDisabled={!currentPricing} reskinDisabledReason="Waiting for avatar reskin pricing" onLoadProfile={(next) => { setProfile(next); setOriginalProfile(next); }} />{!currentPricing ? <p className="dance-creation-status">Waiting for avatar reskin pricing.</p> : null}{reskinMessage ? <p className={`dance-creation-status${reskinMessage.toLowerCase().includes("failed") || reskinMessage.toLowerCase().includes("error") ? " dance-creation-status--error" : ""}`} role="status">{reskinMessage}</p> : null}</> : <p className="dance-creation-empty">Generate or load an avatar model and its canonical manifest to adjust the rig.</p>}
        </div>

          <div className="dance-creation-card dance-creation-preview-card">
            <div className="dance-creation-card-heading"><div><span className="dance-engine-eyebrow"><Play size={14} aria-hidden="true" /> Preview</span><h3>Model performance</h3></div><span className="dance-creation-step">03</span></div>
          <label className="dance-creation-field dance-creation-preview-select"><span>Preview a saved dance</span><select value={previewCompositionId} onChange={(event) => { setPreviewCompositionId(event.currentTarget.value); setPreviewPlaying(false); setCursorSeconds(0); }}><option value="">Current motion track</option>{motionItems.map((item) => <option value={item.id} key={item.id}>Private · {item.title}</option>)}{publicMotionItems.map((item) => <option value={item.id} key={item.id}>Public · {item.title}</option>)}</select></label>
          <audio ref={audioRef} />
          {model ? <DanceEngineCanvas audioRef={audioRef} beats={[]} bpm={120} model={model} options={options} capturedMotion={previewClip} capturedMotionEnabled={Boolean(previewClip) && (Boolean(previewComposition) || motionEnabled)} motionPlaybackPlaying={previewPlaying} onSnapshot={setSnapshot} onError={setAvatarMessage} /> : <div className="dance-creation-preview-empty"><Upload size={22} aria-hidden="true" /><strong>Avatar preview</strong><span>Generate an avatar or load a model to begin.</span></div>}
          <div className="dance-creation-preview-actions"><button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary" disabled={!model || !previewClip} onClick={preview}>{previewPlaying ? "Pause preview" : "Play preview"}</button><span>{snapshot ? `${snapshot.rigCoverage * 100 | 0}% rig · ${snapshot.fps.toFixed(0)} fps` : "Waiting for an avatar model"}</span></div>
        </div>
      </section>

      <section className="dance-creation-lower-grid">
        <div className="dance-creation-card dance-creation-capture-card">
          <div className="dance-creation-card-heading">
            <div><span className="dance-engine-eyebrow"><FileVideo size={14} aria-hidden="true" /> Pose extraction</span><h3>Capture a dance video</h3></div>
            <span className="dance-creation-step">04</span>
          </div>
          <DanceMotionCapturePanel
            showPlaybackActions={false}
            onMotionClip={handleCaptureClip}
            onJob={setCaptureJob}
            captureTitle={captureTitle}
            onCaptureTitleChange={setCaptureTitle}
            onSaveCapture={saveCaptureAsset}
            captureSaveBusy={captureSaveBusy}
          />
        </div>
        <div className="dance-creation-card dance-creation-track-card">
          <div className="dance-creation-card-heading">
            <div><span className="dance-engine-eyebrow"><AudioLines size={14} aria-hidden="true" /> Motion editing</span><h3>Dance Assembly</h3></div>
            <span className="dance-creation-step">05</span>
          </div>
          <p className="dance-creation-help">Add saved dance assets to the track, then arrange, trim, and cut them into a new dance. Empty time between clips is an intentional pose transition.</p>
          <div className="dance-creation-assembly-open">
            <label className="dance-creation-field">
              <span>Open dance for editing</span>
              <select value={assemblyOpenId} onChange={(event) => openAssembly(event.currentTarget.value)}>
                <option value="">New dance assembly</option>
                {motionItems.map((item) => <option value={item.id} key={item.id}>Private · {item.title}</option>)}
                {publicMotionItems.map((item) => <option value={item.id} key={item.id}>Public · {item.title}</option>)}
              </select>
            </label>
            <span className="dance-creation-assembly-open__hint">{savedItem ? "Saving updates this private asset." : "Saving creates a new private asset."}</span>
          </div>
          <DanceMotionCompositionTrack
            segments={segments}
            selectedSegmentId={selectedSegmentId}
            durationSeconds={composed.durationSeconds}
            cursorSeconds={cursorSeconds}
            onCursorChange={setCursorSeconds}
            onSelectSegment={setSelectedSegmentId}
            onUpdateSegment={updateSegment}
            onRemoveSegment={removeSegment}
            onCutAtCursor={cutSelectedAtCursor}
          />
          {selectedSegment ? <div className="dance-creation-segment-controls">
            <label><span>Start</span><input type="number" min="0" step="0.01" value={selectedSegment.offsetSeconds} onInput={(event) => updateSegment(selectedSegment.id, { offsetSeconds: Math.max(0, Number(event.currentTarget.value) || 0) })} /></label>
            <label><span>Trim in</span><input type="number" min="0" step="0.01" value={selectedSegment.trimStartSeconds} onInput={(event) => updateSegment(selectedSegment.id, { trimStartSeconds: Math.max(0, Math.min(selectedSegment.trimEndSeconds - 0.01, Number(event.currentTarget.value) || 0)) })} /></label>
            <label><span>Trim out</span><input type="number" min={selectedSegment.trimStartSeconds + 0.01} step="0.01" value={selectedSegment.trimEndSeconds} onInput={(event) => updateSegment(selectedSegment.id, { trimEndSeconds: Math.max(selectedSegment.trimStartSeconds + 0.01, Math.min(selectedSegment.clip.durationSeconds, Number(event.currentTarget.value) || selectedSegment.trimEndSeconds)) })} /></label>
          </div> : null}
          <div className="dance-creation-track-library">
            <select value={trackAssetId} onChange={(event) => setTrackAssetId(event.currentTarget.value)}>
              <option value="">Add a saved dance asset</option>
              {motionItems.map((item) => <option value={item.id} key={item.id}>Private · {item.title}</option>)}
              {publicMotionItems.map((item) => <option value={item.id} key={item.id}>Public · {item.title}</option>)}
            </select>
            <button type="button" className="rhythm-beats-secondary-button" disabled={!trackAssetId} onClick={addLibraryDanceToTrack}>Add to track</button>
          </div>
          <div className="dance-creation-track-footer">
            <label className="dance-creation-title-field"><span>Asset name</span><input value={compositionTitle} onInput={(event) => setCompositionTitle(event.currentTarget.value)} /></label>
            <span>{segments.length} clips · {composed.durationSeconds.toFixed(2)} seconds</span>
            <button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--primary" disabled={!segments.length} onClick={() => void saveComposition()}><Save size={15} aria-hidden="true" /> {savedItem ? "Update private" : "Save private"}</button>
            <button type="button" className="rhythm-beats-secondary-button rhythm-beats-secondary-button--publish" disabled={!savedItem} onClick={() => void publishComposition()}><CheckCircle2 size={15} aria-hidden="true" /> Publish</button>
          </div>
          {compositionMessage ? <p className="dance-creation-status" role="status">{compositionMessage}</p> : null}
        </div>
      </section>
    </div>
  );
}
