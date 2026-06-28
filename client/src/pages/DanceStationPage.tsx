import type { RefObject } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { api, type CreatorPublishTokenRecord, type LibraryItem } from "../lib/api";
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
    status: "Available",
    available: true,
    description: "Private assets, public library browsing, account sync, and publishing.",
  },
  {
    id: "audio-edit",
    label: "Audio Edit",
    status: "Available",
    available: true,
    description: "AudioMass browser editing with workspace import/export.",
  },
  {
    id: "instrument-lab",
    label: "Instrument Lab",
    status: "Available",
    available: true,
    description: "Browser instruments, MIDI-style clips, and rendered workspace assets.",
  },
  {
    id: "generation",
    label: "Generation",
    status: "Remote compute later",
    available: false,
    description: "ACE-Step jobs once hosted compute is connected.",
  },
  {
    id: "extraction",
    label: "Extraction",
    status: "Remote compute later",
    available: false,
    description: "Stem and track extraction once hosted compute is connected.",
  },
  {
    id: "training",
    label: "LoKr Training",
    status: "Remote compute later",
    available: false,
    description: "Side-Step training once GPU workers are available.",
  },
];

export function DanceStationPage({ session, setSession }: Props): JSX.Element {
  const [activePanel, setActivePanel] = useState<DanceStationPanel>("library");
  const [tokens, setTokens] = useState<CreatorPublishTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState("Dance Station");
  const [newToken, setNewToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");
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
  const [instrumentNotes, setInstrumentNotes] = useState<InstrumentNote[]>([]);
  const [instrumentStatus, setInstrumentStatus] = useState("Ready");
  const [instrumentPreviewUrl, setInstrumentPreviewUrl] = useState("");
  const [instrumentRecording, setInstrumentRecording] = useState(false);
  const [instrumentCountIn, setInstrumentCountIn] = useState(0);
  const [audioEditPickerOpen, setAudioEditPickerOpen] = useState(false);
  const instrumentObjectUrlRef = useRef("");
  const liveAudioContextRef = useRef<AudioContext | null>(null);
  const instrumentHeldNotesRef = useRef<Map<string, { pitch: number; start: number }>>(new Map());
  const instrumentRecordingStartedAtRef = useRef(0);
  const instrumentTimerRefs = useRef<number[]>([]);
  const audioMassFrameRef = useRef<HTMLIFrameElement | null>(null);
  const audioMassObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    return () => {
      if (instrumentObjectUrlRef.current) URL.revokeObjectURL(instrumentObjectUrlRef.current);
      audioMassObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
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

  useEffect(() => {
    if (!session.authenticated) {
      setTokens([]);
      return;
    }
    api.creatorPublishTokens()
      .then((payload) => setTokens(payload.tokens))
      .catch((error: Error) => setTokenStatus(error.message));
  }, [session.authenticated]);

  const createToken = async () => {
    setTokenStatus("Creating token...");
    const payload = await api.createCreatorPublishToken(tokenName || "Dance Station");
    setNewToken(payload.token);
    setTokens((current) => [payload.record, ...current]);
    setTokenStatus("Token created. Copy it now; it will only be shown once.");
  };

  const revokeToken = async (tokenId: string) => {
    await api.revokeCreatorPublishToken(tokenId);
    setTokens((current) => current.map((token) => (
      token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token
    )));
  };

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

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== audioMassFrameRef.current?.contentWindow) return;
      const message = event.data || {};
      if (message.source !== "dance-station-audiomass") return;
      if (message.type === "dance-station:request-assets") {
        setAudioEditPickerOpen(true);
        return;
      }
      if (message.type === "dance-station:exported-audio") {
        void saveAudioMassExport(message.payload).catch((error: Error) => setWorkspaceMessage(error.message));
        return;
      }
      if (message.type === "dance-station-export-audio-result") {
        if (message.ok) {
          void saveAudioMassExport(message).catch((error: Error) => setWorkspaceMessage(error.message));
        } else {
          setWorkspaceMessage(message.error || "AudioMass could not export the current edit.");
        }
        return;
      }
      if (message.type === "dance-station:audiomass-error") {
        setWorkspaceMessage(message.payload?.message || "AudioMass reported an error.");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const addInstrumentNote = (pitch: number, startBeat?: number, durationBeat?: number) => {
    const start = startBeat ?? (instrumentRecording
      ? currentRecordingBeat(instrumentRecordingStartedAtRef.current, instrumentBpm)
      : nextInstrumentStart(instrumentNotes));
    setInstrumentNotes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        pitch,
        start,
        duration: durationBeat ?? 0.5,
        velocity: 0.82,
      },
    ]);
  };

  const clearInstrumentNotes = () => {
    setInstrumentNotes([]);
    setInstrumentStatus("Ready");
  };

  const playInstrumentClip = async () => {
    if (!instrumentNotes.length) {
      setInstrumentStatus("Add notes first");
      return;
    }
    await stopInstrumentClip();
    const context = liveAudioContextRef.current || new AudioContext();
    liveAudioContextRef.current = context;
    await context.resume();
    setInstrumentStatus("Playing");
    const destination = context.destination;
    const startAt = context.currentTime + 0.04;
    instrumentNotes.forEach((note) => scheduleInstrumentNote(context, destination, note, instrumentBpm, instrumentId, startAt));
    const timer = window.setTimeout(() => setInstrumentStatus("Ready"), Math.max(600, instrumentDurationSeconds(instrumentNotes, instrumentBpm) * 1000 + 200));
    instrumentTimerRefs.current.push(timer);
  };

  const stopInstrumentClip = async () => {
    instrumentTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
    instrumentTimerRefs.current = [];
    instrumentHeldNotesRef.current.clear();
    setInstrumentRecording(false);
    setInstrumentCountIn(0);
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
      instrumentRecordingStartedAtRef.current = performance.now();
      setInstrumentRecording(true);
      setInstrumentCountIn(0);
      setInstrumentStatus("Recording");
    }, 2000);
    instrumentTimerRefs.current.push(first, second);
  };

  const renderInstrumentClip = async () => {
    if (!instrumentNotes.length) {
      setInstrumentStatus("Add notes first");
      return null;
    }
    setInstrumentStatus("Rendering");
    const file = await renderInstrumentWav({
      notes: instrumentNotes,
      bpm: instrumentBpm,
      bars: instrumentBars,
      instrumentId,
      label: instrumentLabel,
    });
    if (instrumentObjectUrlRef.current) URL.revokeObjectURL(instrumentObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    instrumentObjectUrlRef.current = url;
    setInstrumentPreviewUrl(url);
    setInstrumentStatus("Rendered");
    return file;
  };

  const saveInstrumentClip = async () => {
    const file = await renderInstrumentClip();
    if (!file) return;
    const item = createPrivateAssetWorkspaceItem(file, instrumentLabel || file.name, "instrument");
    item.metadata = {
      ...item.metadata,
      bpm: instrumentBpm,
      bars: instrumentBars,
      instrumentId,
      notes: instrumentNotes,
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
    const name = payload.name || `dance-station-edit-${Date.now()}.wav`;
    const file = new File([payload.audio], name, { type: payload.mimeType || "audio/wav" });
    const item = createPrivateAssetWorkspaceItem(file, name.replace(/\.[^.]+$/, ""), "edit");
    item.metadata = {
      ...item.metadata,
      sourceTool: "audio-edit",
      duration: payload.duration,
      sampleRate: payload.sampleRate,
      channels: payload.channels,
    };
    await saveWorkspaceItem(item);
    setWorkspaceMessage(`${item.title} saved to Private Assets.`);
    await refreshWorkspace();
  };

  const loadAudioMassAsset = (asset: AudioMassWorkspaceAsset) => {
    audioMassFrameRef.current?.contentWindow?.postMessage({
      type: "dance-station:load-audio",
      payload: {
        url: asset.url,
        name: asset.title,
      },
    }, window.location.origin);
    setAudioEditPickerOpen(false);
    setWorkspaceMessage(`${asset.title} loaded into Audio Edit.`);
  };

  const requestAudioMassWorkspaceSave = () => {
    audioMassFrameRef.current?.contentWindow?.postMessage({
      type: "dance-station-export-audio",
      requestId: crypto.randomUUID(),
      name: `dance-station-edit-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
    }, window.location.origin);
    setWorkspaceMessage("Saving current Audio Edit buffer to Private Assets...");
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
  }, [activePanel, instrumentNotes, instrumentOctave, instrumentRecording, instrumentBpm]);

  return (
    <main className="home-v2 library-page-shell dance-station-app-shell">
      <div className="home-v2-shell">
        <HomeTopNav />

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
            <h1>Creator workspace</h1>
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
              <span>{tool.status}</span>
              <strong>{tool.label}</strong>
              <small>{tool.description}</small>
            </button>
          ))}
        </section>

        <section className="dance-station-main-grid">
          <div className="home-v2-card dance-station-main-panel">
            {activePanel === "library" ? (
              <LibraryWorkspacePanel
                workspaceItems={workspaceItems}
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
                refreshWorkspace={refreshWorkspace}
                setWorkspaceMessage={setWorkspaceMessage}
              />
            ) : activePanel === "audio-edit" ? (
              <AudioEditPanel frameRef={audioMassFrameRef} />
            ) : activePanel === "instrument-lab" ? (
              <InstrumentLabPanel
                label={instrumentLabel}
                bpm={instrumentBpm}
                bars={instrumentBars}
                octave={instrumentOctave}
                instrumentId={instrumentId}
                notes={instrumentNotes}
                status={instrumentStatus}
                previewUrl={instrumentPreviewUrl}
                recording={instrumentRecording}
                countIn={instrumentCountIn}
                setLabel={setInstrumentLabel}
                setBpm={setInstrumentBpm}
                setBars={setInstrumentBars}
                setOctave={setInstrumentOctave}
                setInstrumentId={setInstrumentId}
                addNote={addInstrumentNote}
                clearNotes={clearInstrumentNotes}
                playClip={playInstrumentClip}
                stopClip={stopInstrumentClip}
                recordClip={startInstrumentRecording}
                renderClip={renderInstrumentClip}
                saveClip={saveInstrumentClip}
              />
            ) : (
              <UnavailablePanel tool={tools.find((tool) => tool.id === activePanel) ?? tools[0]} />
            )}
          </div>

          <aside className="home-v2-card dance-station-context-panel">
            {showSettings ? (
              <BrowserWorkspaceSettings
                workspaceStatus={workspaceStatus}
                workspaceMessage={workspaceMessage}
                refreshWorkspace={refreshWorkspace}
                requestPersistence={requestPersistence}
                setShowStorageHelp={setShowStorageHelp}
              />
            ) : (
              <>
                {activePanel === "audio-edit" ? (
                  <AudioEditWorkspaceControls
                    audioAssetCount={countAudioWorkspaceItems(workspaceItems)}
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
                <div className="dance-station-storage-grid dance-station-storage-grid--compact">
                  <StatusChip label="Private Assets" value={workspaceStatus?.indexedDb ? "Ready" : "Unavailable"} good={Boolean(workspaceStatus?.indexedDb)} />
                  <StatusChip label="Protection" value={workspaceStatus?.persisted ? "Granted" : "Optional"} good={Boolean(workspaceStatus?.persisted)} />
                </div>
              </>
            )}
          </aside>
        </section>

        {showSettings ? (
          <section className="dance-station-settings-grid">
            <PublishConnectionSettings
              session={session}
              setSession={setSession}
              tokens={tokens}
              tokenName={tokenName}
              newToken={newToken}
              tokenStatus={tokenStatus}
              setTokenName={setTokenName}
              createToken={createToken}
              revokeToken={revokeToken}
              setTokenStatus={setTokenStatus}
            />
          </section>
        ) : null}

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
  refreshWorkspace,
  setWorkspaceMessage,
}: {
  workspaceItems: BrowserWorkspaceItem[];
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

      <div className="dance-station-workspace-list">
        {privateItems.length ? privateItems.map((item) => (
          <PrivateAssetRow key={item.id} item={item} />
        )) : (
          <div className="library-empty">No private assets yet.</div>
        )}
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
      <section className="library-grid dance-station-public-grid">
        {filteredPublicItems.map((item) => (
          <PublicLibraryAssetCard key={item.id} item={item} importPublicItem={importPublicItem} setWorkspaceMessage={setWorkspaceMessage} />
        ))}
      </section>
    </>
  );
}

function PrivateAssetRow({ item }: { item: BrowserWorkspaceItem }): JSX.Element {
  const metadata = item.metadata;
  const size = typeof metadata.sizeBytes === "number" ? formatBytes(metadata.sizeBytes) : "";
  const mime = typeof metadata.mimeType === "string" ? metadata.mimeType : item.source === "public-library" ? "public library item" : "";
  const updated = new Date(item.updatedAt);
  return (
    <article className="dance-station-workspace-item">
      <div>
        <strong>{item.title}</strong>
        <span>{formatKind(item.kind)} · {item.source === "public-library" ? "Imported" : "Private"}{item.creatorName ? ` · ${item.creatorName}` : ""}</span>
        {mime || size ? <small>{[mime, size].filter(Boolean).join(" · ")}</small> : null}
      </div>
      <div className="dance-station-asset-actions">
        <span>{Number.isNaN(updated.getTime()) ? "Recent" : updated.toLocaleDateString()}</span>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" disabled>
          Publish Soon
        </button>
      </div>
    </article>
  );
}

function PublicLibraryAssetCard({
  item,
  importPublicItem,
  setWorkspaceMessage,
}: {
  item: LibraryItem;
  importPublicItem: (item: LibraryItem) => Promise<void>;
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  const audioFile = item.files.find((file) => file.role === "audio" || file.role === "preview");
  const coverFile = item.files.find((file) => file.role === "cover");
  const datasetSamples = item.files.filter((file) => file.role === "dataset_sample").length;
  const creatorName = item.creator?.displayName || item.creator?.creatorSlug || "Faceless creator";
  const cardImage = coverFile?.publicUrl || item.creator?.bannerUrl || item.creator?.avatarUrl || "";

  return (
    <article className="library-card dance-station-public-card">
      <div
        className={`library-card__media${cardImage ? "" : " library-card__media--empty"}`}
        style={cardImage ? { backgroundImage: `url(${cardImage})` } : undefined}
      >
        <span className="home-v2-tag">{formatKind(item.kind)}</span>
      </div>
      <div className="library-card__topline">
        <span>By {creatorName}</span>
        <span>{item.files.length} files</span>
      </div>
      <h2>{item.title}</h2>
      <p>{item.description || fallbackDescription(item.kind)}</p>
      <div className="library-card__facts">
        {item.kind === "dataset" ? <span>{datasetSamples} samples</span> : null}
        {item.license ? <span>{item.license}</span> : null}
      </div>
      {item.tags.length ? (
        <div className="library-card__tags">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      {audioFile?.publicUrl ? (
        <audio className="library-card__audio" controls preload="metadata" src={audioFile.publicUrl}></audio>
      ) : null}
      <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => importPublicItem(item).catch((error) => setWorkspaceMessage(error.message))}>
        Add to Private Assets
      </button>
    </article>
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

function InstrumentLabPanel({
  label,
  bpm,
  bars,
  octave,
  instrumentId,
  notes,
  status,
  previewUrl,
  recording,
  countIn,
  setLabel,
  setBpm,
  setBars,
  setOctave,
  setInstrumentId,
  addNote,
  clearNotes,
  playClip,
  stopClip,
  recordClip,
  renderClip,
  saveClip,
}: {
  label: string;
  bpm: number;
  bars: number;
  octave: number;
  instrumentId: string;
  notes: InstrumentNote[];
  status: string;
  previewUrl: string;
  recording: boolean;
  countIn: number;
  setLabel: (value: string) => void;
  setBpm: (value: number) => void;
  setBars: (value: number) => void;
  setOctave: (value: number) => void;
  setInstrumentId: (value: string) => void;
  addNote: (pitch: number) => void;
  clearNotes: () => void;
  playClip: () => Promise<void>;
  stopClip: () => Promise<void>;
  recordClip: () => Promise<void>;
  renderClip: () => Promise<File | null>;
  saveClip: () => Promise<void>;
}): JSX.Element {
  return (
    <div className="dance-station-tool-panel dance-station-instrument-workbench">
      <div className="dance-station-panel-head dance-station-instrument-toolbar">
        <div>
          <p className="home-v2-kicker">Instrument Lab</p>
          <h2>Performance editor</h2>
        </div>
        <span className="dance-station-status-pill">{countIn ? `Starts in ${countIn}` : status}</span>
      </div>

      <div className="dance-station-instrument-grid">
        <section className="dance-station-inner-panel dance-station-instrument-sidebar">
          <label>
            <span>Clip name</span>
            <input value={label} onInput={(event) => setLabel((event.currentTarget as HTMLInputElement).value)} />
          </label>
          <div className="dance-station-control-row">
            <label>
              <span>BPM</span>
              <input type="number" min="40" max="240" value={bpm} onInput={(event) => setBpm(Number((event.currentTarget as HTMLInputElement).value || 120))} />
            </label>
            <label>
              <span>Bars</span>
              <input type="number" min="1" max="16" value={bars} onInput={(event) => setBars(Number((event.currentTarget as HTMLInputElement).value || 4))} />
            </label>
            <label>
              <span>Octave</span>
              <input type="number" min="1" max="7" value={octave} onInput={(event) => setOctave(Number((event.currentTarget as HTMLInputElement).value || 4))} />
            </label>
          </div>
          <label>
            <span>Instrument</span>
            <select value={instrumentId} onChange={(event) => setInstrumentId((event.currentTarget as HTMLSelectElement).value)}>
              {INSTRUMENT_BANK.map((instrument) => (
                <option key={instrument.id} value={instrument.id}>{instrument.name}</option>
              ))}
            </select>
          </label>
        </section>

        <section className="dance-station-inner-panel dance-station-performance-panel">
          <div className="dance-station-transport">
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => playClip()}>
              Play
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => recordClip()} disabled={recording || Boolean(countIn)}>
              {recording ? "Recording" : "Record"}
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => stopClip()}>
              Stop
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={clearNotes}>
              Clear
            </button>
          </div>
          <div className="dance-station-piano">
            {PIANO_KEYS.map((key) => (
              <button
                key={key.semitone}
                type="button"
                className={key.black ? "black" : ""}
                onClick={() => addNote((octave + 1) * 12 + key.semitone)}
              >
                {key.label}
              </button>
            ))}
          </div>
          <div className="dance-station-note-lane">
            {notes.length ? notes.map((note) => (
              <span key={note.id} style={{ left: `${Math.min(96, note.start * 8)}%`, width: `${Math.max(3, note.duration * 8)}%` }}>
                {midiNoteLabel(note.pitch)}
              </span>
            )) : <em>No notes yet.</em>}
          </div>
        </section>

        <section className="dance-station-inner-panel dance-station-render-panel">
          <div className="dance-station-panel-actions">
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => renderClip()}>
              Render Preview
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => saveClip()}>
              Save Clip
            </button>
          </div>
          {previewUrl ? <audio controls preload="metadata" src={previewUrl}></audio> : <div className="library-empty">No rendered preview yet.</div>}
        </section>
      </div>
    </div>
  );
}

function AudioMassAssetPicker({
  assets,
  onLoad,
  onClose,
}: {
  assets: AudioMassWorkspaceAsset[];
  onLoad: (asset: AudioMassWorkspaceAsset) => void;
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
            <button key={asset.id} type="button" onClick={() => onLoad(asset)}>
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
  openPrivateAssets,
  saveCurrentEdit,
}: {
  audioAssetCount: number;
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
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={saveCurrentEdit}>
          Save Current Edit
        </button>
      </div>
      <p className="small">{audioAssetCount} audio assets available. Disk open and download stay in AudioMass File.</p>
    </section>
  );
}

function UnavailablePanel({ tool }: { tool: typeof tools[number] }): JSX.Element {
  return (
    <div className="dance-station-unavailable-panel">
      <p className="home-v2-kicker">{tool.status}</p>
      <h2>{tool.label}</h2>
      <p>{tool.description}</p>
      <p className="small">This panel is part of the shared Dance Station shell. The feature will activate when its site adapter is connected.</p>
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

function PublishConnectionSettings({
  session,
  setSession,
  tokens,
  tokenName,
  newToken,
  tokenStatus,
  setTokenName,
  createToken,
  revokeToken,
  setTokenStatus,
}: {
  session: SessionState;
  setSession: (next: SessionState) => void;
  tokens: CreatorPublishTokenRecord[];
  tokenName: string;
  newToken: string;
  tokenStatus: string;
  setTokenName: (value: string) => void;
  createToken: () => Promise<void>;
  revokeToken: (tokenId: string) => Promise<void>;
  setTokenStatus: (value: string) => void;
}): JSX.Element {
  return (
    <section className="home-v2-card dance-station-token-panel">
      <p className="home-v2-kicker">Publish Connection</p>
      <h2>Local app token</h2>
      <p>
        Generate a creator publish token for a local Dance Station install. The site version uses your signed-in
        session directly for account sync and publish actions.
      </p>

      {session.authenticated ? (
        <div className="dance-station-token-controls">
          <label>
            <span>Token name</span>
            <input
              value={tokenName}
              onInput={(event) => setTokenName((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => createToken().catch((error) => setTokenStatus(error.message))}>
            Create Publish Token
          </button>
          {newToken ? (
            <label>
              <span>New token</span>
              <textarea readOnly rows={3} value={newToken}></textarea>
            </label>
          ) : null}
          {tokenStatus ? <p className="small">{tokenStatus}</p> : null}
          <div className="dance-station-token-list">
            {tokens.map((token) => (
              <div className="dance-station-token-row" key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <span>{token.revokedAt ? "Revoked" : token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
                </div>
                {!token.revokedAt ? (
                  <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => revokeToken(token.id).catch((error) => setTokenStatus(error.message))}>
                    Revoke
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <WalletAuthCard onVerified={(next) => setSession({ loading: false, ...next })} />
      )}
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
  gain.gain.linearRampToValueAtTime(note.velocity * 0.75, start + instrument.attack);
  gain.gain.setValueAtTime(note.velocity * 0.75, start + Math.max(instrument.attack, duration - instrument.release));
  gain.gain.linearRampToValueAtTime(0, start + duration + instrument.release);
  oscillator.connect(gain).connect(destination);
  oscillator.start(start);
  oscillator.stop(start + duration + instrument.release + 0.05);
}

function instrumentDurationSeconds(notes: InstrumentNote[], bpm: number): number {
  if (!notes.length) return 0;
  return Math.max(...notes.map((note) => note.start + note.duration)) * beatSeconds(bpm);
}

async function renderInstrumentWav({
  notes,
  bpm,
  bars,
  instrumentId,
  label,
}: {
  notes: InstrumentNote[];
  bpm: number;
  bars: number;
  instrumentId: string;
  label: string;
}): Promise<File> {
  const duration = Math.max(bars * 4 * beatSeconds(bpm), instrumentDurationSeconds(notes, bpm) + 0.5);
  const sampleRate = 44100;
  const context = new OfflineAudioContext(2, Math.ceil(sampleRate * duration), sampleRate);
  const master = context.createGain();
  master.gain.value = 0.86;
  master.connect(context.destination);
  notes.forEach((note) => scheduleInstrumentNote(context, master, note, bpm, instrumentId, 0));
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

function buildAudioMassWorkspaceAssets(
  items: BrowserWorkspaceItem[],
  objectUrlsRef: { current: string[] }
): AudioMassWorkspaceAsset[] {
  objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  objectUrlsRef.current = [];
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
  objectUrlsRef: { current: string[] }
): string | null {
  const blob = item.metadata?.blob;
  if (blob instanceof Blob && blob.type.startsWith("audio/")) {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
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
