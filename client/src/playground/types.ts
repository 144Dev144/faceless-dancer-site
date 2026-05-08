import type { SavedBeatEntry } from "../../game/types/beat";

export type VisualizerMode =
  | "prism_bloom"
  | "nebula_ribbons"
  | "pulse_tunnel"
  | "lattice_dream"
  | "fractal_atlas"
  | "celestial_gyroscope"
  | "chaos_bloom"
  | "quantum_veil"
  | "spectral_superformula"
  | "harmonic_lissajous_manifold"
  | "attractor_phase_weave"
  | "spectral_implicit_isolines";

export type PlaygroundTab = "visualizer" | "rhythm_flame";

export type RhythmFlameMode = "flame" | "flame_ring";

export interface RhythmFlameConfig {
  mode: RhythmFlameMode;
  extension: number;
  intensity: number;
  chaos: number;
  directionDegrees: number;
  coreColor: string;
  midColor: string;
  edgeColor: string;
}

export interface RhythmFlameAudioControl {
  audioMaster: number;
  meydaInfluence: number;
  beatInfluence: number;
}

export interface RhythmFlameAudioFrame {
  rms: number;
  flux: number;
  bass: number;
  mid: number;
  treble: number;
  beatPulse: number;
  beatImpulse: number;
}

export interface PlaygroundSongSummary {
  beatEntryId: string;
  title: string;
  majorBeatCount: number;
  gameBeatCount: number;
  coverImageUrl: string | null;
}

export interface MeydaFrame {
  rms: number;
  zcr: number;
  spectralCentroid: number;
  spectralFlatness: number;
  spectralRolloff: number;
  spectralFlux: number;
  perceptualSpread: number;
  perceptualSharpness: number;
  loudnessTotal: number;
  loudnessSpecific: number[];
  energyBass: number;
  energyMid: number;
  energyTreble: number;
  chroma: number[];
  amplitudeSpectrum: number[];
}

export interface PlaygroundTrackData {
  song: PlaygroundSongSummary;
  entry: SavedBeatEntry;
  accentBeats: Array<{ timeSeconds: number; strength: number }>;
}
