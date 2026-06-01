import appGamesWithRhythmImage from "../../assets/home/apps/games-with-rhythm.png";
import appVisualizersExperiencesImage from "../../assets/home/apps/visualizers-experiences.png";
import appMoreApplicationsImage from "../../assets/home/apps/more-applications-ahead.png";

const appCards = [
  {
    title: "1. Games with Rhythm",
    copy: "Extracted beats and stem drive timing, animations, mechanics, and scoring inside The Faceless Dancer Stage. Every note counts.",
    tag: "Live Today",
    image: appGamesWithRhythmImage,
    alt: "Neon dance stage environment with rhythm data visuals",
  },
  {
    title: "2. Visualizers & Experiences",
    copy: "Use stems and rhythm data to build reactive visualizers and immersive experiences in The Faceless Playground.",
    tag: "Live Today",
    image: appVisualizersExperiencesImage,
    alt: "Colorful waveform visualizer over reflective dark surface",
  },
  {
    title: "3. More Applications Ahead",
    copy: "We are building a platform, not just one app. More tools and creative uses for rhythm data are on the way.",
    tag: "In Development",
    image: appMoreApplicationsImage,
    alt: "Futuristic application dashboard with audio modules",
  },
];

export function ApplicationsSection(): JSX.Element {
  return (
    <section id="apps" className="home-v2-section home-v2-apps">
      <div className="home-v2-heading">
        <p className="home-v2-kicker">Current Applications</p>
        <h2>From beats and stems to games, visualizers, and more</h2>
        <p>Our platform is already powering creative experiences with real, extracted music data.</p>
      </div>

      <div className="home-v2-cards home-v2-cards--three">
        {appCards.map((card) => (
          <article key={card.title} className="home-v2-card">
            <div className="home-v2-card__media">
              <img src={card.image} alt={card.alt} loading="lazy" />
            </div>
            <h3>{card.title}</h3>
            <p>{card.copy}</p>
            <span className="home-v2-tag">{card.tag}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
