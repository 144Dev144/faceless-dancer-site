import { useEffect, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { CheckCircle2, CircleAlert, Clock3, Download, ExternalLink, LoaderCircle, Music2 } from "lucide-preact";
import { HomeTopNav } from "../components/home/HomeTopNav";
import { AudioPlayButton } from "../components/audio/SiteAudioPlayer";
import { api, type RemoteRewardSubmission } from "../lib/api";
import type { SessionState } from "../hooks/useSession";

interface Props {
  session: SessionState;
  setSession: (next: SessionState) => void;
}

const statusCopy: Record<RemoteRewardSubmission["status"], string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

function profileBadge(session: SessionState): string {
  const displayName = session.creatorProfile?.displayName?.trim();
  if (displayName) return displayName.slice(0, 1).toUpperCase();
  return session.publicKey.slice(0, 2).toUpperCase();
}

export function ProfilePage({ session, setSession }: Props): JSX.Element {
  const [submissions, setSubmissions] = useState<RemoteRewardSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [appealSubmission, setAppealSubmission] = useState<RemoteRewardSubmission | null>(null);
  const [appealPostLink, setAppealPostLink] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState("");

  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

  useEffect(() => {
    if (!session.authenticated) {
      setSubmissions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api.remoteRewardSubmissions(100)
      .then((next) => {
        if (!cancelled) setSubmissions(next);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Could not load reward submissions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.authenticated, session.publicKey]);

  function openAppeal(submission: RemoteRewardSubmission) {
    setAppealSubmission(submission);
    setAppealPostLink(submission.postLink);
    setAppealError("");
  }

  function closeAppeal() {
    if (!appealBusy) setAppealSubmission(null);
  }

  async function submitAppeal() {
    const postLink = appealPostLink.trim();
    if (!appealSubmission || !postLink) {
      setAppealError("Add a link to the post before appealing.");
      return;
    }
    setAppealBusy(true);
    setAppealError("");
    try {
      const updated = await api.appealRemoteRewardSubmission(appealSubmission.id, postLink);
      setSubmissions((current) => current.map((submission) => submission.id === updated.id ? updated : submission));
      setAppealSubmission(null);
    } catch (nextError) {
      setAppealError(nextError instanceof Error ? nextError.message : "This reward submission could not be appealed. Please try again.");
    } finally {
      setAppealBusy(false);
    }
  }

  return (
    <main className="home-v2 profile-page-shell">
      <div className="home-v2-shell">
        <HomeTopNav session={session} setSession={setSession} />
        <section className="profile-page">
          <header className="profile-page__heading">
            <div className="profile-page__identity">
              {session.authenticated ? <span className="profile-page__avatar">
                {session.creatorProfile?.avatarUrl ? <img src={session.creatorProfile.avatarUrl} alt="" /> : profileBadge(session)}
              </span> : null}
              <div>
              <span className="home-v2-kicker">Creator profile</span>
              {session.creatorProfile?.displayName?.trim() ? <h1>{session.creatorProfile.displayName.trim()}</h1> : null}
              <p>{session.authenticated ? "Your reward submissions and review history." : "Connect your wallet to view your profile."}</p>
              </div>
            </div>
            {session.authenticated ? <span className="profile-page__wallet">{session.publicKey.slice(0, 8)}...{session.publicKey.slice(-6)}</span> : null}
          </header>

          {!session.authenticated ? (
            <div className="profile-page__empty"><CircleAlert aria-hidden="true" size={22} /><span>Log in from the navigation menu to view your submissions.</span></div>
          ) : (
            <section className="profile-submissions" aria-labelledby="profile-submissions-title">
              <div className="profile-submissions__heading">
                <h2 id="profile-submissions-title">Submitted generations</h2>
                <span>{submissions.length}</span>
              </div>
              {loading ? <div className="profile-page__empty"><LoaderCircle className="profile-page__spinner" aria-hidden="true" size={21} /><span>Loading submissions...</span></div> : null}
              {error ? <p className="dance-station-error" role="alert">{error}</p> : null}
              {!loading && !error && !submissions.length ? <div className="profile-page__empty"><Music2 aria-hidden="true" size={24} /><span>Submitted generations will appear here.</span></div> : null}
              {!loading && submissions.length ? (
                <div className="profile-submissions__list">
                  {submissions.map((submission) => (
                    <article className="profile-submission-row" key={submission.id}>
                      <div className="profile-submission-row__main">
                        <strong>{submission.generationTitle}</strong>
                        <span>{new Date(submission.createdAt).toLocaleString()}</span>
                        <a href={submission.postLink} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" size={13} /> View post</a>
                        {submission.status === "rejected" && submission.rejectionReason ? <p>{submission.rejectionReason}</p> : null}
                      </div>
                      <div className="profile-submission-row__actions">
                        <span className={`profile-submission-status profile-submission-status--${submission.status}`}>
                          {submission.status === "approved" ? <CheckCircle2 aria-hidden="true" size={14} /> : submission.status === "rejected" ? <CircleAlert aria-hidden="true" size={14} /> : <Clock3 aria-hidden="true" size={14} />}
                          {statusCopy[submission.status]}
                        </span>
                        {submission.status === "rejected" ? <button className="profile-submission-appeal" type="button" onClick={() => openAppeal(submission)}>Appeal</button> : null}
                        <AudioPlayButton track={{ id: `reward-${submission.id}`, title: submission.generationTitle, url: submission.audioUrl, mimeType: submission.audioMimeType }} />
                        <a className="profile-submission-download" href={submission.audioUrl} download target="_blank" rel="noreferrer" aria-label={`Download ${submission.generationTitle}`} title="Download generation"><Download aria-hidden="true" size={15} /></a>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          )}
        </section>
      </div>
      {appealSubmission && typeof document !== "undefined" ? createPortal(
        <div className="profile-appeal-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAppeal(); }}>
          <section className="profile-appeal-modal" role="dialog" aria-modal="true" aria-labelledby="profile-appeal-title">
            <div className="profile-appeal-modal__head">
              <div>
                <span className="home-v2-kicker">Reward submission</span>
                <h2 id="profile-appeal-title">Appeal rejected submission</h2>
              </div>
              <button className="profile-appeal-modal__close" type="button" onClick={closeAppeal} disabled={appealBusy} aria-label="Close appeal dialog">×</button>
            </div>
            <p>Update the post link if needed and send this submission back for review.</p>
            <label className="profile-appeal-modal__field">
              <span>Link To Post</span>
              <input value={appealPostLink} onInput={(event) => setAppealPostLink((event.currentTarget as HTMLInputElement).value)} maxLength={2048} autoFocus disabled={appealBusy} />
            </label>
            {appealSubmission.rejectionReason ? <div className="profile-appeal-modal__reason"><strong>Review note</strong><span>{appealSubmission.rejectionReason}</span></div> : null}
            {appealError ? <p className="dance-station-error" role="alert">{appealError}</p> : null}
            <div className="profile-appeal-modal__actions">
              <button className="profile-appeal-modal__button" type="button" onClick={closeAppeal} disabled={appealBusy}>Cancel</button>
              <button className="profile-appeal-modal__button profile-appeal-modal__button--primary" type="button" onClick={() => void submitAppeal()} disabled={appealBusy || !appealPostLink.trim()}>{appealBusy ? "Appealing..." : "Submit appeal"}</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </main>
  );
}
