import { useEffect, useState } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { WalletAuthCard } from "../components/WalletAuthCard";
import { api, type CreatorPublishTokenRecord } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

export function DanceStationPage({ session, setSession }: Props): JSX.Element {
  const [tokens, setTokens] = useState<CreatorPublishTokenRecord[]>([]);
  const [tokenName, setTokenName] = useState("Dance Station");
  const [newToken, setNewToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
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
