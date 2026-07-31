import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import {
  createLibraryItemSchema,
  libraryFileRoleSchema,
  libraryFileUploadFieldsSchema,
  libraryJsonObjectSchema,
  libraryListQuerySchema,
  publishLibraryItemSchema,
} from "@faceless/shared";
import { pool } from "../../db/postgres.js";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { createId, hashToken } from "../../utils/crypto.js";
import { buildObjectPath, downloadFromBunny, uploadBufferToBunny } from "../storage/bunnyStorage.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { listOfficialRhythmGameLibraryItems, readOfficialRhythmGameLibraryItem } from "./officialRhythmGames.js";
import { normalizeLibraryItemMetadata } from "./rhythmGameLibrary.js";
import { parseSfzInstrument } from "./sfz.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.libraryMaxUploadSizeBytes,
  },
});

function mapLibraryItem(row: any, files: any[] = []) {
  const sourceLineage = row.source_lineage_json ?? {};
  const isOfficialLegacyRhythmGame = sourceLineage.source === "legacy_game_catalog";
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    visibility: row.visibility,
    status: row.status,
    kind: row.kind,
    title: row.title,
    description: row.description,
    tags: row.tags_json ?? [],
    metadata: normalizeLibraryItemMetadata(row.kind, row.metadata_json ?? {}),
    sourceLineage,
    license: row.license,
    attribution: row.attribution,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files,
    creator: row.owner_user_id
      ? {
          displayName: row.creator_display_name ?? null,
          creatorSlug: row.creator_slug ?? null,
          avatarUrl: row.creator_avatar_url ?? null,
          bannerUrl: row.creator_banner_url ?? null,
          publicKey: row.creator_public_key ?? null,
        }
      : isOfficialLegacyRhythmGame
        ? {
            displayName: "The Faceless Dancer",
            creatorSlug: "the-faceless-dancer",
            avatarUrl: null,
            bannerUrl: null,
            publicKey: null,
          }
        : null,
  };
}

function mapLibraryFile(row: any) {
  return {
    id: row.id,
    itemId: row.item_id,
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

function safeFileName(name: string) {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return clean.slice(0, 120) || "file";
}

function isRemoteGenerationObjectPath(objectPath: string): boolean {
  return /^remote-generation(?:-[A-Za-z0-9-]+)?\/jobs\/[A-Za-z0-9-]+\/[^/]+(?:\/[^/]+)*$/.test(objectPath)
    && !objectPath.includes("..")
    && !objectPath.includes("\\");
}

async function resolvePublishUser(req: any, res: any): Promise<{ userId: string; isAdmin: boolean } | null> {
  const accessToken = req.cookies?.accessToken;
  if (accessToken) {
    try {
      const session = verifyAccessToken(accessToken);
      req.session = session;
      return {
        userId: session.userId,
        isAdmin: session.isAdmin,
      };
    } catch {
      // Fall through to token auth for local-app publish flows.
    }
  }

  const authorization = String(req.headers.authorization ?? "");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: "Missing creator publish token or authenticated session" });
    return null;
  }

  try {
    const session = verifyAccessToken(match[1]);
    req.session = session;
    return {
      userId: session.userId,
      isAdmin: session.isAdmin,
    };
  } catch {
    // Fall back to legacy creator publish token lookup.
  }

  const tokenHash = hashToken(match[1]);
  const result = await pool.query<{
    id: string;
    user_id: string;
    is_admin: number | boolean;
  }>(
    `SELECT t.id, t.user_id, u.is_admin
     FROM creator_publish_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    res.status(401).json({ error: "Invalid or revoked creator publish token" });
    return null;
  }

  await pool.query(`UPDATE creator_publish_tokens SET last_used_at = now() WHERE id = $1`, [row.id]);
  return {
    userId: row.user_id,
    isAdmin: row.is_admin === true || row.is_admin === 1,
  };
}

async function readItemWithFiles(itemId: string) {
  const itemResult = await pool.query(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url,
            u.public_key AS creator_public_key
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     WHERE li.id = $1
     LIMIT 1`,
    [itemId]
  );
  const item = itemResult.rows[0];
  if (!item) {
    return null;
  }
  const fileResult = await pool.query(`SELECT * FROM library_files WHERE item_id = $1 ORDER BY created_at ASC`, [itemId]);
  return mapLibraryItem(item, fileResult.rows.map(mapLibraryFile));
}

router.get("/", async (req, res) => {
  const parsed = libraryListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const filters = ["li.visibility = 'public'", "li.status = 'published'"];
  const values: unknown[] = [];

  if (parsed.data.kind) {
    values.push(parsed.data.kind);
    filters.push(`li.kind = $${values.length}`);
  }

  if (parsed.data.tag) {
    values.push(JSON.stringify([parsed.data.tag]));
    filters.push(`li.tags_json @> $${values.length}::jsonb`);
  }

  if (parsed.data.license) {
    values.push(parsed.data.license);
    filters.push(`li.license = $${values.length}`);
  }

  if (parsed.data.playable) {
    filters.push(`EXISTS (
      SELECT 1
      FROM library_files playable_file
      WHERE playable_file.item_id = li.id
        AND playable_file.role IN ('audio', 'preview')
        AND playable_file.public_url IS NOT NULL
    )`);
  }

  if (parsed.data.artwork) {
    filters.push(`EXISTS (
      SELECT 1
      FROM library_files artwork_file
      WHERE artwork_file.item_id = li.id
        AND artwork_file.role = 'cover'
        AND artwork_file.public_url IS NOT NULL
    )`);
  }

  const search = parsed.data.search?.trim() ?? "";
  if (search) {
    values.push(`%${search}%`);
    const searchParam = `$${values.length}`;
    filters.push(`(
      li.title ILIKE ${searchParam}
      OR COALESCE(li.description, '') ILIKE ${searchParam}
      OR li.kind ILIKE ${searchParam}
      OR li.tags_json::text ILIKE ${searchParam}
    )`);
  }

  const countResult = await pool.query<{
    count: string;
    creators: string;
    playable: string;
    artwork: string;
  }>(
    `SELECT COUNT(*)::text AS count,
            COUNT(DISTINCT li.owner_user_id)::text AS creators,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1
              FROM library_files playable_file
              WHERE playable_file.item_id = li.id
                AND playable_file.role IN ('audio', 'preview')
                AND playable_file.public_url IS NOT NULL
            ))::text AS playable,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1
              FROM library_files artwork_file
              WHERE artwork_file.item_id = li.id
                AND artwork_file.role = 'cover'
                AND artwork_file.public_url IS NOT NULL
            ))::text AS artwork
     FROM library_items li
     WHERE ${filters.join(" AND ")}`,
    values,
  );
  const databaseTotal = Number(countResult.rows[0]?.count ?? 0);
  const databaseCreators = Number(countResult.rows[0]?.creators ?? 0);
  const databasePlayable = Number(countResult.rows[0]?.playable ?? 0);
  const databaseArtwork = Number(countResult.rows[0]?.artwork ?? 0);

  const searchNeedle = search.toLowerCase();
  const officialItems = !parsed.data.kind || parsed.data.kind === "rhythm_game"
    ? (await listOfficialRhythmGameLibraryItems(req))
      .filter((item) => {
        if (parsed.data.tag && !item.tags.includes(parsed.data.tag)) return false;
        if (parsed.data.license && item.license !== parsed.data.license) return false;
        if (parsed.data.playable && !item.files.some((file) => ["audio", "preview"].includes(String(file.role)) && file.publicUrl)) return false;
        if (parsed.data.artwork && !item.files.some((file) => file.role === "cover" && file.publicUrl)) return false;
        if (!searchNeedle) return true;
        return [item.title, item.description, item.kind, item.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(searchNeedle);
      })
      .sort((left, right) => {
        const comparison = String(left.updatedAt || left.createdAt || "").localeCompare(String(right.updatedAt || right.createdAt || ""));
        return parsed.data.sort === "oldest" ? comparison : -comparison;
      })
    : [];

  // Official rhythm entries are legacy catalog records, so keep them at the
  // front of the combined list while database results remain bounded.
  const officialTotal = officialItems.length;
  const officialPageStart = Math.min(parsed.data.offset, officialTotal);
  const officialPage = officialItems.slice(officialPageStart, officialPageStart + parsed.data.limit);
  const databaseLimit = Math.max(0, parsed.data.limit - officialPage.length);
  const databaseOffset = Math.max(0, parsed.data.offset - officialTotal);

  const result = databaseLimit
    ? await pool.query(
      `SELECT li.*,
              u.display_name AS creator_display_name,
              u.creator_slug,
              u.avatar_public_url AS creator_avatar_url,
              u.banner_public_url AS creator_banner_url,
              u.public_key AS creator_public_key
       FROM library_items li
       LEFT JOIN users u ON u.id = li.owner_user_id
       WHERE ${filters.join(" AND ")}
       ORDER BY li.updated_at ${parsed.data.sort === "oldest" ? "ASC" : "DESC"}, li.id ${parsed.data.sort === "oldest" ? "ASC" : "DESC"}
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, databaseLimit, databaseOffset],
    )
    : { rows: [] };

  const itemIds = result.rows.map((row) => row.id);
  const filesByItem = new Map<string, any[]>();
  if (itemIds.length) {
    const fileResult = await pool.query(`SELECT * FROM library_files WHERE item_id = ANY($1::text[]) ORDER BY created_at ASC`, [
      itemIds,
    ]);
    for (const file of fileResult.rows) {
      const files = filesByItem.get(file.item_id) ?? [];
      files.push(mapLibraryFile(file));
      filesByItem.set(file.item_id, files);
    }
  }

  const databaseItems = result.rows.map((row) => mapLibraryItem(row, filesByItem.get(row.id) ?? []));
  const items = [...officialPage, ...databaseItems];
  const total = officialTotal + databaseTotal;
  const officialCreators = officialTotal ? 1 : 0;
  return res.json({
    items,
    total,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    hasMore: parsed.data.offset + items.length < total,
    summary: {
      items: total,
      creators: officialCreators + databaseCreators,
      playable: officialTotal + databasePlayable,
      artwork: databaseArtwork,
    },
  });
});

const instrumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.libraryMaxUploadSizeBytes,
    files: 513,
    fields: 8,
  },
});

const storageCopySchema = z.object({
  role: libraryFileRoleSchema,
  metadata: libraryJsonObjectSchema,
  sourceObjectPath: z.string().trim().min(1).max(2000),
  mimeType: z.string().trim().min(1).max(160).optional(),
  fileName: z.string().trim().max(160).optional(),
});

const instrumentImportFieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  itemId: z.string().trim().max(200).optional(),
  license: z.string().trim().max(160).optional(),
  attribution: z.string().trim().max(1000).optional(),
});

function instrumentUploadFiles(req: any): { sfz: Express.Multer.File | null; samples: Express.Multer.File[] } {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return {
    sfz: files.sfz?.[0] ?? null,
    samples: Array.isArray(files.samples) ? files.samples : [],
  };
}

router.post("/publish/instruments/import", instrumentUpload.fields([
  { name: "sfz", maxCount: 1 },
  { name: "samples", maxCount: 512 },
]), async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const parsedFields = instrumentImportFieldsSchema.safeParse(req.body);
  if (!parsedFields.success) {
    return res.status(400).json({ error: "Enter an instrument name and upload an SFZ file." });
  }
  const { sfz, samples } = instrumentUploadFiles(req);
  if (!sfz || !sfz.originalname.toLowerCase().endsWith(".sfz")) {
    return res.status(400).json({ error: "Upload one .sfz definition file." });
  }
  if (!samples.length) {
    return res.status(400).json({ error: "Upload the audio samples referenced by the SFZ file." });
  }

  let definition;
  try {
    definition = parseSfzInstrument({
      buffer: sfz.buffer,
      sourceName: sfz.originalname,
      sampleNames: samples.map((file) => file.originalname),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The SFZ package could not be validated.";
    return res.status(400).json({ error: message });
  }

  const fields = parsedFields.data;
  const localId = fields.itemId ?? "";
  let itemId = localId;
  let existing: any = null;
  if (itemId) {
    const existingResult = await pool.query(
      `SELECT id, owner_user_id, visibility, status, source_lineage_json
       FROM library_items
       WHERE id = $1
       LIMIT 1`,
      [itemId],
    );
    existing = existingResult.rows[0] ?? null;
    if (!existing) return res.status(404).json({ error: "Instrument library item not found" });
    if (existing.owner_user_id !== publisher.userId && !publisher.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
  } else {
    itemId = createId();
  }

  const metadata = {
    sourceTool: "instrument-lab",
    format: "sfz",
    sourceFileName: sfz.originalname,
    instrumentDefinition: definition,
    regionCount: definition.regions.length,
    sampleCount: samples.length,
    validation: {
      state: "ready",
      validatedAt: new Date().toISOString(),
      missingSamples: 0,
      warnings: definition.warnings,
    },
  };
  const sourceLineage = {
    ...(existing?.source_lineage_json ?? {}),
    source: "instrument-lab-site",
    ...(localId ? { localId } : {}),
  };

  if (!existing) {
    await pool.query(
      `INSERT INTO library_items (
        id, owner_user_id, visibility, status, kind, title, description, tags_json,
        metadata_json, source_lineage_json, license, attribution
      )
      VALUES ($1, $2, 'private', 'draft', 'instrument', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        itemId,
        publisher.userId,
        fields.title,
        "Validated SFZ instrument package for Instrument Lab.",
        JSON.stringify(["sfz", "instrument"]),
        JSON.stringify(metadata),
        JSON.stringify(sourceLineage),
        fields.license ?? null,
        fields.attribution ?? null,
      ],
    );
  }

  const previousFiles = await pool.query<{ id: string }>(
    `SELECT id FROM library_files WHERE item_id = $1`,
    [itemId],
  );
  const filesToStore: Array<{
    file: Express.Multer.File;
    role: string;
    metadata: Record<string, unknown>;
  }> = [
    {
      file: sfz,
      role: "instrument_definition",
      metadata: {
        originalName: sfz.originalname,
        sourceName: sfz.originalname,
        format: "sfz",
      },
    },
    ...samples.map((file) => ({
      file,
      role: "instrument_sample",
      metadata: {
        originalName: file.originalname,
        sourcePaths: definition.regions.filter((region) => region.fileName === file.originalname).map((region) => region.sample),
      },
    })),
  ];
  const manifest = Buffer.from(JSON.stringify({
    format: "sfz",
    definition,
    files: filesToStore.map(({ file, role, metadata: fileMetadata }) => ({
      role,
      name: file.originalname,
      ...fileMetadata,
    })),
  }, null, 2));

  const insertedFileIds: string[] = [];
  try {
    const stored = [
      ...filesToStore,
      {
        file: {
          originalname: "instrument-manifest.json",
          mimetype: "application/json",
          size: manifest.byteLength,
          buffer: manifest,
        } as Express.Multer.File,
        role: "instrument_manifest",
        metadata: {
          originalName: "instrument-manifest.json",
          regionCount: definition.regions.length,
          sampleCount: samples.length,
        },
      },
    ];
    for (const entry of stored) {
      const fileId = createId();
      insertedFileIds.push(fileId);
      const originalName = safeFileName(entry.file.originalname || entry.role);
      const ext = path.extname(originalName);
      const baseName = safeFileName(path.basename(originalName, ext));
      const objectPath = buildObjectPath([
        "library",
        publisher.userId,
        itemId,
        `${fileId}-${baseName}${ext}`,
      ]);
      const sha256 = crypto.createHash("sha256").update(entry.file.buffer).digest("hex");
      const uploadResult = await uploadBufferToBunny({
        buffer: entry.file.buffer,
        objectPath,
        contentType: entry.file.mimetype || "application/octet-stream",
      });
      await pool.query(
        `INSERT INTO library_files (
          id, item_id, role, mime_type, size_bytes, storage_provider, path, public_url, sha256, metadata_json
        )
        VALUES ($1, $2, $3, $4, $5, 'bunny', $6, $7, $8, $9::jsonb)`,
        [
          fileId,
          itemId,
          entry.role,
          entry.file.mimetype || "application/octet-stream",
          entry.file.size,
          uploadResult.objectPath,
          uploadResult.publicUrl,
          sha256,
          JSON.stringify(entry.metadata),
        ],
      );
    }
    if (previousFiles.rows.length) {
      await pool.query(`DELETE FROM library_files WHERE id = ANY($1::text[])`, [previousFiles.rows.map((file) => file.id)]);
    }
  } catch (error) {
    if (insertedFileIds.length) {
      await pool.query(`DELETE FROM library_files WHERE id = ANY($1::text[])`, [insertedFileIds]).catch(() => undefined);
    }
    if (!existing) {
      await pool.query(`DELETE FROM library_items WHERE id = $1`, [itemId]).catch(() => undefined);
    }
    console.error("[library] SFZ instrument package storage failed", {
      itemId,
      userId: publisher.userId,
      error,
    });
    return res.status(502).json({ error: "The instrument package could not be stored" });
  }

  if (existing) {
    await pool.query(
      `UPDATE library_items
       SET title = $1,
           kind = 'instrument',
           metadata_json = $2::jsonb,
           source_lineage_json = $3::jsonb,
           license = COALESCE($4, license),
           attribution = COALESCE($5, attribution),
           updated_at = now()
       WHERE id = $6 AND owner_user_id = $7`,
      [
        fields.title,
        JSON.stringify(metadata),
        JSON.stringify(sourceLineage),
        fields.license ?? null,
        fields.attribution ?? null,
        itemId,
        publisher.userId,
      ],
    );
  }
  await pool.query(`UPDATE library_items SET updated_at = now() WHERE id = $1`, [itemId]);
  const item = await readItemWithFiles(itemId);
  return res.status(201).json({
    item,
    validation: {
      state: "ready",
      regionCount: definition.regions.length,
      sampleCount: samples.length,
      warnings: definition.warnings,
    },
  });
});

router.post("/publish/items", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const parsed = publishLibraryItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const item = parsed.data;
  const normalizedMetadata = normalizeLibraryItemMetadata(item.kind, item.metadata);
  const localId = item.localId ?? String(item.sourceLineage.localId ?? item.sourceLineage.sourceId ?? "");
  const sourceLineage = { ...item.sourceLineage, ...(localId ? { localId } : {}) };

  let itemId: string | null = null;
  if (localId) {
    const existingResult = await pool.query<{ id: string }>(
      `SELECT id
       FROM library_items
       WHERE owner_user_id = $1 AND source_lineage_json ->> 'localId' = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [publisher.userId, localId]
    );
    itemId = existingResult.rows[0]?.id ?? null;
  }

  if (!itemId) {
    itemId = createId();
    await pool.query(
      `INSERT INTO library_items (
        id, owner_user_id, visibility, status, kind, title, description, tags_json,
        metadata_json, source_lineage_json, license, attribution
      )
      VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
      [
        itemId,
        publisher.userId,
        item.visibility,
        item.kind,
        item.title,
        item.description ?? null,
        JSON.stringify(item.tags),
        JSON.stringify(normalizedMetadata),
        JSON.stringify(sourceLineage),
        item.license ?? null,
        item.attribution ?? null,
      ]
    );
  } else {
    await pool.query(
      `UPDATE library_items
       SET visibility = $1,
           kind = $2,
           title = $3,
           description = $4,
           tags_json = $5::jsonb,
           metadata_json = $6::jsonb,
           source_lineage_json = $7::jsonb,
           license = $8,
           attribution = $9,
           updated_at = now()
       WHERE id = $10 AND owner_user_id = $11`,
      [
        item.visibility,
        item.kind,
        item.title,
        item.description ?? null,
        JSON.stringify(item.tags),
        JSON.stringify(normalizedMetadata),
        JSON.stringify(sourceLineage),
        item.license ?? null,
        item.attribution ?? null,
        itemId,
        publisher.userId,
      ]
    );
  }

  const fullItem = await readItemWithFiles(itemId);
  return res.status(201).json({ item: fullItem });
});

router.post("/publish/items/:itemId/files", upload.single("file"), async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const parsed = libraryFileUploadFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Missing file" });
  }

  const itemResult = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM library_items WHERE id = $1 LIMIT 1`,
    [req.params.itemId]
  );
  const item = itemResult.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }
  if (item.owner_user_id !== publisher.userId && !publisher.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const fileId = createId();
  const originalName = safeFileName(req.file.originalname || `${parsed.data.role}`);
  const ext = path.extname(originalName);
  const baseName = safeFileName(path.basename(originalName, ext));
  const objectPath = buildObjectPath([
    "library",
    item.owner_user_id,
    item.id,
    `${fileId}-${baseName}${ext}`,
  ]);
  const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
  const uploadResult = await uploadBufferToBunny({
    buffer: req.file.buffer,
    objectPath,
    contentType: req.file.mimetype || "application/octet-stream",
  });

  await pool.query(
    `INSERT INTO library_files (
      id, item_id, role, mime_type, size_bytes, storage_provider, path, public_url, sha256, metadata_json
    )
    VALUES ($1, $2, $3, $4, $5, 'bunny', $6, $7, $8, $9::jsonb)`,
    [
      fileId,
      item.id,
      parsed.data.role,
      req.file.mimetype || "application/octet-stream",
      req.file.size,
      uploadResult.objectPath,
      uploadResult.publicUrl,
      sha256,
      JSON.stringify({
        ...parsed.data.metadata,
        originalName: req.file.originalname,
      }),
    ]
  );

  await pool.query(`UPDATE library_items SET updated_at = now() WHERE id = $1`, [item.id]);
  const fullItem = await readItemWithFiles(item.id);
  return res.status(201).json({ item: fullItem });
});

router.post("/publish/items/:itemId/files/from-storage", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const parsed = storageCopySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid storage copy payload", details: parsed.error.flatten() });
  }

  const { sourceObjectPath } = parsed.data;
  if (!isRemoteGenerationObjectPath(sourceObjectPath)) {
    return res.status(400).json({ error: "Only remote generation artifacts can be copied from storage" });
  }

  const itemResult = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM library_items WHERE id = $1 LIMIT 1`,
    [req.params.itemId],
  );
  const item = itemResult.rows[0];
  if (!item) return res.status(404).json({ error: "Library item not found" });
  if (item.owner_user_id !== publisher.userId && !publisher.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  let source: { buffer: Buffer; contentType: string };
  try {
    source = await downloadFromBunny(sourceObjectPath);
  } catch (error) {
    console.error("[library] generated asset storage copy failed", { sourceObjectPath, error });
    return res.status(502).json({ error: "The generated asset could not be read from storage" });
  }

  const fileId = createId();
  const originalName = safeFileName(parsed.data.fileName || path.basename(sourceObjectPath));
  const ext = path.extname(originalName);
  const baseName = safeFileName(path.basename(originalName, ext));
  const objectPath = buildObjectPath([
    "library",
    item.owner_user_id,
    item.id,
    `${fileId}-${baseName}${ext}`,
  ]);
  const mimeType = parsed.data.mimeType || source.contentType || "application/octet-stream";
  const sha256 = crypto.createHash("sha256").update(source.buffer).digest("hex");

  let uploadResult: { objectPath: string; publicUrl: string };
  try {
    uploadResult = await uploadBufferToBunny({
      buffer: source.buffer,
      objectPath,
      contentType: mimeType,
    });
  } catch (error) {
    console.error("[library] generated asset public copy failed", { sourceObjectPath, objectPath, error });
    return res.status(502).json({ error: "The generated asset could not be stored in the public library" });
  }

  await pool.query(
    `INSERT INTO library_files (
      id, item_id, role, mime_type, size_bytes, storage_provider, path, public_url, sha256, metadata_json
    )
    VALUES ($1, $2, $3, $4, $5, 'bunny', $6, $7, $8, $9::jsonb)`,
    [
      fileId,
      item.id,
      parsed.data.role,
      mimeType,
      source.buffer.byteLength,
      uploadResult.objectPath,
      uploadResult.publicUrl,
      sha256,
      JSON.stringify({
        ...parsed.data.metadata,
        originalName,
        sourceObjectPath,
      }),
    ],
  );

  await pool.query(`UPDATE library_items SET updated_at = now() WHERE id = $1`, [item.id]);
  const fullItem = await readItemWithFiles(item.id);
  return res.status(201).json({ item: fullItem });
});

router.delete("/publish/items/:itemId/files", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const itemResult = await pool.query<{ id: string; owner_user_id: string }>(
    `SELECT id, owner_user_id FROM library_items WHERE id = $1 LIMIT 1`,
    [req.params.itemId]
  );
  const item = itemResult.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }
  if (item.owner_user_id !== publisher.userId && !publisher.isAdmin) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await pool.query(`DELETE FROM library_files WHERE item_id = $1`, [item.id]);
  await pool.query(`UPDATE library_items SET updated_at = now() WHERE id = $1`, [item.id]);
  const fullItem = await readItemWithFiles(item.id);
  return res.json({ item: fullItem });
});

router.post("/publish/items/:itemId/submit", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const result = await pool.query(
    `UPDATE library_items
     SET status = 'submitted', updated_at = now()
     WHERE id = $1 AND owner_user_id = $2
     RETURNING *`,
    [req.params.itemId, publisher.userId]
  );
  const item = result.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }
  const fullItem = await readItemWithFiles(item.id);
  return res.json({ item: fullItem });
});

router.post("/publish/items/:itemId/publish", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const fileCount = await pool.query<{ count: string }>(
    `SELECT COUNT(1) AS count FROM library_files WHERE item_id = $1`,
    [req.params.itemId]
  );
  if (Number(fileCount.rows[0]?.count ?? 0) < 1) {
    return res.status(400).json({ error: "Upload at least one file before publishing" });
  }

  const result = await pool.query(
    `UPDATE library_items
     SET visibility = 'public', status = 'published', updated_at = now()
     WHERE id = $1 AND owner_user_id = $2
     RETURNING *`,
    [req.params.itemId, publisher.userId]
  );
  const item = result.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }
  const fullItem = await readItemWithFiles(item.id);
  return res.json({ item: fullItem });
});

router.post("/publish/items/:itemId/revoke", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const result = await pool.query(
    `UPDATE library_items
     SET visibility = 'private', status = 'archived', updated_at = now()
     WHERE id = $1 AND owner_user_id = $2
     RETURNING *`,
    [req.params.itemId, publisher.userId]
  );
  const item = result.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }
  const fullItem = await readItemWithFiles(item.id);
  return res.json({ item: fullItem });
});

router.get("/:itemId/files/:fileId", async (req, res) => {
  const fileResult = await pool.query<{
    item_id: string;
    owner_user_id: string | null;
    visibility: string;
    status: string;
    storage_provider: string;
    path: string;
    public_url: string | null;
    mime_type: string;
    size_bytes: string;
  }>(
    `SELECT lf.item_id, lf.storage_provider, lf.path, lf.public_url, lf.mime_type, lf.size_bytes,
            li.owner_user_id, li.visibility, li.status
     FROM library_files lf
     JOIN library_items li ON li.id = lf.item_id
     WHERE lf.item_id = $1 AND lf.id = $2
     LIMIT 1`,
    [req.params.itemId, req.params.fileId],
  );
  const file = fileResult.rows[0];
  if (!file) return res.status(404).json({ error: "Library file not found" });

  const publiclyReadable = file.visibility === "public" && file.status === "published";
  if (!publiclyReadable) {
    const accessToken = req.cookies?.accessToken;
    if (!accessToken) return res.status(401).json({ error: "Authentication required" });
    let session;
    try {
      session = verifyAccessToken(accessToken);
    } catch {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (file.owner_user_id !== session.userId && !session.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  if (file.storage_provider !== "bunny" || !file.path) {
    return res.status(404).json({ error: "Library file is not available" });
  }

  try {
    const asset = await downloadFromBunny(file.path);
    res.setHeader("Content-Type", file.mime_type || asset.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(asset.buffer.byteLength || Number(file.size_bytes) || 0));
    res.setHeader("Cache-Control", publiclyReadable ? "public, max-age=300" : "private, max-age=300");
    return res.send(asset.buffer);
  } catch (error) {
    console.error("[library] file proxy failed", { itemId: req.params.itemId, fileId: req.params.fileId, error });
    return res.status(404).json({ error: "Library file not found" });
  }
});

router.get("/:itemId", async (req, res) => {
  const officialItem = await readOfficialRhythmGameLibraryItem(req, req.params.itemId);
  if (officialItem) {
    return res.json({ item: officialItem });
  }
  const itemResult = await pool.query(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url,
            u.public_key AS creator_public_key
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     WHERE li.id = $1 AND li.visibility = 'public' AND li.status = 'published'
     LIMIT 1`,
    [req.params.itemId]
  );
  const item = itemResult.rows[0];
  if (!item) {
    return res.status(404).json({ error: "Library item not found" });
  }

  const fileResult = await pool.query(`SELECT * FROM library_files WHERE item_id = $1 ORDER BY created_at ASC`, [
    item.id,
  ]);

  return res.json({ item: mapLibraryItem(item, fileResult.rows.map(mapLibraryFile)) });
});

router.post("/", requireAuth, async (req, res) => {
  const parsed = createLibraryItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const itemId = createId();
  const item = parsed.data;

  await pool.query(
    `INSERT INTO library_items (
      id,
      owner_user_id,
      visibility,
      status,
      kind,
      title,
      description,
      tags_json,
      metadata_json,
      source_lineage_json,
      license,
      attribution
    )
    VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)`,
    [
      itemId,
      req.session!.userId,
      item.visibility,
      item.kind,
      item.title,
      item.description ?? null,
      JSON.stringify(item.tags),
      JSON.stringify(item.metadata),
      JSON.stringify(item.sourceLineage),
      item.license ?? null,
      item.attribution ?? null,
    ]
  );

  return res.status(201).json({ itemId, status: "draft" });
});

export const libraryRouter = router;
