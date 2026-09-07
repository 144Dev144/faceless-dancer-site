import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Image as ImageIcon, LoaderCircle, Plus, RefreshCw, Save, Scissors, Sparkles, Trash2, Upload, Video, WandSparkles } from "lucide-preact";
import { GENERATIVE_DANCE_MAX_DURATION_SECONDS, type GenerativeDanceSequence, type GenerativeDanceSequenceSegment } from "@faceless/shared";
import { api, type LibraryItem, type RemoteGenerationInput, type RemoteGenerationRequest, type RemoteJob, type RemotePaymentCurrency, type RemotePricingConfig, type RemotePricingQuote } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";
import { createRemoteGenerativeDanceWorkspaceItem, createRemoteImageWorkspaceItem, saveWorkspaceItem, type BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import { fetchFaceLESSWalletBalance, fetchSolWalletBalance, type FaceLESSWalletBalance } from "../../lib/facelessBalance";
import { sendRemoteGenerationPayment, sendRemoteGenerationSolPayment, signRemoteGenerationPayment } from "../../lib/remoteGenerationPayment";
import { calculateRemotePricing, createFreeMarketPrice, fetchOnChainMarketPrice, holderFreeForRequest, type RemoteMarketPrice } from "../../lib/remoteGenerationPricing";

const FPS = 24;
const MAX_FRAMES_PER_GENERATION = 81;
const MAX_WINDOW_SECONDS = MAX_FRAMES_PER_GENERATION / FPS;
const TRACK_PIXELS_PER_SECOND = 92;
const TRACK_MIN_SECONDS = 8;
const SNAP_SECONDS = 0.14;
const MIN_CLIP_SECONDS = 0.08;

interface Props {
  session: SessionState;
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  onWorkspaceChanged?: () => void;
}

interface DriverClip {
  id: string;
  title: string;
  file: File;
  durationSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
  offsetSeconds: number;
  prompt: string;
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
}

function formatToken(amount: string, decimals: number): string {
  const value = Number(amount) / 10 ** decimals;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function artifactRecord(job: RemoteJob): RemoteJob["artifacts"][number] | null {
  const media = job.artifacts.filter((item) => item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/") || /\.(png|jpe?g|webp|mp4|webm|mov)$/i.test(item.objectPath));
  return media.find((item) => /generative-dance-output|00-final/i.test(item.objectPath))
    ?? media.find((item) => (item as RemoteJob["artifacts"][number] & { primary?: boolean }).primary === true)
    ?? media[0]
    ?? null;
}

function inputFromAvatar(item: BrowserWorkspaceItem | LibraryItem): RemoteGenerationInput | null {
  const metadata = item.metadata as Record<string, unknown>;
  const files = Array.isArray(metadata.files)
    ? metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
    : Array.isArray((item as LibraryItem).files)
      ? (item as LibraryItem).files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const file = files.find((candidate) => candidate.role === "reference-image" || candidate.role === "image") ?? (metadata.avatarMode === "generative-image" ? files[0] : undefined);
  const sourceUrl = typeof file?.sourcePublicUrl === "string" ? file.sourcePublicUrl : typeof metadata.sourcePublicUrl === "string" ? metadata.sourcePublicUrl : "";
  if (!sourceUrl) return null;
  return {
    id: "avatar-reference",
    role: "avatar-reference",
    sourceUrl,
    mimeType: typeof file?.mimeType === "string" ? file.mimeType : "image/png",
    fileName: typeof file?.fileName === "string" ? file.fileName : `${item.title}.png`,
    sizeBytes: typeof file?.sizeBytes === "number" ? file.sizeBytes : undefined,
  };
}

function sourceUrlFromDanceItem(item: BrowserWorkspaceItem | LibraryItem): string {
  const metadata = item.metadata as Record<string, unknown>;
  const files = Array.isArray(metadata.files)
    ? metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
    : Array.isArray((item as LibraryItem).files)
      ? (item as LibraryItem).files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const file = files.find((candidate) => candidate.role === "generative-video" || candidate.role === "video" || candidate.mimeType === "video/mp4" || candidate.mimeType === "video/webm");
  return typeof file?.publicUrl === "string" ? file.publicUrl : typeof file?.sourcePublicUrl === "string" ? file.sourcePublicUrl : "";
}

function splitWindows(segment: DriverClip, inputId: string): GenerativeDanceSequenceSegment {
  const sourceDuration = Math.max(0.01, segment.trimEndSeconds - segment.trimStartSeconds);
  const outputStart = segment.offsetSeconds;
  const windows = [];
  let elapsed = 0;
  let index = 0;
  while (elapsed < sourceDuration - 0.001) {
    const length = Math.min(MAX_WINDOW_SECONDS, sourceDuration - elapsed);
    windows.push({
      index,
      sourceStartSeconds: segment.trimStartSeconds + elapsed,
      sourceEndSeconds: segment.trimStartSeconds + elapsed + length,
      timelineStartSeconds: outputStart + elapsed,
      timelineEndSeconds: outputStart + elapsed + length,
    });
    elapsed += length;
    index += 1;
  }
  return {
    id: segment.id,
    inputId,
    title: segment.title,
    prompt: segment.prompt.trim(),
    sourceStartSeconds: segment.trimStartSeconds,
    sourceEndSeconds: segment.trimEndSeconds,
    timelineStartSeconds: segment.offsetSeconds,
    timelineEndSeconds: segment.offsetSeconds + sourceDuration,
    placement: {
      translateX: segment.translateX,
      translateY: segment.translateY,
      scale: segment.scale,
      rotationDegrees: segment.rotationDegrees,
    },
    anchor: [0.5, 0.58],
    subjectBounds: [0.15, 0.05, 0.85, 0.95],
    windows,
  };
}

function durationFor(clip: DriverClip): number {
  return Math.max(0.01, clip.trimEndSeconds - clip.trimStartSeconds);
}

type SequencePointerEdit = {
  kind: "move" | "trim-left" | "trim-right";
  id: string;
  startX: number;
  offsetSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
};

function snapSequenceValue(value: number, candidates: number[]): number {
  const closest = candidates.reduce<{ value: number; distance: number } | null>((best, candidate) => {
    const distance = Math.abs(candidate - value);
    return !best || distance < best.distance ? { value: candidate, distance } : best;
  }, null);
  return closest && closest.distance <= SNAP_SECONDS ? closest.value : value;
}

interface GenerativeDanceSequenceTrackProps {
  clips: DriverClip[];
  selectedClipId: string | null;
  durationSeconds: number;
  cursorSeconds: number;
  onCursorChange: (seconds: number) => void;
  onSelectClip: (id: string) => void;
  onUpdateClip: (id: string, patch: Partial<DriverClip>) => void;
  onCutAtCursor: () => void;
}

function GenerativeDanceSequenceTrack({ clips, selectedClipId, durationSeconds, cursorSeconds, onCursorChange, onSelectClip, onUpdateClip, onCutAtCursor }: GenerativeDanceSequenceTrackProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointerEditRef = useRef<SequencePointerEdit | null>(null);
  const [cutMode, setCutMode] = useState(false);
  const trackSeconds = Math.max(TRACK_MIN_SECONDS, durationSeconds + 1);
  const trackWidth = trackSeconds * TRACK_PIXELS_PER_SECOND;
  const selectedClip = clips.find((clip) => clip.id === selectedClipId) ?? null;

  const secondsAtClientX = (clientX: number): number => {
    const viewport = viewportRef.current;
    if (!viewport) return 0;
    const bounds = viewport.getBoundingClientRect();
    return Math.max(0, Math.min(trackSeconds, (clientX - bounds.left + viewport.scrollLeft) / TRACK_PIXELS_PER_SECOND));
  };

  const handleTimelinePointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-generative-clip]")) return;
    const seconds = secondsAtClientX(event.clientX);
    onCursorChange(seconds);
    if (cutMode && selectedClip && seconds >= selectedClip.offsetSeconds && seconds <= selectedClip.offsetSeconds + durationFor(selectedClip)) {
      onCutAtCursor();
      setCutMode(false);
    }
  };

  const beginEdit = (event: PointerEvent, kind: SequencePointerEdit["kind"], clip: DriverClip) => {
    event.stopPropagation();
    event.preventDefault();
    onSelectClip(clip.id);
    pointerEditRef.current = { kind, id: clip.id, startX: event.clientX, offsetSeconds: clip.offsetSeconds, trimStartSeconds: clip.trimStartSeconds, trimEndSeconds: clip.trimEndSeconds };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const updateEdit = (event: PointerEvent) => {
    const edit = pointerEditRef.current;
    if (!edit) return;
    const delta = (event.clientX - edit.startX) / TRACK_PIXELS_PER_SECOND;
    const clip = clips.find((candidate) => candidate.id === edit.id);
    if (!clip) return;
    const otherEdges = clips.filter((candidate) => candidate.id !== edit.id).flatMap((candidate) => [candidate.offsetSeconds, candidate.offsetSeconds + durationFor(candidate)]);
    const fixedRight = edit.offsetSeconds + (edit.trimEndSeconds - edit.trimStartSeconds);
    if (edit.kind === "move") {
      const nextOffset = snapSequenceValue(Math.max(0, edit.offsetSeconds + delta), [0, ...otherEdges]);
      onUpdateClip(edit.id, { offsetSeconds: nextOffset });
      onCursorChange(nextOffset);
    } else if (edit.kind === "trim-left") {
      const proposedLeft = snapSequenceValue(Math.max(0, edit.offsetSeconds + delta), [0, ...otherEdges]);
      const nextLeft = Math.min(proposedLeft, fixedRight - MIN_CLIP_SECONDS);
      onUpdateClip(edit.id, {
        offsetSeconds: nextLeft,
        trimStartSeconds: Math.max(0, Math.min(edit.trimEndSeconds - MIN_CLIP_SECONDS, edit.trimStartSeconds + nextLeft - edit.offsetSeconds)),
      });
    } else {
      const proposedRight = snapSequenceValue(Math.max(edit.offsetSeconds + MIN_CLIP_SECONDS, fixedRight + delta), otherEdges);
      const nextRight = Math.max(edit.offsetSeconds + MIN_CLIP_SECONDS, proposedRight);
      onUpdateClip(edit.id, { trimEndSeconds: Math.min(clip.durationSeconds, edit.trimStartSeconds + nextRight - edit.offsetSeconds) });
    }
  };

  return <div className="generative-dance-composition-editor">
    <div className="generative-dance-composition-toolbar"><span>Drag clips to position them. Pull an edge to trim.</span><div><button type="button" className={`rhythm-beats-secondary-button generative-dance-composition-tool${cutMode ? " is-active" : ""}`} title="Cut selected clip at the playhead" aria-label="Cut selected clip at the playhead" disabled={!selectedClip} onClick={() => setCutMode((value) => !value)}><Scissors size={15} aria-hidden="true" /></button></div></div>
    <div ref={viewportRef} className="generative-dance-composition-viewport" onPointerDown={handleTimelinePointerDown}>
      <div className="generative-dance-composition-canvas" style={{ width: `${trackWidth}px` }}>
        <div className="generative-dance-composition-axis" aria-hidden="true">{Array.from({ length: Math.ceil(trackSeconds) + 1 }, (_, index) => <span key={index} style={{ left: `${index * TRACK_PIXELS_PER_SECOND}px` }}>{index}s</span>)}</div>
        <div className="generative-dance-composition-lane">
          {clips.map((clip, index) => {
            const width = durationFor(clip) * TRACK_PIXELS_PER_SECOND;
            return <div key={clip.id} data-generative-clip="true" className={`generative-dance-composition-clip${selectedClipId === clip.id ? " is-selected" : ""}`} style={{ left: `${clip.offsetSeconds * TRACK_PIXELS_PER_SECOND}px`, width: `${Math.max(30, width)}px` }} title={`${clip.title} · ${durationFor(clip).toFixed(2)} seconds`} onPointerDown={(event) => {
              if (cutMode) {
                event.stopPropagation();
                event.preventDefault();
                onSelectClip(clip.id);
                onCursorChange(secondsAtClientX(event.clientX));
                if (selectedClipId === clip.id) {
                  onCutAtCursor();
                  setCutMode(false);
                }
                return;
              }
              beginEdit(event, "move", clip);
            }} onPointerMove={updateEdit} onPointerUp={() => { pointerEditRef.current = null; }} onPointerCancel={() => { pointerEditRef.current = null; }} onClick={(event) => { event.stopPropagation(); onSelectClip(clip.id); }}>
              <button type="button" className="generative-dance-composition-handle is-left" aria-label={`Trim start of ${clip.title}`} onPointerDown={(event) => beginEdit(event, "trim-left", clip)} />
              <span>{index + 1}. {clip.title}</span><small>{durationFor(clip).toFixed(1)}s</small>
              <button type="button" className="generative-dance-composition-handle is-right" aria-label={`Trim end of ${clip.title}`} onPointerDown={(event) => beginEdit(event, "trim-right", clip)} />
            </div>;
          })}
          {!clips.length ? <span className="generative-dance-composition-empty">Add driver videos above to begin the sequence.</span> : null}
          <div className="generative-dance-composition-playhead" style={{ left: `${Math.max(0, Math.min(trackSeconds, cursorSeconds)) * TRACK_PIXELS_PER_SECOND}px` }} aria-label={`Playhead at ${cursorSeconds.toFixed(2)} seconds`} />
        </div>
      </div>
    </div>
    <div className="generative-dance-composition-selection"><span>{selectedClip ? `Selected: ${selectedClip.title}` : "Select a clip to edit it"}</span><span>Playhead {cursorSeconds.toFixed(2)}s · {durationSeconds.toFixed(2)}s total</span>{cutMode ? <strong>Click inside the selected clip to cut</strong> : null}</div>
  </div>;
}

function avatarItems(workspaceItems: BrowserWorkspaceItem[], publicItems: LibraryItem[]): Array<{ id: string; item: BrowserWorkspaceItem | LibraryItem; label: string }> {
  return [
    ...workspaceItems.filter((item) => item.kind === "avatar" && item.metadata.avatarMode === "generative-image").map((item) => ({ id: `private:${item.id}`, item, label: `Private · ${item.title}` })),
    ...publicItems.filter((item) => item.kind === "avatar" && item.metadata.avatarMode === "generative-image").map((item) => ({ id: `public:${item.id}`, item, label: `Public · ${item.title}` })),
  ];
}

export function GenerativeDancePanel({ session, workspaceItems, publicItems, onWorkspaceChanged }: Props): JSX.Element {
  const [avatarTitle, setAvatarTitle] = useState("");
  const [avatarDescription, setAvatarDescription] = useState("");
  const [avatarReference, setAvatarReference] = useState<File | null>(null);
  const [avatarId, setAvatarId] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [danceTitle, setDanceTitle] = useState("My Generative Dance");
  const [dancePrompt, setDancePrompt] = useState("Preserve the dancer's identity and motion style; keep the full body visible.");
  const [enhancementEnabled, setEnhancementEnabled] = useState(true);
  const [motionInterpolationEnabled, setMotionInterpolationEnabled] = useState(true);
  const [clips, setClips] = useState<DriverClip[]>([]);
  const [savedDriverId, setSavedDriverId] = useState("");
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [cursorSeconds, setCursorSeconds] = useState(0);
  const [danceBusy, setDanceBusy] = useState(false);
  const [danceMessage, setDanceMessage] = useState<string | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<RemotePaymentCurrency>("FACELESS");
  const [pricingConfig, setPricingConfig] = useState<RemotePricingConfig | null>(null);
  const [marketPrice, setMarketPrice] = useState<RemoteMarketPrice | null>(null);
  const [pricingError, setPricingError] = useState("");
  const [pricing, setPricing] = useState<RemotePricingQuote | null>(null);
  const [walletBalance, setWalletBalance] = useState<FaceLESSWalletBalance | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletRefresh, setWalletRefresh] = useState(0);
  const [avatarPricing, setAvatarPricing] = useState<RemotePricingQuote | null>(null);

  const selectedAvatar = avatarItems(workspaceItems, publicItems).find((item) => item.id === avatarId)?.item ?? null;
  const savedDriverItems = [
    ...workspaceItems.filter((item) => item.kind === "dance_motion" && item.metadata.danceMode === "generative-video").map((item) => ({ id: `private:${item.id}`, item, label: `Private · ${item.title}` })),
    ...publicItems.filter((item) => item.kind === "dance_motion" && item.metadata.danceMode === "generative-video").map((item) => ({ id: `public:${item.id}`, item, label: `Public · ${item.title}` })),
  ];
  const holderFreeAvatar = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, { runtime: "flux-image", modelRevision: "flux-2-klein-4b", inputs: [], priority: "low", paymentCurrency, metadata: { title: avatarTitle || "Generated avatar" }, parameters: { task_type: "generative_avatar", description: avatarDescription } }));
  const holderFreeDance = Boolean(session.isHolder && pricingConfig && holderFreeForRequest(pricingConfig, { runtime: "wan-animate", modelRevision: "wan-animate-2", inputs: [], priority: "low", paymentCurrency, metadata: { title: danceTitle }, parameters: { task_type: "generative_dance" } }));

  const avatarRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "flux-image",
    modelRevision: "flux-2-klein-4b",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: avatarTitle.trim() || "Generated avatar" },
    parameters: {
      task_type: "generative_avatar",
      description: avatarDescription.trim(),
      steps: 4,
      true_cfg_scale: 1,
    },
  }), [avatarDescription, avatarTitle, paymentCurrency]);

  const sequence = useMemo<GenerativeDanceSequence | null>(() => {
    if (!clips.length) return null;
    const segments = clips.map((clip) => splitWindows(clip, `driver-${clip.id}`));
    return {
      format: "faceless-generative-dance-sequence",
      version: 1,
      fps: FPS,
      maxFramesPerGeneration: MAX_FRAMES_PER_GENERATION,
      canvas: { width: 480, height: 832, anchorSemantic: "pelvis", anchorX: 0.5, anchorY: 0.58, floorY: 0.94 },
      durationSeconds: Math.max(...segments.map((segment) => segment.timelineEndSeconds)),
      segments,
    };
  }, [clips]);

  const danceRequest = useMemo<RemoteGenerationRequest>(() => ({
    runtime: "wan-animate",
    modelRevision: "wan-animate-2-q6",
    inputs: [],
    priority: "low",
    paymentCurrency,
    metadata: { title: danceTitle.trim() || "Generative dance" },
    parameters: {
      task_type: "generative_dance",
      prompt: dancePrompt.trim(),
      fps: FPS,
      max_frames_per_generation: MAX_FRAMES_PER_GENERATION,
      avatar_input_id: "avatar-reference",
      postprocess: {
        enhancement_enabled: enhancementEnabled,
        enhancement_scale: 2,
        motion_interpolation_enabled: motionInterpolationEnabled,
        motion_interpolation_target_fps: 48,
      },
      sequence,
    },
  }), [dancePrompt, danceTitle, enhancementEnabled, motionInterpolationEnabled, paymentCurrency, sequence]);

  const loadPricing = async () => {
    try {
      const config = await api.remoteGenerationPricingConfig();
      setPricingConfig(config);
      const holderFree = session.isHolder && (config.settings.fluxImageFreeForHolders || config.settings.wanAnimateFreeForHolders);
      const market = config.paymentMode === "free-signature" || holderFree ? createFreeMarketPrice(config, holderFree ? "holder-free" : "free-signature") : await fetchOnChainMarketPrice(config);
      setMarketPrice(market);
      setPricingError("");
    } catch (error: unknown) {
      setPricingError(error instanceof Error ? error.message : "Pricing is temporarily unavailable.");
    }
  };

  const quote = async (request: RemoteGenerationRequest, kind: "avatar" | "dance") => {
    if (!pricingConfig || !marketPrice) return;
    try {
      const free = session.isHolder && holderFreeForRequest(pricingConfig, request);
      const next = calculateRemotePricing(pricingConfig, request, free ? createFreeMarketPrice(pricingConfig, "holder-free") : marketPrice, { freeForHolder: free });
      if (kind === "avatar") setAvatarPricing(next); else setPricing(next);
    } catch {
      if (kind === "avatar") setAvatarPricing(null); else setPricing(null);
    }
  };

  useEffect(() => { void loadPricing(); }, []);
  useEffect(() => { void quote(avatarRequest, "avatar"); }, [avatarRequest, marketPrice, pricingConfig, session.isHolder]);
  useEffect(() => { void quote(danceRequest, "dance"); }, [danceRequest, marketPrice, pricingConfig, session.isHolder]);

  useEffect(() => {
    if (!session.authenticated || !session.publicKey || !pricingConfig) return;
    let cancelled = false;
    setWalletBalanceLoading(true);
    const network = { network: pricingConfig.network, rpcUrl: pricingConfig.market.rpcUrl };
    void (paymentCurrency === "SOL"
      ? fetchSolWalletBalance(session.publicKey, network)
      : fetchFaceLESSWalletBalance(session.publicKey, pricing?.tokenMint ?? pricingConfig.currencies.FACELESS.tokenMint, pricing?.tokenDecimals ?? pricingConfig.currencies.FACELESS.tokenDecimals, network))
      .then((balance) => { if (!cancelled) setWalletBalance(balance); })
      .catch(() => { if (!cancelled) setWalletBalance(null); })
      .finally(() => { if (!cancelled) setWalletBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [paymentCurrency, pricing?.tokenDecimals, pricing?.tokenMint, pricingConfig?.market.rpcUrl, pricingConfig?.network, session.authenticated, session.publicKey, walletRefresh]);

  const submit = async (request: RemoteGenerationRequest, onQueued?: (job: RemoteJob) => Promise<void>): Promise<RemoteJob> => {
    if (!session.authenticated || !session.publicKey) throw new Error("Connect and verify your wallet before generating.");
    const intent = await api.createRemotePaymentIntent(request);
    const signature = intent.paymentMode === "free-signature"
      ? intent.paymentMessage ? await signRemoteGenerationPayment({ walletAddress: session.publicKey, paymentMessage: intent.paymentMessage }) : (() => { throw new Error("The launch server did not provide the wallet authorization message."); })()
      : intent.currency === "SOL"
        ? await sendRemoteGenerationSolPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference })
        : await sendRemoteGenerationPayment({ walletAddress: session.publicKey, recipientAddress: intent.recipientAddress, tokenMint: intent.tokenMint, tokenDecimals: intent.tokenDecimals, network: intent.network, amountAtomic: intent.amountAtomic, paymentReference: intent.paymentReference });
    const paid = await api.verifyRemotePayment(intent.id, signature);
    const queued = await api.createRemoteJob(paid.id, request);
    await onQueued?.(queued);
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const current = await api.remoteJob(queued.id);
      if (["succeeded", "failed", "cancelled", "refunded"].includes(current.status)) return current;
      await new Promise((resolve) => window.setTimeout(resolve, 4000));
    }
    throw new Error("The generation is still running. Check generation history for its result.");
  };

  const addClip = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name)) {
      setDanceMessage("Choose an MP4, WebM, MOV, or MKV dance video.");
      return;
    }
    const currentEnd = clips.reduce((end, clip) => Math.max(end, clip.offsetSeconds + durationFor(clip)), 0);
    if (GENERATIVE_DANCE_MAX_DURATION_SECONDS - currentEnd < MIN_CLIP_SECONDS) {
      setDanceMessage(`The sequence is already at the ${GENERATIVE_DANCE_MAX_DURATION_SECONDS}-second limit.`);
      return;
    }
    const id = crypto.randomUUID();
    const objectUrl = URL.createObjectURL(file);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = objectUrl;
    probe.onloadedmetadata = () => {
      const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : MAX_WINDOW_SECONDS;
      URL.revokeObjectURL(objectUrl);
      const available = Math.max(0, GENERATIVE_DANCE_MAX_DURATION_SECONDS - currentEnd);
      const trimEnd = Math.min(duration, available);
      setClips((current) => {
        const offset = current.reduce((end, clip) => Math.max(end, clip.offsetSeconds + durationFor(clip)), 0);
        const currentAvailable = GENERATIVE_DANCE_MAX_DURATION_SECONDS - offset;
        if (currentAvailable < MIN_CLIP_SECONDS) return current;
        const next: DriverClip = { id, title: file.name.replace(/\.[^.]+$/, ""), file, durationSeconds: duration, trimStartSeconds: 0, trimEndSeconds: trimEnd, offsetSeconds: offset, prompt: dancePrompt, translateX: 0, translateY: 0, scale: 1, rotationDegrees: 0 };
        return [...current, next];
      });
      setDanceMessage(duration > trimEnd + 0.01 ? `This clip was trimmed to keep the sequence within ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.` : null);
      setSelectedClipId(id);
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setDanceMessage("The dance video duration could not be read.");
    };
  };

  const addSavedDriver = async () => {
    const selected = savedDriverItems.find((item) => item.id === savedDriverId)?.item;
    const sourceUrl = selected ? sourceUrlFromDanceItem(selected) : "";
    if (!selected || !sourceUrl) {
      setDanceMessage("Choose a saved generative dance with a public video source.");
      return;
    }
    try {
      const response = await fetch(sourceUrl, { credentials: "include" });
      if (!response.ok) throw new Error("The saved dance video could not be loaded.");
      const blob = await response.blob();
      addClip(new File([blob], `${selected.title}.mp4`, { type: blob.type || "video/mp4" }));
      setSavedDriverId("");
    } catch (error: unknown) {
      setDanceMessage(error instanceof Error ? error.message : "The saved dance video could not be loaded.");
    }
  };

  const updateClip = (id: string, patch: Partial<DriverClip>) => setClips((current) => current.map((clip) => {
    if (clip.id !== id) return clip;
    const next = { ...clip, ...patch };
    const trimStartSeconds = Math.max(0, Math.min(next.durationSeconds - MIN_CLIP_SECONDS, next.trimStartSeconds));
    const trimEndSeconds = Math.max(trimStartSeconds + MIN_CLIP_SECONDS, Math.min(next.durationSeconds, next.trimEndSeconds));
    const durationSeconds = trimEndSeconds - trimStartSeconds;
    const offsetSeconds = Math.max(0, Math.min(GENERATIVE_DANCE_MAX_DURATION_SECONDS - durationSeconds, next.offsetSeconds));
    return { ...next, trimStartSeconds, trimEndSeconds, offsetSeconds };
  }));
  const removeClip = (id: string) => { setClips((current) => current.filter((clip) => clip.id !== id)); setSelectedClipId((current) => current === id ? null : current); };
  const moveClip = (id: string, direction: -1 | 1) => setClips((current) => {
    const index = current.findIndex((clip) => clip.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const cutSelectedAtCursor = () => {
    if (!selectedClipId) return;
    setClips((current) => {
      const selected = current.find((clip) => clip.id === selectedClipId);
      if (!selected) return current;
      const localOffset = cursorSeconds - selected.offsetSeconds;
      const duration = durationFor(selected);
      if (localOffset <= MIN_CLIP_SECONDS || localOffset >= duration - MIN_CLIP_SECONDS) return current;
      const splitSourceTime = selected.trimStartSeconds + localOffset;
      const first = { ...selected, id: crypto.randomUUID(), title: `${selected.title} A`, trimEndSeconds: splitSourceTime };
      const second = { ...selected, id: crypto.randomUUID(), title: `${selected.title} B`, trimStartSeconds: splitSourceTime, offsetSeconds: cursorSeconds };
      setSelectedClipId(second.id);
      return current.flatMap((clip) => clip.id === selected.id ? [first, second] : [clip]);
    });
  };

  const generateAvatar = async () => {
    if (!avatarTitle.trim() || !avatarDescription.trim() || avatarBusy) return;
    setAvatarBusy(true);
    setAvatarMessage(null);
    try {
      const inputs = avatarReference ? [(await api.uploadRemoteGenerationAvatarSource(avatarReference, "reference-image")).input] : [];
      const job = await submit({ ...avatarRequest, inputs });
      if (job.status !== "succeeded") throw new Error(job.errorMessage || "The avatar image could not be generated.");
      const artifact = artifactRecord(job);
      const publicUrl = artifact?.publicUrl || "";
      if (!artifact || !publicUrl) throw new Error("The image worker finished without returning an image artifact.");
      await saveWorkspaceItem(createRemoteImageWorkspaceItem({ jobId: job.id, title: avatarTitle.trim(), publicUrl, objectPath: artifact.objectPath, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, createdAt: job.createdAt, updatedAt: new Date().toISOString() }));
      onWorkspaceChanged?.();
      setAvatarMessage("Avatar image generated and saved to Private Assets.");
      setAvatarId(`private:remote-generative-avatar-${job.id}`);
    } catch (error: unknown) {
      setAvatarMessage(error instanceof Error ? error.message : "The avatar image could not be generated.");
    } finally { setAvatarBusy(false); }
  };

  const generateDance = async () => {
    if (!sequence || !selectedAvatar || danceBusy) return;
    const avatarInput = inputFromAvatar(selectedAvatar);
    if (!avatarInput) { setDanceMessage("Choose a generated avatar image with a CDN reference."); return; }
    if (sequence.durationSeconds > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01) { setDanceMessage(`The dance sequence cannot exceed ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.`); return; }
    if (sequence.segments.some((segment) => segment.windows.some((window) => window.sourceEndSeconds - window.sourceStartSeconds > MAX_WINDOW_SECONDS + 0.05))) { setDanceMessage("One or more clips exceed the worker window. Trim them or split the source clip."); return; }
    setDanceBusy(true);
    setDanceMessage(null);
    try {
      const uploaded: RemoteGenerationInput[] = [];
      for (const clip of clips) {
        const input = (await api.uploadRemoteGenerationSource(clip.file)).input;
        uploaded.push({ ...input, id: `driver-${clip.id}`, role: "driver", durationSeconds: clip.durationSeconds });
      }
      const job = await submit({ ...danceRequest, inputs: [avatarInput, ...uploaded] });
      if (job.status !== "succeeded") throw new Error(job.errorMessage || "The generative dance could not be completed.");
      const artifact = artifactRecord(job);
      const publicUrl = artifact?.publicUrl || "";
      if (!artifact || !publicUrl) throw new Error("The animation worker finished without returning a video artifact.");
      await saveWorkspaceItem(createRemoteGenerativeDanceWorkspaceItem({ jobId: job.id, title: danceTitle.trim() || "Generative dance", publicUrl, objectPath: artifact.objectPath, mimeType: artifact.mimeType, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256, sequence, createdAt: job.createdAt, updatedAt: new Date().toISOString() }));
      onWorkspaceChanged?.();
      setDanceMessage("Generative dance video saved to Private Assets.");
    } catch (error: unknown) {
      setDanceMessage(error instanceof Error ? error.message : "The generative dance could not be completed.");
    } finally { setDanceBusy(false); }
  };

  const balanceLabel = !session.authenticated ? "Connect wallet" : walletBalance ? `${formatToken(walletBalance.amountAtomic, walletBalance.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}` : walletBalanceLoading ? "Checking..." : "Unavailable";
  const avatarCost = avatarPricing?.priceUsd === 0 ? "Free for holders · signature required" : avatarPricing ? `${formatToken(avatarPricing.amountAtomic, avatarPricing.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}` : pricingConfig ? "Checking price..." : "Price unavailable";
  const danceCost = pricing?.priceUsd === 0 ? "Free for holders · signature required" : pricing ? `${formatToken(pricing.amountAtomic, pricing.tokenDecimals)} ${paymentCurrency === "SOL" ? "SOL" : "$FACELESS"}` : pricingConfig ? "Checking price..." : "Price unavailable";

  return <section className="generative-dance-panel" aria-labelledby="generative-dance-title">
    <header className="generative-dance-panel__header"><div><span className="dance-engine-eyebrow"><Sparkles size={14} aria-hidden="true" /> Generative dance</span><h2 id="generative-dance-title">Create a dancer, then animate a sequence</h2><p>Generate a character image, arrange driver clips, and send one normalized sequence to Wan Animate.</p></div><span className="generative-dance-panel__window">{GENERATIVE_DANCE_MAX_DURATION_SECONDS}s max sequence · {MAX_FRAMES_PER_GENERATION} frames / window</span></header>
    <div className="generative-dance-panel__grid">
      <section className="generative-dance-card generative-dance-avatar-card"><div className="generative-dance-card__heading"><div><span className="dance-engine-eyebrow"><ImageIcon size={14} aria-hidden="true" /> Step 01</span><h3>Generate avatar image</h3></div></div>
        <label className="dance-creation-field"><span>Avatar title</span><input value={avatarTitle} onInput={(event) => setAvatarTitle(event.currentTarget.value)} placeholder="Purple cowboy frog" maxLength={120} /></label>
        <label className="dance-creation-field"><span>Character description</span><textarea value={avatarDescription} onInput={(event) => setAvatarDescription(event.currentTarget.value)} placeholder="A purple horse wearing a baseball cap" rows={4} /></label>
        <label className="dance-creation-file rhythm-beats-secondary-button"><Upload size={15} aria-hidden="true" /><span>{avatarReference?.name || "Optional reference image"}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setAvatarReference(event.currentTarget.files?.[0] ?? null)} /></label>
        <div className="generative-dance-payment"><div><span>Wallet</span><strong>{balanceLabel}</strong><button type="button" className="dance-station-cost-estimator__refresh" onClick={() => setWalletRefresh((value) => value + 1)} aria-label="Refresh wallet balance" title="Refresh wallet balance"><RefreshCw size={14} aria-hidden="true" /></button></div><div className="dance-station-payment-currency" role="radiogroup" aria-label="Avatar payment currency">{(["FACELESS", "SOL"] as const).map((currency) => <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}><input type="radio" name="generative-avatar-currency" checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} /><span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span></label>)}</div><div className="dance-creation-price-row"><span>Avatar image</span><strong>{avatarCost}</strong></div></div>
        <button type="button" className="rhythm-beats-submit" disabled={avatarBusy || !avatarTitle.trim() || !avatarDescription.trim() || !avatarPricing} onClick={() => void generateAvatar()}>{avatarBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Generating</> : <><WandSparkles size={15} aria-hidden="true" /> Generate avatar image</>}</button>
        {avatarMessage ? <p className="generative-dance-message" role="status">{avatarMessage}</p> : null}
      </section>
      <section className="generative-dance-card generative-dance-sequence-card"><div className="generative-dance-card__heading"><div><span className="dance-engine-eyebrow"><Video size={14} aria-hidden="true" /> Step 02</span><h3>Build generative dance</h3></div><label className="generative-dance-title-input"><span>Asset title</span><input value={danceTitle} onInput={(event) => setDanceTitle(event.currentTarget.value)} /></label></div>
        <div className="generative-dance-sequence-settings"><label className="dance-creation-field"><span>Dancer image</span><select value={avatarId} onChange={(event) => setAvatarId(event.currentTarget.value)}><option value="">Choose a generated avatar</option>{avatarItems(workspaceItems, publicItems).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label><label className="dance-creation-field"><span>Overall direction</span><input value={dancePrompt} onInput={(event) => setDancePrompt(event.currentTarget.value)} /></label></div>
        <div className="generative-dance-postprocess" aria-label="Dance video quality options">
          <span className="generative-dance-postprocess__title">Output quality</span>
          <label><input type="checkbox" checked={enhancementEnabled} onChange={(event) => setEnhancementEnabled(event.currentTarget.checked)} /><span>2x enhancement</span></label>
          <label><input type="checkbox" checked={motionInterpolationEnabled} onChange={(event) => setMotionInterpolationEnabled(event.currentTarget.checked)} /><span>Motion interpolation · 48 FPS</span></label>
        </div>
        <div className="generative-dance-track-toolbar"><div><strong>Driver sequence</strong><span>{clips.length ? `${clips.length} clip${clips.length === 1 ? "" : "s"} · ${sequence?.durationSeconds.toFixed(2)}s timeline` : "Add videos to create the sequence"}</span></div><div className="generative-dance-track-toolbar__actions">{savedDriverItems.length ? <><select value={savedDriverId} onChange={(event) => setSavedDriverId(event.currentTarget.value)} aria-label="Saved generative dance source"><option value="">Add saved dance</option>{savedDriverItems.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><button type="button" className="rhythm-beats-secondary-button" disabled={!savedDriverId} onClick={() => void addSavedDriver()}><Plus size={15} aria-hidden="true" /> Add saved</button></> : null}<label className="rhythm-beats-secondary-button"><Plus size={15} aria-hidden="true" /> Add driver video<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" onChange={(event) => { addClip(event.currentTarget.files?.[0] ?? null); event.currentTarget.value = ""; }} /></label></div></div>
        <GenerativeDanceSequenceTrack clips={clips} selectedClipId={selectedClipId} durationSeconds={sequence?.durationSeconds ?? 0} cursorSeconds={cursorSeconds} onCursorChange={setCursorSeconds} onSelectClip={setSelectedClipId} onUpdateClip={updateClip} onCutAtCursor={cutSelectedAtCursor} />
        <div className="generative-dance-track" role="list" aria-label="Generative dance driver sequence">{clips.length ? clips.map((clip, index) => <article className={`generative-dance-clip${selectedClipId === clip.id ? " is-selected" : ""}`} key={clip.id} onClick={() => setSelectedClipId(clip.id)}><div className="generative-dance-clip__top"><strong>{index + 1}. {clip.title}</strong><span>{durationFor(clip).toFixed(2)}s · starts {clip.offsetSeconds.toFixed(2)}s</span><div><button type="button" onClick={(event) => { event.stopPropagation(); moveClip(clip.id, -1); }} disabled={index === 0} aria-label="Move clip earlier" title="Move clip earlier"><ChevronUp size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); moveClip(clip.id, 1); }} disabled={index === clips.length - 1} aria-label="Move clip later" title="Move clip later"><ChevronDown size={14} /></button><button type="button" onClick={(event) => { event.stopPropagation(); removeClip(clip.id); }} aria-label={`Remove ${clip.title}`} title="Remove clip"><Trash2 size={14} /></button></div></div><div className="generative-dance-clip__controls"><label><span>Trim in</span><input type="number" min="0" max={Math.max(0, clip.trimEndSeconds - 0.01)} step="0.01" value={clip.trimStartSeconds} onInput={(event) => updateClip(clip.id, { trimStartSeconds: Math.min(Number(event.currentTarget.value), clip.trimEndSeconds - 0.01) })} /></label><label><span>Trim out</span><input type="number" min={Math.min(clip.durationSeconds, clip.trimStartSeconds + 0.01)} max={clip.durationSeconds} step="0.01" value={clip.trimEndSeconds} onInput={(event) => updateClip(clip.id, { trimEndSeconds: Math.max(Number(event.currentTarget.value), clip.trimStartSeconds + 0.01) })} /></label><label><span>Timeline start</span><input type="number" min="0" step="0.01" value={clip.offsetSeconds} onInput={(event) => updateClip(clip.id, { offsetSeconds: Math.max(0, Number(event.currentTarget.value)) })} /></label><label className="generative-dance-clip__prompt"><span>Motion prompt</span><input value={clip.prompt} onInput={(event) => updateClip(clip.id, { prompt: event.currentTarget.value })} /></label></div><div className="generative-dance-clip__placement"><span>Normalized placement</span><label>X <input type="number" step="0.01" value={clip.translateX} onInput={(event) => updateClip(clip.id, { translateX: Number(event.currentTarget.value) })} /></label><label>Y <input type="number" step="0.01" value={clip.translateY} onInput={(event) => updateClip(clip.id, { translateY: Number(event.currentTarget.value) })} /></label><label>Scale <input type="number" min="0.5" max="2" step="0.01" value={clip.scale} onInput={(event) => updateClip(clip.id, { scale: Number(event.currentTarget.value) })} /></label><label>Rotate <input type="number" min="-180" max="180" step="1" value={clip.rotationDegrees} onInput={(event) => updateClip(clip.id, { rotationDegrees: Number(event.currentTarget.value) })} /></label></div><small>Worker windows: {splitWindows(clip, `driver-${clip.id}`).windows.length} · each at most {MAX_WINDOW_SECONDS.toFixed(2)}s · pelvis anchor (50%, 58%)</small></article>) : <div className="generative-dance-track__empty"><Video size={20} aria-hidden="true" /><strong>Your sequence is empty</strong><span>Add one or more driver videos. Gaps between timeline starts are preserved for transitions.</span></div>}</div>
        <div className="generative-dance-payment"><div><span>Wallet</span><strong>{balanceLabel}</strong></div><div className="dance-station-payment-currency" role="radiogroup" aria-label="Generative dance payment currency">{(["FACELESS", "SOL"] as const).map((currency) => <label key={currency} className={paymentCurrency === currency ? "is-active" : ""}><input type="radio" name="generative-dance-currency" checked={paymentCurrency === currency} onChange={() => setPaymentCurrency(currency)} /><span>{currency === "FACELESS" ? "$FACELESS" : "SOL"}</span></label>)}</div><div className="dance-creation-price-row"><span>Generative dance loop</span><strong>{danceCost}</strong></div></div>
        <button type="button" className="rhythm-beats-submit" disabled={danceBusy || !sequence || sequence.durationSeconds > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01 || !selectedAvatar || !pricing} onClick={() => void generateDance()}>{danceBusy ? <><LoaderCircle size={15} className="is-spinning" aria-hidden="true" /> Generating sequence</> : <><Save size={15} aria-hidden="true" /> Generate and save dance</>}</button>
        {danceMessage ? <p className={`generative-dance-message${/could not|failed|error|choose/i.test(danceMessage) ? " is-error" : ""}`} role="status">{/could not|failed|error/i.test(danceMessage) ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}{danceMessage}</p> : null}
        {pricingError ? <p className="generative-dance-message is-error" role="status">{pricingError}</p> : null}
      </section>
    </div>
  </section>;
}
