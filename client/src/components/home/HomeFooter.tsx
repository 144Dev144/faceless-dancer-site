export function HomeFooter(): JSX.Element {
  return (
    <footer id="docs" className="home-v2-footer">
      <div className="home-v2-footer__brand">
        <strong>The Faceless Dancer</strong>
        <p>Building the future of rhythm-powered creativity.</p>
        <p>(c) 2026 The Faceless Dancer. All rights reserved.</p>
      </div>

      <div className="home-v2-footer__links">
        <div>
          <h3>Platform</h3>
          <a href="#how-it-works">How It Works</a>
          <a href="#apps">Apps</a>
          <a href="#roadmap">Roadmap</a>
        </div>
        <div>
          <h3>Resources</h3>
          <a href="#docs">Docs</a>
          <a href="#docs">API</a>
          <a href="#docs">Whitepaper</a>
        </div>
        <div id="community">
          <h3>Community</h3>
          <a href="#community">X / Twitter</a>
          <a href="#community">YouTube</a>
          <a href="#community">Telegram</a>
        </div>
      </div>

    </footer>
  );
}
