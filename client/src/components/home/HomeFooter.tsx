import { ArrowUpRight, AtSign, Send, Video } from "lucide-preact";
import type { SiteSettings } from "../../lib/api";
import { navigateInApp } from "../../lib/clientNavigation";

interface Props {
  settings: SiteSettings;
}

function configured(value: string | undefined, enabled = true): value is string {
  return enabled && Boolean(value?.trim());
}

export function HomeFooter({ settings }: Props): JSX.Element {
  return (
    <footer className="homepage-footer">
      <div className="homepage-footer__main">
        <div className="homepage-footer__brand">
          <strong>The Faceless Dancer</strong>
          <p>Open audio infrastructure for creators of rhythm.</p>
          <span>© 2026 The Faceless Dancer</span>
        </div>
        <div className="homepage-footer__links">
          <div><h3>Products</h3><a href="/dance-station" onClick={(event) => navigateInApp(event, "/dance-station")}>Dance Station</a><a href="/game" onClick={(event) => navigateInApp(event, "/game")}>Dance Stage</a><a href="/library" onClick={(event) => navigateInApp(event, "/library")}>Shared Library</a></div>
          <div><h3>Resources</h3><a href="#workflow">Creator workflow</a><a href="#roadmap">Roadmap</a>{configured(settings.autotransitionGithubUrl) ? <a href={settings.autotransitionGithubUrl} target="_blank" rel="noreferrer">Open-source tools <ArrowUpRight size={13} /></a> : null}</div>
          <div><h3>Community</h3>{configured(settings.twitterUrl, settings.showTwitter) ? <a href={settings.twitterUrl} target="_blank" rel="noreferrer"><AtSign size={14} /> X / Twitter</a> : null}{configured(settings.youtubeUrl, settings.showYoutube) ? <a href={settings.youtubeUrl} target="_blank" rel="noreferrer"><Video size={14} /> YouTube</a> : null}{configured(settings.telegramUrl, settings.showTelegram) ? <a href={settings.telegramUrl} target="_blank" rel="noreferrer"><Send size={14} /> Telegram</a> : null}</div>
        </div>
        <div className="homepage-footer__signup"><p>Stay close to the build.</p><span>Updates, releases, and creator experiments.</span><div className="homepage-footer__signup-links">{configured(settings.autotransitionGithubUrl) ? <a href={settings.autotransitionGithubUrl} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a> : null}{configured(settings.telegramUrl, settings.showTelegram) ? <a href={settings.telegramUrl} target="_blank" rel="noreferrer">Community <ArrowUpRight size={13} /></a> : null}</div></div>
      </div>
      <div className="homepage-footer__legal"><span>Open source audio infrastructure for public creativity.</span><span><a href="#platform">Platform</a><a href="#token">$FACELESS</a><a href="/profile" onClick={(event) => navigateInApp(event, "/profile")}>Profile</a></span></div>
    </footer>
  );
}
