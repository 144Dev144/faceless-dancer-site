import { useState } from "preact/hooks";
import { WalletAuthCard } from "../WalletAuthCard";
import { MySubmissionsCard } from "../MySubmissionsCard";
import { SubmissionCard } from "../SubmissionCard";
import { ScheduleSlotPicker } from "../ScheduleSlotPicker";
import { AdminConsoleCard } from "../AdminConsoleCard";
import { api, type SiteSettings } from "../../lib/api";
import type { SessionState } from "../../hooks/useSession";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
  refreshSession: () => Promise<void>;
  siteSettings: SiteSettings;
  onSiteSettingsSaved: (settings: SiteSettings) => void;
}

interface SelectionState {
  startIso: string;
  endIso: string;
  hasPendingConflict: boolean;
}

const emptySelection: SelectionState = {
  startIso: "",
  endIso: "",
  hasPendingConflict: false,
};

export function HolderToolsSection({
  session,
  setSession,
  refreshSession,
  siteSettings,
  onSiteSettingsSaved,
}: Props): JSX.Element {
  const [selection, setSelection] = useState<SelectionState>(emptySelection);
  const [scheduleRefreshKey, setScheduleRefreshKey] = useState(0);

  return (
    <section className="home-v2-section home-v2-tools">
      <div className="home-v2-heading">
        <p className="home-v2-kicker">Holder Tools</p>
        <h2>Utility and submission workflow</h2>
        <p>
          Tools for verified holders to submit, manage assets, and schedule access.
        </p>
      </div>

      <div className="home-v2-tools-grid">
        <div className="home-v2-tools-left">
          <section className="card home-v2-step-card">
            <div className="home-v2-step-card__label">1</div>
            <h2>The Faceless Dancer</h2>
            <p className="small">Solana holder-gated requests for stream scheduling and asset submissions.</p>
            {session.authenticated ? (
              <div>
                <span className="badge ok">Authenticated</span>{" "}
                {session.isHolder ? <span className="badge ok">Verified Holder</span> : <span className="badge warn">Not a Holder</span>}{" "}
                {session.isAdmin ? <span className="badge ok">Admin</span> : null}
                <p className="small">Wallet: {session.publicKey}</p>
                <div className="row">
                  <button type="button" className="secondary" onClick={() => refreshSession().catch(() => null)}>Refresh Session</button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => api.logout().then(() => setSession({ loading: false, authenticated: false, publicKey: "", isHolder: false, isAdmin: false }))}
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <span className="badge warn">Not Authenticated</span>
            )}
          </section>

          <div className="home-v2-step-wrap">
            <div className="home-v2-step-head"><span>2</span><h3>Wallet Verification</h3></div>
            <WalletAuthCard onVerified={(next) => setSession({ loading: false, ...next })} />
          </div>

          <div className="home-v2-step-wrap">
            <div className="home-v2-step-head"><span>3</span><h3>My Submissions</h3></div>
            <MySubmissionsCard enabled={session.authenticated} />
          </div>

          <div className="home-v2-step-wrap">
            <div className="home-v2-step-head"><span>4</span><h3>Holder Submission</h3></div>
            <SubmissionCard
              enabled={session.authenticated && session.isHolder}
              hideSchedulePicker
              selectedStart={selection.startIso}
              selectedEnd={selection.endIso}
              hasPendingConflict={selection.hasPendingConflict}
              onScheduleSelect={setSelection}
              scheduleRefreshKey={scheduleRefreshKey}
              onSubmissionCreated={() => setScheduleRefreshKey((value) => value + 1)}
            />
          </div>
        </div>

        <div className="home-v2-tools-right">
          <section className="card home-v2-step-card home-v2-step-card--schedule">
            <div className="home-v2-step-head"><span>5</span><h3>Pick a 1-Hour ET Slot</h3></div>
            <p className="small">Approved and scheduled slots are public. Pending slots are first come first serve.</p>
            <ScheduleSlotPicker
              enabled={session.authenticated && session.isHolder}
              selectedStart={selection.startIso}
              selectedEnd={selection.endIso}
              refreshKey={scheduleRefreshKey}
              onSelect={setSelection}
            />
            {!session.authenticated ? <div className="small">Connect a wallet to request slots.</div> : null}
          </section>
        </div>
      </div>

      {session.authenticated && session.isAdmin ? (
        <section className="home-v2-admin-wrap">
          <AdminConsoleCard
            enabled
            settings={siteSettings}
            onSettingsSaved={onSiteSettingsSaved}
          />
        </section>
      ) : null}
    </section>
  );
}
