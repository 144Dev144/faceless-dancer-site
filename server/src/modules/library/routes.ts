import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import {
  createLibraryItemSchema,
  libraryFileUploadFieldsSchema,
  libraryListQuerySchema,
  publishLibraryItemSchema,
} from "@faceless/shared";
import { pool } from "../../db/postgres.js";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { createId, hashToken } from "../../utils/crypto.js";
import { buildObjectPath, uploadBufferToBunny } from "../storage/bunnyStorage.js";
import { verifyAccessToken } from "../auth/tokens.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.libraryMaxUploadSizeBytes,
  },
});

function mapLibraryItem(row: any, files: any[] = []) {
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    visibility: row.visibility,
    status: row.status,
    kind: row.kind,
    title: row.title,
    description: row.description,
    tags: row.tags_json ?? [],
    metadata: row.metadata_json ?? {},
    sourceLineage: row.source_lineage_json ?? {},
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
            u.banner_public_url AS creator_banner_url
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

  const filters = ["visibility = 'public'", "status = 'published'"];
  const values: unknown[] = [];

  if (parsed.data.kind) {
    values.push(parsed.data.kind);
    filters.push(`kind = $${values.length}`);
  }

  if (parsed.data.tag) {
    values.push(JSON.stringify([parsed.data.tag]));
    filters.push(`tags_json @> $${values.length}::jsonb`);
  }

  values.push(parsed.data.limit);
  const limitIndex = values.length;
  values.push(parsed.data.offset);
  const offsetIndex = values.length;

  const result = await pool.query(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url
     FROM library_items li
     LEFT JOIN users u ON u.id = li.owner_user_id
     WHERE ${filters.map((filter) => `li.${filter}`).join(" AND ")}
     ORDER BY li.created_at DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    values
  );

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

  return res.json({ items: result.rows.map((row) => mapLibraryItem(row, filesByItem.get(row.id) ?? [])) });
});

router.post("/publish/items", async (req, res) => {
  const publisher = await resolvePublishUser(req, res);
  if (!publisher) return;

  const parsed = publishLibraryItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const item = parsed.data;
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
        JSON.stringify(item.metadata),
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
        JSON.stringify(item.metadata),
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

router.get("/:itemId", async (req, res) => {
  const itemResult = await pool.query(
    `SELECT li.*,
            u.display_name AS creator_display_name,
            u.creator_slug,
            u.avatar_public_url AS creator_avatar_url,
            u.banner_public_url AS creator_banner_url
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
