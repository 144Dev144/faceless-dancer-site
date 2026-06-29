import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { LibraryAssetCard } from "../components/library/LibraryAssetCard";
import { api, type LibraryItem } from "../lib/api";
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

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

type DanceStationPanel = "library" | "audio-edit" | "instrument-lab" | "generation" | "extraction" | "training";

const tools: Array<{
  id: DanceStationPanel;
  label: string;
  status: string;
  available: boolean;
  description: string;
}> = [
  {
    id: "library",
    label: "Library",
    status: "",
    available: true,
    description: "Private assets, public library browsing, account sync, and publishing.",
  },
  {
    id: "audio-edit",
    label: "Audio Edit",
    status: "",
    available: true,
    description: "AudioMass browser editing with workspace import/export.",
  },
  {
    id: "instrument-lab",
    label: "Instrument Lab",
    status: "",
    available: true,
    description: "Browser instruments, MIDI-style clips, and rendered workspace assets.",
  },
  {
    id: "generation",
    label: "Generation",
    status: "COMING SOON",
    available: false,
    description: "ACE-Step jobs once hosted compute is connected.",
  },
  {
    id: "extraction",
    label: "Extraction",
    status: "COMING SOON",
    available: false,
    description: "Stem and track extraction once hosted compute is connected.",
  },
  {
    id: "training",
    label: "LoKr Training",
    status: "COMING SOON",
    available: false,
    description: "Side-Step training once GPU workers are available.",
  },
];

export function DanceStationPage({ session, setSession }: Props): JSX.Element {
  const [activePanel, setActivePanel] = useState<DanceStationPanel>("library");
  const [workspaceItems, setWorkspaceItems] = useState<BrowserWorkspaceItem[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<BrowserWorkspaceStatus | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [assetLabel, setAssetLabel] = useState("");
  const [showStorageHelp, setShowStorageHelp] = useState(false);
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
  const [audioEditPickerOpen, setAudioEditPickerOpen] = useState(false);
  const [audioEditLabel, setAudioEditLabel] = useState("");
  const [audioEditSaveStatus, setAudioEditSaveStatus] = useState("");
  const instrumentObjectUrlRef = useRef("");
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const instrumentAudioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const instrumentHeldNotesRef = useRef<Map<string, { pitch: number; start: number }>>(new Map());
  const instrumentRecordingStartedAtRef = useRef(0);
  const instrumentTimerRefs = useRef<number[]>([]);
  const audioMassFrameRef = useRef<HTMLIFrameElement | null>(null);
  const instrumentLabFrameRef = useRef<HTMLIFrameElement | null>(null);
  const workspaceItemsRef = useRef<BrowserWorkspaceItem[]>([]);
  const audioMassObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const instrumentAssetObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const workspaceCardObjectUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    return () => {
      if (instrumentObjectUrlRef.current) URL.revokeObjectURL(instrumentObjectUrlRef.current);
      audioMassObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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

  const addPrivateAsset = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    await saveWorkspaceItem(createPrivateAssetWorkspaceItem(file, assetLabel || file.name));
    setAssetLabel("");
    setWorkspaceMessage(`${file.name} added to Private Assets.`);
    await refreshWorkspace();
  };

  const importPublicItem = async (item: LibraryItem) => {
    if (!session.authenticated) {
      throw new Error("Login to import public items.");
    }
    const now = new Date().toISOString();
    const creatorName = item.creator?.displayName || item.creator?.creatorSlug || "Faceless creator";
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
        creatorName,
        description: item.description,
        tags: item.tags,
        files: item.files,
      },
    });
    setWorkspaceMessage(`${item.title} added to Private Assets.`);
    await refreshWorkspace();
  };

  const publishWorkspaceItem = async (item: BrowserWorkspaceItem) => {
    if (!session.authenticated) {
      throw new Error("Connect a wallet before publishing.");
    }
    if (item.source !== "private") {
      throw new Error("Only private assets with local files can be published from the site right now.");
    }
    const blob = item.metadata.blob;
    if (!(blob instanceof File)) {
      throw new Error("This private asset is missing its local file data. Re-add it from disk before publishing.");
    }

    const tags = Array.isArray(item.metadata.tags)
      ? item.metadata.tags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const description = typeof item.metadata.description === "string" && item.metadata.description.trim()
      ? item.metadata.description.trim()
      : undefined;
    const fileRole = blob.type.startsWith("audio/")
      ? "audio"
      : blob.type.startsWith("image/")
        ? "cover"
        : "metadata";

    const currentlyPublished = isPublishedLibraryRecord(item.metadata.publicLibrary);
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

    await api.uploadDraftLibraryFile(managed.item.id, {
      role: fileRole,
      metadata: {
        originalTitle: item.title,
      },
      file: blob,
    });
    const coverBlob = item.metadata.cardImageBlob;
    if (coverBlob instanceof File) {
      await api.uploadDraftLibraryFile(managed.item.id, {
        role: "cover",
        metadata: {
          originalTitle: coverBlob.name,
        },
        file: coverBlob,
      });
    }

    const published = await api.publishDraftLibraryItem(managed.item.id);
    await saveWorkspaceItem({
      ...item,
      creatorName: published.item.creator?.displayName || published.item.creator?.creatorSlug || item.creatorName,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...item.metadata,
        publicLibrary: published.item,
        libraryItemId: published.item.id,
      },
    });
    setWorkspaceMessage(`${item.title} ${currentlyPublished ? "updated in" : "published to"} the public library.`);
    await refreshWorkspace();
  };

  const revokeWorkspaceItem = async (item: BrowserWorkspaceItem) => {
    const libraryItemId = typeof item.metadata.libraryItemId === "string"
      ? item.metadata.libraryItemId
      : (item.metadata.publicLibrary && typeof item.metadata.publicLibrary === "object"
        ? String((item.metadata.publicLibrary as { id?: unknown }).id ?? "")
        : "");
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

  const activeInstrumentTrack = instrumentTracks.find((track) => track.id === activeInstrumentTrackId) ?? instrumentTracks[0] ?? null;
  const activeInstrumentNotes = activeInstrumentTrack?.kind === "instrument" ? activeInstrumentTrack.notes : [];
  const activeInstrumentId = activeInstrumentTrack?.kind === "instrument" ? activeInstrumentTrack.instrumentId : instrumentId;
  const instrumentAssets = workspaceItems.filter(workspaceItemHasAudio).map((item) => ({
    id: item.id,
    title: item.title,
    kind: formatKind(item.kind),
    creatorName: item.creatorName,
  }));

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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data || {};
      if (event.source === audioMassFrameRef.current?.contentWindow) {
        if (message.source !== "dance-station-audiomass") return;
        if (message.type === "dance-station:request-assets") {
          setAudioEditPickerOpen(true);
          return;
        }
        if (message.type === "dance-station:audiomass-loaded") {
          const sourceName = typeof message.payload?.sourceName === "string" ? message.payload.sourceName : "";
          const suggested = sourceName.replace(/\.[^.]+$/, "").trim();
          if (suggested) {
            setAudioEditLabel(suggested);
          }
          setAudioEditSaveStatus("");
          return;
        }
        if (message.type === "dance-station:native-download") {
          downloadAudioMassFile(message.payload);
          return;
        }
        if (message.type === "dance-station:audiomass-error") {
          setAudioEditSaveStatus("Save failed");
          setWorkspaceMessage(message.payload?.message || "AudioMass reported an error.");
        }
        return;
      }

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
    const assets = buildAudioMassWorkspaceAssets(workspaceItemsRef.current, instrumentAssetObjectUrlsRef).map((asset) => {
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

  const loadAudioMassAsset = async (asset: AudioMassWorkspaceAsset) => {
    setWorkspaceMessage(`Loading ${asset.title} into Audio Edit...`);
    setAudioEditLabel(asset.title.replace(/\.[^.]+$/, ""));
    setAudioEditSaveStatus("");
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`Could not read audio asset (${response.status}).`);
      const buffer = await response.arrayBuffer();
      audioMassFrameRef.current?.contentWindow?.postMessage({
        type: "dance-station:load-audio-buffer",
        payload: {
          buffer,
          name: asset.title,
          mimeType: response.headers.get("content-type") || "audio/wav",
        },
      }, window.location.origin, [buffer]);
    } catch {
      audioMassFrameRef.current?.contentWindow?.postMessage({
        type: "dance-station:load-audio",
        payload: {
          url: asset.url,
          name: asset.title,
        },
      }, window.location.origin);
    }
    setAudioEditPickerOpen(false);
    setWorkspaceMessage(`${asset.title} loaded into Audio Edit.`);
  };

  const requestAudioMassEditorAudio = (label: string) => {
    const frameWindow = audioMassFrameRef.current?.contentWindow;
    if (!frameWindow) {
      return Promise.reject(new Error("Audio Edit is not ready."));
    }
    const requestId = crypto.randomUUID();
    return new Promise<{
      audio: ArrayBuffer;
      name?: string;
      mimeType?: string;
      duration?: number;
      sampleRate?: number;
      channels?: number;
    }>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error("Audio Edit did not return the rendered audio."));
      }, 15000);

      function onMessage(event: MessageEvent) {
        if (event.source !== frameWindow) return;
        const message = event.data || {};
        if (message.type !== "dance-station-export-audio-result" || message.requestId !== requestId) return;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        if (!message.ok) {
          reject(new Error(message.error || "Audio Edit export failed."));
          return;
        }
        resolve({
          audio: message.audio,
          name: message.name,
          mimeType: message.mimeType,
          duration: message.duration,
          sampleRate: message.sampleRate,
          channels: message.channels,
        });
      }

      window.addEventListener("message", onMessage);
      frameWindow.postMessage({
        type: "dance-station-export-audio",
        requestId,
        name: `${label}.wav`,
      }, window.location.origin);
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
    <main className="home-v2 library-page-shell dance-station-app-shell">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />

        {showStorageHelp ? (
          <section className="dance-station-storage-modal" role="dialog" aria-modal="true" aria-label="Browser storage notice">
            <div className="home-v2-card dance-station-storage-modal__card">
              <p className="home-v2-kicker">First Use</p>
              <h2>Browser work is saved on this device</h2>
              <StorageCaveats includeSettingsNote />
              <div className="dance-station-panel-actions">
                <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => dismissStorageHelp().catch(() => setShowStorageHelp(false))}>
                  Got It
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="dance-station-app-header">
          <div>
            <p className="home-v2-kicker">Dance Station</p>
            <p>Build, import, edit, sync, and publish music assets from one browser workspace.</p>
          </div>
          <div className="dance-station-header-actions">
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => setShowStorageHelp(true)}>
              Help
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => setShowSettings((value) => !value)}>
              {showSettings ? "Close Settings" : "Settings"}
            </button>
          </div>
        </section>

        <section className="dance-station-tool-grid" aria-label="Dance Station tools">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={`dance-station-tool-card${activePanel === tool.id ? " active" : ""}${tool.available ? "" : " disabled"}`}
              onClick={() => setActivePanel(tool.id)}
            >
              {!tool.available ? <span>{tool.status}</span> : null}
              <strong>{tool.label}</strong>
              <small>{tool.description}</small>
            </button>
          ))}
        </section>

        <section className={`dance-station-main-grid${activePanel === "instrument-lab" ? " dance-station-main-grid--wide" : ""}`}>
          <div className="home-v2-card dance-station-main-panel">
            {showSettings ? (
              <BrowserWorkspaceSettings
                workspaceStatus={workspaceStatus}
                workspaceMessage={workspaceMessage}
                refreshWorkspace={refreshWorkspace}
                requestPersistence={requestPersistence}
                setShowStorageHelp={setShowStorageHelp}
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
                  revokeWorkspaceItem={revokeWorkspaceItem}
                  setWorkspaceCardImage={setWorkspaceCardImage}
                  workspaceCardObjectUrlsRef={workspaceCardObjectUrlsRef}
                  refreshWorkspace={refreshWorkspace}
                  setWorkspaceMessage={setWorkspaceMessage}
                />
            ) : activePanel === "audio-edit" ? (
              <AudioEditPanel frameRef={audioMassFrameRef} />
            ) : activePanel === "instrument-lab" ? (
              <InstrumentLabPanel frameRef={instrumentLabFrameRef} />
            ) : (
              <UnavailablePanel tool={tools.find((tool) => tool.id === activePanel) ?? tools[0]} />
            )}
          </div>

          {activePanel !== "instrument-lab" ? <aside className="home-v2-card dance-station-context-panel">
            {showSettings ? (
              <SettingsSummaryPanel
                session={session}
                workspaceStatus={workspaceStatus}
              />
            ) : (
              <>
                {activePanel === "audio-edit" ? (
                  <AudioEditWorkspaceControls
                    audioAssetCount={countAudioWorkspaceItems(workspaceItems)}
                    label={audioEditLabel}
                    setLabel={setAudioEditLabel}
                    saveStatus={audioEditSaveStatus}
                    openPrivateAssets={() => setAudioEditPickerOpen(true)}
                    saveCurrentEdit={requestAudioMassWorkspaceSave}
                  />
                ) : null}
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

        {audioEditPickerOpen ? (
          <AudioMassAssetPicker
            assets={buildAudioMassWorkspaceAssets(workspaceItems, audioMassObjectUrlsRef)}
            onLoad={loadAudioMassAsset}
            onClose={() => setAudioEditPickerOpen(false)}
          />
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
      {workspaceMessage ? <p className="small">{workspaceMessage}</p> : null}

      <div className="dance-station-library-scroll">
        <div className="dance-station-workspace-list">
          {privateItems.length ? privateItems.map((item) => (
            <PrivateAssetRow
              key={item.id}
              item={item}
              canPublish={session.authenticated && item.source === "private" && item.metadata.blob instanceof File}
              isAuthenticated={session.authenticated}
              onPublish={publishWorkspaceItem}
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
              canImport={session.authenticated}
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
  canPublish,
  isAuthenticated,
  onPublish,
  onRevoke,
  onSetCardImage,
  workspaceCardObjectUrlsRef,
  setWorkspaceMessage,
}: {
  item: BrowserWorkspaceItem;
  canPublish: boolean;
  isAuthenticated: boolean;
  onPublish: (item: BrowserWorkspaceItem) => Promise<void>;
  onRevoke: (item: BrowserWorkspaceItem) => Promise<void>;
  onSetCardImage: (item: BrowserWorkspaceItem, fileList: FileList | null) => Promise<void>;
  workspaceCardObjectUrlsRef: { current: Map<string, string> };
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  const cardImageInputRef = useRef<HTMLInputElement | null>(null);
  const metadata = item.metadata;
  const size = typeof metadata.sizeBytes === "number" ? formatBytes(metadata.sizeBytes) : "";
  const mime = typeof metadata.mimeType === "string" ? metadata.mimeType : item.source === "public-library" ? "public library item" : "";
  const updated = new Date(item.updatedAt);
  const published = isPublishedLibraryRecord(metadata.publicLibrary);
  const hasLinkedLibraryItem = Boolean(
    (typeof metadata.libraryItemId === "string" && metadata.libraryItemId)
    || (metadata.publicLibrary && typeof metadata.publicLibrary === "object" && (metadata.publicLibrary as Record<string, unknown>).id)
  );
  const publishHint = !canPublish
    ? item.source === "public-library"
      ? "Imported assets cannot be republished from the site yet."
      : "Login to publish"
    : "";
  const cardImageUrl = workspaceItemCardImageUrl(item, workspaceCardObjectUrlsRef);
  return (
    <article
      className={`dance-station-workspace-item${cardImageUrl ? " dance-station-workspace-item--image" : ""}`}
      style={cardImageUrl ? { backgroundImage: `linear-gradient(180deg, rgba(4, 10, 19, 0.24), rgba(4, 10, 19, 0.92)), url(${cardImageUrl})` } : undefined}
    >
      <div className="dance-station-workspace-item__body">
        <div className="dance-station-workspace-item__meta">
          <span className="home-v2-tag">{formatKind(item.kind)}</span>
          <span className="home-v2-tag">{item.source === "public-library" ? "Imported" : "Private"}</span>
          {item.creatorName ? <span className="home-v2-tag">{item.creatorName}</span> : null}
        </div>
        <strong>{item.title}</strong>
        <span>{Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString()}</span>
        {mime || size ? <small>{[mime, size].filter(Boolean).join(" · ")}</small> : null}
      </div>
      <div className="dance-station-asset-actions">
        {item.source === "private" ? (
          <>
            <input
              ref={cardImageInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => onSetCardImage(item, (event.currentTarget as HTMLInputElement).files).catch((error) => setWorkspaceMessage(error.message))}
            />
            <button
              type="button"
              className="home-v2-btn home-v2-btn--secondary"
              onClick={() => cardImageInputRef.current?.click()}
            >
              Set Card Image
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="home-v2-btn home-v2-btn--secondary"
          disabled={!canPublish && !published}
          onClick={() => onPublish(item).catch((error) => setWorkspaceMessage(error.message))}
          title={published ? "Update the current public library item" : publishHint}
        >
          {published ? "Update Published Item" : hasLinkedLibraryItem ? (isAuthenticated ? "Republish" : "Login to Publish") : item.source === "public-library" ? "Imported" : isAuthenticated ? "Publish" : "Login to Publish"}
        </button>
        {published ? (
          <button
            type="button"
            className="home-v2-btn home-v2-btn--secondary"
            onClick={() => onRevoke(item).catch((error) => setWorkspaceMessage(error.message))}
          >
            Revoke
          </button>
        ) : null}
      </div>
    </article>
  );
}

function PublicLibraryAssetCard({
  item,
  canImport,
  importPublicItem,
  setWorkspaceMessage,
}: {
  item: LibraryItem;
  canImport: boolean;
  importPublicItem: (item: LibraryItem) => Promise<void>;
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  return (
    <LibraryAssetCard
      item={item}
      className="dance-station-public-card"
      actionLabel={canImport ? "Add to Private Assets" : "Login to Import"}
      actionDisabled={!canImport}
      actionTitle={canImport ? undefined : "Login to import"}
      onAction={() => importPublicItem(item).catch((error) => setWorkspaceMessage(error.message))}
    />
  );
}

function AudioEditPanel({ frameRef }: { frameRef: RefObject<HTMLIFrameElement> }): JSX.Element {
  return (
    <iframe
      ref={frameRef}
      className="dance-station-audiomass-frame"
      title="Dance Station AudioMass editor"
      src={audioMassFrameUrl()}
      allow="autoplay; clipboard-read; clipboard-write; microphone; downloads"
    ></iframe>
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

function AudioMassAssetPicker({
  assets,
  onLoad,
  onClose,
}: {
  assets: AudioMassWorkspaceAsset[];
  onLoad: (asset: AudioMassWorkspaceAsset) => void | Promise<void>;
  onClose: () => void;
}): JSX.Element {
  return (
    <section className="dance-station-storage-modal" role="dialog" aria-modal="true" aria-label="Choose audio for Audio Edit">
      <div className="home-v2-card dance-station-storage-modal__card dance-station-asset-picker">
        <div className="dance-station-panel-head">
          <div>
            <p className="home-v2-kicker">Audio Edit</p>
            <h2>Open from Private Assets</h2>
          </div>
          <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dance-station-picker-list">
          {assets.length ? assets.map((asset) => (
            <button key={asset.id} type="button" onClick={() => { void onLoad(asset); }}>
              <strong>{asset.title}</strong>
              <span>{asset.kind}{asset.creatorName ? ` - ${asset.creatorName}` : ""}</span>
            </button>
          )) : <div className="library-empty">No audio assets are saved yet.</div>}
        </div>
      </div>
    </section>
  );
}

function AudioEditWorkspaceControls({
  audioAssetCount,
  label,
  setLabel,
  saveStatus,
  openPrivateAssets,
  saveCurrentEdit,
}: {
  audioAssetCount: number;
  label: string;
  setLabel: (value: string) => void;
  saveStatus: string;
  openPrivateAssets: () => void;
  saveCurrentEdit: () => void;
}): JSX.Element {
  return (
    <section className="dance-station-side-tool">
      <p className="home-v2-kicker">Audio Edit</p>
      <h2>Workspace</h2>
      <div className="dance-station-side-actions">
        <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={openPrivateAssets}>
          Open Private Asset
        </button>
      </div>
      <label className="dance-station-audio-edit-label">
        <input
          type="text"
          value={label}
          onInput={(event) => setLabel((event.currentTarget as HTMLInputElement).value)}
          placeholder="Asset Name"
        />
      </label>
      <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={saveCurrentEdit}>
        Save Edit As Asset
      </button>
      {saveStatus ? <span className="dance-station-status-pill">{saveStatus}</span> : null}
      <p className="small">{audioAssetCount} audio assets available. Disk open and download stay in AudioMass File.</p>
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
  setShowStorageHelp,
}: {
  workspaceStatus: BrowserWorkspaceStatus | null;
  workspaceMessage: string;
  refreshWorkspace: () => Promise<void>;
  requestPersistence: () => Promise<void>;
  setShowStorageHelp: (value: boolean) => void;
}): JSX.Element {
  return (
    <section className="dance-station-workspace-panel dance-station-settings-panel">
      <div className="dance-station-panel-head">
        <div>
          <p className="home-v2-kicker">Browser Workspace Settings</p>
          <h2>Local save behavior</h2>
        </div>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => setShowStorageHelp(true)}>
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
    const url = workspaceItemAudioUrl(item, objectUrlsRef);
    if (!url) return [];
    return [{
      id: item.id,
      title: item.title,
      kind: formatKind(item.kind),
      creatorName: item.creatorName,
      url,
    }];
  });
}

function countAudioWorkspaceItems(items: BrowserWorkspaceItem[]): number {
  return items.reduce((total, item) => total + (workspaceItemHasAudio(item) ? 1 : 0), 0);
}

function workspaceItemHasAudio(item: BrowserWorkspaceItem): boolean {
  const blob = item.metadata?.blob;
  if (blob instanceof Blob && blob.type.startsWith("audio/")) return true;
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

function isPublishedLibraryRecord(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { id?: unknown; status?: unknown; visibility?: unknown };
  return typeof record.id === "string" && record.status === "published" && record.visibility === "public";
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

function audioMassFrameUrl(): string {
  const params = new URLSearchParams({ ds_mode: "site" });
  return `/dance-station/audiomass/index.html?${params.toString()}`;
}
