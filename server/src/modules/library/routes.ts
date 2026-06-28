import { Router } from "express";
import { createLibraryItemSchema, libraryListQuerySchema } from "@faceless/shared";
import { pool } from "../../db/postgres.js";
import { requireAuth } from "../../middleware/auth.js";
import { createId } from "../../utils/crypto.js";

const router = Router();

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
    `SELECT * FROM library_items
     WHERE ${filters.join(" AND ")}
     ORDER BY created_at DESC
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

router.get("/:itemId", async (req, res) => {
  const itemResult = await pool.query(
    `SELECT * FROM library_items WHERE id = $1 AND visibility = 'public' AND status = 'published' LIMIT 1`,
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
