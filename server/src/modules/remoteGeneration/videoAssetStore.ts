import { pool } from "../../db/postgres.js";
import { createId } from "../../utils/crypto.js";
import type { RemoteArtifact, RemoteJob } from "./client.js";
import type { VideoChainParent } from "./videoChainService.js";

export type RemoteVideoAssetKind = "video_generation" | "video_chain";

export interface StoredRemoteVideoAsset {
  id: string;
  ownerUserId: string;
  assetKind: RemoteVideoAssetKind;
  jobId: string;
  chainId?: string;
  parentJobId?: string;
  parentChainId?: string;
  title: string;
  objectPath: string;
  publicUrl: string;
  proxyUrl?: string;
  manifestObjectPath?: string;
  manifestPublicUrl?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  durationSeconds?: number;
  frameRate?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function mapAsset(row: Record<string, unknown>): StoredRemoteVideoAsset {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    assetKind: row.asset_kind as RemoteVideoAssetKind,
    jobId: String(row.job_id),
    chainId: row.chain_id ? String(row.chain_id) : undefined,
    parentJobId: row.parent_job_id ? String(row.parent_job_id) : undefined,
    parentChainId: row.parent_chain_id ? String(row.parent_chain_id) : undefined,
    title: String(row.title),
    objectPath: String(row.object_path),
    publicUrl: String(row.public_url),
    proxyUrl: row.proxy_url ? String(row.proxy_url) : undefined,
    manifestObjectPath: row.manifest_object_path ? String(row.manifest_object_path) : undefined,
    manifestPublicUrl: row.manifest_public_url ? String(row.manifest_public_url) : undefined,
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    durationSeconds: row.duration_seconds === null || row.duration_seconds === undefined ? undefined : Number(row.duration_seconds),
    frameRate: row.frame_rate === null || row.frame_rate === undefined ? undefined : Number(row.frame_rate),
    metadata: (row.metadata_json && typeof row.metadata_json === "object" ? row.metadata_json : {}) as Record<string, unknown>,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function upsertRemoteVideoGenerationAsset(input: {
  ownerUserId: string;
  job: RemoteJob;
  artifact: RemoteArtifact;
  title: string;
  durationSeconds?: number;
  frameRate?: number;
  lineage?: Record<string, unknown>;
}): Promise<StoredRemoteVideoAsset> {
  const result = await pool.query(
    `INSERT INTO remote_generation_assets (
       id, owner_user_id, asset_kind, job_id, title, object_path, public_url,
       proxy_url, mime_type, size_bytes, sha256, duration_seconds, frame_rate,
       metadata_json
     ) VALUES ($1, $2, 'video_generation', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (owner_user_id, job_id, asset_kind) DO UPDATE SET
       title = EXCLUDED.title,
       object_path = EXCLUDED.object_path,
       public_url = EXCLUDED.public_url,
       proxy_url = EXCLUDED.proxy_url,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       sha256 = EXCLUDED.sha256,
       duration_seconds = EXCLUDED.duration_seconds,
       frame_rate = EXCLUDED.frame_rate,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = now()
     RETURNING *`,
    [
      createId(),
      input.ownerUserId,
      input.job.id,
      input.title,
      input.artifact.objectPath,
      input.artifact.publicUrl ?? `/api/remote-generation/assets/file?path=${encodeURIComponent(input.artifact.objectPath)}`,
      `/api/remote-generation/assets/file?path=${encodeURIComponent(input.artifact.objectPath)}`,
      input.artifact.mimeType,
      input.artifact.sizeBytes,
      input.artifact.sha256,
      input.durationSeconds ?? null,
      input.frameRate ?? null,
      JSON.stringify({
        sourceTool: "ltx-video",
        videoAssetKind: "generation",
        modelRevision: input.job.modelRevision,
        requestHash: input.job.requestHash,
        videoLineage: input.lineage,
        expectedAssetKinds: input.lineage ? ["video_generation", "video_chain"] : ["video_generation"],
      }),
    ],
  );
  return mapAsset(result.rows[0]);
}

export async function upsertRemoteVideoChainAsset(input: {
  ownerUserId: string;
  appendJobId: string;
  title: string;
  parent: VideoChainParent;
  chain: {
    chainId: string;
    objectPath: string;
    publicUrl: string;
    proxyUrl: string;
    manifestObjectPath: string;
    manifestPublicUrl: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    durationSeconds: number;
    frameRate: number;
    audioPreserved: boolean;
    segments: unknown;
  };
}): Promise<StoredRemoteVideoAsset> {
  const result = await pool.query(
    `INSERT INTO remote_generation_assets (
       id, owner_user_id, asset_kind, job_id, chain_id, parent_job_id, parent_chain_id,
       title, object_path, public_url, proxy_url, manifest_object_path, manifest_public_url,
       mime_type, size_bytes, sha256, duration_seconds, frame_rate, metadata_json
     ) VALUES ($1, $2, 'video_chain', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (owner_user_id, job_id, asset_kind) DO UPDATE SET
       chain_id = EXCLUDED.chain_id,
       parent_job_id = EXCLUDED.parent_job_id,
       parent_chain_id = EXCLUDED.parent_chain_id,
       title = EXCLUDED.title,
       object_path = EXCLUDED.object_path,
       public_url = EXCLUDED.public_url,
       proxy_url = EXCLUDED.proxy_url,
       manifest_object_path = EXCLUDED.manifest_object_path,
       manifest_public_url = EXCLUDED.manifest_public_url,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       sha256 = EXCLUDED.sha256,
       duration_seconds = EXCLUDED.duration_seconds,
       frame_rate = EXCLUDED.frame_rate,
       metadata_json = EXCLUDED.metadata_json,
       updated_at = now()
     RETURNING *`,
    [
      createId(),
      input.ownerUserId,
      input.appendJobId,
      input.chain.chainId,
      input.parent.sourceJobId ?? null,
      input.parent.sourceChainId ?? null,
      input.title,
      input.chain.objectPath,
      input.chain.publicUrl,
      input.chain.proxyUrl,
      input.chain.manifestObjectPath,
      input.chain.manifestPublicUrl,
      input.chain.mimeType,
      input.chain.sizeBytes,
      input.chain.sha256,
      input.chain.durationSeconds,
      input.chain.frameRate,
      JSON.stringify({
        sourceTool: "ltx-video",
        videoAssetKind: "chain",
        appendJobId: input.appendJobId,
        parent: input.parent,
        audioPreserved: input.chain.audioPreserved,
        segments: input.chain.segments,
      }),
    ],
  );
  return mapAsset(result.rows[0]);
}

export async function findRemoteVideoAssetByJob(input: { ownerUserId: string; jobId: string; assetKind: RemoteVideoAssetKind }): Promise<StoredRemoteVideoAsset | null> {
  const result = await pool.query(
    `SELECT * FROM remote_generation_assets WHERE owner_user_id = $1 AND job_id = $2 AND asset_kind = $3 LIMIT 1`,
    [input.ownerUserId, input.jobId, input.assetKind],
  );
  return result.rows[0] ? mapAsset(result.rows[0]) : null;
}

export async function findRemoteVideoChainById(input: { ownerUserId: string; chainId: string }): Promise<StoredRemoteVideoAsset | null> {
  const result = await pool.query(
    `SELECT * FROM remote_generation_assets WHERE owner_user_id = $1 AND chain_id = $2 AND asset_kind = 'video_chain' LIMIT 1`,
    [input.ownerUserId, input.chainId],
  );
  return result.rows[0] ? mapAsset(result.rows[0]) : null;
}

export async function listRemoteVideoAssets(ownerUserId: string): Promise<StoredRemoteVideoAsset[]> {
  const result = await pool.query(
    `SELECT * FROM remote_generation_assets WHERE owner_user_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [ownerUserId],
  );
  return result.rows.map(mapAsset);
}
