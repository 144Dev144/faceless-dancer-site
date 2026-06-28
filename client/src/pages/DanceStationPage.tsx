import { useEffect, useState } from "preact/hooks";
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
    status: "Next",
    available: false,
    description: "AudioMass browser editing with workspace import/export.",
  },
  {
    id: "instrument-lab",
    label: "Instrument Lab",
    status: "Next",
    available: false,
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

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
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
