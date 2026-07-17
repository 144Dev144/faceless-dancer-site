import { useState } from "preact/hooks";
import {
  ArrowRight,
  ArrowUpRight,
  Award,
  Check,
  Code2,
  Coins,
  Copy,
  ExternalLink,
  Gamepad2,
  GitBranch,
  Layers3,
  LibraryBig,
  Trophy,
  WandSparkles,
} from "lucide-preact";
import danceStationImage from "../../assets/home/products/dance-station-workspace.png";
import sharedLibraryImage from "../../assets/home/products/shared-library-workspace.png";
import danceStageImage from "../../assets/home/apps/games-with-rhythm.png";
import openToolsImage from "../../assets/home/icons/open-tools.png";
import type { SessionState } from "../../hooks/useSession";
import { navigateInApp } from "../../lib/clientNavigation";
import type { SiteSettings } from "../../lib/api";

interface Props {
  settings: SiteSettings;
  session: SessionState;
}

function internalClick(event: MouseEvent, href: string): void {
  navigateInApp(event, href);
}

function isConfigured(value: string | undefined, enabled = true): value is string {
  return enabled && Boolean(value?.trim());
}

const atGlance = [
  { label: "Open Source", detail: "Tools that stay forkable", Icon: Code2, tone: "cyan" },
  { label: "Shared Library", detail: "Assets built to travel", Icon: LibraryBig, tone: "violet" },
  { label: "Creator Rewards", detail: "Earn from what you make", Icon: Award, tone: "amber" },
  { label: "Token Utility", detail: "A creative economy in motion", Icon: Coins, tone: "green" },
  { label: "Dance Stage", detail: "Put rhythm in play", Icon: Gamepad2, tone: "pink" },
];

const workflow = [
  { step: "01", title: "Create", detail: "Turn an idea into a track.", Icon: WandSparkles },
  { step: "02", title: "Edit", detail: "Shape the sound for your world.", Icon: Layers3 },
  { step: "03", title: "Store", detail: "Keep every version in Library.", Icon: LibraryBig },
  { step: "04", title: "Publish", detail: "Send it to Dance Stage.", Icon: Gamepad2 },
  { step: "05", title: "Grow", detail: "Share, earn, repeat.", Icon: Trophy },
];

export function HomeDashboard({ settings }: Props): JSX.Element {
  const [copied, setCopied] = useState(false);
  const githubUrl = isConfigured(settings.autotransitionGithubUrl);

  const copyTokenAddress = async () => {
    if (!settings.tokenAddress || !navigator.clipboard) return;
    await navigator.clipboard.writeText(settings.tokenAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const ecosystem = [
    {
      eyebrow: "Workspace",
      title: "Dance Station",
      detail: "Generate, edit, and organize audio in one focused creative surface.",
      href: "/dance-station",
      image: danceStationImage,
      Icon: WandSparkles,
      tone: "cyan",
    },
    {
      eyebrow: "Arcade",
      title: "Dance Stage",
      detail: "Turn rhythm and music into playable experiences.",
      href: "/game",
      image: danceStageImage,
      Icon: Gamepad2,
      tone: "pink",
    },
    {
      eyebrow: "Cloud",
      title: "Shared Library",
      detail: "Keep your generated audio available, reusable, and ready to publish.",
      href: "/library",
      image: sharedLibraryImage,
      Icon: LibraryBig,
      tone: "violet",
    },
    {
      eyebrow: "Open tools",
      title: "Open-Source Tools",
      detail: "Build on transparent audio infrastructure with the community.",
      href: githubUrl ? settings.autotransitionGithubUrl : "",
      image: openToolsImage,
      Icon: GitBranch,
      tone: "green",
      external: true,
    },
  ];

  return (
    <>
      <section className="homepage-hero" aria-labelledby="homepage-title">
        <div className="homepage-hero__copy">
          <p className="homepage-kicker"><span className="homepage-kicker__dot" /> THE FACELESS DANCER / AUDIO INFRASTRUCTURE</p>
          <h1 id="homepage-title">Open-source audio infrastructure for <span>creators of rhythm.</span></h1>
          <p className="homepage-hero__lead">
            Generate, shape, and publish the sound behind the next wave of rhythm-driven experiences.
          </p>
          <div className="homepage-hero__actions">
            <a className="homepage-button homepage-button--primary" href="/dance-station" onClick={(event) => internalClick(event, "/dance-station")}>
              <WandSparkles aria-hidden="true" size={17} />
              <span>Launch Dance Station</span>
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
            <a className="homepage-button homepage-button--secondary" href="/game" onClick={(event) => internalClick(event, "/game")}>
              <Gamepad2 aria-hidden="true" size={17} />
              <span>Explore Dance Stage</span>
            </a>
          </div>
          <div className="homepage-hero__links" aria-label="Project links">
            {githubUrl ? <a href={settings.autotransitionGithubUrl} target="_blank" rel="noreferrer"><GitBranch aria-hidden="true" size={14} /> Open source</a> : <span><Code2 aria-hidden="true" size={14} /> Open source</span>}
            <span className="homepage-hero__separator">/</span>
            {githubUrl ? <a href={settings.autotransitionGithubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink aria-hidden="true" size={12} /></a> : null}
            {isConfigured(settings.telegramUrl, settings.showTelegram) ? <a href={settings.telegramUrl} target="_blank" rel="noreferrer">Community <ExternalLink aria-hidden="true" size={12} /></a> : null}
          </div>
        </div>

        <div className="homepage-platform-overview" aria-label="Platform overview">
          <a className="homepage-platform-feature" href="/dance-station" onClick={(event) => internalClick(event, "/dance-station")}>
            <div className="homepage-platform-feature__copy">
              <div className="homepage-platform-feature__heading"><span>DANCE STATION</span><WandSparkles aria-hidden="true" size={16} /></div>
              <strong>Create. Generate. Refine.</strong>
              <p>Powerful generative tools and editing for rhythm-driven audio.</p>
              <span className="homepage-platform-feature__action">Open Station <ArrowRight aria-hidden="true" size={13} /></span>
            </div>
            <div className="homepage-platform-feature__image"><img src={danceStationImage} alt="Dance Station workspace" /></div>
          </a>
          <div className="homepage-platform-grid">
            {ecosystem.slice(1).map((card) => {
              const Icon = card.Icon;
              const content = (
                <>
                  <div className="homepage-platform-card__image"><img src={card.image} alt="" /><span><Icon aria-hidden="true" size={15} /></span></div>
                  <div className="homepage-platform-card__body"><p>{card.eyebrow}</p><h3>{card.title}</h3><span>{card.detail}</span></div>
                </>
              );
              return card.href ? <a key={card.title} className={`homepage-platform-card homepage-platform-card--${card.tone}`} href={card.href} target={card.external ? "_blank" : undefined} rel={card.external ? "noreferrer" : undefined} onClick={card.external ? undefined : (event) => internalClick(event, card.href)}>{content}</a> : <article key={card.title} className={`homepage-platform-card homepage-platform-card--${card.tone}`}>{content}</article>;
            })}
          </div>
        </div>
      </section>

      <section className="homepage-section homepage-section--glance" id="platform" aria-labelledby="glance-title">
        <div className="homepage-section__intro"><p className="homepage-label">01 / PLATFORM</p><h2 id="glance-title">A connected system for <span>making things move.</span></h2><p>Every part of the stack is built to keep creators close to the sound and the people who use it.</p></div>
        <div className="homepage-glance-grid">{atGlance.map((card) => { const Icon = card.Icon; return <article className={`homepage-glance-card homepage-glance-card--${card.tone}`} key={card.label}><Icon aria-hidden="true" size={19} /><strong>{card.label}</strong><span>{card.detail}</span></article>; })}</div>
      </section>

      <section className="homepage-section homepage-section--ecosystem" id="products" aria-labelledby="ecosystem-title">
        <div className="homepage-section__intro homepage-section__intro--row"><div><p className="homepage-label">02 / ECOSYSTEM</p><h2 id="ecosystem-title">Everything you need to <span>build.</span></h2></div><p>Start where you are. The tools are designed to work together as your project grows.</p></div>
        <div className="homepage-ecosystem-grid">{ecosystem.map((card) => { const Icon = card.Icon; const content = <><div className="homepage-ecosystem-card__image"><img src={card.image} alt="" /><span><Icon aria-hidden="true" size={16} /></span></div><div className="homepage-ecosystem-card__body"><p>{card.eyebrow}</p><h3>{card.title}</h3><span>{card.detail}</span><b>Explore <ArrowRight aria-hidden="true" size={14} /></b></div></>; return card.href ? <a key={card.title} className={`homepage-ecosystem-card homepage-ecosystem-card--${card.tone}`} href={card.href} target={card.external ? "_blank" : undefined} rel={card.external ? "noreferrer" : undefined} onClick={card.external ? undefined : (event) => internalClick(event, card.href)}>{content}</a> : <article key={card.title} className={`homepage-ecosystem-card homepage-ecosystem-card--${card.tone}`}>{content}</article>; })}</div>
      </section>

      <section className="homepage-section homepage-section--workflow" id="workflow" aria-labelledby="workflow-title">
        <div className="homepage-section__intro"><p className="homepage-label">03 / CREATOR WORKFLOW</p><h2 id="workflow-title">From first spark to <span>full expression.</span></h2></div>
        <div className="homepage-workflow">{workflow.map((item, index) => { const Icon = item.Icon; return <div className="homepage-workflow__item" key={item.step}><div className="homepage-workflow__number">{item.step}</div><Icon aria-hidden="true" size={19} /><strong>{item.title}</strong><span>{item.detail}</span>{index < workflow.length - 1 ? <ArrowRight className="homepage-workflow__arrow" aria-hidden="true" size={16} /> : null}</div>; })}</div>
      </section>

      <section className="homepage-section homepage-section--token" id="token" aria-labelledby="token-title">
        <div className="homepage-token__copy"><p className="homepage-label">04 / TOKEN UTILITY</p><h2 id="token-title"><span>$FACELESS</span> drives creation and rewards.</h2><p>One utility layer across generation, ownership, publishing, and the people building the culture around it.</p>{settings.tokenAddress ? <div className="homepage-token-address"><code>{settings.tokenAddress}</code><button type="button" onClick={() => copyTokenAddress()} aria-label="Copy token address" title="Copy token address">{copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}</button></div> : <div className="homepage-token-address homepage-token-address--empty"><span>Token address configured in project settings</span></div>}</div>
        <div className="homepage-token-grid"><article><WandSparkles aria-hidden="true" size={19} /><strong>Create</strong><span>Access the tools that turn prompts into sound.</span></article><article><Award aria-hidden="true" size={19} /><strong>Reward</strong><span>Recognize the creators who make the ecosystem better.</span></article><article><Gamepad2 aria-hidden="true" size={19} /><strong>Publish</strong><span>Put music into experiences people can play.</span></article><article><Coins aria-hidden="true" size={19} /><strong>Participate</strong><span>Keep value circulating between the work and its audience.</span></article></div>
      </section>

      <section className="homepage-section homepage-section--roadmap" id="roadmap" aria-labelledby="roadmap-title">
        <div className="homepage-section__intro homepage-section__intro--row"><div><p className="homepage-label">05 / ROADMAP</p><h2 id="roadmap-title">Built for today. <span>Designed for what’s next.</span></h2></div><p>The foundation is live. The next layer is shaped by the people using it.</p></div>
        <div className="homepage-roadmap"><div className="homepage-roadmap__list"><div><span>01</span><strong>Open tools and creator workspace</strong><b>Live</b></div><div><span>02</span><strong>Shared audio library and publishing</strong><b>Live</b></div><div className="is-active"><span>03</span><strong>More runtimes and richer creator rewards</strong><b>In Progress</b></div><div><span>04</span><strong>In-House Generative Models</strong><b>In Progress</b></div><div><span>05</span><strong>Community-built rhythm experiences</strong><b>Growing</b></div></div><div className="homepage-roadmap__signal"><div className="homepage-roadmap__signal-top"><span>BUILD SIGNAL</span><span>2026 / 03</span></div><div className="homepage-roadmap__bars" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ height: `${20 + ((index * 23) % 65)}%` }} />)}</div><strong>Keep building in public.</strong><p>The most useful infrastructure is the infrastructure creators can understand and extend.</p>{githubUrl ? <a href={settings.autotransitionGithubUrl} target="_blank" rel="noreferrer">View the project on GitHub <ArrowUpRight aria-hidden="true" size={15} /></a> : null}</div></div>
      </section>
    </>
  );
}
