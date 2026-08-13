import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { ChevronLeft, ChevronRight, LoaderCircle, UserRound, Waves } from "lucide-preact";
import type { DanceMotionClip, DanceMotionComposition } from "@faceless/shared";
import type { LibraryItem } from "../../lib/api";
import type { BrowserWorkspaceItem } from "../../lib/danceStationWorkspace";
import { DanceEngineCanvas } from "../dance-engine/DanceEngineCanvas";
import { composeDanceMotion } from "../dance-engine/motionComposition";
import { parseDanceModelManifest } from "../dance-engine/modelManifest";
import type { DanceModelPreset, DanceRuntimeOptions, DanceRuntimeSnapshot } from "../dance-engine/types";

type CatalogItem = BrowserWorkspaceItem | LibraryItem;
type AssetSource = "private" | "public";

interface AssetChoice {
  id: string;
  title: string;
  source: AssetSource;
  item: CatalogItem;
}

interface Props {
  workspaceItems: BrowserWorkspaceItem[];
  publicItems: LibraryItem[];
  selectedModelId?: string;
  selectedDanceId?: string;
  onSelectionChange?: (kind: "model" | "dance", id: string) => void;
  showSelectors?: boolean;
  showHeading?: boolean;
  className?: string;
  motionPlaybackPlaying?: boolean;
}

const PREVIEW_OPTIONS: DanceRuntimeOptions = {
  energy: 0.68,
  variety: 0.62,
  bpmScale: 1,
  style: "balanced",
  liveAccents: false,
  reducedQuality: true,
  minBeatStrength: 0.1,
  seed: 31,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDanceStageEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.danceStageEnabled !== false;
}

function metadataFiles(item: CatalogItem): Array<Record<string, unknown>> {
  if ("files" in item) {
    return item.files.map((file) => file as unknown as Record<string, unknown>);
  }
  const value = item.metadata.files;
  return Array.isArray(value)
    ? value.filter((file): file is Record<string, unknown> => isRecord(file))
    : [];
}

function fileRecord(item: CatalogItem, role: string): Record<string, unknown> | null {
  return metadataFiles(item).find((file) => file.role === role) ?? null;
}

function fileUrl(item: CatalogItem, role: string): string {
  const file = fileRecord(item, role);
  if (!file) return "";
  if ("files" in item && typeof file.id === "string") {
    // Public Bunny URLs do not expose CORS headers. Keep browser reads on the
    // site origin so unauthenticated Dance Stage visitors can load assets.
    return `/api/library/${encodeURIComponent(item.id)}/files/${encodeURIComponent(file.id)}`;
  }
  if (typeof file.publicUrl === "string" && file.publicUrl.trim()) return file.publicUrl.trim();
  return "";
}

function fileBlob(item: CatalogItem, role: string): Blob | null {
  const file = fileRecord(item, role);
  if (file?.blob instanceof Blob) return file.blob;
  if (!("files" in item) && item.metadata.blob instanceof Blob && !file) return item.metadata.blob;
  return null;
}

function linkedLibraryId(item: BrowserWorkspaceItem): string {
  if (typeof item.metadata.libraryItemId === "string" && item.metadata.libraryItemId.trim()) {
    return item.metadata.libraryItemId.trim();
  }
  const publicLibrary = item.metadata.publicLibrary;
  if (isRecord(publicLibrary) && typeof publicLibrary.id === "string" && publicLibrary.id.trim()) {
    return publicLibrary.id.trim();
  }
  return "";
}

function assetChoices(items: CatalogItem[], kind: string, source: AssetSource, hiddenPublicIds = new Set<string>()): AssetChoice[] {
  return items
    .filter((item) => item.kind === kind && isDanceStageEnabled(item.metadata) && (source !== "public" || !hiddenPublicIds.has(item.id)))
    .map((item) => ({ id: `${source}:${item.id}`, title: item.title || "Untitled", source, item }));
}

function compositionFromItem(item: CatalogItem): DanceMotionComposition | null {
  const value = item.metadata.composition;
  if (!isRecord(value) || value.format !== "faceless-dance-composition" || !Array.isArray(value.segments)) return null;
  return value as unknown as DanceMotionComposition;
}

async function readTextAsset(item: CatalogItem, role: string): Promise<string> {
  const blob = fileBlob(item, role);
  if (blob) return blob.text();
  const url = fileUrl(item, role);
  if (!url) throw new Error(`The ${role.replace(/_/g, " ")} file is unavailable.`);
  const publicFile = "files" in item || ("source" in item && item.source === "public-library") || /^https?:\/\//i.test(url);
  const response = await fetch(url, { credentials: publicFile ? "omit" : "include" });
  if (!response.ok) throw new Error(`Could not load the ${role.replace(/_/g, " ")} file.`);
  return response.text();
}

function modelObjectUrl(item: CatalogItem): { url: string; revoke: boolean } {
  const blob = fileBlob(item, "model");
  if (blob) return { url: URL.createObjectURL(blob), revoke: true };
  const url = fileUrl(item, "model");
  return { url, revoke: false };
}

export function DanceStageDancerPanel({
  workspaceItems,
  publicItems,
  selectedModelId: controlledModelId,
  selectedDanceId: controlledDanceId,
  onSelectionChange,
  showSelectors = true,
  showHeading = true,
  className,
  motionPlaybackPlaying,
}: Props): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localSelectedModelId, setLocalSelectedModelId] = useState("");
  const [localSelectedDanceId, setLocalSelectedDanceId] = useState("");
  const [model, setModel] = useState<DanceModelPreset | null>(null);
  const [motion, setMotion] = useState<DanceMotionClip | null>(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadingDance, setLoadingDance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DanceRuntimeSnapshot | null>(null);

  const hiddenPublicIds = useMemo(() => new Set(
    workspaceItems
      .filter((item) => (item.kind === "avatar" || item.kind === "dance_motion") && !isDanceStageEnabled(item.metadata))
      .map(linkedLibraryId)
      .filter(Boolean),
  ), [workspaceItems]);

  const modelChoices = useMemo(
    () => [
      ...assetChoices(workspaceItems, "avatar", "private"),
      ...assetChoices(publicItems, "avatar", "public", hiddenPublicIds),
    ],
    [hiddenPublicIds, publicItems, workspaceItems],
  );
  const danceChoices = useMemo(
    () => [
      ...assetChoices(workspaceItems, "dance_motion", "private"),
      ...assetChoices(publicItems, "dance_motion", "public", hiddenPublicIds),
    ],
    [hiddenPublicIds, publicItems, workspaceItems],
  );

  const selectedModelId = controlledModelId ?? localSelectedModelId;
  const selectedDanceId = controlledDanceId ?? localSelectedDanceId;
  const setSelectedModelId = useCallback((id: string) => {
    if (controlledModelId !== undefined) onSelectionChange?.("model", id);
    else setLocalSelectedModelId(id);
  }, [controlledModelId, onSelectionChange]);
  const setSelectedDanceId = useCallback((id: string) => {
    if (controlledDanceId !== undefined) onSelectionChange?.("dance", id);
    else setLocalSelectedDanceId(id);
  }, [controlledDanceId, onSelectionChange]);

  useEffect(() => {
    if (modelChoices.length === 0) {
      setSelectedModelId("");
      return;
    }
    if (!modelChoices.some((choice) => choice.id === selectedModelId)) setSelectedModelId(modelChoices[0].id);
  }, [modelChoices, selectedModelId]);

  useEffect(() => {
    if (danceChoices.length === 0) {
      setSelectedDanceId("");
      return;
    }
    if (!danceChoices.some((choice) => choice.id === selectedDanceId)) setSelectedDanceId(danceChoices[0].id);
  }, [danceChoices, selectedDanceId]);

  const selectedModel = modelChoices.find((choice) => choice.id === selectedModelId) ?? null;
  const selectedDance = danceChoices.find((choice) => choice.id === selectedDanceId) ?? null;

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setModel(null);
    setSnapshot(null);
    setError(null);
    if (!selectedModel) {
      setLoadingModel(false);
      return () => undefined;
    }

    setLoadingModel(true);
    void (async () => {
      try {
        const modelSource = modelObjectUrl(selectedModel.item);
        if (!modelSource.url) throw new Error("This dancer asset has no model file.");
        if (modelSource.revoke) objectUrl = modelSource.url;
        const manifestText = await readTextAsset(selectedModel.item, "rig_manifest");
        const manifest = parseDanceModelManifest(JSON.parse(manifestText)).manifest;
        if (cancelled) return;
        setModel({
          id: selectedModel.id,
          label: selectedModel.title,
          url: modelSource.url,
          clipNames: { idle: "Idle" },
          baseClipName: "Idle",
          source: selectedModel.source === "public" ? "Public library" : "Private assets",
          manifest: { ...manifest, modelFile: modelSource.url },
        });
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the selected dancer.");
      } finally {
        if (!cancelled) setLoadingModel(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedModel]);

  useEffect(() => {
    let cancelled = false;
    setMotion(null);
    setError(null);
    if (!selectedDance) {
      setLoadingDance(false);
      return () => undefined;
    }

    setLoadingDance(true);
    void (async () => {
      try {
        let composition = compositionFromItem(selectedDance.item);
        if (!composition) {
          const motionText = await readTextAsset(selectedDance.item, "motion");
          const parsed = JSON.parse(motionText);
          if (!isRecord(parsed) || parsed.format !== "faceless-dance-composition") throw new Error("This dance asset has no usable motion composition.");
          composition = parsed as unknown as DanceMotionComposition;
        }
        const clip = composeDanceMotion(composition);
        if (!clip) throw new Error("This dance asset contains no playable motion frames.");
        if (!cancelled) setMotion(clip);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the selected dance.");
      } finally {
        if (!cancelled) setLoadingDance(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedDance]);

  const moveSelection = useCallback((kind: "model" | "dance", direction: -1 | 1) => {
    const choices = kind === "model" ? modelChoices : danceChoices;
    const currentId = kind === "model" ? selectedModelId : selectedDanceId;
    if (!choices.length) return;
    const currentIndex = Math.max(0, choices.findIndex((choice) => choice.id === currentId));
    const nextIndex = (currentIndex + direction + choices.length) % choices.length;
    if (kind === "model") setSelectedModelId(choices[nextIndex].id);
    else setSelectedDanceId(choices[nextIndex].id);
  }, [danceChoices, modelChoices, selectedDanceId, selectedModelId]);

  const handleEngineError = useCallback((message: string | null) => {
    if (message) setError(message);
  }, []);

  const ready = Boolean(model && motion);
  const panelClassName = ["game-menu-dancer-panel", className].filter(Boolean).join(" ");
  return (
    <section className={panelClassName} aria-label="Dancer and dance selection">
      {showHeading ? <div className="game-menu-dancer-heading">
        <div>
          <p className="game-menu-kicker">Dance Stage</p>
          <h3>Choose your dancer</h3>
        </div>
        <span className={`game-menu-dancer-status${ready ? " is-ready" : ""}`}>
          {loadingModel || loadingDance ? <LoaderCircle size={13} className="is-spinning" aria-hidden="true" /> : <UserRound size={13} aria-hidden="true" />}
          {ready ? "Ready" : "Preview"}
        </span>
      </div> : null}
      {showSelectors ? <div className="game-menu-dancer-selectors">
        <div className="game-menu-dancer-selector">
          <span className="game-menu-dancer-selector-label">Dancer</span>
          <button type="button" className="secondary game-icon-button" onClick={() => moveSelection("model", -1)} disabled={modelChoices.length < 2} aria-label="Previous dancer" title="Previous dancer">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{selectedModel?.title ?? "No dancer assets"}</strong>
          <button type="button" className="secondary game-icon-button" onClick={() => moveSelection("model", 1)} disabled={modelChoices.length < 2} aria-label="Next dancer" title="Next dancer">
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="game-menu-dancer-selector">
          <span className="game-menu-dancer-selector-label">Dance</span>
          <button type="button" className="secondary game-icon-button" onClick={() => moveSelection("dance", -1)} disabled={danceChoices.length < 2} aria-label="Previous dance" title="Previous dance">
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong>{selectedDance?.title ?? "No dance assets"}</strong>
          <button type="button" className="secondary game-icon-button" onClick={() => moveSelection("dance", 1)} disabled={danceChoices.length < 2} aria-label="Next dance" title="Next dance">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      </div> : null}
      <div className="game-menu-dancer-preview">
        {model ? (
          <DanceEngineCanvas
            key={`${selectedModelId}:${selectedDanceId}`}
            audioRef={audioRef}
            beats={[]}
            bpm={120}
            model={model}
            options={PREVIEW_OPTIONS}
            capturedMotion={motion}
            capturedMotionEnabled={Boolean(motion)}
            motionPlaybackPlaying={motionPlaybackPlaying ?? Boolean(motion)}
            onSnapshot={setSnapshot}
            onError={handleEngineError}
          />
        ) : (
          <div className={`game-menu-dancer-empty${loadingModel ? " is-loading" : ""}`} aria-live="polite">
            {loadingModel ? <LoaderCircle size={26} className="is-spinning" aria-hidden="true" /> : <UserRound size={28} aria-hidden="true" />}
            <strong>{loadingModel ? "Loading dancer..." : "No dancer selected"}</strong>
            <span>{loadingModel ? "Preparing the selected model" : "Generated and published avatar assets will appear here."}</span>
          </div>
        )}
        {showHeading && model && motion ? <div className="game-menu-dancer-preview-badge"><Waves size={13} aria-hidden="true" /> {snapshot?.loaded ? "Dancing" : "Loading"}</div> : null}
      </div>
      {error ? <p className="game-menu-dancer-error" role="status">{error}</p> : null}
      {!modelChoices.length || !danceChoices.length ? <p className="game-menu-dancer-hint">Create or publish a dancer and a dance asset in Dance Station to use the preview.</p> : null}
    </section>
  );
}
