export interface RhythmGameSupportedModes {
  stepArrows: boolean;
  orbBeat: boolean;
  laserShoot: boolean;
}

export interface RhythmGameVolumeRecord {
  volumeId: string;
  volumeLabel: string;
  volumeSlug: string;
  officialVolume: boolean;
  sortOrder: number;
}

export interface RhythmGameLibraryMetadata extends RhythmGameVolumeRecord {
  gameEnabled: boolean;
  supportedGameModes: RhythmGameSupportedModes;
  legacyCatalogSource?: string;
}
