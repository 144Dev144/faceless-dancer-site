import logoImage from "../../assets/hero/logo.png";

export function HomeTopNav(): JSX.Element {
  return (
    <header className="home-v2-nav">
      <a className="home-v2-nav__brand" href="/">
        <img src={logoImage} alt="The Faceless Dancer logo" />
        <span>The Faceless Dancer</span>
      </a>

      <nav className="home-v2-nav__links" aria-label="Primary">
        <a href="/">Home</a>
        <a href="/game">Dance Stage</a>
        <a href="/library">Library</a>
        <a href="/dance-station">Dance Station</a>
      </nav>

      <a className="home-v2-nav__cta" href="/game">Enter Stage</a>
    </header>
  );
}
