import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AudioWaveform, Check, CircleHelp, Eye, EyeOff, FileUp, ImagePlus, LibraryBig, MoreHorizontal, Pencil, Piano, RotateCcw, Search, Settings2, SlidersHorizontal, Sparkles, Upload, Waves, X as XIcon, type LucideIcon } from "lucide-preact";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { LibraryAssetCard } from "../components/library/LibraryAssetCard";
import { RemoteGenerationPanel } from "../components/danceStation/RemoteGenerationPanel";
import { RhythmBeatsPanel } from "../components/danceStation/RhythmBeatsPanel";
import { DanceCreationPanel } from "../components/danceStation/DanceCreationPanel";
import { AudioMassInlineEditor, audioMassInlineController, type AudioMassEvent } from "../components/danceStation/AudioMassInlineEditor";
import { AudioPlayButton } from "../components/audio/SiteAudioPlayer";
import { api, type LibraryItem, type SupportIssueType } from "../lib/api";
import type { SessionState } from "../hooks/useSession";
import {
  createPrivateAssetWorkspaceItem,
  getBrowserWorkspaceStatus,
  getWorkspaceSetting,
  listWorkspaceItems,
  requestPersistentWorkspaceStorage,
  saveWorkspaceItem,
  setWorkspaceSetting,
  type BrowserWorkspaceItem,
  type BrowserWorkspaceStatus,
} from "../lib/danceStationWorkspace";
import { captureAvatarPreview } from "../lib/avatarPreviewCapture";
import danceMotionWireframeDefault from "../assets/library/dance-motion-wireframe-default.png";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

type DanceStationPanel = "library" | "audio-edit" | "instrument-lab" | "generation" | "rhythm-beats" | "dance-creation";

const panelHashById: Record<DanceStationPanel, string> = {
  generation: "music-generation",
  "rhythm-beats": "rhythm-beats",
  "dance-creation": "dance-creation",
  library: "library",
  "audio-edit": "audio-edit",
  "instrument-lab": "instrument-lab",
};

const panelIdByHash: Record<string, DanceStationPanel> = {
  "music-generation": "generation",
  generation: "generation",
  "rhythm-beats": "rhythm-beats",
  "dance-creation": "dance-creation",
  library: "library",
  "audio-edit": "audio-edit",
  "instrument-lab": "instrument-lab",
};

function panelFromHash(): DanceStationPanel {
  const hash = window.location.hash.replace(/^#/, "").trim().toLowerCase();
  return panelIdByHash[hash] ?? "generation";
}

const tools: Array<{
  id: DanceStationPanel;
  label: string;
  status: string;
  available: boolean;
  Icon: LucideIcon;
}> = [
  {
    id: "generation",
    label: "Music Generation",
    status: "REMOTE",
    available: true,
    Icon: Sparkles,
  },
  {
    id: "rhythm-beats",
    label: "Rhythm Beats",
    status: "REMOTE",
    available: true,
    Icon: Waves,
  },
  {
    id: "dance-creation",
    label: "Dance Creation",
    status: "REMOTE",
    available: true,
    Icon: Sparkles,
  },
  {
    id: "audio-edit",
    label: "Audio Edit",
    status: "",
    available: true,
    Icon: AudioWaveform,
  },
  {
    id: "instrument-lab",
    label: "Instrument Lab",
    status: "",
    available: true,
    Icon: Piano,
  },
  {
    id: "library",
    label: "Library",
    status: "",
    available: true,
    Icon: LibraryBig,
  },
];

export function DanceStationPage({ session, setSession }: Props): JSX.Element {
  const [activePanel, setActivePanel] = useState<DanceStationPanel>(panelFromHash);
  const [workspaceItems, setWorkspaceItems] = useState<BrowserWorkspaceItem[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<BrowserWorkspaceStatus | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [assetLabel, setAssetLabel] = useState("");
  const [showStorageHelp, setShowStorageHelp] = useState(false);
  const [helpModalView, setHelpModalView] = useState<"help" | "support">("help");
  const [supportEmail, setSupportEmail] = useState("");
  const [supportIssueType, setSupportIssueType] = useState<SupportIssueType>("bug_report");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportSubmitted, setSupportSubmitted] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [publicItems, setPublicItems] = useState<LibraryItem[]>([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [publicQuery, setPublicQuery] = useState("");
  const [instrumentLabel, setInstrumentLabel] = useState("Instrument idea");
  const [instrumentBpm, setInstrumentBpm] = useState(120);
  const [instrumentBars, setInstrumentBars] = useState(4);
  const [instrumentOctave, setInstrumentOctave] = useState(4);
  const [instrumentId, setInstrumentId] = useState("synth.lead");
  const [instrumentTracks, setInstrumentTracks] = useState<InstrumentTrack[]>(() => [createInstrumentTrack("Track 1", "synth.lead")]);
  const [activeInstrumentTrackId, setActiveInstrumentTrackId] = useState("track-main");
  const [instrumentStatus, setInstrumentStatus] = useState("Ready");
  const [instrumentPreviewUrl, setInstrumentPreviewUrl] = useState("");
  const [instrumentRecording, setInstrumentRecording] = useState(false);
  const [instrumentCountIn, setInstrumentCountIn] = useState(0);
  const [instrumentCursorBeat, setInstrumentCursorBeat] = useState(0);
  const [audioEditAssetQuery, setAudioEditAssetQuery] = useState("");
  const [audioEditRailTab, setAudioEditRailTab] = useState<"assets" | "export">("assets");
  const [audioEditLabel, setAudioEditLabel] = useState("");
  const [audioEditSaveStatus, setAudioEditSaveStatus] = useState("");
  const instrumentObjectUrlRef = useRef("");
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const instrumentAudioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const instrumentHeldNotesRef = useRef<Map<string, { pitch: number; start: number }>>(new Map());
  const instrumentRecordingStartedAtRef = useRef(0);
  const instrumentTimerRefs = useRef<number[]>([]);
  const instrumentLabFrameRef = useRef<HTMLIFrameElement | null>(null);
  const sessionRef = useRef(session);
  const workspaceItemsRef = useRef<BrowserWorkspaceItem[]>([]);
  const audioMassObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const audioMassExportRequestsRef = useRef<Map<string, {
    resolve: (payload: AudioMassExportPayload) => void;
    reject: (error: Error) => void;
    timeout: number;
  }>>(new Map());
  const instrumentAssetObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const workspaceCardObjectUrlsRef = useRef<Map<string, string>>(new Map());

  sessionRef.current = session;

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    if (!window.location.hash || !panelIdByHash[window.location.hash.replace(/^#/, "").trim().toLowerCase()]) {
      window.history.replaceState({}, "", `${window.location.pathname}#${panelHashById[activePanel]}`);
    }
    const onHashChange = () => setActivePanel(panelFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    return () => {
      if (instrumentObjectUrlRef.current) URL.revokeObjectURL(instrumentObjectUrlRef.current);
      audioMassObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioMassExportRequestsRef.current.forEach((request) => {
        window.clearTimeout(request.timeout);
        request.reject(new Error("Audio Edit was closed before export completed."));
      });
      audioMassExportRequestsRef.current.clear();
      instrumentAssetObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      workspaceCardObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      void liveAudioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    void refreshWorkspace();
    getWorkspaceSetting<boolean>("storageIntroDismissed")
      .then((dismissed) => setShowStorageHelp(!dismissed))
      .catch(() => setShowStorageHelp(true));
  }, []);

  useEffect(() => {
    workspaceItemsRef.current = workspaceItems;
    postAudioMassAssetCatalog(workspaceItems, audioMassObjectUrlsRef);
  }, [workspaceItems]);

  useEffect(() => {
    if (!audioEditSaveStatus) return;
    const timeout = window.setTimeout(() => setAudioEditSaveStatus(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [audioEditSaveStatus]);

  useEffect(() => {
    let cancelled = false;
    setPublicLoading(true);
    setPublicError(null);
    api.publicLibrary({ limit: 60 })
      .then((payload) => {
        if (!cancelled) setPublicItems(payload.items);
      })
      .catch((error: Error) => {
        if (!cancelled) setPublicError(error.message);
      })
      .finally(() => {
        if (!cancelled) setPublicLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshWorkspace = async () => {
    const [items, status] = await Promise.all([
      listWorkspaceItems(),
      getBrowserWorkspaceStatus(),
    ]);
    setWorkspaceItems(items);
    setWorkspaceStatus(status);
  };

  const selectPanel = (panel: DanceStationPanel) => {
    setActivePanel(panel);
    const nextHash = `#${panelHashById[panel]}`;
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  };

  const addPrivateAsset = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    await saveWorkspaceItem(createPrivateAssetWorkspaceItem(file, assetLabel || file.name));
    setAssetLabel("");
    setWorkspaceMessage(`${file.name} added to Private Assets.`);
    await refreshWorkspace();
  };

  const renameWorkspaceItem = async (item: BrowserWorkspaceItem, nextTitle: string) => {
    const title = nextTitle.trim();
    if (!title) throw new Error("Enter a name for this private asset.");
    if (title === item.title) return;
    await saveWorkspaceItem({
      ...item,
      title,
      updatedAt: new Date().toISOString(),
    });
    setWorkspaceMessage(`${title} renamed.`);
    await refreshWorkspace();
  };

  const setDanceStageVisibility = async (item: BrowserWorkspaceItem, enabled: boolean) => {
    if (!isDanceStageAsset(item.kind)) return;
    await saveWorkspaceItem({
      ...item,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        danceStageEnabled: enabled,
      },
    });
    setWorkspaceMessage(`${item.title} ${enabled ? "will appear in" : "hidden from"} Dance Stage.`);
    await refreshWorkspace();
  };

  const importPublicItem = async (item: LibraryItem) => {
    if (!session.authenticated) {
      throw new Error("Login to import public items.");
    }
    const now = new Date().toISOString();
    const creatorName = item.creator?.displayName || item.creator?.creatorSlug || item.creator?.publicKey || "Faceless creator";
    await saveWorkspaceItem({
      id: `public-${item.id}`,
      title: item.title,
      kind: item.kind,
      source: "public-library",
      creatorName,
      createdAt: now,
      updatedAt: now,
      metadata: {
        libraryItemId: item.id,
        publicLibrary: item,
        creatorName,
        description: item.description,
        tags: item.tags,
        files: item.files,
        ...(isDanceStageAsset(item.kind) ? { danceStageEnabled: isDanceStageEnabled(item.metadata) } : {}),
        ...(item.kind === "instrument" && item.metadata.instrumentDefinition
          ? { instrumentDefinition: item.metadata.instrumentDefinition }
          : {}),
      },
    });
    setWorkspaceMessage(`${item.title} added to Private Assets.`);
    await refreshWorkspace();
  };

  const publishRhythmGameWorkspaceItem = async (item: BrowserWorkspaceItem): Promise<void> => {
    if (!session.authenticated) throw new Error("Connect a wallet before publishing.");

    const metadata = item.metadata;
    const publicLibrary = recordMetadata(metadata.publicLibrary);
    const publicFiles = Array.isArray(publicLibrary.files)
      ? publicLibrary.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
    const sourceAudio = recordMetadata(metadata.sourceAudio);
    const sourceUrl = metadataText(sourceAudio.publicUrl, metadataText(metadata.publicUrl, publicFiles.find((file) => file.role === "audio")?.publicUrl as string ?? ""));
    const sourceFileName = metadataText(sourceAudio.fileName, metadataText(metadata.fileName, `${item.title}.audio`));
    const sourceMimeType = metadataText(sourceAudio.mimeType, metadataText(metadata.mimeType, "audio/mpeg"));
    const coverBlob = workspaceMetadataFile(metadata.cardImageBlob, metadata.cardImageFileName, metadata.cardImageMimeType);
    const publicCover = publicFiles.find((file) => file.role === "cover");
    if (!sourceUrl) throw new Error("This beat asset is missing its source audio.");
    if (!coverBlob && !publicCover?.publicUrl) throw new Error("Add a cover image before publishing this game beat asset.");

    const modeDifficultyCharts = recordMetadata(metadata.modeDifficultyCharts);
    const chartData = recordMetadata(metadata.chartData);
    const chartPayload = {
      schemaVersion: 1,
      runtime: "rhythm-beats",
      title: item.title,
      durationSeconds: metadata.durationSeconds,
      tempoBpm: chartData.tempoBpm,
      selectedStems: metadata.selectedStems,
      selectedEventKinds: metadata.selectedEventKinds,
      difficultySelectedEventIds: metadata.difficultySelectedEventIds,
      difficultyRangeSelections: metadata.difficultyRangeSelections,
      modeDifficultyCharts,
      availableGameModes: metadata.availableGameModes,
      availableDifficulties: metadata.availableDifficulties,
      modeDifficultyBeatCounts: metadata.modeDifficultyBeatCounts,
      gameBeats: metadata.gameBeats,
      gameNotes: metadata.gameNotes,
      gameBeatSelections: metadata.gameBeatSelections,
      gameBeatConfig: metadata.gameBeatConfig,
      gameBeatsUpdatedAtIso: metadata.gameBeatsUpdatedAtIso,
      entry: {
        durationSeconds: metadata.durationSeconds,
        tempoBpm: chartData.tempoBpm,
      },
    };

    const publicMetadata: Record<string, unknown> = { ...metadata, sourceTool: "rhythm-beats", category: "rhythm_game", gameEnabled: true };
    ["audioArtifacts", "cardImageBlob", "chartObjectPath", "chartUrl", "publicLibrary", "publicLibraryStatus", "libraryItemId", "files"].forEach((key) => delete publicMetadata[key]);
    const volumeSlug = metadataText(metadata.volumeSlug, "rhythm-game");
    const tags = [...new Set(["rhythm-game", "game-ready", volumeSlug])];
    const currentlyPublished = isPublishedLibraryMetadata(metadata);
    const publishVerb = currentlyPublished ? "Updating" : "Publishing";
    const setPublishStage = (stage: string): void => {
      setWorkspaceMessage(`${publishVerb} ${item.title} · ${stage}`);
    };
    setPublishStage("Preparing public library item");

    const managed = await api.upsertOwnedLibraryItem({
      visibility: "public",
      kind: "rhythm_game",
      title: item.title,
      description: "Rhythm-game-ready music and metadata package.",
      tags,
      metadata: publicMetadata,
      sourceLineage: {
        localId: item.id,
        source: "dance-station-site",
        runtime: "rhythm-beats",
      },
      localId: item.id,
    });
    await api.clearOwnedLibraryItemFiles(managed.item.id);

    setPublishStage("Uploading source audio");
    const sourceFile = await fetchPublicAssetFile(sourceUrl, sourceFileName, sourceMimeType);
    await api.uploadDraftLibraryFile(managed.item.id, {
      role: "audio",
      metadata: { originalTitle: item.title, source: "rhythm-beats-source" },
      file: sourceFile,
    });

    setPublishStage("Uploading chart");
    await api.uploadDraftLibraryFile(managed.item.id, {
      role: "chart",
      metadata: { originalTitle: `${item.title}.json`, source: "rhythm-beats-selected-chart" },
      file: jsonDownloadFile(`${item.title}.json`, chartPayload),
    });

    setPublishStage("Uploading cover");
    const coverFile = coverBlob ?? await fetchPublicAssetFile(String(publicCover?.publicUrl), "cover-image", metadataText(publicCover?.mimeType, "image/png"));
    await api.uploadDraftLibraryFile(managed.item.id, {
      role: "cover",
      metadata: { originalTitle: coverFile.name },
      file: coverFile,
    });

    setPublishStage("Finalizing publication");
    const published = await api.publishDraftLibraryItem(managed.item.id);
    await saveWorkspaceItem({
      ...item,
      creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || published.item.creator?.publicKey || item.creatorName,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        publicLibrary: published.item,
        libraryItemId: published.item.id,
        publicLibraryStatus: "published",
        files: published.item.files,
      },
    });
    setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
    await refreshWorkspace();
  };

  const publishWorkspaceItem = async (item: BrowserWorkspaceItem) => {
    if (!session.authenticated) {
      throw new Error("Connect a wallet before publishing.");
    }
    if (item.source !== "private") {
      throw new Error("Only private assets can be published from the site right now.");
    }
    if (item.kind === "rhythm_game") {
      await publishRhythmGameWorkspaceItem(item);
      return;
    }
    if (item.kind === "dance_motion") {
      const composition = item.metadata.composition;
      if (!composition || typeof composition !== "object") throw new Error("This dance motion is missing its composition data.");
      const currentlyPublished = isPublishedLibraryMetadata(item.metadata);
      setWorkspaceMessage(`${currentlyPublished ? "Updating" : "Publishing"} ${item.title}...`);
      const managed = await api.upsertOwnedLibraryItem({
        visibility: "public",
        kind: "dance_motion",
        title: item.title,
        description: "Canonical dance motion composition for avatar playback.",
        tags: ["dance", "motion", "avatar"],
        metadata: {
          sourceTool: "dance-creation",
          composition,
          danceStageEnabled: isDanceStageEnabled(item.metadata),
        },
        sourceLineage: { localId: item.id, source: "dance-station-site" },
        localId: item.id,
      });
      await api.clearOwnedLibraryItemFiles(managed.item.id);
      await api.uploadDraftLibraryFile(managed.item.id, {
        role: "motion",
        metadata: { originalTitle: `${item.title}.dance.json`, source: "dance-creation" },
        file: jsonDownloadFile(`${item.title}.dance.json`, composition),
      });
      const published = await api.publishDraftLibraryItem(managed.item.id);
      await saveWorkspaceItem({
        ...item,
        creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || published.item.creator?.publicKey || item.creatorName,
        updatedAt: new Date().toISOString(),
        metadata: { ...item.metadata, publicLibrary: published.item, libraryItemId: published.item.id, publicLibraryStatus: "published", files: published.item.files },
      });
      setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
      await refreshWorkspace();
      return;
    }
    if (item.kind === "avatar") {
      const files = Array.isArray(item.metadata.files)
        ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
        : [];
      const modelFile = files.find((file) => file.role === "model");
      const manifestFile = files.find((file) => file.role === "rig_manifest");
      const modelObjectPath = typeof modelFile?.objectPath === "string"
        ? modelFile.objectPath.trim()
        : typeof modelFile?.path === "string"
          ? modelFile.path.trim()
          : "";
      const manifestObjectPath = typeof manifestFile?.objectPath === "string"
        ? manifestFile.objectPath.trim()
        : typeof manifestFile?.path === "string"
          ? manifestFile.path.trim()
          : "";
      if (!modelObjectPath) throw new Error("This avatar is missing its model file.");
      if (!manifestObjectPath) throw new Error("This avatar is missing its canonical rig manifest.");
      const currentlyPublished = isPublishedLibraryMetadata(item.metadata);
      setWorkspaceMessage(`${currentlyPublished ? "Updating" : "Publishing"} ${item.title}...`);
      const managed = await api.upsertOwnedLibraryItem({
        visibility: "public",
        kind: "avatar",
        title: item.title,
        description: "Rigged avatar model for dance playback.",
        tags: ["avatar", "dance"],
        metadata: {
          sourceTool: item.metadata.sourceTool ?? "avatar-generation",
          remoteJobId: item.metadata.remoteJobId,
          danceStageEnabled: isDanceStageEnabled(item.metadata),
        },
        sourceLineage: { localId: item.id, source: "dance-station-site", runtime: "avatar" },
        localId: item.id,
      });
      await api.clearOwnedLibraryItemFiles(managed.item.id);
      await api.copyDraftLibraryFileFromStorage(managed.item.id, {
        role: "model",
        metadata: { originalTitle: typeof modelFile?.fileName === "string" ? modelFile.fileName : `${item.title}.glb`, source: "avatar-generation" },
        sourceObjectPath: modelObjectPath,
        mimeType: typeof modelFile?.mimeType === "string" ? modelFile.mimeType : "model/gltf-binary",
        fileName: typeof modelFile?.fileName === "string" ? modelFile.fileName : `${item.title}.glb`,
      });
      await api.copyDraftLibraryFileFromStorage(managed.item.id, {
        role: "rig_manifest",
        metadata: { originalTitle: typeof manifestFile?.fileName === "string" ? manifestFile.fileName : "manifest.json", source: "avatar-generation" },
        sourceObjectPath: manifestObjectPath,
        mimeType: typeof manifestFile?.mimeType === "string" ? manifestFile.mimeType : "application/json",
        fileName: typeof manifestFile?.fileName === "string" ? manifestFile.fileName : "manifest.json",
      });
      const coverFile = workspaceMetadataFile(item.metadata.cardImageBlob, item.metadata.cardImageFileName, item.metadata.cardImageMimeType);
      if (coverFile) {
        await api.uploadDraftLibraryFile(managed.item.id, {
          role: "cover",
          metadata: { originalTitle: coverFile.name, source: "avatar-front-preview" },
          file: coverFile,
        });
      }
      const published = await api.publishDraftLibraryItem(managed.item.id);
      await saveWorkspaceItem({
        ...item,
        creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || published.item.creator?.publicKey || item.creatorName,
        updatedAt: new Date().toISOString(),
        metadata: { ...item.metadata, publicLibrary: published.item, libraryItemId: published.item.id, publicLibraryStatus: "published" },
      });
      setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
      await refreshWorkspace();
      return;
    }
    const linkedLibraryId = linkedLibraryItemIdFromMetadata(item.metadata);
    const currentlyPublished = isPublishedLibraryMetadata(item.metadata);
    if (item.kind === "instrument" && linkedLibraryId) {
      setWorkspaceMessage(`${currentlyPublished ? "Updating" : "Publishing"} ${item.title}...`);
      if (currentlyPublished) {
        const packageFiles = await workspaceInstrumentPackageFiles(item);
        await api.importInstrumentPackage({
          itemId: linkedLibraryId,
          title: item.title,
          sfz: packageFiles.sfz,
          samples: packageFiles.samples,
        });
      }
      const published = await api.publishDraftLibraryItem(linkedLibraryId);
      await saveWorkspaceItem({
        ...item,
        creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || published.item.creator?.publicKey || item.creatorName,
        updatedAt: new Date().toISOString(),
        metadata: {
          ...item.metadata,
          publicLibrary: published.item,
          libraryItemId: published.item.id,
          publicLibraryStatus: "published",
          files: published.item.files,
        },
      });
      setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
      await refreshWorkspace();
      return;
    }
    const sourceObjectPath = typeof item.metadata.objectPath === "string" ? item.metadata.objectPath.trim() : "";
    const localFile = workspaceMetadataFile(item.metadata.blob, item.metadata.fileName, item.metadata.mimeType);
    const file = localFile || (!sourceObjectPath ? await workspaceItemFile(item) : null);
    if (!file && !sourceObjectPath) {
      throw new Error("This private asset is missing its file data. Re-add it from disk or refresh the workspace before publishing.");
    }

    const tags = Array.isArray(item.metadata.tags)
      ? item.metadata.tags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const description = typeof item.metadata.description === "string" && item.metadata.description.trim()
      ? item.metadata.description.trim()
      : undefined;
    const mimeType = file?.type || (typeof item.metadata.mimeType === "string" ? item.metadata.mimeType : "application/octet-stream");
    const fileRole = mimeType.startsWith("audio/")
      ? "audio"
      : mimeType.startsWith("image/")
        ? "cover"
        : "metadata";

    setWorkspaceMessage(`${currentlyPublished ? "Updating" : "Publishing"} ${item.title}...`);

    const managed = await api.upsertOwnedLibraryItem({
      visibility: "public",
      kind: item.kind as any,
      title: item.title,
      description,
      tags,
      metadata: {
        sourceTool: item.metadata.sourceTool,
        mimeType: item.metadata.mimeType,
        sizeBytes: item.metadata.sizeBytes,
      },
      sourceLineage: {
        localId: item.id,
        source: "dance-station-site",
      },
      localId: item.id,
    });
    await api.clearOwnedLibraryItemFiles(managed.item.id);

    if (file) {
      await api.uploadDraftLibraryFile(managed.item.id, {
        role: fileRole,
        metadata: {
          originalTitle: item.title,
        },
        file,
      });
    } else {
      const sourceFileName = typeof item.metadata.fileName === "string" && item.metadata.fileName.trim()
        ? item.metadata.fileName
        : sourceObjectPath.split("/").pop() || `${item.title}.audio`;
      await api.copyDraftLibraryFileFromStorage(managed.item.id, {
        role: fileRole,
        metadata: {
          originalTitle: item.title,
        },
        sourceObjectPath,
        mimeType,
        fileName: sourceFileName,
      });
    }
    const coverBlob = item.metadata.cardImageBlob;
    const coverFile = workspaceMetadataFile(coverBlob, item.metadata.cardImageFileName, item.metadata.cardImageMimeType);
    if (coverFile) {
      await api.uploadDraftLibraryFile(managed.item.id, {
        role: "cover",
        metadata: {
          originalTitle: coverFile.name,
        },
        file: coverFile,
      });
    }

    const published = await api.publishDraftLibraryItem(managed.item.id);
    await saveWorkspaceItem({
      ...item,
      creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || published.item.creator?.publicKey || item.creatorName,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        publicLibrary: published.item,
        libraryItemId: published.item.id,
        publicLibraryStatus: "published",
      },
    });
    setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
    await refreshWorkspace();
  };

  const revokeWorkspaceItem = async (item: BrowserWorkspaceItem) => {
    const linkedPublicItem = publicLibraryItemForWorkspaceItem(item, publicItems);
    const libraryItemId = linkedPublicItem?.id || linkedLibraryItemIdFromMetadata(item.metadata);
    if (!libraryItemId) {
      throw new Error("This asset is not linked to a published library item.");
    }
    setWorkspaceMessage(`Revoking ${item.title}...`);
    const revoked = await api.revokeOwnedLibraryItem(libraryItemId);
    await saveWorkspaceItem({
      ...item,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        publicLibrary: revoked.item,
        libraryItemId: revoked.item.id,
        publicLibraryStatus: revoked.item.status,
      },
    });
    setWorkspaceMessage(`${item.title} removed from the public library.`);
    await refreshWorkspace();
  };

  const requestPersistence = async () => {
    const granted = await requestPersistentWorkspaceStorage();
    setWorkspaceMessage(
      granted
        ? "Persistent browser storage granted."
        : "Persistent storage was not granted. Local save still works, but account sync is safest for important work."
    );
    await refreshWorkspace();
  };

  const dismissStorageHelp = async () => {
    await setWorkspaceSetting("storageIntroDismissed", true);
    setShowStorageHelp(false);
  };

  const openHelpModal = () => {
    setHelpModalView("help");
    setSupportSubmitted(false);
    setSupportError("");
    setShowStorageHelp(true);
  };

  const closeHelpModal = () => {
    setShowStorageHelp(false);
    setHelpModalView("help");
    setSupportSubmitted(false);
    setSupportError("");
  };

  const openSupportForm = () => {
    setHelpModalView("support");
    setSupportSubmitted(false);
    setSupportError("");
  };

  const submitSupportRequest = async (event: SubmitEvent) => {
    event.preventDefault();
    setSupportError("");
    setSupportSubmitting(true);
    try {
      await api.submitSupportRequest({
        email: supportEmail.trim(),
        issueType: supportIssueType,
        message: supportMessage.trim(),
      });
      setSupportSubmitted(true);
      setSupportMessage("");
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "Support is temporarily unavailable. Please try again shortly.");
    } finally {
      setSupportSubmitting(false);
    }
  };

  const activeInstrumentTrack = instrumentTracks.find((track) => track.id === activeInstrumentTrackId) ?? instrumentTracks[0] ?? null;
  const activeInstrumentNotes = activeInstrumentTrack?.kind === "instrument" ? activeInstrumentTrack.notes : [];
  const activeInstrumentId = activeInstrumentTrack?.kind === "instrument" ? activeInstrumentTrack.instrumentId : instrumentId;
  const instrumentAssets = workspaceItems.filter(workspaceItemHasAudio).map((item) => ({
    id: item.id,
    title: item.title,
    kind: formatKind(item.kind),
    creatorName: item.creatorName,
  }));
  const audioMassAssets = buildAudioMassWorkspaceAssets(workspaceItems, audioMassObjectUrlsRef);

  const sendAudioMassAssets = () => {
    postAudioMassAssetCatalog(workspaceItemsRef.current, audioMassObjectUrlsRef);
  };

  const handleAudioMassEvent = (event: AudioMassEvent) => {
    if (event.type === "dance-station:request-assets") {
      setAudioEditRailTab("assets");
      setWorkspaceMessage("Choose an audio asset from My Assets.");
      sendAudioMassAssets();
      return;
    }
    if (event.type === "dance-station:audiomass-ready") {
      sendAudioMassAssets();
      return;
    }
    if (event.type === "dance-station:audiomass-loaded") {
      const sourceName = typeof event.payload.sourceName === "string" ? event.payload.sourceName : "";
      const suggested = sourceName.replace(/\.[^.]+$/, "").trim();
      if (suggested) setAudioEditLabel(suggested);
      setAudioEditSaveStatus("");
      return;
    }
    if (event.type === "dance-station:audiomass-drop") {
      const dropped = event.payload.asset;
      if (!dropped || typeof dropped !== "object") {
        setWorkspaceMessage("Audio Edit could not read that asset.");
        return;
      }
      const candidate = dropped as Partial<AudioMassWorkspaceAsset>;
      if (typeof candidate.url !== "string" || typeof candidate.title !== "string") {
        setWorkspaceMessage("Audio Edit could not read that asset.");
        return;
      }
      void addAudioMassAsset({
        id: typeof candidate.id === "string" ? candidate.id : `drag-${crypto.randomUUID()}`,
        title: candidate.title,
        kind: typeof candidate.kind === "string" ? candidate.kind : "Audio file",
        creatorName: typeof candidate.creatorName === "string" ? candidate.creatorName : undefined,
        url: candidate.url,
        mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
        duration: typeof candidate.duration === "number" ? candidate.duration : undefined,
      }, {
        trackId: typeof event.payload.trackId === "string" ? event.payload.trackId : undefined,
        start: typeof event.payload.start === "number" ? event.payload.start : undefined,
      });
      return;
    }
    if (event.type === "dance-station:native-download") {
      downloadAudioMassFile(event.payload);
      return;
    }
    if (event.type === "dance-station-export-audio-result") {
      const requestId = typeof event.payload.requestId === "string" ? event.payload.requestId : "";
      const request = requestId ? audioMassExportRequestsRef.current.get(requestId) : undefined;
      if (!request) return;
      audioMassExportRequestsRef.current.delete(requestId);
      window.clearTimeout(request.timeout);
      if (event.payload.ok !== true || !(event.payload.audio instanceof ArrayBuffer)) {
        request.reject(new Error(typeof event.payload.error === "string" ? event.payload.error : "Audio Edit did not return the rendered audio."));
        return;
      }
      request.resolve(event.payload as AudioMassExportPayload);
      return;
    }
    if (event.type === "dance-station:audiomass-error") {
      setAudioEditSaveStatus("Save failed");
      setWorkspaceMessage(typeof event.payload.message === "string" ? event.payload.message : "AudioMass reported an error.");
    }
  };

  const setWorkspaceCardImage = async (item: BrowserWorkspaceItem, fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      throw new Error("Select an image file for the card background.");
    }
    const existing = workspaceCardObjectUrlsRef.current.get(`${item.id}:card-image`);
    if (existing) {
      URL.revokeObjectURL(existing);
      workspaceCardObjectUrlsRef.current.delete(`${item.id}:card-image`);
    }
    await saveWorkspaceItem({
      ...item,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        cardImageBlob: file,
        cardImageFileName: file.name,
        cardImageMimeType: file.type,
      },
    });
    setWorkspaceMessage(`${item.title} card image updated.`);
    await refreshWorkspace();
  };

  const extractAvatarCardImage = async (item: BrowserWorkspaceItem) => {
    if (item.kind !== "avatar") return;
    const files = Array.isArray(item.metadata.files)
      ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
    const modelFile = files.find((file) => file.role === "model");
    const manifestFile = files.find((file) => file.role === "rig_manifest");
    const modelUrl = typeof modelFile?.publicUrl === "string"
      ? modelFile.publicUrl.trim()
      : typeof modelFile?.objectPath === "string"
        ? `/api/remote-generation/assets/file?path=${encodeURIComponent(modelFile.objectPath)}`
        : "";
    let manifest: Record<string, unknown> = {};
    if (manifestFile?.blob instanceof Blob) {
      manifest = recordMetadata(JSON.parse(await manifestFile.blob.text()));
    } else if (typeof manifestFile?.publicUrl === "string" && manifestFile.publicUrl.trim()) {
      const response = await fetch(manifestFile.publicUrl, { credentials: "include" });
      if (response.ok) manifest = recordMetadata(await response.json());
    }
    const orientation = recordMetadata(manifest.orientation ?? item.metadata.orientation);
    const yawRadians = typeof orientation.yawRadians === "number" ? orientation.yawRadians : 0;
    setWorkspaceMessage(`Extracting a front preview for ${item.title}...`);
    const blob = await captureAvatarPreview({ url: modelUrl, yawRadians });
    await saveWorkspaceItem({
      ...item,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        cardImageBlob: blob,
        cardImageFileName: `${item.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "avatar"}-front.png`,
        cardImageMimeType: "image/png",
      },
    });
    setWorkspaceMessage(`${item.title} front preview updated.`);
    await refreshWorkspace();
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data || {};
      if (event.source === instrumentLabFrameRef.current?.contentWindow) {
        if (message.source !== "dance-station-instrument-lab") return;
        if (message.type === "instrument-lab:ready" || message.type === "instrument-lab:request-assets") {
          sendInstrumentLabAssets();
          return;
        }
        if (message.type === "instrument-lab:save") {
          void saveInstrumentLabExport(message.payload).catch((error: Error) => {
            instrumentLabFrameRef.current?.contentWindow?.postMessage({
              source: "dance-station-host",
              type: "instrument-lab:error",
              payload: { message: error.message },
            }, window.location.origin);
            setWorkspaceMessage(error.message);
          });
          return;
        }
        if (message.type === "instrument-lab:save-instrument") {
          void saveInstrumentLabPackage(message.payload).catch((error: Error) => {
            instrumentLabFrameRef.current?.contentWindow?.postMessage({
              source: "dance-station-host",
              type: "instrument-lab:error",
              payload: { message: error.message },
            }, window.location.origin);
            setWorkspaceMessage(error.message);
          });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const addInstrumentNote = (pitch: number, startBeat?: number, durationBeat?: number) => {
    if (!activeInstrumentTrack || activeInstrumentTrack.kind !== "instrument") {
      setInstrumentStatus("Select an instrument track");
      return;
    }
    const start = startBeat ?? (instrumentRecording
      ? currentRecordingBeat(instrumentRecordingStartedAtRef.current, instrumentBpm)
      : nextInstrumentStart(activeInstrumentNotes));
    const note = {
      id: crypto.randomUUID(),
      pitch,
      start,
      duration: durationBeat ?? 0.5,
      velocity: 0.82,
    };
    setInstrumentTracks((current) => current.map((track) => (
      track.id === activeInstrumentTrack.id && track.kind === "instrument"
        ? { ...track, notes: [...track.notes, note] }
        : track
    )));
  };

  const clearInstrumentNotes = () => {
    if (!activeInstrumentTrack || activeInstrumentTrack.kind !== "instrument") return;
    setInstrumentTracks((current) => current.map((track) => (
      track.id === activeInstrumentTrack.id && track.kind === "instrument" ? { ...track, notes: [] } : track
    )));
    setInstrumentStatus("Ready");
  };

  const addInstrumentTrack = () => {
    const next = createInstrumentTrack(`Track ${instrumentTracks.filter((track) => track.kind === "instrument").length + 1}`, instrumentId);
    setInstrumentTracks((current) => [...current, next]);
    setActiveInstrumentTrackId(next.id);
    setInstrumentStatus("Track added");
  };

  const updateInstrumentTrack = (trackId: string, patch: Partial<InstrumentTrack>) => {
    setInstrumentTracks((current) => current.map((track) => (
      track.id === trackId ? ({ ...track, ...patch } as InstrumentTrack) : track
    )));
  };

  const importInstrumentAssetTrack = (assetId: string) => {
    const item = workspaceItems.find((candidate) => candidate.id === assetId);
    if (!item) return;
    const url = workspaceItemAudioUrl(item, instrumentAssetObjectUrlsRef);
    if (!url) {
      setInstrumentStatus("Could not load asset");
      return;
    }
    const track = createAudioTrack(item.title, url, item.title);
    setInstrumentTracks((current) => [...current, track]);
    setActiveInstrumentTrackId(track.id);
    setInstrumentStatus("Audio track added");
  };

  const playInstrumentClip = async () => {
    const playableTracks = instrumentTracks.filter((track) => !track.muted && (track.kind === "audio" || track.notes.length));
    if (!playableTracks.length) {
      setInstrumentStatus("Add or import a track first");
      return;
    }
    await stopInstrumentClip();
    const context = liveAudioContextRef.current || new AudioContext();
    liveAudioContextRef.current = context;
    await context.resume();
    setInstrumentStatus("Playing");
    setInstrumentCursorBeat(0);
    const destination = context.destination;
    const startAt = context.currentTime + 0.04;
    await scheduleInstrumentTracks(context, destination, playableTracks, instrumentBpm, startAt, instrumentAudioBufferCacheRef.current);
    const startedAt = performance.now();
    const durationBeats = Math.max(instrumentBars * 4, ...playableTracks.flatMap((track) => (
      track.kind === "instrument" ? track.notes.map((note) => note.start + note.duration) : [instrumentBars * 4]
    )));
    const cursorTimer = window.setInterval(() => {
      setInstrumentCursorBeat(Math.min(durationBeats, ((performance.now() - startedAt) / 1000) / beatSeconds(instrumentBpm)));
    }, 33);
    const doneTimer = window.setTimeout(() => {
      window.clearInterval(cursorTimer);
      setInstrumentStatus("Ready");
    }, Math.max(600, instrumentDurationSeconds(instrumentNotes, instrumentBpm) * 1000 + 200));
    instrumentTimerRefs.current.push(cursorTimer, doneTimer);
  };

  const stopInstrumentClip = async () => {
    instrumentTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    instrumentTimerRefs.current = [];
    instrumentHeldNotesRef.current.clear();
    setInstrumentRecording(false);
    setInstrumentCountIn(0);
    setInstrumentCursorBeat(0);
    await liveAudioContextRef.current?.close();
    liveAudioContextRef.current = null;
    setInstrumentStatus("Ready");
  };

  const startInstrumentRecording = async () => {
    await stopInstrumentClip();
    setInstrumentStatus("Count-in");
    setInstrumentCountIn(2);
    const first = window.setTimeout(() => setInstrumentCountIn(1), 1000);
    const second = window.setTimeout(async () => {
      const context = new AudioContext();
      liveAudioContextRef.current = context;
      await context.resume();
      const backingTracks = instrumentTracks.filter((track) => !track.muted && track.playDuringRecord);
      await scheduleInstrumentTracks(context, context.destination, backingTracks, instrumentBpm, context.currentTime + 0.04, instrumentAudioBufferCacheRef.current);
      instrumentRecordingStartedAtRef.current = performance.now();
      setInstrumentCursorBeat(0);
      setInstrumentRecording(true);
      setInstrumentCountIn(0);
      setInstrumentStatus("Recording");
      const cursorTimer = window.setInterval(() => {
        setInstrumentCursorBeat(currentRecordingBeat(instrumentRecordingStartedAtRef.current, instrumentBpm));
      }, 33);
      instrumentTimerRefs.current.push(cursorTimer);
    }, 2000);
    instrumentTimerRefs.current.push(first, second);
  };

  const renderInstrumentClip = async () => {
    const file = await renderInstrumentTracks({ trackOnly: false });
    return file;
  };

  const renderActiveInstrumentTrack = async () => {
    const file = await renderInstrumentTracks({ trackOnly: true });
    return file;
  };

  const renderInstrumentTracks = async ({ trackOnly }: { trackOnly: boolean }) => {
    const tracks = trackOnly && activeInstrumentTrack ? [activeInstrumentTrack] : instrumentTracks;
    const renderableTracks = tracks.filter((track) => !track.muted && (track.kind === "audio" || track.notes.length));
    if (!renderableTracks.length) {
      setInstrumentStatus(trackOnly ? "Select a track with notes or audio" : "Add or import a track first");
      return null;
    }
    setInstrumentStatus("Rendering");
    const file = await renderInstrumentWav({
      tracks: renderableTracks,
      bpm: instrumentBpm,
      bars: instrumentBars,
      label: trackOnly && activeInstrumentTrack ? activeInstrumentTrack.label : instrumentLabel,
      audioBufferCache: instrumentAudioBufferCacheRef.current,
    });
    if (instrumentObjectUrlRef.current) URL.revokeObjectURL(instrumentObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    instrumentObjectUrlRef.current = url;
    setInstrumentPreviewUrl(url);
    setInstrumentStatus("Rendered");
    return file;
  };

  const saveInstrumentClip = async ({ trackOnly = false }: { trackOnly?: boolean } = {}) => {
    const file = await renderInstrumentTracks({ trackOnly });
    if (!file) return;
    const title = trackOnly && activeInstrumentTrack ? activeInstrumentTrack.label : instrumentLabel;
    const item = createPrivateAssetWorkspaceItem(file, title || file.name, trackOnly ? "instrumenttrack" : "instrument");
    item.metadata = {
      ...item.metadata,
      bpm: instrumentBpm,
      bars: instrumentBars,
      tracks: trackOnly && activeInstrumentTrack ? [serializeInstrumentTrack(activeInstrumentTrack)] : instrumentTracks.map(serializeInstrumentTrack),
    };
    await saveWorkspaceItem(item);
    setWorkspaceMessage(`${item.title} saved to Private Assets.`);
    await refreshWorkspace();
  };

  const saveAudioMassExport = async (payload: {
    audio?: ArrayBuffer;
    name?: string;
    mimeType?: string;
    duration?: number;
    sampleRate?: number;
    channels?: number;
  }) => {
    if (!payload?.audio) throw new Error("AudioMass did not return exported audio.");
    const label = audioEditLabel.trim();
    if (!label) throw new Error("Enter an asset name before saving.");
    const name = `${label}.wav`;
    const file = new File([payload.audio], name, { type: payload.mimeType || "audio/wav" });
    const item = createPrivateAssetWorkspaceItem(file, label, "edit");
    item.metadata = {
      ...item.metadata,
      sourceTool: "audio-edit",
      duration: payload.duration,
      sampleRate: payload.sampleRate,
      channels: payload.channels,
    };
    await saveWorkspaceItem(item);
    setWorkspaceMessage(`${item.title} saved to Private Assets.`);
    setAudioEditLabel(item.title);
    setAudioEditSaveStatus("Saved");
    await refreshWorkspace();
  };

  const downloadAudioMassFile = (payload: {
    name?: string;
    mimeType?: string;
    buffer?: ArrayBuffer;
  }) => {
    if (!payload?.buffer) {
      setWorkspaceMessage("AudioMass did not provide a file to download.");
      return;
    }
    const blob = new Blob([payload.buffer], { type: payload.mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = payload.name || "audiomass-output.mp3";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setWorkspaceMessage(`${link.download} downloaded.`);
  };

  const sendInstrumentLabAssets = () => {
    const audioAssets = buildAudioMassWorkspaceAssets(workspaceItemsRef.current, instrumentAssetObjectUrlsRef).map((asset) => {
      const item = workspaceItemsRef.current.find((candidate) => candidate.id === asset.id);
      return {
        id: asset.id,
        title: asset.title,
        kind: item?.kind || asset.kind,
        creatorName: asset.creatorName,
        url: asset.url,
        metadata: {
          bpm: item?.metadata?.bpm,
          key: item?.metadata?.key,
          bars: item?.metadata?.bars,
          tracks: item?.metadata?.tracks,
        },
      };
    });
    const instrumentAssets = workspaceItemsRef.current
      .filter((item) => item.kind === "instrument")
      .map((item) => {
        const definition = workspaceInstrumentDefinition(item);
        if (!definition) return null;
        return {
          id: item.id,
          title: item.title,
          kind: "instrument",
          creatorName: item.creatorName,
          metadata: {
            instrumentDefinition: definition,
          },
        };
      })
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    const assets = [...audioAssets, ...instrumentAssets];
    instrumentLabFrameRef.current?.contentWindow?.postMessage({
      source: "dance-station-host",
      type: "instrument-lab:assets",
      payload: { assets },
    }, window.location.origin);
  };

  const saveInstrumentLabExport = async (payload: {
    audio?: ArrayBuffer;
    name?: string;
    title?: string;
    kind?: string;
    mimeType?: string;
    bpm?: number;
    key?: string;
    bars?: number;
    tracks?: unknown[];
  }) => {
    if (!payload?.audio) throw new Error("Instrument Lab did not return rendered audio.");
    const name = payload.name || `instrument-${Date.now()}.wav`;
    const file = new File([payload.audio], name, { type: payload.mimeType || "audio/wav" });
    const item = createPrivateAssetWorkspaceItem(file, payload.title || name.replace(/\.[^.]+$/, ""), payload.kind || "instrument");
    item.metadata = {
      ...item.metadata,
      sourceTool: "instrument-lab",
      bpm: payload.bpm,
      key: payload.key,
      bars: payload.bars,
      tracks: payload.tracks,
    };
    await saveWorkspaceItem(item);
    setWorkspaceMessage(`${item.title} saved to Private Assets.`);
    await refreshWorkspace();
    instrumentLabFrameRef.current?.contentWindow?.postMessage({
      source: "dance-station-host",
      type: "instrument-lab:saved",
      payload: {
        item: {
          id: item.id,
          title: item.title,
          kind: item.kind,
        },
      },
    }, window.location.origin);
  };

  const saveInstrumentLabPackage = async (payload: {
    title?: string;
    sfz?: File;
    samples?: File[];
  }) => {
    if (!sessionRef.current.authenticated) throw new Error("Connect a wallet before saving an instrument.");
    if (!(payload.sfz instanceof File) || !Array.isArray(payload.samples) || !payload.samples.every((file) => file instanceof File)) {
      throw new Error("Instrument Lab did not return a complete SFZ package.");
    }
    const imported = await api.importInstrumentPackage({
      title: payload.title?.trim() || payload.sfz.name.replace(/\.sfz$/i, ""),
      sfz: payload.sfz,
      samples: payload.samples,
    });
    const libraryItem = imported.item;
    const now = new Date().toISOString();
    const item: BrowserWorkspaceItem = {
      id: `instrument-${libraryItem.id}`,
      title: libraryItem.title,
      kind: "instrument",
      source: "private",
      creatorName: libraryItem.creator?.displayName || libraryItem.creator?.creatorSlug || libraryItem.creator?.publicKey || "",
      createdAt: libraryItem.createdAt || now,
      updatedAt: libraryItem.updatedAt || now,
      metadata: {
        storage: "remote-library",
        sourceTool: "instrument-lab",
        libraryItemId: libraryItem.id,
        publicLibrary: libraryItem,
        publicLibraryStatus: libraryItem.status,
        instrumentDefinition: libraryItem.metadata.instrumentDefinition,
        files: libraryItem.files,
        validation: imported.validation,
      },
    };
    await saveWorkspaceItem(item);
    setWorkspaceMessage(`${item.title} saved to Private Assets.`);
    await refreshWorkspace();
    const definition = workspaceInstrumentDefinition(item);
    instrumentLabFrameRef.current?.contentWindow?.postMessage({
      source: "dance-station-host",
      type: "instrument-lab:instrument-saved",
      payload: {
        item: { id: item.id, title: item.title, kind: item.kind },
        instrument: definition ? {
          id: `library:${item.id}`,
          name: item.title,
          category: "Saved SFZ",
          type: "sample",
          samples: definition.regions,
        } : null,
      },
    }, window.location.origin);
  };

  const addAudioMassAsset = async (asset: AudioMassWorkspaceAsset, placement?: { trackId?: string; start?: number }) => {
    setWorkspaceMessage(`Loading ${asset.title} into Audio Edit...`);
    setAudioEditLabel(asset.title.replace(/\.[^.]+$/, ""));
    setAudioEditSaveStatus("");
    if (!audioMassInlineController.isReady()) {
      setWorkspaceMessage("Audio Edit is not ready yet.");
      return;
    }
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Audio asset request failed (${response.status}).`);
      const buffer = await response.arrayBuffer();
      audioMassInlineController.addAudioBuffer({
        id: asset.id,
        buffer,
        name: asset.title,
        mimeType: asset.mimeType || response.headers.get("content-type") || "audio/wav",
        trackId: placement?.trackId,
        start: placement?.start,
      });
      setWorkspaceMessage(`${asset.title} added to Audio Edit.`);
    } catch {
      audioMassInlineController.addAudioClip({
        id: asset.id,
        url: asset.url,
        name: asset.title,
        mimeType: asset.mimeType,
      });
      setWorkspaceMessage(`${asset.title} sent to Audio Edit.`);
    }
  };

  const requestAudioMassEditorAudio = (label: string) => {
    if (!audioMassInlineController.isReady()) {
      return Promise.reject(new Error("Audio Edit is not ready."));
    }
    const requestId = crypto.randomUUID();
    return new Promise<AudioMassExportPayload>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        audioMassExportRequestsRef.current.delete(requestId);
        reject(new Error("Audio Edit did not return the rendered audio."));
      }, 60000);
      audioMassExportRequestsRef.current.set(requestId, { resolve, reject, timeout });
      audioMassInlineController.exportAudio(`${label}.wav`, requestId);
    });
  };

  const requestAudioMassWorkspaceSave = () => {
    const label = audioEditLabel.trim();
    if (!label) {
      setAudioEditSaveStatus("Enter a label");
      setWorkspaceMessage("Enter a label for the edit before saving.");
      return;
    }
    setAudioEditSaveStatus("Saving");
    setWorkspaceMessage(`Saving ${label} to Private Assets...`);
    void requestAudioMassEditorAudio(label)
      .then((payload) => saveAudioMassExport(payload))
      .catch((error: Error) => {
        setAudioEditSaveStatus("Save failed");
        setWorkspaceMessage(error.message);
      });
  };

  useEffect(() => {
    if (activePanel !== "instrument-lab") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const semitone = KEYBOARD_NOTE_MAP[event.key.toLowerCase()];
      if (semitone === undefined || event.repeat) return;
      event.preventDefault();
      const pitch = (instrumentOctave + 1) * 12 + semitone;
      if (instrumentRecording) {
        instrumentHeldNotesRef.current.set(event.key.toLowerCase(), {
          pitch,
          start: currentRecordingBeat(instrumentRecordingStartedAtRef.current, instrumentBpm),
        });
      } else {
        addInstrumentNote(pitch);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!instrumentRecording) return;
      const held = instrumentHeldNotesRef.current.get(event.key.toLowerCase());
      if (!held) return;
      instrumentHeldNotesRef.current.delete(event.key.toLowerCase());
      const end = currentRecordingBeat(instrumentRecordingStartedAtRef.current, instrumentBpm);
      addInstrumentNote(held.pitch, held.start, Math.max(0.125, end - held.start));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [activePanel, activeInstrumentTrackId, activeInstrumentNotes, instrumentOctave, instrumentRecording, instrumentBpm]);

  return (
    <main className={`home-v2 library-page-shell dance-station-app-shell${activePanel === "generation" ? " dance-station-app-shell--generation" : ""}${activePanel === "dance-creation" ? " dance-station-app-shell--dance-creation" : ""}`}>
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />

        {showStorageHelp ? (
          <section className="dance-station-storage-modal" role="dialog" aria-modal="true" aria-label={helpModalView === "support" ? "Contact support" : "Browser storage help"}>
            <div className="home-v2-card dance-station-storage-modal__card">
              {helpModalView === "support" ? (
                <SupportForm
                  email={supportEmail}
                  issueType={supportIssueType}
                  message={supportMessage}
                  submitting={supportSubmitting}
                  submitted={supportSubmitted}
                  error={supportError}
                  setEmail={setSupportEmail}
                  setIssueType={setSupportIssueType}
                  setMessage={setSupportMessage}
                  onSubmit={submitSupportRequest}
                  onBack={openHelpModal}
                  onClose={closeHelpModal}
                />
              ) : (
                <>
                  <p className="home-v2-kicker">First Use</p>
                  <h2>Browser work is saved on this device</h2>
                  <StorageCaveats includeSettingsNote />
                  <div className="dance-station-panel-actions">
                    <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => dismissStorageHelp().catch(() => closeHelpModal())}>
                      Got It
                    </button>
                    <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={openSupportForm}>
                      Contact Support
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}

        <section className="dance-station-app-header">
          <div>
            <p className="home-v2-kicker">Dance Station</p>
          </div>
          <div className="dance-station-header-actions">
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={openHelpModal}>
              <CircleHelp aria-hidden="true" size={15} strokeWidth={2} />
              <span>Help</span>
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => setShowSettings((value) => !value)}>
              <Settings2 aria-hidden="true" size={15} strokeWidth={2} />
              <span>{showSettings ? "Close Settings" : "Settings"}</span>
            </button>
          </div>
        </section>

        <section className="dance-station-tool-grid" aria-label="Dance Station tools">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`dance-station-tool-card${activePanel === tool.id ? " active" : ""}${tool.available ? "" : " disabled"}`}
              onClick={() => selectPanel(tool.id)}
            >
              <tool.Icon aria-hidden="true" size={16} strokeWidth={2} />
              <span className="dance-station-tool-card__label">{tool.label}</span>
              {!tool.available ? <span className="dance-station-tool-card__status">{tool.status}</span> : null}
            </button>
          ))}
        </section>

        <section className={`dance-station-main-grid${activePanel === "instrument-lab" || activePanel === "library" || activePanel === "audio-edit" ? " dance-station-main-grid--wide" : ""}${activePanel === "generation" ? " dance-station-main-grid--generation" : ""}${activePanel === "rhythm-beats" ? " dance-station-main-grid--rhythm-beats" : ""}${activePanel === "dance-creation" ? " dance-station-main-grid--dance-creation" : ""}`}>
          <div className="home-v2-card dance-station-main-panel">
            {showSettings ? (
              <BrowserWorkspaceSettings
                workspaceStatus={workspaceStatus}
                workspaceMessage={workspaceMessage}
                refreshWorkspace={refreshWorkspace}
                requestPersistence={requestPersistence}
                openStorageHelp={openHelpModal}
              />
            ) : activePanel === "library" ? (
                <LibraryWorkspacePanel
                  workspaceItems={workspaceItems}
                  session={session}
                  assetLabel={assetLabel}
                  workspaceMessage={workspaceMessage}
                  publicItems={publicItems}
                publicLoading={publicLoading}
                publicError={publicError}
                publicQuery={publicQuery}
                setAssetLabel={setAssetLabel}
                setPublicQuery={setPublicQuery}
                  addPrivateAsset={addPrivateAsset}
                  importPublicItem={importPublicItem}
                  publishWorkspaceItem={publishWorkspaceItem}
                  renameWorkspaceItem={renameWorkspaceItem}
                  setDanceStageVisibility={setDanceStageVisibility}
                  extractAvatarCardImage={extractAvatarCardImage}
                  revokeWorkspaceItem={revokeWorkspaceItem}
                  setWorkspaceCardImage={setWorkspaceCardImage}
                  workspaceCardObjectUrlsRef={workspaceCardObjectUrlsRef}
                  refreshWorkspace={refreshWorkspace}
                  setWorkspaceMessage={setWorkspaceMessage}
                />
            ) : activePanel === "audio-edit" ? (
              <AudioEditWorkspace
                onAudioMassEvent={handleAudioMassEvent}
                assets={audioMassAssets}
                query={audioEditAssetQuery}
                setQuery={setAudioEditAssetQuery}
                railTab={audioEditRailTab}
                setRailTab={setAudioEditRailTab}
                label={audioEditLabel}
                setLabel={setAudioEditLabel}
                saveStatus={audioEditSaveStatus}
                workspaceMessage={workspaceMessage}
                addAsset={addAudioMassAsset}
                saveCurrentEdit={requestAudioMassWorkspaceSave}
              />
            ) : activePanel === "instrument-lab" ? (
              <InstrumentLabPanel frameRef={instrumentLabFrameRef} />
            ) : activePanel === "generation" ? (
              <RemoteGenerationPanel session={session} workspaceItems={workspaceItems} publicItems={publicItems} onWorkspaceChanged={refreshWorkspace} />
            ) : activePanel === "rhythm-beats" ? (
              <RhythmBeatsPanel session={session} workspaceItems={workspaceItems} publicItems={publicItems} onWorkspaceChanged={refreshWorkspace} onPublishAsset={publishWorkspaceItem} />
            ) : activePanel === "dance-creation" ? (
              <DanceCreationPanel session={session} workspaceItems={workspaceItems} publicItems={publicItems} onWorkspaceChanged={refreshWorkspace} onPublishAsset={publishWorkspaceItem} />
            ) : (
              <UnavailablePanel tool={tools.find((tool) => tool.id === activePanel) ?? tools[0]} />
            )}
          </div>

          {activePanel !== "instrument-lab" && activePanel !== "generation" && activePanel !== "rhythm-beats" && activePanel !== "dance-creation" && activePanel !== "library" && activePanel !== "audio-edit" ? <aside className="home-v2-card dance-station-context-panel">
            {showSettings ? (
              <SettingsSummaryPanel
                session={session}
                workspaceStatus={workspaceStatus}
              />
            ) : (
              <>
                <p className="home-v2-kicker">Session</p>
                <h2>{session.authenticated ? "Connected" : "Not connected"}</h2>
                <p>
                  {session.authenticated
                    ? `Wallet ${session.publicKey.slice(0, 6)}...${session.publicKey.slice(-4)}`
                    : "Connect a wallet when you want to sync or publish account-owned assets."}
                </p>
              </>
            )}
          </aside> : null}
        </section>

        {activePanel === "generation" ? (
          <footer className="dance-station-status-bar" aria-label="Dance Station status">
            <span>Model: ACE-Step 1.5 XL Turbo</span>
            <span>Workspace: Local assets</span>
            <span>Queue: Remote launch</span>
            <span>System status <strong>Live above</strong></span>
          </footer>
        ) : null}

      </div>
    </main>
  );
}

function LibraryWorkspacePanel({
  workspaceItems,
  session,
  assetLabel,
  workspaceMessage,
  publicItems,
  publicLoading,
  publicError,
  publicQuery,
  setAssetLabel,
  setPublicQuery,
  addPrivateAsset,
  importPublicItem,
  publishWorkspaceItem,
  renameWorkspaceItem,
  setDanceStageVisibility,
  extractAvatarCardImage,
  revokeWorkspaceItem,
  setWorkspaceCardImage,
  workspaceCardObjectUrlsRef,
  refreshWorkspace,
  setWorkspaceMessage,
}: {
  workspaceItems: BrowserWorkspaceItem[];
  session: SessionState;
  assetLabel: string;
  workspaceMessage: string;
  publicItems: LibraryItem[];
  publicLoading: boolean;
  publicError: string | null;
  publicQuery: string;
  setAssetLabel: (value: string) => void;
  setPublicQuery: (value: string) => void;
  addPrivateAsset: (fileList: FileList | null) => Promise<void>;
  importPublicItem: (item: LibraryItem) => Promise<void>;
  publishWorkspaceItem: (item: BrowserWorkspaceItem) => Promise<void>;
  renameWorkspaceItem: (item: BrowserWorkspaceItem, nextTitle: string) => Promise<void>;
  setDanceStageVisibility: (item: BrowserWorkspaceItem, enabled: boolean) => Promise<void>;
  extractAvatarCardImage: (item: BrowserWorkspaceItem) => Promise<void>;
  revokeWorkspaceItem: (item: BrowserWorkspaceItem) => Promise<void>;
  setWorkspaceCardImage: (item: BrowserWorkspaceItem, fileList: FileList | null) => Promise<void>;
  workspaceCardObjectUrlsRef: { current: Map<string, string> };
  refreshWorkspace: () => Promise<void>;
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  const privateItems = workspaceItems.filter((item) => item.source === "private" || item.source === "public-library");
  const filteredPublicItems = publicItems.filter((item) => {
    const needle = publicQuery.trim().toLowerCase();
    if (!needle) return true;
    return [item.title, item.description ?? "", item.kind, item.tags.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <>
      <div className="dance-station-panel-head">
        <div>
          <p className="home-v2-kicker">Library</p>
          <h2>Private Assets</h2>
        </div>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => refreshWorkspace().catch((error) => setWorkspaceMessage(error.message))}>
          Refresh
        </button>
      </div>
      <p>
        Add audio and image files to your private workspace, import public items, then publish selected assets when
        the browser publish flow is connected.
      </p>

      <div className="dance-station-draft-row">
        <label>
          <span>Asset label</span>
          <input value={assetLabel} onInput={(event) => setAssetLabel((event.currentTarget as HTMLInputElement).value)} placeholder="optional display name" />
        </label>
        <label>
          <span>Upload private asset</span>
          <input type="file" accept="audio/*,image/*" onChange={(event) => addPrivateAsset((event.currentTarget as HTMLInputElement).files).catch((error) => setWorkspaceMessage(error.message))} />
        </label>
      </div>
      {workspaceMessage ? <p className="small dance-station-workspace-message">{workspaceMessage}</p> : null}

      <div className="dance-station-library-scroll">
        <div className="dance-station-workspace-list">
          {privateItems.length ? privateItems.map((item) => (
            <PrivateAssetRow
              key={item.id}
              item={item}
              linkedPublicItem={publicLibraryItemForWorkspaceItem(item, publicItems)}
              canPublish={session.authenticated && item.source === "private" && hasPublishableWorkspaceItem(item)}
              isAuthenticated={session.authenticated}
              onPublish={publishWorkspaceItem}
              onRename={renameWorkspaceItem}
              onSetDanceStageVisibility={setDanceStageVisibility}
              onExtractAvatarCardImage={extractAvatarCardImage}
              onRevoke={revokeWorkspaceItem}
              onSetCardImage={setWorkspaceCardImage}
              workspaceCardObjectUrlsRef={workspaceCardObjectUrlsRef}
              setWorkspaceMessage={setWorkspaceMessage}
            />
          )) : (
            <div className="library-empty">No private assets yet.</div>
          )}
        </div>
      </div>

      <div className="dance-station-section-divider"></div>

      <div className="dance-station-panel-head">
        <div>
          <p className="home-v2-kicker">Public Library</p>
          <h2>Browse and import</h2>
        </div>
      </div>
      <div className="library-toolbar dance-station-library-toolbar" aria-label="Dance Station public library filters">
        <label>
          <span>Search public items</span>
          <input
            value={publicQuery}
            onInput={(event) => setPublicQuery((event.currentTarget as HTMLInputElement).value)}
            placeholder="title, kind, tag"
          />
        </label>
      </div>
      {publicLoading ? <div className="library-empty">Loading public library...</div> : null}
      {publicError ? <div className="library-empty library-empty--error">{publicError}</div> : null}
      {!publicLoading && !publicError && filteredPublicItems.length === 0 ? (
        <div className="library-empty">No public items match this search.</div>
      ) : null}
      <div className="dance-station-library-scroll">
        <section className="library-grid dance-station-public-grid">
          {filteredPublicItems.map((item) => (
            <PublicLibraryAssetCard
              key={item.id}
              item={item}
              canImport={session.authenticated && item.creator?.publicKey !== session.publicKey}
              isOwner={session.authenticated && item.creator?.publicKey === session.publicKey}
              importPublicItem={importPublicItem}
              setWorkspaceMessage={setWorkspaceMessage}
            />
          ))}
        </section>
      </div>
    </>
  );
}

function PrivateAssetRow({
  item,
  linkedPublicItem,
  canPublish,
  isAuthenticated,
  onPublish,
  onRename,
  onSetDanceStageVisibility,
  onExtractAvatarCardImage,
  onRevoke,
  onSetCardImage,
  workspaceCardObjectUrlsRef,
  setWorkspaceMessage,
}: {
  item: BrowserWorkspaceItem;
  linkedPublicItem?: LibraryItem;
  canPublish: boolean;
  isAuthenticated: boolean;
  onPublish: (item: BrowserWorkspaceItem) => Promise<void>;
  onRename: (item: BrowserWorkspaceItem, nextTitle: string) => Promise<void>;
  onSetDanceStageVisibility: (item: BrowserWorkspaceItem, enabled: boolean) => Promise<void>;
  onExtractAvatarCardImage: (item: BrowserWorkspaceItem) => Promise<void>;
  onRevoke: (item: BrowserWorkspaceItem) => Promise<void>;
  onSetCardImage: (item: BrowserWorkspaceItem, fileList: FileList | null) => Promise<void>;
  workspaceCardObjectUrlsRef: { current: Map<string, string> };
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  const cardImageInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(item.title);
  const [renameSaving, setRenameSaving] = useState(false);
  const [previewExtracting, setPreviewExtracting] = useState(false);
  const metadata = item.metadata;
  const danceStageAsset = isDanceStageAsset(item.kind);
  const danceStageEnabled = isDanceStageEnabled(metadata);
  const size = typeof metadata.sizeBytes === "number" ? formatBytes(metadata.sizeBytes) : "";
  const mime = typeof metadata.mimeType === "string" ? metadata.mimeType : item.source === "public-library" ? "public library item" : "";
  const updated = new Date(item.updatedAt);
  const published = isPublishedLibraryMetadata(metadata) || linkedPublicItem?.status === "published";
  const hasLinkedLibraryItem = Boolean(linkedLibraryItemIdFromMetadata(metadata) || linkedPublicItem?.id);
  const publishHint = !canPublish
    ? !isAuthenticated
      ? "Login to publish"
      : item.source === "public-library"
      ? "Imported assets cannot be republished from the site yet."
      : "This asset file is unavailable. Re-add it or refresh the workspace."
    : "";
  const cardImageUrl = workspaceItemCardImageUrl(item, workspaceCardObjectUrlsRef);
  const audioUrl = workspaceItemAudioUrl(item, workspaceCardObjectUrlsRef);
  const kindClass = item.kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const dateLabel = Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString();
  const publishLabel = !isAuthenticated
    ? "Login"
    : !canPublish && !published
      ? "Unavailable"
      : published
        ? "Update"
        : hasLinkedLibraryItem
          ? "Republish"
            : item.source === "public-library"
            ? "Imported"
            : "Publish";

  useEffect(() => {
    if (renameOpen) renameInputRef.current?.focus();
  }, [renameOpen]);

  const beginRename = () => {
    setRenameValue(item.title);
    setRenameOpen(true);
    setMenuOpen(false);
  };

  const cancelRename = () => {
    if (renameSaving) return;
    setRenameValue(item.title);
    setRenameOpen(false);
  };

  const confirmRename = async () => {
    const title = renameValue.trim();
    if (!title) {
      setWorkspaceMessage("Enter a name for this private asset.");
      renameInputRef.current?.focus();
      return;
    }
    setRenameSaving(true);
    try {
      await onRename(item, title);
      setRenameOpen(false);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Could not rename this private asset.");
    } finally {
      setRenameSaving(false);
    }
  };

  const extractPreview = async () => {
    setMenuOpen(false);
    setPreviewExtracting(true);
    try {
      await onExtractAvatarCardImage(item);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : "Could not extract the avatar preview.");
    } finally {
      setPreviewExtracting(false);
    }
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [item.id, menuOpen]);

  return (
    <article className={`library-card dance-station-private-card library-card--${kindClass}${cardImageUrl ? " library-card--image" : ""}`}>
      <div className="library-card__art">
        {cardImageUrl ? <img src={cardImageUrl} alt="" loading="lazy" /> : <WorkspaceFallbackArtwork kind={item.kind} />}
        <div className="library-card__art-shade" />
        <div className="library-card__badge-row">
          <span className="library-card__kind-badge">{formatKind(item.kind)}</span>
          <span className="library-card__new-badge">{item.source === "public-library" ? "Imported" : "Private"}</span>
        </div>
        {audioUrl ? <AudioPlayButton track={{ id: `workspace-audio-${item.id}`, title: item.title, url: audioUrl, mimeType: typeof metadata.mimeType === "string" ? metadata.mimeType : undefined, artworkUrl: cardImageUrl || undefined }} /> : null}
      </div>

      <div className="library-card__content">
        <div className="library-card__meta">
          <span>{item.creatorName || "Private workspace"}</span>
          <span>{dateLabel}</span>
        </div>
        {renameOpen ? (
          <form
            className="private-asset-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmRename();
            }}
          >
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              maxLength={160}
              aria-label={`Rename ${item.title}`}
              disabled={renameSaving}
              onInput={(event) => setRenameValue((event.currentTarget as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
            <span className="private-asset-rename__actions">
              <button type="submit" aria-label="Confirm rename" title="Confirm rename" disabled={renameSaving}>
                <Check aria-hidden="true" size={14} />
              </button>
              <button type="button" aria-label="Cancel rename" title="Cancel rename" disabled={renameSaving} onClick={cancelRename}>
                <XIcon aria-hidden="true" size={14} />
              </button>
            </span>
          </form>
        ) : <h2 title={item.title}>{item.title}</h2>}
        <p>{mime || fallbackDescription(item.kind)}</p>
        <div className="library-card__facts">
          {size ? <span>{size}</span> : null}
          {audioUrl ? <span>Audio</span> : null}
        </div>
        <div className="library-card__footer">
          <div className="library-card__details">
            <span>{item.source === "public-library" ? "Imported" : "Private"}</span>
            {mime ? <span>{mime}</span> : null}
          </div>
          <div className="library-card__actions" ref={menuRef}>
            <button
              type="button"
              className="library-card__action-button"
              disabled={!canPublish && !published}
              onClick={() => onPublish(item).catch((error) => setWorkspaceMessage(error.message))}
              title={published ? "Update the current public library item" : publishHint}
            >
              {publishLabel}
            </button>
            <button type="button" className="library-card__options-button" onClick={() => setMenuOpen((value) => !value)} aria-label={`Options for ${item.title}`} aria-expanded={menuOpen} title="Asset options">
              <MoreHorizontal aria-hidden="true" size={18} />
            </button>
            {menuOpen ? (
              <div className="library-card__options-menu">
                {danceStageAsset ? (
                  <label className="library-card__visibility-toggle">
                    <input
                      type="checkbox"
                      checked={danceStageEnabled}
                      aria-label={`${danceStageEnabled ? "Hide" : "Show"} ${item.title} in Dance Stage`}
                      onChange={(event) => {
                        setMenuOpen(false);
                        onSetDanceStageVisibility(item, (event.currentTarget as HTMLInputElement).checked).catch((error) => setWorkspaceMessage(error.message));
                      }}
                    />
                    {danceStageEnabled ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
                    <span>Show in Dance Stage</span>
                  </label>
                ) : null}
                {item.source === "private" ? (
                  <>
                    <button type="button" onClick={beginRename}><Pencil aria-hidden="true" size={14} /> Rename</button>
                    <input
                      ref={cardImageInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        setMenuOpen(false);
                        onSetCardImage(item, (event.currentTarget as HTMLInputElement).files).catch((error) => setWorkspaceMessage(error.message));
                      }}
                    />
                    <button type="button" onClick={() => cardImageInputRef.current?.click()}><ImagePlus aria-hidden="true" size={14} /> Set Card Image</button>
                  </>
                ) : null}
                {item.kind === "avatar" ? (
                  <button type="button" disabled={previewExtracting} onClick={() => void extractPreview()}>
                    <ImagePlus aria-hidden="true" size={14} /> {previewExtracting ? "Extracting Preview..." : "Extract Front Preview"}
                  </button>
                ) : null}
                {published ? <button type="button" onClick={() => { setMenuOpen(false); onRevoke(item).catch((error) => setWorkspaceMessage(error.message)); }}><RotateCcw aria-hidden="true" size={14} /> Revoke</button> : null}
                {item.source !== "private" && !published ? <span>No additional options</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function WorkspaceFallbackArtwork({ kind }: { kind: string }): JSX.Element {
  return (
    <div className={`library-card__fallback library-card__fallback--${kind.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
      <div className="library-card__waveform" aria-hidden="true">
        {Array.from({ length: 28 }, (_, index) => <span key={index} style={{ height: `${24 + ((index * 37) % 66)}%` }} />)}
      </div>
      <AudioWaveform aria-hidden="true" size={42} strokeWidth={1.2} />
    </div>
  );
}

function PublicLibraryAssetCard({
  item,
  canImport,
  isOwner,
  importPublicItem,
  setWorkspaceMessage,
}: {
  item: LibraryItem;
  canImport: boolean;
  isOwner: boolean;
  importPublicItem: (item: LibraryItem) => Promise<void>;
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  const actionLabel = isOwner ? undefined : canImport ? "Add to Private Assets" : "Login to Import";
  return (
    <LibraryAssetCard
      item={item}
      className="dance-station-public-card"
      actionLabel={actionLabel}
      actionDisabled={!canImport}
      actionTitle={isOwner ? undefined : canImport ? undefined : "Login to import"}
      onAction={() => importPublicItem(item).catch((error) => setWorkspaceMessage(error.message))}
    />
  );
}

function AudioEditWorkspace({
  onAudioMassEvent,
  assets,
  query,
  setQuery,
  railTab,
  setRailTab,
  label,
  setLabel,
  saveStatus,
  workspaceMessage,
  addAsset,
  saveCurrentEdit,
}: {
  onAudioMassEvent: (event: AudioMassEvent) => void;
  assets: AudioMassWorkspaceAsset[];
  query: string;
  setQuery: (value: string) => void;
  railTab: "assets" | "export";
  setRailTab: (value: "assets" | "export") => void;
  label: string;
  setLabel: (value: string) => void;
  saveStatus: string;
  workspaceMessage: string;
  addAsset: (asset: AudioMassWorkspaceAsset) => Promise<void>;
  saveCurrentEdit: () => void;
}): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const diskObjectUrlsRef = useRef<string[]>([]);
  useEffect(() => () => {
    diskObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const filteredAssets = assets.filter((asset) => {
    const term = query.trim().toLowerCase();
    return !term || `${asset.title} ${asset.kind} ${asset.creatorName || ""}`.toLowerCase().includes(term);
  });

  const importFromDisk = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) return;
    const url = URL.createObjectURL(file);
    diskObjectUrlsRef.current.push(url);
    void addAsset({
      id: `disk-${crypto.randomUUID()}`,
      title: file.name,
      kind: "Audio file",
      url,
      mimeType: file.type,
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const beginAssetDrag = (event: DragEvent, asset: AudioMassWorkspaceAsset) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-dance-station-audio-asset", JSON.stringify({
      id: asset.id,
      name: asset.title,
      title: asset.title,
      kind: asset.kind,
      creatorName: asset.creatorName,
      url: asset.url,
      mimeType: asset.mimeType,
      duration: asset.duration,
    }));
    event.dataTransfer.setData("text/plain", asset.title);
  };

  return (
    <div className="dance-station-audio-workspace">
      <div className="dance-station-audio-workspace__editor">
        <AudioEditPanel onAudioMassEvent={onAudioMassEvent} />
      </div>
      <aside className="dance-station-audio-rail" aria-label="Audio Edit workspace tools">
        <div className="dance-station-audio-rail__tabs" role="tablist" aria-label="Audio Edit tools">
          <button type="button" role="tab" aria-selected={railTab === "assets"} className={railTab === "assets" ? "active" : ""} onClick={() => setRailTab("assets")}>
            My Assets
          </button>
          <button type="button" role="tab" aria-selected={railTab === "export"} className={railTab === "export" ? "active" : ""} onClick={() => setRailTab("export")}>
            Export
          </button>
        </div>

        {railTab === "assets" ? (
          <div className="dance-station-audio-rail__content">
            <input ref={fileInputRef} className="dance-station-visually-hidden" type="file" accept="audio/*" onChange={(event) => importFromDisk(event.currentTarget.files)} />
            <button type="button" className="dance-station-audio-import" onClick={() => fileInputRef.current?.click()}>
              <Upload aria-hidden="true" size={17} strokeWidth={2} />
              <span>Import Audio</span>
            </button>
            <div className="dance-station-audio-search">
              <Search aria-hidden="true" size={15} />
              <input type="search" value={query} onInput={(event) => setQuery(event.currentTarget.value)} placeholder="Search assets..." aria-label="Search audio assets" />
              <button type="button" title="Filter audio assets" aria-label="Filter audio assets"><SlidersHorizontal aria-hidden="true" size={15} /></button>
            </div>
            <div className="dance-station-audio-rail__count">{assets.length} audio assets available</div>
            <div className="dance-station-audio-asset-list">
              {filteredAssets.length ? filteredAssets.map((asset) => (
                <div key={asset.id} className="dance-station-audio-asset-row" draggable onDragStart={(event) => beginAssetDrag(event, asset)}>
                  <AudioPlayButton track={{ id: `audio-edit-${asset.id}`, title: asset.title, url: asset.url, mimeType: asset.mimeType }} />
                  <button type="button" className="dance-station-audio-asset-row__select" onClick={() => { void addAsset(asset); }}>
                    <strong title={asset.title}>{asset.title}</strong>
                    <span>{asset.kind}</span>
                  </button>
                  <span className="dance-station-audio-asset-row__duration">{formatAudioAssetDuration(asset.duration)}</span>
                  <button type="button" className="dance-station-audio-asset-row__options" title="Audio asset options" aria-label={`Options for ${asset.title}`} onClick={(event) => event.stopPropagation()}>
                    <MoreHorizontal aria-hidden="true" size={16} />
                  </button>
                </div>
              )) : <div className="library-empty">No matching audio assets.</div>}
            </div>
          </div>
        ) : (
          <div className="dance-station-audio-rail__content dance-station-audio-rail__export">
            <p className="home-v2-kicker">Export</p>
            <h2>Save your edit</h2>
            <p className="small">Mix the current tracks into one audio asset and keep it in your Private Assets.</p>
            <label className="dance-station-audio-export-label">
              <span>Asset name</span>
              <input type="text" value={label} onInput={(event) => setLabel(event.currentTarget.value)} placeholder="Audio edit" />
            </label>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={saveCurrentEdit}>
              <FileUp aria-hidden="true" size={15} />
              <span>Save Mixdown As Asset</span>
            </button>
            {saveStatus ? <span className="dance-station-status-pill">{saveStatus}</span> : null}
          </div>
        )}
        {workspaceMessage ? <p className="small dance-station-workspace-message">{workspaceMessage}</p> : null}
      </aside>
    </div>
  );
}

function AudioEditPanel({ onAudioMassEvent }: { onAudioMassEvent: (event: AudioMassEvent) => void }): JSX.Element {
  return (
    <div className="dance-station-audiomass-frame dance-station-audiomass-direct" aria-label="Dance Station AudioMass editor">
      <AudioMassInlineEditor onEvent={onAudioMassEvent} />
    </div>
  );
}

function InstrumentLabPanel({ frameRef }: { frameRef: RefObject<HTMLIFrameElement> }): JSX.Element {
  return (
    <iframe
      ref={frameRef}
      className="dance-station-instrument-frame"
      title="Dance Station Instrument Lab"
      src="/dance-station/instrument-lab/site/index.html"
      allow="autoplay; clipboard-read; clipboard-write"
    ></iframe>
  );
}

function InstrumentLabWorkspaceControls({ audioAssetCount }: { audioAssetCount: number }): JSX.Element {
  return (
    <section className="dance-station-side-tool dance-station-instrument-session">
      <p className="home-v2-kicker">Instrument Lab</p>
      <h2>Shared editor</h2>
      <p className="small">
        Private audio assets are available inside the editor. Rendered tracks and clips save back into Private Assets.
      </p>
      <div className="dance-station-storage-grid dance-station-storage-grid--compact">
        <StatusChip label="Audio Assets" value={String(audioAssetCount)} good={audioAssetCount > 0} />
      </div>
    </section>
  );
}

function InstrumentLabSessionControls({
  status,
  previewUrl,
  tracks,
  activeTrackId,
  assets,
  setActiveTrackId,
  updateTrack,
  addTrack,
  importAssetTrack,
  renderClip,
  renderTrack,
  saveClip,
  saveTrack,
}: {
  status: string;
  previewUrl: string;
  tracks: InstrumentTrack[];
  activeTrackId: string;
  assets: InstrumentAssetOption[];
  setActiveTrackId: (trackId: string) => void;
  updateTrack: (trackId: string, patch: Partial<InstrumentTrack>) => void;
  addTrack: () => void;
  importAssetTrack: (assetId: string) => void;
  renderClip: () => Promise<File | null>;
  renderTrack: () => Promise<File | null>;
  saveClip: () => Promise<void>;
  saveTrack: () => Promise<void>;
}): JSX.Element {
  return (
    <section className="dance-station-side-tool dance-station-instrument-session">
      <p className="home-v2-kicker">Instrument Lab</p>
      <h2>Tracks</h2>
      <span className="dance-station-status-pill">{status}</span>

      <div className="dance-station-track-list">
        {tracks.map((track) => (
          <div key={track.id} className={`dance-station-track-row${track.id === activeTrackId ? " active" : ""}`}>
            <button type="button" className="dance-station-track-select" onClick={() => setActiveTrackId(track.id)}>
              <strong>{track.label}</strong>
              <span>{track.kind === "audio" ? "Audio" : "Instrument"}</span>
            </button>
            <label>
              <span>Mute</span>
              <input
                type="checkbox"
                checked={track.muted}
                onChange={(event) => updateTrack(track.id, { muted: (event.currentTarget as HTMLInputElement).checked })}
              />
            </label>
            <label>
              <span>Record</span>
              <input
                type="checkbox"
                checked={track.playDuringRecord}
                onChange={(event) => updateTrack(track.id, { playDuringRecord: (event.currentTarget as HTMLInputElement).checked })}
              />
            </label>
            <input
              className="dance-station-track-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={track.volume}
              onInput={(event) => updateTrack(track.id, { volume: Number((event.currentTarget as HTMLInputElement).value || 0.85) })}
              aria-label={`${track.label} volume`}
            />
          </div>
        ))}
      </div>

      <div className="dance-station-side-actions">
        <button type="button" className="dance-station-tool-button" onClick={addTrack}>
          Add Track
        </button>
        <label>
          <span>Import creation</span>
          <select
            value=""
            onChange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              if (value) importAssetTrack(value);
            }}
          >
            <option value="">Choose audio asset</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.title}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="dance-station-section-divider"></div>

      <h2>Render</h2>
      <div className="dance-station-side-actions">
        <button type="button" className="dance-station-tool-button" onClick={() => renderTrack()}>
          Render Track
        </button>
        <button type="button" className="dance-station-tool-button" onClick={() => saveTrack()}>
          Save Track
        </button>
        <button type="button" className="dance-station-tool-button" onClick={() => renderClip()}>
          Render Clip
        </button>
        <button type="button" className="dance-station-tool-button primary" onClick={() => saveClip()}>
          Save Clip
        </button>
      </div>
      {previewUrl ? <audio controls preload="metadata" src={previewUrl}></audio> : <div className="library-empty">No rendered preview yet.</div>}
    </section>
  );
}

function UnavailablePanel({ tool }: { tool: typeof tools[number] }): JSX.Element {
  return (
    <div className="dance-station-unavailable-panel">
      <p className="home-v2-kicker">{tool.status}</p>
      <h2>{tool.label}</h2>
      <p>Remote compute coming soon.</p>
    </div>
  );
}

function BrowserWorkspaceSettings({
  workspaceStatus,
  workspaceMessage,
  refreshWorkspace,
  requestPersistence,
  openStorageHelp,
}: {
  workspaceStatus: BrowserWorkspaceStatus | null;
  workspaceMessage: string;
  refreshWorkspace: () => Promise<void>;
  requestPersistence: () => Promise<void>;
  openStorageHelp: () => void;
}): JSX.Element {
  return (
    <section className="dance-station-workspace-panel dance-station-settings-panel">
      <div className="dance-station-panel-head">
        <div>
          <p className="home-v2-kicker">Browser Workspace Settings</p>
          <h2>Local save behavior</h2>
        </div>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={openStorageHelp}>
          Storage Help
        </button>
      </div>
      <p>
        Browser storage is available without this extra permission. Persistent storage is an optional protection layer
        that some browsers grant silently and some deny silently.
      </p>
      <StorageCaveats includeSettingsNote />
      <div className="dance-station-storage-grid">
        <StatusChip label="IndexedDB" value={workspaceStatus?.indexedDb ? "Available" : "Unavailable"} good={Boolean(workspaceStatus?.indexedDb)} />
        <StatusChip label="OPFS" value={workspaceStatus?.opfs ? "Available" : "Not available"} good={Boolean(workspaceStatus?.opfs)} />
        <StatusChip label="Persistence" value={workspaceStatus?.persisted ? "Granted" : "Not granted"} good={Boolean(workspaceStatus?.persisted)} />
        <StatusChip label="Quota" value={formatStorageEstimate(workspaceStatus)} good={Boolean(workspaceStatus?.estimate?.quota)} />
      </div>
      <div className="dance-station-panel-actions">
        <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => requestPersistence().catch(() => null)}>
          Request Persistent Storage
        </button>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => refreshWorkspace().catch(() => null)}>
          Refresh Status
        </button>
      </div>
      {workspaceMessage ? <p className="small">{workspaceMessage}</p> : null}
    </section>
  );
}

function SettingsSummaryPanel({
  session,
  workspaceStatus,
}: {
  session: SessionState;
  workspaceStatus: BrowserWorkspaceStatus | null;
}): JSX.Element {
  return (
    <section className="dance-station-workspace-panel dance-station-settings-summary">
      <p className="home-v2-kicker">Settings Summary</p>
      <h2>{session.authenticated ? "Connected session" : "Guest session"}</h2>
      <div className="dance-station-value-list">
        <div className="dance-station-value-row">
          <span>Wallet</span>
          <strong>{session.authenticated ? `${session.publicKey.slice(0, 6)}...${session.publicKey.slice(-4)}` : "Not connected"}</strong>
        </div>
        <div className="dance-station-value-row">
          <span>Display name</span>
          <strong>{session.creatorProfile.displayName || "Not set"}</strong>
        </div>
        <div className="dance-station-value-row">
          <span>IndexedDB</span>
          <strong>{workspaceStatus?.indexedDb ? "Available" : "Unavailable"}</strong>
        </div>
        <div className="dance-station-value-row">
          <span>OPFS</span>
          <strong>{workspaceStatus?.opfs ? "Available" : "Not available"}</strong>
        </div>
        <div className="dance-station-value-row">
          <span>Persistent storage</span>
          <strong>{workspaceStatus?.persisted ? "Granted" : "Not granted"}</strong>
        </div>
        <div className="dance-station-value-row">
          <span>Quota</span>
          <strong>{formatStorageEstimate(workspaceStatus)}</strong>
        </div>
      </div>
    </section>
  );
}

function StorageCaveats({ includeSettingsNote = false }: { includeSettingsNote?: boolean }): JSX.Element {
  return (
    <ul className="dance-station-storage-caveats">
      <li>Private assets are tied to this browser, device, and site address until synced or published.</li>
      <li>Closing the site and coming back normally should keep it available.</li>
      <li>Clearing site data, using private browsing, or browser storage cleanup can remove it.</li>
      <li>Persistent storage can add another layer of protection in Browser Workspace settings.</li>
      <li>Important work should be synced to your account or published when those actions are available.</li>
      {includeSettingsNote ? <li>You can reopen this from Help or Settings at any time.</li> : null}
    </ul>
  );
}

function SupportForm({
  email,
  issueType,
  message,
  submitting,
  submitted,
  error,
  setEmail,
  setIssueType,
  setMessage,
  onSubmit,
  onBack,
  onClose,
}: {
  email: string;
  issueType: SupportIssueType;
  message: string;
  submitting: boolean;
  submitted: boolean;
  error: string;
  setEmail: (value: string) => void;
  setIssueType: (value: SupportIssueType) => void;
  setMessage: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onBack: () => void;
  onClose: () => void;
}): JSX.Element {
  if (submitted) {
    return (
      <div className="dance-station-support-modal">
        <p className="home-v2-kicker">Contact Support</p>
        <h2>Support request sent</h2>
        <p className="dance-station-support-modal__success" role="status">
          We received your message. We will reply to the email address you provided.
        </p>
        <div className="dance-station-panel-actions">
          <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={onBack}>
            Back to Help
          </button>
          <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="dance-station-support-modal" onSubmit={onSubmit}>
      <p className="home-v2-kicker">Contact Support</p>
      <h2>How can we help?</h2>
      <p className="dance-station-support-modal__intro">Tell us what happened and where we should reply.</p>
      <label className="dance-station-support-modal__field">
        Reply email
        <input
          type="email"
          value={email}
          onInput={(event) => setEmail((event.currentTarget as HTMLInputElement).value)}
          placeholder="you@example.com"
          autoComplete="email"
          maxLength={320}
          required
        />
      </label>
      <label className="dance-station-support-modal__field">
        Issue type
        <select value={issueType} onChange={(event) => setIssueType((event.currentTarget as HTMLSelectElement).value as SupportIssueType)}>
          <option value="bug_report">Bug report</option>
          <option value="refund_request">Refund request</option>
          <option value="general_support">General support</option>
        </select>
      </label>
      <label className="dance-station-support-modal__field">
        Message
        <textarea
          value={message}
          onInput={(event) => setMessage((event.currentTarget as HTMLTextAreaElement).value)}
          placeholder="Describe the issue..."
          minLength={10}
          maxLength={5000}
          rows={6}
          required
        />
      </label>
      {error ? <p className="dance-station-support-modal__error" role="alert">{error}</p> : null}
      <div className="dance-station-panel-actions">
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={onBack} disabled={submitting}>
          Back to Help
        </button>
        <button type="submit" className="home-v2-btn home-v2-btn--primary" disabled={submitting}>
          {submitting ? "Sending..." : "Send Message"}
        </button>
      </div>
    </form>
  );
}

function StatusChip({ label, value, good }: { label: string; value: string; good: boolean }): JSX.Element {
  return (
    <div className={`dance-station-status-chip${good ? " good" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatStorageEstimate(status: BrowserWorkspaceStatus | null): string {
  if (!status?.estimate?.quota) return "Unknown";
  const usage = status.estimate.usage / (1024 * 1024);
  const quota = status.estimate.quota / (1024 * 1024);
  return `${usage.toFixed(0)} / ${quota.toFixed(0)} MB`;
}

interface InstrumentNote {
  id: string;
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

type InstrumentTrack =
  | {
    id: string;
    label: string;
    kind: "instrument";
    instrumentId: string;
    notes: InstrumentNote[];
    muted: boolean;
    playDuringRecord: boolean;
    volume: number;
  }
  | {
    id: string;
    label: string;
    kind: "audio";
    sourceTitle: string;
    audioUrl: string;
    muted: boolean;
    playDuringRecord: boolean;
    volume: number;
    notes: [];
  };

interface InstrumentDefinition {
  id: string;
  name: string;
  oscillator: OscillatorType;
  attack: number;
  release: number;
  octave: number;
}

interface AudioMassWorkspaceAsset {
  id: string;
  title: string;
  kind: string;
  creatorName?: string;
  url: string;
  mimeType?: string;
  duration?: number;
}

interface AudioMassExportPayload {
  audio: ArrayBuffer;
  name?: string;
  mimeType?: string;
  duration?: number;
  sampleRate?: number;
  channels?: number;
}

interface InstrumentAssetOption {
  id: string;
  title: string;
  kind: string;
  creatorName?: string;
}

const INSTRUMENT_BANK: InstrumentDefinition[] = [
  { id: "synth.lead", name: "Lead Synth", oscillator: "sawtooth", attack: 0.01, release: 0.18, octave: 0 },
  { id: "synth.square-lead", name: "Square Lead", oscillator: "square", attack: 0.005, release: 0.16, octave: 0 },
  { id: "bass.synth", name: "Bass Synth", oscillator: "square", attack: 0.005, release: 0.12, octave: -12 },
  { id: "bass.sub", name: "Sub Bass", oscillator: "sine", attack: 0.01, release: 0.22, octave: -24 },
  { id: "keys.soft-pad", name: "Soft Pad", oscillator: "triangle", attack: 0.14, release: 0.45, octave: 0 },
  { id: "keys.pluck", name: "Pluck", oscillator: "triangle", attack: 0.005, release: 0.08, octave: 12 },
  { id: "strings.synthetic", name: "Synthetic Strings", oscillator: "sawtooth", attack: 0.22, release: 0.55, octave: 0 },
  { id: "brass.soft", name: "Soft Brass", oscillator: "sawtooth", attack: 0.08, release: 0.25, octave: 0 },
];

function createInstrumentTrack(label: string, instrumentId: string): InstrumentTrack {
  return {
    id: label === "Track 1" ? "track-main" : `track-${crypto.randomUUID()}`,
    label,
    kind: "instrument",
    instrumentId,
    notes: [],
    muted: false,
    playDuringRecord: true,
    volume: 0.85,
  };
}

function createAudioTrack(label: string, audioUrl: string, sourceTitle: string): InstrumentTrack {
  return {
    id: `audio-${crypto.randomUUID()}`,
    label,
    kind: "audio",
    sourceTitle,
    audioUrl,
    notes: [],
    muted: false,
    playDuringRecord: true,
    volume: 0.85,
  };
}

function serializeInstrumentTrack(track: InstrumentTrack): Record<string, unknown> {
  return track.kind === "instrument"
    ? {
      id: track.id,
      label: track.label,
      kind: track.kind,
      instrumentId: track.instrumentId,
      notes: track.notes,
      muted: track.muted,
      playDuringRecord: track.playDuringRecord,
      volume: track.volume,
    }
    : {
      id: track.id,
      label: track.label,
      kind: track.kind,
      sourceTitle: track.sourceTitle,
      muted: track.muted,
      playDuringRecord: track.playDuringRecord,
      volume: track.volume,
    };
}

const PIANO_KEYS = [
  { label: "C", semitone: 0 },
  { label: "C#", semitone: 1, black: true },
  { label: "D", semitone: 2 },
  { label: "D#", semitone: 3, black: true },
  { label: "E", semitone: 4 },
  { label: "F", semitone: 5 },
  { label: "F#", semitone: 6, black: true },
  { label: "G", semitone: 7 },
  { label: "G#", semitone: 8, black: true },
  { label: "A", semitone: 9 },
  { label: "A#", semitone: 10, black: true },
  { label: "B", semitone: 11 },
];

const KEYBOARD_NOTE_MAP: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
};

function nextInstrumentStart(notes: InstrumentNote[]): number {
  if (!notes.length) return 0;
  const end = Math.max(...notes.map((note) => note.start + note.duration));
  return Math.round(end * 2) / 2;
}

function currentRecordingBeat(startedAt: number, bpm: number): number {
  if (!startedAt) return 0;
  return Math.max(0, ((performance.now() - startedAt) / 1000) / beatSeconds(bpm));
}

function midiFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

function instrumentDefinition(instrumentId: string): InstrumentDefinition {
  return INSTRUMENT_BANK.find((instrument) => instrument.id === instrumentId) ?? INSTRUMENT_BANK[0];
}

function beatSeconds(bpm: number): number {
  return 60 / Math.max(20, bpm || 120);
}

function scheduleInstrumentNote(
  context: BaseAudioContext,
  destination: AudioNode,
  note: InstrumentNote,
  bpm: number,
  instrumentId: string,
  volume = 0.85,
  offsetSeconds = 0
): void {
  const instrument = instrumentDefinition(instrumentId);
  const start = offsetSeconds + note.start * beatSeconds(bpm);
  const duration = Math.max(0.05, note.duration * beatSeconds(bpm));
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = instrument.oscillator;
  oscillator.frequency.setValueAtTime(midiFrequency(note.pitch + instrument.octave), start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(note.velocity * volume, start + instrument.attack);
  gain.gain.setValueAtTime(note.velocity * volume, start + Math.max(instrument.attack, duration - instrument.release));
  gain.gain.linearRampToValueAtTime(0, start + duration + instrument.release);
  oscillator.connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + instrument.release + 0.05);
}

async function scheduleInstrumentTracks(
  context: BaseAudioContext,
  destination: AudioNode,
  tracks: InstrumentTrack[],
  bpm: number,
  offsetSeconds: number,
  audioBufferCache: Map<string, AudioBuffer>
): Promise<void> {
  await Promise.all(tracks.map(async (track) => {
    if (track.muted) return;
    if (track.kind === "instrument") {
      track.notes.forEach((note) => scheduleInstrumentNote(context, destination, note, bpm, track.instrumentId, track.volume, offsetSeconds));
      return;
    }
    const buffer = await loadTrackAudioBuffer(context, track.audioUrl, audioBufferCache);
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = track.volume;
    source.connect(gain).connect(destination);
    source.start(offsetSeconds);
  }));
}

async function loadTrackAudioBuffer(
  context: BaseAudioContext,
  url: string,
  audioBufferCache: Map<string, AudioBuffer>
): Promise<AudioBuffer> {
  const cached = audioBufferCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load audio track: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const decoded = await context.decodeAudioData(buffer.slice(0));
  audioBufferCache.set(url, decoded);
  return decoded;
}

function instrumentDurationSeconds(notes: InstrumentNote[], bpm: number): number {
  if (!notes.length) return 0;
  return Math.max(...notes.map((note) => note.start + note.duration)) * beatSeconds(bpm);
}

async function renderInstrumentWav({
  tracks,
  bpm,
  bars,
  label,
  audioBufferCache,
}: {
  tracks: InstrumentTrack[];
  bpm: number;
  bars: number;
  label: string;
  audioBufferCache: Map<string, AudioBuffer>;
}): Promise<File> {
  const instrumentEnd = Math.max(0, ...tracks.flatMap((track) => (
    track.kind === "instrument" ? track.notes.map((note) => note.start + note.duration) : [bars * 4]
  )));
  const duration = Math.max(bars * 4 * beatSeconds(bpm), instrumentEnd * beatSeconds(bpm) + 0.5);
  const sampleRate = 44100;
  const context = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.86;
  master.connect(context.destination);
  await scheduleInstrumentTracks(context, master, tracks, bpm, 0, audioBufferCache);
  const buffer = await context.startRendering();
  const wav = audioBufferToWav(buffer);
  return new File([wav], `${safeFileStem(label || "instrument")}.wav`, { type: "audio/wav" });
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = samples * blockAlign;
  const wav = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wav);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let index = 0; index < samples; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }
  return wav;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function safeFileStem(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "instrument";
}

function cursorPercent(beat: number, bars: number): number {
  const totalBeats = Math.max(1, bars * 4);
  return Math.max(0, Math.min(100, (beat / totalBeats) * 100));
}

function instrumentNoteStyle(note: InstrumentNote, bars: number): Record<string, string> {
  const totalBeats = Math.max(1, bars * 4);
  const top = Math.max(7, Math.min(82, 84 - ((note.pitch - 36) / 48) * 74));
  return {
    left: `${Math.max(0, Math.min(98, (note.start / totalBeats) * 100))}%`,
    width: `${Math.max(2.5, Math.min(100, (note.duration / totalBeats) * 100))}%`,
    top: `${top}%`,
  };
}

function buildAudioMassWorkspaceAssets(
  items: BrowserWorkspaceItem[],
  objectUrlsRef: { current: Map<string, string> }
): AudioMassWorkspaceAsset[] {
  const liveIds = new Set(items.map((item) => item.id));
  objectUrlsRef.current.forEach((url, id) => {
    if (!liveIds.has(id)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(id);
    }
  });
  return items.flatMap((item) => {
    const directUrl = workspaceItemAudioUrl(item, objectUrlsRef);
    const url = directUrl ? audioMassAssetUrl(item, directUrl) : null;
    if (!url) return [];
    return [{
      id: item.id,
      title: item.title,
      kind: formatKind(item.kind),
      creatorName: item.creatorName,
      url,
      mimeType: typeof item.metadata?.mimeType === "string" ? item.metadata.mimeType : undefined,
      duration: typeof item.metadata?.duration === "number" ? item.metadata.duration : undefined,
    }];
  });
}

function audioMassAssetUrl(item: BrowserWorkspaceItem, directUrl: string): string {
  const objectPath = typeof item.metadata?.objectPath === "string" ? item.metadata.objectPath.trim() : "";
  if (/^remote-generation(?:-[A-Za-z0-9-]+)?\/jobs\/[A-Za-z0-9-]+\/[^/]+(?:\/[^/]+)*$/.test(objectPath)) {
    return `/api/remote-generation/assets/audio?path=${encodeURIComponent(objectPath)}`;
  }
  return directUrl;
}

function postAudioMassAssetCatalog(
  items: BrowserWorkspaceItem[],
  objectUrlsRef: { current: Map<string, string> }
): void {
  audioMassInlineController.setAssetCatalog(buildAudioMassWorkspaceAssets(items, objectUrlsRef).map((asset) => ({
    id: asset.id,
    title: asset.title,
    kind: asset.kind,
    creatorName: asset.creatorName,
    url: asset.url,
    mimeType: asset.mimeType,
    duration: asset.duration,
  })));
}

function workspaceItemHasAudio(item: BrowserWorkspaceItem): boolean {
  const blob = item.metadata?.blob;
  if (blob instanceof Blob && blob.type.startsWith("audio/")) return true;
  const directUrl = item.metadata?.publicUrl;
  const directMime = item.metadata?.mimeType;
  if (typeof directUrl === "string" && (typeof directMime !== "string" || directMime.startsWith("audio/"))) return true;
  const files = item.metadata?.files;
  if (!Array.isArray(files)) return false;
  return files.some((file) => {
    if (!file || typeof file !== "object") return false;
    const candidate = file as { mimeType?: unknown; publicUrl?: unknown; url?: unknown };
    return typeof (candidate.publicUrl || candidate.url) === "string"
      && (typeof candidate.mimeType !== "string" || candidate.mimeType.startsWith("audio/"));
  });
}

function workspaceItemAudioUrl(
  item: BrowserWorkspaceItem,
  objectUrlsRef: { current: Map<string, string> }
): string | null {
  const blob = item.metadata?.blob;
  if (blob instanceof Blob && blob.type.startsWith("audio/")) {
    const existing = objectUrlsRef.current.get(item.id);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.set(item.id, url);
    return url;
  }
  const directUrl = item.metadata?.publicUrl;
  const directMime = item.metadata?.mimeType;
  if (typeof directUrl === "string" && (typeof directMime !== "string" || directMime.startsWith("audio/"))) return directUrl;
  const files = item.metadata?.files;
  if (Array.isArray(files)) {
    const audioFile = files.find((file) => {
      if (!file || typeof file !== "object") return false;
      const candidate = file as { mimeType?: unknown; publicUrl?: unknown; url?: unknown };
      return typeof (candidate.publicUrl || candidate.url) === "string"
        && (typeof candidate.mimeType !== "string" || candidate.mimeType.startsWith("audio/"));
    }) as { publicUrl?: string; url?: string } | undefined;
    return audioFile?.publicUrl || audioFile?.url || null;
  }
  return null;
}

function workspaceItemCardImageUrl(
  item: BrowserWorkspaceItem,
  objectUrlsRef: { current: Map<string, string> }
): string | null {
  const cardImageBlob = item.metadata?.cardImageBlob;
  if (cardImageBlob instanceof Blob) {
    const key = `${item.id}:card-image`;
    const existing = objectUrlsRef.current.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(cardImageBlob);
    objectUrlsRef.current.set(key, url);
    return url;
  }
  // Dance motions use the project-owned canonical wireframe artwork by default.
  // Older workspace records may contain a generic cover reference from before
  // dance-motion artwork was defined; do not let that stale reference win.
  if (isDanceMotionWorkspaceItem(item)) return danceMotionWireframeDefault;
  const publicLibrary = item.metadata?.publicLibrary;
  if (publicLibrary && typeof publicLibrary === "object") {
    const files = (publicLibrary as { files?: Array<{ role?: string; publicUrl?: string | null }> }).files;
    const cover = Array.isArray(files) ? files.find((file) => file?.role === "cover" && typeof file.publicUrl === "string") : null;
    if (cover?.publicUrl) return cover.publicUrl;
  }
  const files = item.metadata?.files;
  if (Array.isArray(files)) {
    const cover = files.find((file) => file && typeof file === "object" && (file as { role?: string; publicUrl?: string }).role === "cover") as { publicUrl?: string } | undefined;
    if (cover?.publicUrl) return cover.publicUrl;
  }
  return null;
}

function linkedLibraryItemIdFromMetadata(metadata: Record<string, unknown>): string {
  if (typeof metadata.libraryItemId === "string" && metadata.libraryItemId.trim()) {
    return metadata.libraryItemId.trim();
  }
  if (metadata.publicLibrary && typeof metadata.publicLibrary === "object") {
    const id = (metadata.publicLibrary as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return "";
}

function publicLibraryItemForWorkspaceItem(item: BrowserWorkspaceItem, publicItems: LibraryItem[]): LibraryItem | undefined {
  const linkedId = linkedLibraryItemIdFromMetadata(item.metadata);
  if (linkedId) {
    const linked = publicItems.find((publicItem) => publicItem.id === linkedId);
    if (linked) return linked;
  }

  const remoteJobId = typeof item.metadata.remoteJobId === "string" ? item.metadata.remoteJobId.trim() : "";
  return publicItems.find((publicItem) => {
    if (publicItem.kind !== item.kind) return false;
    const localId = typeof publicItem.sourceLineage?.localId === "string" ? publicItem.sourceLineage.localId : "";
    const publicRemoteJobId = typeof publicItem.metadata?.remoteJobId === "string" ? publicItem.metadata.remoteJobId : "";
    return localId === item.id || Boolean(remoteJobId && publicRemoteJobId === remoteJobId);
  });
}

function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isDanceStageAsset(kind: string): boolean {
  return kind === "avatar" || kind === "dance_motion";
}

function isDanceMotionWorkspaceItem(item: BrowserWorkspaceItem): boolean {
  if (item.kind === "dance_motion") return true;
  const composition = item.metadata?.composition;
  return Boolean(
    composition
    && typeof composition === "object"
    && (composition as { format?: unknown }).format === "faceless-dance-composition",
  );
}

function isDanceStageEnabled(metadata: Record<string, unknown>): boolean {
  return metadata.danceStageEnabled !== false;
}

function jsonDownloadFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value, null, 2)], name, { type: "application/json" });
}

async function fetchPublicAssetFile(url: string, fileName: string, mimeType: string): Promise<File> {
  // Public CDN assets use wildcard CORS and cannot be fetched with credentials.
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Could not read the source audio (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("The source audio file is empty.");
  return new File([blob], fileName, { type: mimeType || blob.type || "application/octet-stream" });
}

function isPublishedLibraryMetadata(metadata: Record<string, unknown>): boolean {
  if (!linkedLibraryItemIdFromMetadata(metadata)) return false;
  if (typeof metadata.publicLibraryStatus === "string") {
    return metadata.publicLibraryStatus.trim().toLowerCase() === "published";
  }
  if (!metadata.publicLibrary || typeof metadata.publicLibrary !== "object") return true;
  const record = metadata.publicLibrary as { status?: unknown; visibility?: unknown };
  if (record.status === undefined) return true;
  return typeof record.status === "string"
    && record.status.trim().toLowerCase() === "published"
    && (record.visibility === undefined || record.visibility === "public");
}

function midiNoteLabel(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function fallbackDescription(kind: string): string {
  if (kind === "dataset") return "Captioned training dataset prepared for creator workflows.";
  if (kind === "lokr") return "Trained LoKr adapter for compatible Dance Station generation workflows.";
  if (kind === "rhythm_game") return "Rhythm-game-ready music and metadata package.";
  return "Published Dance Station library item.";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function isWorkspaceBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function hasWorkspaceFile(metadata: Record<string, unknown>): boolean {
  return isWorkspaceBlob(metadata.blob)
    || typeof metadata.libraryItemId === "string"
    || (typeof metadata.publicUrl === "string" && metadata.publicUrl.trim().length > 0);
}

function hasPublishableWorkspaceItem(item: BrowserWorkspaceItem): boolean {
  if (item.kind === "dance_motion") {
    return Boolean(item.metadata.composition && typeof item.metadata.composition === "object");
  }
  if (item.kind === "avatar") {
    const files = Array.isArray(item.metadata.files)
      ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
    const hasStoragePath = (role: string) => files.some((file) => {
      if (file.role !== role) return false;
      const objectPath = typeof file.objectPath === "string" ? file.objectPath.trim() : "";
      const path = typeof file.path === "string" ? file.path.trim() : "";
      return Boolean(objectPath || path);
    });
    return hasStoragePath("model") && hasStoragePath("rig_manifest");
  }
  return hasWorkspaceFile(item.metadata);
}

function workspaceMetadataFile(value: unknown, nameValue: unknown, mimeValue: unknown): File | null {
  if (!isWorkspaceBlob(value) || typeof File === "undefined") return null;
  if (value instanceof File) return value;
  const name = typeof nameValue === "string" && nameValue.trim() ? nameValue : "private-asset";
  const type = value.type || (typeof mimeValue === "string" ? mimeValue : "application/octet-stream");
  return new File([value], name, { type });
}

async function workspaceItemFile(item: BrowserWorkspaceItem): Promise<File | null> {
  const metadata = item.metadata;
  const localFile = workspaceMetadataFile(metadata.blob, metadata.fileName, metadata.mimeType);
  if (localFile) return localFile;

  const publicUrl = typeof metadata.publicUrl === "string" ? metadata.publicUrl.trim() : "";
  if (!publicUrl || typeof File === "undefined") return null;
  const response = await fetch(publicUrl);
  if (!response.ok) throw new Error(`Could not read the private asset file (${response.status}).`);
  const blob = await response.blob();
  if (!blob.size) throw new Error("The private asset file is empty.");
  const name = typeof metadata.fileName === "string" && metadata.fileName.trim()
    ? metadata.fileName
    : `${item.title || "private-asset"}.${blob.type === "audio/wav" ? "wav" : "bin"}`;
  const type = blob.type || (typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream");
  return new File([blob], name, { type });
}

function workspaceInstrumentDefinition(item: BrowserWorkspaceItem): {
  format: string;
  sourceName?: string;
  regions: Array<Record<string, unknown>>;
  warnings?: string[];
} | null {
  const direct = item.metadata.instrumentDefinition;
  const library = item.metadata.publicLibrary;
  const libraryMetadata = library && typeof library === "object"
    ? (library as { metadata?: Record<string, unknown> }).metadata
    : undefined;
  const candidate = direct && typeof direct === "object"
    ? direct
    : libraryMetadata?.instrumentDefinition;
  if (!candidate || typeof candidate !== "object") return null;
  const rawRegions = (candidate as { regions?: unknown }).regions;
  if (!Array.isArray(rawRegions)) return null;
  const libraryFiles = library && typeof library === "object" && Array.isArray((library as { files?: unknown }).files)
    ? (library as { files: Array<Record<string, unknown>> }).files
    : Array.isArray(item.metadata.files)
      ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const sampleFiles = libraryFiles.filter((file) => file.role === "instrument_sample");
  const libraryItemId = library && typeof library === "object" && typeof (library as { id?: unknown }).id === "string"
    ? (library as { id: string }).id
    : typeof item.metadata.libraryItemId === "string"
      ? item.metadata.libraryItemId
      : "";
  const regions = rawRegions.map((raw) => {
    if (!raw || typeof raw !== "object") return null;
    const region = { ...(raw as Record<string, unknown>) };
    const fileName = typeof region.fileName === "string" ? region.fileName : "";
    const sampleFile = sampleFiles.find((file) => {
      const metadata = file.metadata && typeof file.metadata === "object" ? file.metadata as Record<string, unknown> : {};
      const originalName = typeof metadata.originalName === "string" ? metadata.originalName : file.originalName;
      return typeof originalName === "string" && originalName.toLowerCase() === fileName.toLowerCase();
    });
    const publicUrl = sampleFile && typeof sampleFile.publicUrl === "string" ? sampleFile.publicUrl : "";
    if (sampleFile && libraryItemId && typeof sampleFile.id === "string") {
      region.path = `/api/library/${encodeURIComponent(libraryItemId)}/files/${encodeURIComponent(sampleFile.id)}`;
    } else if (publicUrl) {
      region.path = publicUrl;
    }
    return region;
  }).filter((region): region is Record<string, unknown> => Boolean(region));
  return {
    format: typeof (candidate as { format?: unknown }).format === "string" ? (candidate as { format: string }).format : "sfz",
    sourceName: typeof (candidate as { sourceName?: unknown }).sourceName === "string" ? (candidate as { sourceName: string }).sourceName : undefined,
    regions,
    warnings: Array.isArray((candidate as { warnings?: unknown }).warnings)
      ? (candidate as { warnings: string[] }).warnings
      : [],
  };
}

async function workspaceInstrumentPackageFiles(item: BrowserWorkspaceItem): Promise<{ sfz: File; samples: File[] }> {
  const library = item.metadata.publicLibrary;
  const files = library && typeof library === "object" && Array.isArray((library as { files?: unknown }).files)
    ? (library as { files: Array<Record<string, unknown>> }).files
    : Array.isArray(item.metadata.files)
      ? item.metadata.files.filter((file): file is Record<string, unknown> => Boolean(file && typeof file === "object"))
      : [];
  const readFile = async (record: Record<string, unknown>, fallbackName: string): Promise<File> => {
    const url = typeof record.publicUrl === "string" ? record.publicUrl : "";
    if (!url) throw new Error(`The saved instrument is missing its ${fallbackName} file URL.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not read the saved instrument ${fallbackName} file.`);
    const blob = await response.blob();
    const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata as Record<string, unknown> : {};
    const name = typeof metadata.originalName === "string" && metadata.originalName.trim() ? metadata.originalName : fallbackName;
    return new File([blob], name, { type: blob.type || String(record.mimeType || "application/octet-stream") });
  };
  const definitionFile = files.find((file) => file.role === "instrument_definition");
  const sampleFiles = files.filter((file) => file.role === "instrument_sample");
  if (!definitionFile || !sampleFiles.length) throw new Error("The saved instrument package is incomplete.");
  return {
    sfz: await readFile(definitionFile, "instrument.sfz"),
    samples: await Promise.all(sampleFiles.map((file, index) => readFile(file, `sample-${index + 1}.wav`))),
  };
}

function formatAudioAssetDuration(value?: number): string {
  if (!Number.isFinite(value) || !value || value < 0) return "--:--";
  const totalSeconds = Math.floor(value);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}
