import { Gamepad2, Share2, WandSparkles } from "lucide-preact";
import logoImage from "../../assets/hero/logo.png";

const navLinks = [
  { href: "/game", label: "Dance Stage", Icon: Gamepad2 },
  { href: "/library", label: "Library", Icon: Share2 },
  { href: "/dance-station", label: "Dance Station", Icon: WandSparkles },
];

export function HomeTopNav(): JSX.Element {
  return (
    <header className="home-v2-nav">
      <a className="home-v2-nav__brand" href="/">
        <img src={logoImage} alt="The Faceless Dancer logo" />
        <span>The Faceless Dancer</span>
      </a>

      <nav className="home-v2-nav__links" aria-label="Primary">
        {navLinks.map(({ href, label, Icon }) => (
          <a key={href} href={href} aria-label={label} title={label}>
            <Icon aria-hidden="true" size={17} strokeWidth={2.1} />
            <span>{label}</span>
          </a>
        ))}
      </nav>

      <a className="home-v2-nav__cta" href="/game">Enter Stage</a>
    </header>
  );
}
