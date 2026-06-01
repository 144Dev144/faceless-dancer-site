import logoImage from "../../assets/hero/logo.png";

export function HomeTopNav(): JSX.Element {
  return (
    <header className="home-v2-nav">
      <a className="home-v2-nav__brand" href="/">
        <img src={logoImage} alt="The Faceless Dancer logo" />
        <span>The Faceless Dancer</span>
      </a>

      <nav className="home-v2-nav__links" aria-label="Primary">
        <a href="#about">About</a>
        <a href="#how-it-works">How It Works</a>
        <a href="#apps">Apps</a>
        <a href="#roadmap">Roadmap</a>
        <a href="#docs">Docs</a>
        <a href="#community">Community</a>
      </nav>

      <a className="home-v2-nav__cta" href="/game">Launch App</a>
    </header>
  );
}
