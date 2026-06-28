import { useEffect } from "preact/hooks";
import { HomeTopNav } from "../components/home/HomeTopNav";

export function DanceStationPage(): JSX.Element {
  useEffect(() => {
    document.body.classList.add("home-page-body");
    return () => document.body.classList.remove("home-page-body");
  }, []);

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
      </div>
    </main>
  );
}
