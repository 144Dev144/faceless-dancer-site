import type { SiteSettings } from "../lib/api";
import heroMainImage from "../assets/hero/hero_main.png";

interface Props {
  settings: SiteSettings;
}

export function HeroSection({ settings }: Props): JSX.Element {
  const tokenAddressLabel = settings.tokenAddress || "Soon";
  const channelId = (settings.youtubeLiveChannelId ?? "").trim();
  const liveEmbedUrl = settings.showYoutubeEmbed && channelId
    ? `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(channelId)}&autoplay=1&mute=1`
    : "";

  const socialLinks = [
    { label: "X / Twitter", href: settings.twitterUrl, visible: settings.showTwitter },
    { label: "YouTube", href: settings.youtubeUrl, visible: settings.showYoutube },
    { label: "Telegram", href: settings.telegramUrl, visible: settings.showTelegram },
    { label: "DexScreener", href: settings.dexscreenerUrl, visible: settings.showDexscreener },
  ].filter((link) => link.visible && link.href);

  const tokenViewLink = settings.dexscreenerUrl || settings.pumpFunUrl;
  const autotransitionGithubUrl = (settings.autotransitionGithubUrl ?? "").trim();

  return (
    <section className="home-v2-hero">
      <div className="home-v2-hero__content">
        <p className="home-v2-status-pill">The mysterious dancer who never stops</p>
        <h1>The Faceless Dancer</h1>
        <p>
          A music-data platform that extracts rhythm, beats, and stems from audio and
          turns that data into games, visualizers, and future AI-powered creative tools.
        </p>

        <div className="home-v2-hero__actions">
          <a className="home-v2-btn home-v2-btn--primary" href="/game">Play The Game</a>
          <a className="home-v2-btn home-v2-btn--secondary" href="/playground">Faceless Playground</a>
          {autotransitionGithubUrl ? (
            <a
              className="home-v2-btn home-v2-btn--ghost"
              href={autotransitionGithubUrl}
              target="_blank"
              rel="noreferrer"
            >
              Autotransition - Github
            </a>
          ) : null}
        </div>

        <div className="home-v2-social-row">
          {socialLinks.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
          ))}
        </div>

        <div className="home-v2-token-row">
          <div>
            <p>Token Address</p>
            <code>{tokenAddressLabel}</code>
          </div>
          {tokenViewLink ? (
            <a href={tokenViewLink} target="_blank" rel="noreferrer">View</a>
          ) : null}
        </div>
      </div>

      <div className="home-v2-hero__visual">
        <div className="home-v2-stage">
          {liveEmbedUrl ? (
            <iframe
              className="home-v2-stage__stream"
              src={liveEmbedUrl}
              title="The Faceless Dancer live stream"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="home-v2-stage__placeholder" aria-label="Live stage feed placeholder">
              <img
                className="home-v2-stage__hero-image"
                src={heroMainImage}
                alt="The Faceless Dancer hero"
              />
            </div>
          )}
        </div>
        <p className="home-v2-stage__caption">Live stage feed - games, visualizers, and tools powered by music data.</p>
      </div>
    </section>
  );
}
