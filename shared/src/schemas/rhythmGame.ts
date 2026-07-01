import { z } from "zod";

export const rhythmGameSupportedModesSchema = z.object({
  stepArrows: z.boolean().default(true),
  orbBeat: z.boolean().default(false),
  laserShoot: z.boolean().default(true),
});

export const rhythmGameVolumeSchema = z.object({
  volumeId: z.string().trim().min(1).max(80),
  volumeLabel: z.string().trim().min(1).max(160),
  volumeSlug: z.string().trim().min(1).max(120),
  officialVolume: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const rhythmGameLibraryMetadataSchema = z.object({
  gameEnabled: z.boolean().default(false),
  volumeId: z.string().trim().max(80).default(""),
  volumeLabel: z.string().trim().max(160).default(""),
  volumeSlug: z.string().trim().max(120).default(""),
  officialVolume: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  supportedGameModes: rhythmGameSupportedModesSchema.default({
    stepArrows: true,
    orbBeat: false,
    laserShoot: true,
  }),
  legacyCatalogSource: z.string().trim().max(160).optional(),
});
