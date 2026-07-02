import { Readable } from "node:stream";
import {
  countDifficultyChartBeats,
  getAvailableDifficulties,
  getAvailableGameModes,
  getDifficultyBeatCounts,
  getModeDifficultyBeatCounts,
} from "../game/difficultyCharts.js";
import { pool } from "../../db/postgres.js";
import { downloadFromBunny } from "../storage/bunnyStorage.js";
import { findSongByEntryId, setSongEnabledForEntry, upsertSongForEntry } from "../game/service.js";

type LibraryFileRow = {
  id: string;
  item_id: string;
  role: string;
  mime_type: string;
  size_bytes: number;
  storage_provider: string;
  path: string;
  public_url: string;
  sha256: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
};

type PublishedRhythmGameItemRow = {
  id: string;
  owner_user_id: string;
  visibility: string;
  status: string;
  kind: string;
  title: string;
  description: string | null;
  tags_json: string[] | null;
  metadata_json: Record<string, unknown> | null;
  source_lineage_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  creator_display_name: string | null;
  creator_slug: string | null;
  creator_avatar_url: string | null;
  creator_banner_url: string | null;
};

export interface PublishedRhythmGameCatalogRow {
  itemId: string;
  title: string;
  metadata: NormalizedRhythmGameMetadata;
  creatorName: string;
  coverPublicUrl: string | null;
}

export interface NormalizedRhythmGameMetadata {
  category: "rhythm_game";
  gameEnabled: boolean;
  volumeId: string;
  volumeLabel: string;
  volumeSlug: string;
  officialVolume: boolean;
  sortOrder: number;
  supportedGameModes: {
    stepArrows: boolean;
    orbBeat: boolean;
    laserShoot: boolean;
  };
  legacyCatalogSource?: string;
  songTitle?: string;
}

export interface PublishedRhythmGameLibraryItem {
  id: string;
  ownerUserId: string;
  visibility: string;
  status: string;
  kind: string;
  title: string;
  description: string | null;
  tags: string[];
  metadata: NormalizedRhythmGameMetadata;
  sourceLineage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  files: Array<{
    id: string;
    role: string;
    mimeType: string;
    sizeBytes: number;
    storageProvider: string;
    path: string;
    publicUrl: string;
    sha256: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
  creator: {
    displayName: string | null;
    creatorSlug: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
  };
}

function toBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function normalizeRhythmGameLibraryMetadata(input: Record<string, unknown> | null | undefined): NormalizedRhythmGameMetadata {
  const metadata = input && typeof input === "object" ? input : {};
  const rawSupported =
    (metadata.supportedGameModes as Record<string, unknown> | undefined) ??
    (metadata.supported_game_modes as Record<string, unknown> | undefined) ??
    {};
  const stepArrows =
    typeof rawSupported.stepArrows === "boolean"
      ? rawSupported.stepArrows
      : typeof rawSupported.step_arrows === "boolean"
        ? rawSupported.step_arrows
        : true;
  const orbBeat =
    typeof rawSupported.orbBeat === "boolean"
      ? rawSupported.orbBeat
      : typeof rawSupported.orb_beat === "boolean"
        ? rawSupported.orb_beat
        : false;

  return {
    category: "rhythm_game",
    gameEnabled:
      typeof metadata.gameEnabled === "boolean"
        ? metadata.gameEnabled
        : typeof metadata.game_enabled === "boolean"
          ? metadata.game_enabled
          : false,
    volumeId: toStringValue(metadata.volumeId, toStringValue(metadata.volume_id)),
    volumeLabel: toStringValue(metadata.volumeLabel, toStringValue(metadata.volume_label)),
    volumeSlug: toStringValue(metadata.volumeSlug, toStringValue(metadata.volume_slug)),
    officialVolume:
      typeof metadata.officialVolume === "boolean"
        ? metadata.officialVolume
        : typeof metadata.official_volume === "boolean"
          ? metadata.official_volume
          : false,
    sortOrder: toInt(
      metadata.sortOrder,
      toInt(metadata.sort_order)
    ),
    supportedGameModes: {
      stepArrows,
      orbBeat,
      laserShoot: stepArrows,
    },
    legacyCatalogSource: toStringValue(metadata.legacyCatalogSource, toStringValue(metadata.legacy_catalog_source)) || undefined,
    songTitle: toStringValue(metadata.songTitle, toStringValue(metadata.song_title)) || undefined,
  };
}

function mapLibraryFile(row: LibraryFileRow) {
  return {
    id: row.id,
    role: row.role,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageProvider: row.storage_provider,
    path: row.path,
    publicUrl: row.public_url,
    sha256: row.sha256,
    metadata: row.metadata_json ?? {},
    createdAt: row.created_at,
  };
}

function mapPublishedItem(row: PublishedRhythmGameItemRow, files: LibraryFileRow[]): PublishedRhythmGameLibraryItem {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    status: row.status,
    kind: row.kind,
    title: row.title,
    description: row.description,
    tags: row.tags_json ?? [],
    metadata: normalizeRhythmGameLibraryMetadata(row.metadata_json),
    sourceLineage: row.source_lineage_json ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files.map(mapLibraryFile),
    creator: {
      displayName: row.creator_display_name,
      creatorSlug: row.creator_slug,
      avatarUrl: row.creator_avatar_url,
      bannerUrl: row.creator_banner_url,
    },
  };
}

function mapPublishedCatalogRow(
  row: PublishedRhythmGameItemRow,
  coverFile: Pick<LibraryFileRow, "public_url"> | null | undefined
): PublishedRhythmGameCatalogRow {
  return {
    itemId: row.id,
    title: row.title,
    metadata: normalizeRhythmGameLibraryMetadata(row.metadata_json),
    creatorName: row.creator_display_name || row.creator_slug || "Faceless creator",
    coverPublicUrl: coverFile?.public_url || row.creator_banner_url || row.creator_avatar_url || null,
  };
}

async function readItemRows(itemId: string): Promise<{ row: PublishedRhythmGameItemRow; files: LibraryFileRow[] } | null> {
  const itemResult = await pool.query<PublishedRhythmGameItemRow>(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     WHERE li.id = $1 AND li.kind = 'rhythm_game'
     LIMIT 1`,
    [itemId]
  );
  const row = itemResult.rows[0];
  if (!row) {
    return null;
  }
  const fileResult = await pool.query<LibraryFileRow>(
    `SELECT * FROM library_files WHERE item_id = $1 ORDER BY created_at ASC`,
    [itemId]
  );
  return { row, files: fileResult.rows };
}

export async function readPublishedRhythmGameLibraryItem(itemId: string): Promise<PublishedRhythmGameLibraryItem | null> {
  const rows = await readItemRows(itemId);
  if (!rows) {
    return null;
  }
  return mapPublishedItem(rows.row, rows.files);
}

export async function listPublishedRhythmGameLibraryItems(): Promise<PublishedRhythmGameLibraryItem[]> {
  const itemResult = await pool.query<PublishedRhythmGameItemRow>(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     WHERE li.kind = 'rhythm_game'
     ORDER BY li.updated_at DESC`
  );
  if (itemResult.rows.length === 0) {
    return [];
  }
  const itemIds = itemResult.rows.map((row) => row.id);
  const fileResult = await pool.query<LibraryFileRow>(
    `SELECT * FROM library_files WHERE item_id = ANY($1::text[]) ORDER BY created_at ASC`,
    [itemIds]
  );
  const filesByItem = new Map<string, LibraryFileRow[]>();
  for (const file of fileResult.rows) {
    const bucket = filesByItem.get(file.item_id) ?? [];
    bucket.push(file);
    filesByItem.set(file.item_id, bucket);
  }
  return itemResult.rows.map((row) => mapPublishedItem(row, filesByItem.get(row.id) ?? []));
}

export async function listPublishedRhythmGameCatalogRows(
  itemIds?: string[]
): Promise<Map<string, PublishedRhythmGameCatalogRow>> {
  const filters: string[] = [`li.kind = 'rhythm_game'`];
  const values: unknown[] = [];
  if (itemIds && itemIds.length > 0) {
    values.push(itemIds);
    filters.push(`li.id = ANY($${values.length}::text[])`);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const itemResult = await pool.query<PublishedRhythmGameItemRow>(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     ${whereClause}`,
    values
  );
  if (itemResult.rows.length === 0) {
    return new Map();
  }
  const resolvedIds = itemResult.rows.map((row) => row.id);
  const fileResult = await pool.query<Pick<LibraryFileRow, "item_id" | "public_url" | "role">>(
    `SELECT item_id, public_url, role
     FROM library_files
     WHERE item_id = ANY($1::text[])
       AND role = 'cover'
     ORDER BY created_at ASC`,
    [resolvedIds]
  );
  const coverByItem = new Map<string, Pick<LibraryFileRow, "public_url" | "role">>();
  for (const file of fileResult.rows) {
    if (!coverByItem.has(file.item_id)) {
      coverByItem.set(file.item_id, file);
    }
  }
  return new Map(
    itemResult.rows.map((row) => [
      row.id,
      mapPublishedCatalogRow(row, coverByItem.get(row.id)),
    ])
  );
}

function filterEntryModes(entry: Record<string, unknown>, metadata: NormalizedRhythmGameMetadata) {
  const modeCounts = getModeDifficultyBeatCounts(entry);
  const supported = metadata.supportedGameModes;
  const availableModes = getAvailableGameModes(entry).filter((mode) => {
    if (mode === "orb_beat") return supported.orbBeat;
    if (mode === "laser_shoot") return supported.laserShoot;
    return supported.stepArrows;
  });
  const filteredCounts = Object.fromEntries(
    Object.entries(modeCounts).filter(([mode]) => {
      if (mode === "orb_beat") return supported.orbBeat;
      if (mode === "laser_shoot") return supported.laserShoot;
      return supported.stepArrows;
    })
  );
  return {
    ...entry,
    availableGameModes: availableModes,
    availableDifficulties: getAvailableDifficulties(entry),
    difficultyBeatCounts: getDifficultyBeatCounts(entry),
    modeDifficultyBeatCounts: filteredCounts,
  };
}

export async function readPublishedRhythmGameEntry(itemId: string): Promise<Record<string, unknown> | null> {
  const item = await readPublishedRhythmGameLibraryItem(itemId);
  if (!item || item.visibility !== "public" || item.status !== "published" || !item.metadata.gameEnabled) {
    return null;
  }
  const chartFile = item.files.find((file) => file.role === "chart");
  if (!chartFile?.path) {
    return null;
  }
  const raw = await downloadFromBunny(chartFile.path);
  const parsed = JSON.parse(raw.buffer.toString("utf8")) as Record<string, unknown>;
  return filterEntryModes(parsed, item.metadata);
}

export async function createPublishedRhythmGameAudioReadStream(
  itemId: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const item = await readPublishedRhythmGameLibraryItem(itemId);
  if (!item || item.visibility !== "public" || item.status !== "published" || !item.metadata.gameEnabled) {
    return null;
  }
  const audioFile = item.files.find((file) => file.role === "audio" || file.role === "preview");
  if (!audioFile?.path) {
    return null;
  }
  const raw = await downloadFromBunny(audioFile.path);
  return {
    stream: Readable.from(raw.buffer),
    mimeType: audioFile.mimeType || raw.contentType || "application/octet-stream",
  };
}

export async function createPublishedRhythmGameCoverReadStream(
  itemId: string
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string } | null> {
  const item = await readPublishedRhythmGameLibraryItem(itemId);
  if (!item || item.visibility !== "public" || item.status !== "published" || !item.metadata.gameEnabled) {
    return null;
  }
  const coverFile = item.files.find((file) => file.role === "cover");
  if (!coverFile?.path) {
    return null;
  }
  const raw = await downloadFromBunny(coverFile.path);
  return {
    stream: Readable.from(raw.buffer),
    mimeType: coverFile.mimeType || raw.contentType || "application/octet-stream",
  };
}

export async function syncPublishedRhythmGameCatalogEntry(itemId: string): Promise<void> {
  const item = await readPublishedRhythmGameLibraryItem(itemId);
  if (!item) {
    return;
  }
  const shouldEnable =
    item.kind === "rhythm_game" &&
    item.visibility === "public" &&
    item.status === "published" &&
    item.metadata.gameEnabled;
  const chartFile = item.files.find((file) => file.role === "chart");
  const audioFile = item.files.find((file) => file.role === "audio" || file.role === "preview");
  if (shouldEnable && chartFile && audioFile) {
    await upsertSongForEntry({
      beatEntryId: item.id,
      title: item.title,
      isEnabled: true,
      createdByUserId: item.ownerUserId,
    });
    return;
  }
  const existing = await findSongByEntryId(item.id);
  if (existing) {
    await setSongEnabledForEntry(item.id, false, item.title);
  }
}

export async function syncAllPublishedRhythmGameCatalogEntries(): Promise<void> {
  const items = await listPublishedRhythmGameLibraryItems();
  for (const item of items) {
    await syncPublishedRhythmGameCatalogEntry(item.id);
  }
}

export function normalizeLibraryItemMetadata(kind: string, metadata: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "rhythm_game") {
    return metadata;
  }
  return {
    ...metadata,
    ...normalizeRhythmGameLibraryMetadata(metadata),
  };
}

export function buildPublishedSongSummary(item: PublishedRhythmGameLibraryItem, entry: Record<string, unknown>) {
  const normalChart = countDifficultyChartBeats(
    ((entry.modeDifficultyCharts as Record<string, unknown> | undefined)?.step_arrows as Record<string, unknown> | undefined)?.normal as any
  );
  const coverFile = item.files.find((file) => file.role === "cover");
  return {
    beatEntryId: item.id,
    title: item.title,
    majorBeatCount: Array.isArray(entry.majorBeats) ? entry.majorBeats.length : 0,
    gameBeatCount: normalChart || (getDifficultyBeatCounts(entry, "step_arrows").normal ?? 0),
    coverImageUrl: coverFile?.publicUrl ?? item.creator.bannerUrl ?? item.creator.avatarUrl ?? null,
    availableGameModes: (entry.availableGameModes as Array<"step_arrows" | "orb_beat" | "laser_shoot"> | undefined) ?? [],
    availableDifficulties: (entry.availableDifficulties as Array<"easy" | "normal" | "hard"> | undefined) ?? [],
    difficultyBeatCounts: (entry.difficultyBeatCounts as Partial<Record<"easy" | "normal" | "hard", number>> | undefined) ?? {},
    modeDifficultyBeatCounts:
      (entry.modeDifficultyBeatCounts as Partial<
        Record<"step_arrows" | "orb_beat" | "laser_shoot", Partial<Record<"easy" | "normal" | "hard", number>>>
      > | undefined) ?? {},
    volumeId: item.metadata.volumeId,
    volumeLabel: item.metadata.volumeLabel,
    volumeSlug: item.metadata.volumeSlug,
    officialVolume: item.metadata.officialVolume,
    creatorName: item.creator.displayName || item.creator.creatorSlug || "Faceless creator",
  };
}
