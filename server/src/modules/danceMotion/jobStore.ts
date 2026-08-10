import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DanceMotionJob,
  DanceMotionJobArtifact,
  DanceMotionJobStatus
} from "@faceless/shared";
import { env } from "../../config/env.js";

const JOB_METADATA_FILE = "job.json";

function jobDirectory(jobId: string): string {
  return path.join(env.danceMotionStorageDir, jobId);
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(extension) ? extension : ".bin";
}

function artifactUrl(jobId: string, kind: DanceMotionJobArtifact["kind"]): string {
  return `/api/dance-motion/jobs/${jobId}/artifacts/${kind}`;
}

async function writeJob(job: DanceMotionJob): Promise<void> {
  const directory = jobDirectory(job.id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, JOB_METADATA_FILE), JSON.stringify(job, null, 2), "utf8");
}

async function readJob(jobId: string): Promise<DanceMotionJob | null> {
  try {
    const contents = await fs.readFile(path.join(jobDirectory(jobId), JOB_METADATA_FILE), "utf8");
    return JSON.parse(contents) as DanceMotionJob;
  } catch (error: unknown) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function createDanceMotionJob(params: {
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceBuffer: Buffer;
}): Promise<DanceMotionJob> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const job: DanceMotionJob = {
    id,
    status: "uploaded",
    originalFileName: params.originalFileName,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    createdAt: now,
    updatedAt: now,
    progress: 0,
    stage: "Video uploaded; ready for pose extraction.",
    artifacts: [{
      kind: "source-video",
      url: artifactUrl(id, "source-video"),
      fileName: `source${safeExtension(params.originalFileName)}`,
      contentType: params.mimeType,
      sizeBytes: params.sourceBuffer.byteLength
    }]
  };
  const directory = jobDirectory(id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, job.artifacts[0].fileName), params.sourceBuffer);
  await writeJob(job);
  return job;
}

export async function getDanceMotionJob(jobId: string): Promise<DanceMotionJob | null> {
  return readJob(jobId);
}

export async function updateDanceMotionJob(
  jobId: string,
  update: { status?: DanceMotionJobStatus; progress?: number; stage?: string; error?: string }
): Promise<DanceMotionJob | null> {
  const job = await readJob(jobId);
  if (!job) return null;
  job.status = update.status ?? job.status;
  job.progress = Math.max(0, Math.min(100, update.progress ?? job.progress));
  job.stage = update.stage ?? job.stage;
  if (update.error) job.error = update.error;
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

export async function saveDanceMotionResult(params: {
  jobId: string;
  rawPoseJson: string;
  filteredPoseJson: string;
  depthResolvedPoseJson?: string;
  canonicalMotionJson: string;
  diagnosticsJson: string;
  wireframeVideo?: { buffer: Buffer; contentType: string };
}): Promise<DanceMotionJob | null> {
  const job = await readJob(params.jobId);
  if (!job) return null;
  const directory = jobDirectory(job.id);
  const files: Array<{ kind: DanceMotionJobArtifact["kind"], fileName: string, contentType: string, data: string | Buffer }> = [
    { kind: "raw-pose", fileName: "raw-pose.json", contentType: "application/json", data: params.rawPoseJson },
    { kind: "filtered-pose", fileName: "filtered-pose.json", contentType: "application/json", data: params.filteredPoseJson },
    ...(params.depthResolvedPoseJson ? [{ kind: "depth-resolved-pose" as const, fileName: "depth-resolved-pose.json", contentType: "application/json", data: params.depthResolvedPoseJson }] : []),
    { kind: "canonical-motion", fileName: "canonical-motion.json", contentType: "application/json", data: params.canonicalMotionJson },
    { kind: "diagnostics", fileName: "diagnostics.json", contentType: "application/json", data: params.diagnosticsJson }
  ];
  if (params.wireframeVideo) {
    files.push({
      kind: "wireframe-video",
      fileName: "wireframe-review.webm",
      contentType: params.wireframeVideo.contentType || "video/webm",
      data: params.wireframeVideo.buffer
    });
  }
  const artifacts: DanceMotionJobArtifact[] = [];
  for (const file of files) {
    await fs.writeFile(path.join(directory, file.fileName), file.data);
    artifacts.push({
      kind: file.kind,
      url: artifactUrl(job.id, file.kind),
      fileName: file.fileName,
      contentType: file.contentType,
      sizeBytes: Buffer.byteLength(file.data)
    });
  }
  job.artifacts = [...job.artifacts.filter((artifact) => !files.some((file) => file.kind === artifact.kind)), ...artifacts];
  job.status = "completed";
  job.progress = 100;
  job.stage = "Pose data and wireframe review are ready.";
  job.error = undefined;
  job.updatedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

export async function getDanceMotionArtifactPath(jobId: string, kind: DanceMotionJobArtifact["kind"]): Promise<{ path: string; artifact: DanceMotionJobArtifact } | null> {
  const job = await readJob(jobId);
  const artifact = job?.artifacts.find((candidate) => candidate.kind === kind);
  if (!job || !artifact) return null;
  const filePath = path.join(jobDirectory(jobId), artifact.fileName);
  try {
    await fs.access(filePath);
    return { path: filePath, artifact };
  } catch {
    return null;
  }
}
