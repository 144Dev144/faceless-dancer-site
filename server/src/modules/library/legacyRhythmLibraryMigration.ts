import { buildObjectPath, buildBunnyPublicUrl } from "../storage/bunnyStorage.js";
import { env } from "../../config/env.js";
import { pool } from "../../db/postgres.js";
import {
  getAvailableDifficulties,
  getAvailableGameModes,
  getDifficultyBeatCounts,
  getModeDifficultyBeatCounts,
} from "../game/difficultyCharts.js";
import { listAllSongs } from "../game/service.js";
import { readSavedBeatEntry } from "../game/storage.js";

const LEGACY_SOURCE = "legacy_game_catalog";
const MATERIALIZED_CACHE_MS = 30_000;

type LegacySong = Awaited<ReturnType<typeof listAllSongs>>[number];

type MigrationFile = {
  id: string;
  role: "chart" | "audio" | "cover";
  mimeType: string;
  path: string;
  publicUrl: string;
  metadata: Record<string, unknown>;
};

let materializedCache: { expiresAt: number; ids: Set<string> } | null = null;

function itemIdForEntry(entryId: string): string {
  return `official-rhythm-${entryId}`;
}

function beatObjectPath(relativePath: string): string {
  return buildObjectPath([env.BEAT_BUNNY_PREFIX, relativePath]);
}

function audioMimeTypeFromFileName(fileName: string): string {
  const lower = String(fileName || "").toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "audio/mpeg";
}

function isLegacySource(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>).source === LEGACY_SOURCE);
}

export function clearMaterializedLegacyRhythmCache(): void {
  materializedCache = null;
}

export async function getMaterializedLegacyRhythmIds(): Promise<Set<string>> {
  const now = Date.now();
  if (materializedCache && materializedCache.expiresAt > now) {
    return materializedCache.ids;
  }

  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM library_items
     WHERE source_lineage_json ->> 'source' = $1`,
    [LEGACY_SOURCE],
  );
  const ids = new Set(result.rows.map((row) => row.id));
  materializedCache = { expiresAt: now + MATERIALIZED_CACHE_MS, ids };
  return ids;
}

function buildMetadata(song: LegacySong, title: string, entry: Record<string, unknown>): Record<string, unknown> {
  const entryData = (entry.entry as { durationSeconds?: unknown } | undefined) ?? {};
  return {
    category: "rhythm_game",
    gameEnabled: song.is_enabled === 1,
    volumeId: "faceless-volume-1",
    volumeLabel: "Faceless Volume 1",
    volumeSlug: "faceless-volume-1",
    officialVolume: true,
    sortOrder: 0,
    supportedGameModes: {
      stepArrows: true,
      orbBeat: false,
      laserShoot: true,
    },
    legacyCatalogSource: LEGACY_SOURCE,
    songTitle: title,
    durationSeconds: Number(entryData.durationSeconds ?? 0),
    majorBeatCount: Array.isArray(entry.majorBeats) ? entry.majorBeats.length : 0,
    availableGameModes: getAvailableGameModes(entry),
    availableDifficulties: getAvailableDifficulties(entry),
    difficultyBeatCounts: getDifficultyBeatCounts(entry),
    modeDifficultyBeatCounts: getModeDifficultyBeatCounts(entry),
  };
}

function buildFiles(song: LegacySong, entryId: string, entry: Record<string, unknown>): MigrationFile[] {
  const itemId = itemIdForEntry(entryId);
  const files: MigrationFile[] = [];
  const entryData = (entry.entry as { name?: string; fileName?: string; durationSeconds?: number } | undefined) ?? {};
  const audio = (entry.audio as { storedFileName?: string; fileName?: string; mimeType?: string } | undefined) ?? {};

  const chartPath = beatObjectPath(`json/${entryId}.json`);
  files.push({
    id: `${itemId}-chart`,
    role: "chart",
    mimeType: "application/json",
    path: chartPath,
    publicUrl: buildBunnyPublicUrl(chartPath),
    metadata: {
      originalName: `${entryId}.json`,
      legacyBeatEntryId: entryId,
    },
  });

  const storedAudioName = String(audio.storedFileName || "").trim();
  if (storedAudioName) {
    const audioPath = beatObjectPath(`audio/${storedAudioName}`);
    const originalName = String(audio.fileName || entryData.fileName || storedAudioName);
    files.push({
      id: `${itemId}-audio`,
      role: "audio",
      mimeType: String(audio.mimeType || audioMimeTypeFromFileName(originalName)),
      path: audioPath,
      publicUrl: buildBunnyPublicUrl(audioPath),
      metadata: {
        originalName,
        durationSeconds: Number(entryData.durationSeconds || 0),
        legacyBeatEntryId: entryId,
      },
    });
  }

  const coverName = String(song.cover_image_file_name || "").trim();
  if (coverName) {
    const coverPath = beatObjectPath(`covers/${coverName}`);
    files.push({
      id: `${itemId}-cover`,
      role: "cover",
      mimeType: coverName.toLowerCase().endsWith(".png") ? "image/png" : coverName.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg",
      path: coverPath,
      publicUrl: buildBunnyPublicUrl(coverPath),
      metadata: {
        originalName: coverName,
        legacyBeatEntryId: entryId,
      },
    });
  }

  return files;
}

export interface LegacyRhythmMigrationResult {
  scanned: number;
  migrated: number;
  updated: number;
  skipped: number;
  missingEntries: number;
  missingCharts: number;
  collisions: number;
}

export async function migrateLegacyRhythmLibrary(): Promise<LegacyRhythmMigrationResult> {
  const songs = await listAllSongs();
  const result: LegacyRhythmMigrationResult = {
    scanned: songs.length,
    migrated: 0,
    updated: 0,
    skipped: 0,
    missingEntries: 0,
    missingCharts: 0,
    collisions: 0,
  };

  const records = new Array<{ song: LegacySong; entry: Record<string, unknown> | null }>(songs.length);
  let nextIndex = 0;
  const readConcurrency = Math.min(8, songs.length);
  await Promise.all(Array.from({ length: readConcurrency }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= songs.length) return;
      const song = songs[index];
      records[index] = { song, entry: await readSavedBeatEntry(String(song.beat_entry_id || "")) };
    }
  }));

  for (const record of records) {
    const song = record.song;
    const entryId = String(song.beat_entry_id || "").trim();
    if (!entryId) {
      result.skipped += 1;
      continue;
    }

    const entry = record.entry;
    if (!entry) {
      result.missingEntries += 1;
      continue;
    }

    const itemId = itemIdForEntry(entryId);
    const existing = await pool.query<{ source_lineage_json: Record<string, unknown> | null }>(
      `SELECT source_lineage_json FROM library_items WHERE id = $1 LIMIT 1`,
      [itemId],
    );
    if (existing.rows[0] && !isLegacySource(existing.rows[0].source_lineage_json)) {
      result.collisions += 1;
      continue;
    }

    const title = String(song.title || (entry.entry as { name?: string } | undefined)?.name || entryId);
    const files = buildFiles(song, entryId, entry);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const itemInsert = await client.query(
        `INSERT INTO library_items (
          id, owner_user_id, visibility, status, kind, title, description, tags_json,
          metadata_json, source_lineage_json, license, attribution, created_at, updated_at
        )
        VALUES ($1, NULL, 'public', 'published', 'rhythm_game', $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NULL, NULL, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          visibility = EXCLUDED.visibility,
          status = EXCLUDED.status,
          kind = EXCLUDED.kind,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          tags_json = EXCLUDED.tags_json,
          metadata_json = EXCLUDED.metadata_json,
          source_lineage_json = EXCLUDED.source_lineage_json,
          updated_at = EXCLUDED.updated_at
        WHERE library_items.source_lineage_json ->> 'source' = $9
        RETURNING (xmax = 0) AS inserted`,
        [
          itemId,
          title,
          "Official Faceless rhythm-game level.",
          JSON.stringify(["official", "faceless-volume-1", "rhythm-game"]),
          JSON.stringify(buildMetadata(song, title, entry)),
          JSON.stringify({ source: LEGACY_SOURCE, legacyBeatEntryId: entryId }),
          song.created_at,
          song.updated_at,
          LEGACY_SOURCE,
        ],
      );

      if (itemInsert.rowCount === 0) {
        await client.query("ROLLBACK");
        result.collisions += 1;
        continue;
      }

      await client.query(`DELETE FROM library_files WHERE item_id = $1`, [itemId]);
      for (const file of files) {
        await client.query(
          `INSERT INTO library_files (
            id, item_id, role, mime_type, size_bytes, storage_provider, path, public_url, sha256, metadata_json
          )
          VALUES ($1, $2, $3, $4, 0, 'bunny', $5, $6, NULL, $7::jsonb)`,
          [file.id, itemId, file.role, file.mimeType, file.path, file.publicUrl, JSON.stringify(file.metadata)],
        );
      }
      await client.query("COMMIT");
      if (itemInsert.rows[0]?.inserted) result.migrated += 1;
      else result.updated += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  clearMaterializedLegacyRhythmCache();
  return result;
}
