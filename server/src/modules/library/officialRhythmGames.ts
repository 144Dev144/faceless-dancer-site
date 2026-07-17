import type { Request } from "express";
import { listAllSongs } from "../game/service.js";
import { readSavedBeatEntry } from "../game/storage.js";
import { getMaterializedLegacyRhythmIds } from "./legacyRhythmLibraryMigration.js";

const OFFICIAL_VOLUME_ID = "faceless-volume-1";
const OFFICIAL_VOLUME_LABEL = "Faceless Volume 1";
const OFFICIAL_CREATOR = {
  displayName: "The Faceless Dancer",
  creatorSlug: "the-faceless-dancer",
  avatarUrl: null,
  bannerUrl: null,
  publicKey: null,
};

function audioMimeTypeFromFileName(fileName: string): string {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

function syntheticItemId(entryId: string): string {
  return `official-rhythm-${entryId}`;
}

function parseSyntheticItemId(itemId: string): string | null {
  const prefix = "official-rhythm-";
  return itemId.startsWith(prefix) ? itemId.slice(prefix.length) : null;
}

function normalizeMetadata(songTitle: string, enabled: boolean) {
  return {
    category: "rhythm_game",
    gameEnabled: enabled,
    volumeId: OFFICIAL_VOLUME_ID,
    volumeLabel: OFFICIAL_VOLUME_LABEL,
    volumeSlug: OFFICIAL_VOLUME_ID,
    officialVolume: true,
    sortOrder: 0,
    supportedGameModes: {
      stepArrows: true,
      orbBeat: false,
      laserShoot: true,
    },
    legacyCatalogSource: "game_songs",
    songTitle,
  };
}

type SyntheticLibraryItem = {
  id: string;
  ownerId: null;
  visibility: "public";
  status: "published";
  kind: "rhythm_game";
  title: string;
  description: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceLineage: Record<string, unknown>;
  license: null;
  attribution: null;
  createdAt: string;
  updatedAt: string;
  files: Array<Record<string, unknown>>;
  creator: typeof OFFICIAL_CREATOR;
};

type OfficialSong = Awaited<ReturnType<typeof listAllSongs>>[number];
type OfficialEntry = Record<string, unknown>;
type OfficialCatalogRecord = { song: OfficialSong; entry: OfficialEntry };

const OFFICIAL_CATALOG_CACHE_MS = 30_000;
let officialCatalogCache: { expiresAt: number; records: OfficialCatalogRecord[] } | null = null;

async function loadOfficialCatalog(): Promise<OfficialCatalogRecord[]> {
  const now = Date.now();
  if (officialCatalogCache && officialCatalogCache.expiresAt > now) {
    return officialCatalogCache.records;
  }

  const songs = await listAllSongs();
  const records = new Array<OfficialCatalogRecord | null>(songs.length);
  let nextIndex = 0;
  const concurrency = Math.min(8, songs.length);

  const readBatch = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= songs.length) return;
      const song = songs[index];
      const entry = await readSavedBeatEntry(String(song.beat_entry_id || ""));
      records[index] = entry ? { song, entry } : null;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => readBatch()));
  const loadedRecords = records.filter((record): record is OfficialCatalogRecord => record !== null);
  officialCatalogCache = {
    expiresAt: now + OFFICIAL_CATALOG_CACHE_MS,
    records: loadedRecords,
  };
  return loadedRecords;
}

export async function listOfficialRhythmGameLibraryItems(req: Request): Promise<SyntheticLibraryItem[]> {
  const records = await loadOfficialCatalog();
  const items: Array<SyntheticLibraryItem | null> = records.map(({ song, entry }) => {
      if (!entry) return null;
      const entryId = String(entry.id || "");
      const entryData = entry.entry as { name?: string; fileName?: string; durationSeconds?: number } | undefined;
      const fileName = String(entryData?.fileName || `${entryId}.mp3`);
      const songTitle = String(song.title || entryData?.name || entryId);
      const item: SyntheticLibraryItem = {
        id: syntheticItemId(entryId),
        ownerId: null,
        visibility: "public" as const,
        status: "published" as const,
        kind: "rhythm_game" as const,
        title: songTitle,
        description: "Official Faceless rhythm-game level.",
        tags: ["official", "faceless-volume-1", "rhythm-game"],
        metadata: normalizeMetadata(songTitle, song.is_enabled === 1),
        sourceLineage: {
          legacyBeatEntryId: entryId,
          source: "legacy_game_catalog",
        },
        license: null,
        attribution: null,
        createdAt: song.created_at,
        updatedAt: song.updated_at,
        files: [
          {
            id: `${syntheticItemId(entryId)}-chart`,
            itemId: syntheticItemId(entryId),
            role: "chart",
            mimeType: "application/json",
            sizeBytes: 0,
            storageProvider: "bunny",
            path: `/api/game/api/public/beats/${encodeURIComponent(entryId)}`,
            publicUrl: `/api/game/api/public/beats/${encodeURIComponent(entryId)}`,
            sha256: null,
            metadata: {
              originalName: `${entryId}.json`,
              legacyBeatEntryId: entryId,
            },
            createdAt: song.created_at,
          },
          {
            id: `${syntheticItemId(entryId)}-audio`,
            itemId: syntheticItemId(entryId),
            role: "audio",
            mimeType: audioMimeTypeFromFileName(fileName),
            sizeBytes: 0,
            storageProvider: "bunny",
            path: `/api/game/api/public/beats/${encodeURIComponent(entryId)}/audio`,
            publicUrl: `/api/game/api/public/beats/${encodeURIComponent(entryId)}/audio`,
            sha256: null,
            metadata: {
              originalName: fileName,
              durationSeconds: Number(entryData?.durationSeconds || 0),
              legacyBeatEntryId: entryId,
            },
            createdAt: song.created_at,
          },
          ...(song.cover_image_file_name
            ? [{
                id: `${syntheticItemId(entryId)}-cover`,
                itemId: syntheticItemId(entryId),
                role: "cover",
                mimeType: String(song.cover_image_file_name).toLowerCase().endsWith(".png")
                  ? "image/png"
                  : String(song.cover_image_file_name).toLowerCase().endsWith(".webp")
                    ? "image/webp"
                    : "image/jpeg",
                sizeBytes: 0,
                storageProvider: "bunny",
                path: `/api/game/api/public/songs/${encodeURIComponent(entryId)}/cover`,
                publicUrl: `/api/game/api/public/songs/${encodeURIComponent(entryId)}/cover`,
                sha256: null,
                metadata: {
                  originalName: String(song.cover_image_file_name),
                  legacyBeatEntryId: entryId,
                },
                createdAt: song.created_at,
              }] : []),
        ],
        creator: OFFICIAL_CREATOR,
      };
      return item;
    });
  const materializedIds = await getMaterializedLegacyRhythmIds();
  return items.filter((item): item is SyntheticLibraryItem => item !== null && !materializedIds.has(item.id));
}

export async function readOfficialRhythmGameLibraryItem(req: Request, itemId: string) {
  const entryId = parseSyntheticItemId(itemId);
  if (!entryId) return null;
  const materializedIds = await getMaterializedLegacyRhythmIds();
  if (materializedIds.has(itemId)) return null;
  const [entry, songs] = await Promise.all([readSavedBeatEntry(entryId), listAllSongs()]);
  if (!entry) return null;
  const song = songs.find((row) => String(row.beat_entry_id || "") === entryId);
  if (!song) return null;
  const items = await listOfficialRhythmGameLibraryItems(req);
  return items.find((item) => item.id === itemId) || null;
}
