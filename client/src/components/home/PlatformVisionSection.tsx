import rawTrackWaveImage from "../../assets/home/flow/raw-track-wave.png";
import extractBeatsIcon from "../../assets/home/flow/extract-beats.png";
import extractStemsIcon from "../../assets/home/flow/extract-stems.png";
import extractRhythmPatternsIcon from "../../assets/home/flow/extract-rhythm-patterns.png";
import extractTimingStructureIcon from "../../assets/home/flow/extract-timing-structure.png";
import extractBpmKeyMetadataIcon from "../../assets/home/flow/extract-bpm-key-metadata.png";
import appGenresIcon from "../../assets/home/flow/app-genres.png";
import appVisualizersIcon from "../../assets/home/flow/app-visualizers.png";
import appAiToolsIcon from "../../assets/home/flow/app-ai-tools.png";
import appMoreAppsIcon from "../../assets/home/flow/app-more-apps.png";

const extractionSteps = [
  { label: "Beats", icon: extractBeatsIcon },
  { label: "Stems", icon: extractStemsIcon },
  { label: "Rhythm Patterns", icon: extractRhythmPatternsIcon },
  { label: "Timing & Structure", icon: extractTimingStructureIcon },
  { label: "BPM & Key Metadata", icon: extractBpmKeyMetadataIcon },
];

const applicationSteps = [
  { label: "Games", icon: appGenresIcon },
  { label: "Visualizers", icon: appVisualizersIcon },
  { label: "AI Tools", icon: appAiToolsIcon },
  { label: "More Apps", icon: appMoreAppsIcon },
];

export function PlatformVisionSection(): JSX.Element {
  return (
    <section id="how-it-works" className="home-v2-section home-v2-vision">
      <div className="home-v2-heading">
        <p className="home-v2-kicker">Our Platform Vision</p>
        <h2>Music data becomes creative infrastructure</h2>
        <p>
          We extract structure from music: beats, stems, rhythm patterns, timing,
          and more, and apply it across multiple apps today, with powerful AI tools tomorrow.
        </p>
      </div>

      <div className="home-v2-flow" aria-label="Music data pipeline">
        <div className="home-v2-flow__block">
          <p className="home-v2-flow__label">Raw Track</p>
          <div className="home-v2-flow__item home-v2-flow__item--wide">
            <img src={rawTrackWaveImage} alt="Audio waveform input" />
            <span>Audio In</span>
          </div>
        </div>

        <div className="home-v2-flow__arrow" aria-hidden="true">&gt;</div>

        <div className="home-v2-flow__block">
          <p className="home-v2-flow__label">We Extract</p>
          <div className="home-v2-flow__grid">
            {extractionSteps.map((step) => (
              <div key={step.label} className="home-v2-flow__item">
                <img src={step.icon} alt="" aria-hidden="true" />
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="home-v2-flow__arrow" aria-hidden="true">&gt;</div>

        <div className="home-v2-flow__block">
          <p className="home-v2-flow__label">We Apply</p>
          <div className="home-v2-flow__grid home-v2-flow__grid--apps">
            {applicationSteps.map((step) => (
              <div key={step.label} className="home-v2-flow__item">
                <img src={step.icon} alt="" aria-hidden="true" />
                <span>{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="home-v2-footnote">
        From audio to rhythm intelligence, fueling every application we build.
      </p>
    </section>
  );
}
