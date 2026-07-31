import { closePool, pool } from "../db/postgres.js";
import {
  getAvailableDifficulties,
  getAvailableGameModes,
  getDifficultyBeatCounts,
  getModeDifficultyBeatCounts,
} from "../modules/game/difficultyCharts.js";
import { readPublishedRhythmGameEntry } from "../modules/library/rhythmGameLibrary.js";

type CatalogRow = {
  id: string;
  title: string;
  metadata_json: Record<string, unknown> | null;
};

function buildSummary(entry: Record<string, unknown>): Record<string, unknown> {
  const entryData = (entry.entry as { durationSeconds?: unknown } | undefined) ?? {};
  return {
    durationSeconds: Number(entryData.durationSeconds ?? 0),
    majorBeatCount: Array.isArray(entry.majorBeats) ? entry.majorBeats.length : 0,
    availableGameModes: getAvailableGameModes(entry),
    availableDifficulties: getAvailableDifficulties(entry),
    difficultyBeatCounts: getDifficultyBeatCounts(entry),
    modeDifficultyBeatCounts: getModeDifficultyBeatCounts(entry),
  };
}

async function main(): Promise<void> {
  const rows = (
    await pool.query<CatalogRow>(
      `SELECT id, title, metadata_json
       FROM library_items
       WHERE kind = 'rhythm_game'
         AND visibility = 'public'
         AND status = 'published'
         AND COALESCE(NULLIF(metadata_json ->> 'gameEnabled', ''), metadata_json ->> 'game_enabled') = 'true'
       ORDER BY updated_at DESC`,
    )
  ).rows;

  let nextIndex = 0;
  let updated = 0;
  let missing = 0;
  const failures: Array<{ id: string; title: string; error: string }> = [];
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= rows.length) return;
      const row = rows[index];
      try {
        const entry = await readPublishedRhythmGameEntry(row.id);
        if (!entry) {
          missing += 1;
          continue;
        }
        const summary = buildSummary(entry);
        await pool.query(
          `UPDATE library_items
           SET metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $2::jsonb
           WHERE id = $1`,
          [row.id, JSON.stringify(summary)],
        );
        updated += 1;
      } catch (error) {
        failures.push({
          id: row.id,
          title: row.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, () => worker()));
  console.log(JSON.stringify({ scanned: rows.length, updated, missing, failed: failures.length, failures }));
}

try {
  await main();
} finally {
  await closePool();
}
