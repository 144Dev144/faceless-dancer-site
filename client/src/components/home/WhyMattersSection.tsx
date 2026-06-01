import unlockValueIcon from "../../assets/home/icons/unlock-value.png";
import empowerCreatorsIcon from "../../assets/home/icons/empower-creators.png";
import openToolsIcon from "../../assets/home/icons/open-tools.png";
import aiMusicFrontierIcon from "../../assets/home/icons/ai-music-frontier.png";
import futureRhythmIcon from "../../assets/home/icons/future-rhythm.png";

const items = [
  {
    label: "Unlock deeper value from music",
    icon: unlockValueIcon,
  },
  {
    label: "Empower creators with rhythm intelligence",
    icon: empowerCreatorsIcon,
  },
  {
    label: "Build open tools for the community",
    icon: openToolsIcon,
  },
  {
    label: "Push the frontier of AI + music",
    icon: aiMusicFrontierIcon,
  },
  {
    label: "Create the future of interactive rhythm",
    icon: futureRhythmIcon,
  },
];

export function WhyMattersSection(): JSX.Element {
  return (
    <section id="about" className="home-v2-section home-v2-why">
      <h2>Why this matters</h2>
      <div className="home-v2-why-grid">
        {items.map((item) => (
          <article key={item.label} className="home-v2-why-item">
            <div className="home-v2-why-icon" aria-hidden="true">
              <img src={item.icon} alt="" loading="lazy" />
            </div>
            <p>{item.label}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
