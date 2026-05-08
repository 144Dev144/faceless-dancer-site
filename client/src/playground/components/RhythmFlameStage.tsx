import type { RhythmFlameAudioControl, RhythmFlameAudioFrame, RhythmFlameConfig } from "../types";

interface RhythmFlameStageProps {
  config: RhythmFlameConfig;
  audioControl: RhythmFlameAudioControl;
  audioFrame: RhythmFlameAudioFrame;
  isPlaying: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hexToHueDegrees(color: string): number {
  const normalized = color.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(normalized);
  const full = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  let r = 255;
  let g = 128;
  let b = 64;
  if (short) {
    r = Number.parseInt(short[1][0] + short[1][0], 16);
    g = Number.parseInt(short[1][1] + short[1][1], 16);
    b = Number.parseInt(short[1][2] + short[1][2], 16);
  } else if (full) {
    r = Number.parseInt(full[1].slice(0, 2), 16);
    g = Number.parseInt(full[1].slice(2, 4), 16);
    b = Number.parseInt(full[1].slice(4, 6), 16);
  }

  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta <= 0) return 0;

  let hue = 0;
  if (max === rn) {
    hue = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    hue = (bn - rn) / delta + 2;
  } else {
    hue = (rn - gn) / delta + 4;
  }
  const degrees = hue * 60;
  return degrees < 0 ? degrees + 360 : degrees;
}

export function RhythmFlameStage({
  config,
  audioControl,
  audioFrame,
  isPlaying,
}: RhythmFlameStageProps): JSX.Element {
  const extension = clamp(config.extension, 0, 1);
  const intensity = clamp(config.intensity, 0, 1);
  const chaos = clamp(config.chaos, 0, 1);
  const direction = clamp(config.directionDegrees, -180, 180);
  const audioMaster = clamp(audioControl.audioMaster, 0, 1) * (isPlaying ? 1 : 0);
  const meydaInfluence = clamp(audioControl.meydaInfluence, 0, 1);
  const beatInfluence = clamp(audioControl.beatInfluence, 0, 1);
  const meydaDrive = clamp(
    audioFrame.rms * 0.22 +
      audioFrame.flux * 0.24 +
      audioFrame.bass * 0.2 +
      audioFrame.mid * 0.16 +
      audioFrame.treble * 0.18,
    0,
    1
  );
  const beatDrive = clamp(audioFrame.beatPulse * 0.62 + audioFrame.beatImpulse * 0.92, 0, 1);
  const reactiveMeyda = meydaDrive * meydaInfluence * audioMaster;
  const reactiveBeat = beatDrive * beatInfluence * audioMaster;
  const reactiveDrive = clamp(reactiveMeyda * 0.68 + reactiveBeat * 0.92, 0, 1.45);

  const flameHue = Math.round(hexToHueDegrees(config.midColor) - 46);
  const coreHue = Math.round(hexToHueDegrees(config.coreColor) - 46);
  const burnDuration = clamp(
    6.1 + extension * 5.6 - intensity * 2.3 - chaos * 1.4 - reactiveDrive * 2.7,
    2.2,
    13.5
  );
  const burnTravel = Math.round((3400 + extension * 7400) * (1 + reactiveDrive * 0.92));
  const burnDriftX =
    (direction / 180) * (120 + chaos * 220 + extension * 120) + (reactiveMeyda - 0.2) * 110;
  const flameBgSize = Math.round(126 + chaos * 36 + intensity * 14 + reactiveMeyda * 24);
  const fireWidth = clamp(40 + intensity * 8, 32, 58);
  const fireHeight = 78;
  const directionalSkew = (direction / 180) * 10 + (reactiveMeyda - 0.5) * 5;

  const ringSize = 106;
  const ringInnerPad = clamp(ringSize / 6, 10, 34);
  const ringBorder = clamp(ringSize / 30 + intensity * 2.2, 2.4, 9);
  const ringGlow = clamp(
    ringSize / 12 + intensity * 30 + extension * 18 + reactiveDrive * 32,
    10,
    150
  );
  const ringBlur = clamp(1 + chaos * 2 + reactiveMeyda * 0.9, 0.8, 5);
  const ringDisplacement = clamp(
    22 + chaos * 48 + intensity * 12 + extension * 44 + reactiveDrive * 56,
    20,
    170
  );
  const ringBaseLow = clamp(0.004 + chaos * 0.006 + reactiveMeyda * 0.0024, 0.003, 0.02);
  const ringBaseHigh = clamp(0.014 + chaos * 0.022 + reactiveDrive * 0.013, 0.01, 0.08);
  const ringAnimDuration = clamp(65 - chaos * 42 - intensity * 10 - reactiveDrive * 15, 8, 70);
  const ringRotate = (direction / 180) * 22;
  const ringPlumeAmount = (1 + extension * 1.35 + reactiveDrive * 1.15).toFixed(3);
  const ringFlickerAmount = (1 + reactiveBeat * 1.2 + reactiveMeyda * 0.45).toFixed(3);

  const styleVars = {
    "--rf-core-color": config.coreColor,
    "--rf-mid-color": config.midColor,
    "--rf-edge-color": config.edgeColor,
    "--rf-flame-hue": `${flameHue}deg`,
    "--rf-core-hue": `${coreHue}deg`,
    "--rf-burn-duration": `${burnDuration.toFixed(2)}s`,
    "--rf-burn-travel": `${burnTravel}px`,
    "--rf-burn-drift-x": `${burnDriftX.toFixed(1)}px`,
    "--rf-flame-bg-size": `${flameBgSize}% auto`,
    "--rf-fire-width": `${fireWidth}vw`,
    "--rf-fire-height": `${fireHeight}vh`,
    "--rf-direction-skew": `${directionalSkew.toFixed(2)}deg`,
    "--rf-ring-size": `${ringSize}vh`,
    "--rf-ring-pad": `${ringInnerPad}px`,
    "--rf-ring-border": `${ringBorder}px`,
    "--rf-ring-glow": `${ringGlow}px`,
    "--rf-ring-blur": `${ringBlur}px`,
    "--rf-ring-displace": ringDisplacement.toFixed(2),
    "--rf-ring-base-low": ringBaseLow.toFixed(4),
    "--rf-ring-base-high": ringBaseHigh.toFixed(4),
    "--rf-ring-anim-duration": `${ringAnimDuration.toFixed(2)}s`,
    "--rf-ring-rotate": `${ringRotate.toFixed(2)}deg`,
    "--rf-ring-plume-amount": ringPlumeAmount,
    "--rf-ring-flicker-amount": ringFlickerAmount,
  } as Record<string, string>;

  return (
    <div className="rhythm-flame-stage" style={styleVars}>
      {config.mode === "flame" ? (
        <div className="rhythm-flame-fire">
          <div className="rhythm-flame-layer rhythm-flame-layer--flames" />
          <div className="rhythm-flame-layer rhythm-flame-layer--core" />
        </div>
      ) : (
        <div className="rhythm-flame-ring-wrap">
          <div className="rhythm-flame-ring" />
          <svg className="rhythm-flame-svg" aria-hidden="true" focusable="false">
            <filter id="rhythm-flame-wavy">
              <feTurbulence
                x="0"
                y="0"
                baseFrequency={ringBaseLow.toFixed(4)}
                numOctaves="5"
                seed="2"
              >
                <animate
                  attributeName="baseFrequency"
                  dur={`${ringAnimDuration.toFixed(2)}s`}
                  values={`${ringBaseHigh.toFixed(4)}; ${ringBaseLow.toFixed(4)}; ${ringBaseHigh.toFixed(4)}`}
                  repeatCount="indefinite"
                />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" scale={ringDisplacement.toFixed(2)} />
            </filter>
          </svg>
        </div>
      )}
    </div>
  );
}
