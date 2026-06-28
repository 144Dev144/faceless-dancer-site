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

export function DanceStationPage({ session, setSession }: Props): JSX.Element {
  const [tokens, setTokens] = useState<CreatorPublishTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState("Dance Station");
  const [newToken, setNewToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");
  const [workspaceItems, setWorkspaceItems] = useState<BrowserWorkspaceItem[]>([]);
  const [workspaceStatus, setWorkspaceStatus] = useState<BrowserWorkspaceStatus | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [draftTitle, setDraftTitle] = useState("Untitled browser draft");
  const [showStorageHelp, setShowStorageHelp] = useState(false);

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
    setWorkspaceMessage(granted ? "Persistent browser storage granted." : "Browser did not grant persistent storage.");
    await refreshWorkspace();
  };

  const dismissStorageHelp = async () => {
    await setWorkspaceSetting("storageIntroDismissed", true);
    setShowStorageHelp(false);
  };

  return (
    <main className="home-v2 library-page-shell">
      <div className="home-v2-shell">
        <HomeTopNav />
        <section className="library-hero dance-station-hero">
          <p className="home-v2-kicker">Dance Station</p>
          <h1>The local AI music workstation is coming to the web in stages</h1>
          <p>
            Dance Station currently runs as a local creator app for generation, transitions, extraction, AudioMass
            editing, Instrument Lab, datasets, and LoKr training. The site version will start with browser-safe
            library and editing workflows before remote compute is added for ACE-Step and Side-Step.
          </p>
          <div className="library-hero__actions">
            <a className="home-v2-btn home-v2-btn--primary" href="/library">Browse Library</a>
            <a className="home-v2-btn home-v2-btn--secondary" href="/#apps">See Current Tools</a>
          </div>
        </section>

        <section className="dance-station-status-grid">
          <article className="home-v2-card">
            <h2>Available Now</h2>
            <p>Local Dance Station app, public library groundwork, Dance Stage, and rhythm-powered experiences.</p>
          </article>
          <article className="home-v2-card">
            <h2>Next</h2>
            <p>Publish/import flows between the local app and the public library, with admin moderation.</p>
          </article>
          <article className="home-v2-card">
            <h2>Later</h2>
            <p>Remote compute for ACE-Step generation, extraction, autotransition, and Side-Step training.</p>
          </article>
        </section>

        {showStorageHelp ? (
          <section className="dance-station-storage-modal" role="dialog" aria-modal="true" aria-label="Browser storage notice">
            <div className="home-v2-card dance-station-storage-modal__card">
              <p className="home-v2-kicker">First Use</p>
              <h2>Browser work is saved on this device</h2>
              <StorageCaveats />
              <div className="dance-station-panel-actions">
                <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => requestPersistence().catch((error) => setWorkspaceMessage(error.message))}>
                  Request Persistent Storage
                </button>
                <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => dismissStorageHelp().catch(() => setShowStorageHelp(false))}>
                  Got It
                </button>
              </div>
              {workspaceMessage ? <p className="small">{workspaceMessage}</p> : null}
            </div>
          </section>
        ) : null}

        <section className="home-v2-card dance-station-workspace-panel">
          <div className="dance-station-panel-head">
            <div>
              <p className="home-v2-kicker">Browser Workspace</p>
              <h2>Saved on this device</h2>
            </div>
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => setShowStorageHelp(true)}>
              Help / Storage
            </button>
          </div>
          <p>
            This is the web version's local library layer. It keeps browser drafts and imported items available when
            you return on the same browser, while account sync and publishing remain explicit actions.
          </p>
          <div className="dance-station-storage-grid">
            <StatusChip label="IndexedDB" value={workspaceStatus?.indexedDb ? "Available" : "Unavailable"} good={Boolean(workspaceStatus?.indexedDb)} />
            <StatusChip label="OPFS" value={workspaceStatus?.opfs ? "Available" : "Not available"} good={Boolean(workspaceStatus?.opfs)} />
            <StatusChip label="Persistence" value={workspaceStatus?.persisted ? "Granted" : "Not granted"} good={Boolean(workspaceStatus?.persisted)} />
            <StatusChip label="Quota" value={formatStorageEstimate(workspaceStatus)} good={Boolean(workspaceStatus?.estimate?.quota)} />
          </div>
          <div className="dance-station-panel-actions">
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => requestPersistence().catch((error) => setWorkspaceMessage(error.message))}>
              Request Persistent Storage
            </button>
            <button type="button" className="home-v2-btn home-v2-btn--secondary" onClick={() => refreshWorkspace().catch((error) => setWorkspaceMessage(error.message))}>
              Refresh Workspace
            </button>
          </div>
          {workspaceMessage ? <p className="small">{workspaceMessage}</p> : null}

          <div className="dance-station-draft-row">
            <label>
              <span>Draft label</span>
              <input value={draftTitle} onInput={(event) => setDraftTitle((event.currentTarget as HTMLInputElement).value)} />
            </label>
            <button type="button" className="home-v2-btn home-v2-btn--primary" onClick={() => createBrowserDraft().catch((error) => setWorkspaceMessage(error.message))}>
              Save Browser Draft
            </button>
          </div>

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
        </section>

        <section className="home-v2-card dance-station-token-panel">
          <p className="home-v2-kicker">Publish Connection</p>
          <h2>Connect the local app to your public library</h2>
          <p>
            Generate a creator publish token, then paste it into Dance Station's Library connection settings. Media
            uploads go through the site API and are stored in Bunny CDN.
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
      </div>
    </main>
  );
}

function StorageCaveats(): JSX.Element {
  return (
    <ul className="dance-station-storage-caveats">
      <li>Browser-local work is tied to this browser, device, and site address.</li>
      <li>Closing the site and coming back normally should keep it available.</li>
      <li>Clearing site data, using private browsing, or browser storage cleanup can remove it.</li>
      <li>Persistent storage reduces eviction risk, but important work should be synced to your account.</li>
      <li>Publishing makes approved items available in the public library.</li>
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
