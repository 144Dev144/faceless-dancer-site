import type { Request } from "express";
import { listAllSongs } from "../game/service.js";
import { listSavedBeatEntries, readSavedBeatEntry } from "../game/storage.js";

const OFFICIAL_VOLUME_ID = "faceless-volume-1";
const OFFICIAL_VOLUME_LABEL = "Faceless Volume 1";
const OFFICIAL_CREATOR = {
  displayName: "The Faceless Dancer",
  creatorSlug: "the-faceless-dancer",
  avatarUrl: null,
  bannerUrl: null,
};

function audioMimeTypeFromFileName(fileName: string): string {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

function buildBaseUrl(req: Request): string {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim() || "https";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return `${proto}://${host}`;
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

export async function listOfficialRhythmGameLibraryItems(req: Request): Promise<SyntheticLibraryItem[]> {
  const baseUrl = buildBaseUrl(req);
  const [songs, entries] = await Promise.all([listAllSongs(), listSavedBeatEntries()]);
  const entryMap = new Map(entries.map((entry) => [String(entry.id || ""), entry]));
  const items: Array<SyntheticLibraryItem | null> = songs.map((song) => {
      const entry = entryMap.get(String(song.beat_entry_id || ""));
      if (!entry) return null;
      const entryId = String(entry.id || "");
      const songTitle = String(song.title || entry.entryName || entryId);
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
            path: `/api/public/beats/${encodeURIComponent(entryId)}`,
            publicUrl: `${baseUrl}/api/public/beats/${encodeURIComponent(entryId)}`,
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
            mimeType: audioMimeTypeFromFileName(String((entry as any).fileName || `${entryId}.mp3`)),
            sizeBytes: 0,
            storageProvider: "bunny",
            path: `/api/public/beats/${encodeURIComponent(entryId)}/audio`,
            publicUrl: `${baseUrl}/api/public/beats/${encodeURIComponent(entryId)}/audio`,
            sha256: null,
            metadata: {
              originalName: String((entry as any).fileName || `${entryId}.mp3`),
              durationSeconds: Number((entry as any).durationSeconds || 0),
              legacyBeatEntryId: entryId,
            },
            createdAt: song.created_at,
          },
        ],
        creator: OFFICIAL_CREATOR,
      };
      return item;
    });
  return items.filter((item): item is SyntheticLibraryItem => item !== null);
}

export async function readOfficialRhythmGameLibraryItem(req: Request, itemId: string) {
  const entryId = parseSyntheticItemId(itemId);
  if (!entryId) return null;
  const [entry, songs] = await Promise.all([readSavedBeatEntry(entryId), listAllSongs()]);
  if (!entry) return null;
  const song = songs.find((row) => String(row.beat_entry_id || "") === entryId);
  if (!song) return null;
  const items = await listOfficialRhythmGameLibraryItems(req);
  return items.find((item) => item.id === itemId) || null;
}
