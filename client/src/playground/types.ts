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
