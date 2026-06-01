import roadmapAiCubeImage from "../../assets/home/roadmap/train-open-source-ai-models.png";
import roadmapUserAccessImage from "../../assets/home/roadmap/user-access-rhythm-generations.png";

export function RoadmapSection(): JSX.Element {
  return (
    <section id="roadmap" className="home-v2-section home-v2-roadmap">
      <div className="home-v2-heading">
        <p className="home-v2-kicker">Future Roadmap</p>
        <h2>Future rhythm-powered generation</h2>
        <p>
          Our long-term vision is to unlock a new era of rhythm-native AI tools and models.
        </p>
      </div>

      <div className="home-v2-roadmap-grid">
        <article className="home-v2-card home-v2-card--roadmap-split">
          <div className="home-v2-card__body">
            <h3>4. Train Open-Source AI Models & LoRAs</h3>
            <p>
              After the project succeeds, we will train open-source models and LoRAs that generate
              visuals, animations, and other outputs based on rhythm and music structure.
            </p>
            <ul>
              <li>Rhythm-conditioned</li>
              <li>Open-source</li>
              <li>For creators, by the community</li>
            </ul>
          </div>
          <div className="home-v2-card__media home-v2-card__media--roadmap-left">
            <img src={roadmapAiCubeImage} alt="AI model generation core visual" loading="lazy" />
          </div>
        </article>

        <article className="home-v2-card home-v2-card--with-image">
          <div className="home-v2-card__media">
            <img src={roadmapUserAccessImage} alt="Creator workstation with multiple generated outputs" loading="lazy" />
          </div>
          <h3>5. User Access to Rhythm Generations</h3>
          <p>
            Users will be able to generate and access rhythm-based outputs privately or on
            our own hardware and system.
          </p>
          <ul>
            <li>Private generations</li>
            <li>High performance hardware</li>
            <li>Built for creators</li>
          </ul>
        </article>
      </div>
    </section>
  );
}
