import { closePool } from "../db/postgres.js";
import { migrateLegacyRhythmLibrary } from "../modules/library/legacyRhythmLibraryMigration.js";

try {
  const result = await migrateLegacyRhythmLibrary();
  console.log(`[legacy-rhythm-library] ${JSON.stringify(result)}`);
} finally {
  await closePool();
}
