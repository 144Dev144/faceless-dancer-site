import { useEffect, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { api, type CreatorPublishTokenRecord } from "../lib/api";
import type { SessionState } from "../hooks/useSession";
import {
  createDraftWorkspaceItem,
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
    description: "Browser-local workspace, imported assets, account sync, and public publishing.",
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
  const [draftTitle, setDraftTitle] = useState("Untitled browser draft");
  const [showStorageHelp, setShowStorageHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

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

  const createBrowserDraft = async () => {
    const title = draftTitle.trim() || "Untitled browser draft";
    await saveWorkspaceItem(createDraftWorkspaceItem(title));
    setWorkspaceMessage("Saved to this browser.");
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
              Settings
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
                draftTitle={draftTitle}
                workspaceMessage={workspaceMessage}
                setDraftTitle={setDraftTitle}
                createBrowserDraft={createBrowserDraft}
                refreshWorkspace={refreshWorkspace}
                setWorkspaceMessage={setWorkspaceMessage}
              />
            ) : (
              <UnavailablePanel tool={tools.find((tool) => tool.id === activePanel) ?? tools[0]} />
            )}
          </div>

          <aside className="home-v2-card dance-station-context-panel">
            <p className="home-v2-kicker">Session</p>
            <h2>{session.authenticated ? "Connected" : "Not connected"}</h2>
            <p>
              {session.authenticated
                ? `Wallet ${session.publicKey.slice(0, 6)}...${session.publicKey.slice(-4)}`
                : "Connect a wallet when you want to sync or publish account-owned assets."}
            </p>
            <div className="dance-station-storage-grid dance-station-storage-grid--compact">
              <StatusChip label="Local Save" value={workspaceStatus?.indexedDb ? "Ready" : "Unavailable"} good={Boolean(workspaceStatus?.indexedDb)} />
              <StatusChip label="Protection" value={workspaceStatus?.persisted ? "Granted" : "Optional"} good={Boolean(workspaceStatus?.persisted)} />
            </div>
          </aside>
        </section>

        {showSettings ? (
          <section className="dance-station-settings-grid">
            <BrowserWorkspaceSettings
              workspaceStatus={workspaceStatus}
              workspaceMessage={workspaceMessage}
              refreshWorkspace={refreshWorkspace}
              requestPersistence={requestPersistence}
              setShowStorageHelp={setShowStorageHelp}
            />
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
  draftTitle,
  workspaceMessage,
  setDraftTitle,
  createBrowserDraft,
  refreshWorkspace,
  setWorkspaceMessage,
}: {
  workspaceItems: BrowserWorkspaceItem[];
  draftTitle: string;
  workspaceMessage: string;
  setDraftTitle: (value: string) => void;
  createBrowserDraft: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  setWorkspaceMessage: (value: string) => void;
}): JSX.Element {
  return (
    <>
      <div className="dance-station-panel-head">
        <div>
          <p className="home-v2-kicker">Library</p>
          <h2>Browser workspace</h2>
        </div>
        <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => refreshWorkspace().catch((error) => setWorkspaceMessage(error.message))}>
          Refresh
        </button>
      </div>
      <p>
        Save browser-local drafts, then import from the public library or sync to your account as those flows come
        online in the shared Dance Station app.
      </p>

      <div className="dance-station-draft-row">
        <label>
          <span>Draft label</span>
          <input value={draftTitle} onInput={(event) => setDraftTitle((event.currentTarget as HTMLInputElement).value)} />
        </label>
        <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => createBrowserDraft().catch((error) => setWorkspaceMessage(error.message))}>
          Save Browser Draft
        </button>
      </div>
      {workspaceMessage ? <p className="small">{workspaceMessage}</p> : null}

      <div className="dance-station-workspace-list">
        {workspaceItems.length ? workspaceItems.map((item) => (
          <article className="dance-station-workspace-item" key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.kind} · {item.source}</span>
            </div>
            <span>{new Date(item.updatedAt).toLocaleString()}</span>
          </article>
        )) : (
          <div className="library-empty">No browser-local workspace items yet.</div>
        )}
      </div>
    </>
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
    <section className="home-v2-card dance-station-workspace-panel">
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
      <li>Browser-local work is tied to this browser, device, and site address.</li>
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
