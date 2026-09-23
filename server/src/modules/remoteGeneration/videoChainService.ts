import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { env } from "../../config/env.js";
import { buildObjectPath, buildBunnyPublicUrl, downloadFromBunny, uploadBufferToBunny, uploadTextToBunny } from "../storage/bunnyStorage.js";

const execFileAsync = promisify(execFile);

export interface VideoChainParent {
  sourceType: "job" | "chain";
  sourceJobId?: string;
  sourceChainId?: string;
  sourceArtifactObjectPath: string;
  sourceArtifactId?: string;
  sourceUrl?: string;
  frameIndex: number;
  timeSeconds: number;
  frameRate: number;
}

export interface VideoChainAppend {
  jobId: string;
  artifactObjectPath: string;
  artifactId?: string;
  conditioningPrefixFrames?: number;
}

interface VideoChainSegment {
  sourceType: "job" | "chain";
  sourceJobId?: string;
  sourceChainId?: string;
  objectPath: string;
  startSeconds: number;
  endSeconds?: number;
  frameRate: number;
}

async function runFfmpeg(args: string[]): Promise<void> {
  await execFileAsync(env.danceMotionFfmpegPath, args, {
    timeout: env.danceMotionConversionTimeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function probe(args: string[]): Promise<string> {
  const result = await execFileAsync("ffprobe", ["-v", "error", ...args], {
    timeout: env.danceMotionConversionTimeoutMs,
    maxBuffer: 256 * 1024,
  });
  return result.stdout.trim();
}

async function probeDimensions(filePath: string): Promise<{ width: number; height: number }> {
  const value = await probe(["-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", filePath]);
  const [width, height] = value.split("x").map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error("Could not determine the source video dimensions.");
  }
  return { width, height };
}

async function probeDuration(filePath: string): Promise<number> {
  const value = Number(await probe(["-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]));
  if (!Number.isFinite(value) || value <= 0) throw new Error("Could not determine the source video duration.");
  return value;
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  const value = await probe(["-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", filePath]);
  return value.length > 0;
}

async function probeFrameCount(filePath: string): Promise<number> {
  const value = Number(await probe([
    "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=nb_read_frames",
    "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ]));
  if (!Number.isInteger(value) || value <= 0) throw new Error("Could not determine the source video frame count.");
  return value;
}

export async function createVideoChain(input: {
  userId: string;
  title: string;
  frameRate: number;
  parent: VideoChainParent;
  append: VideoChainAppend;
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "faceless-video-chain-"));
  const chainId = crypto.randomUUID();
  const parentInputPath = path.join(tempDir, "parent-source");
  const appendInputPath = path.join(tempDir, "append-source");
  const parentSegmentPath = path.join(tempDir, "parent-segment.mp4");
  const appendSegmentPath = path.join(tempDir, "append-segment.mp4");
  const outputPath = path.join(tempDir, "video-chain.mp4");

  try {
    const [parentSource, appendSource] = await Promise.all([
      downloadFromBunny(input.parent.sourceArtifactObjectPath),
      downloadFromBunny(input.append.artifactObjectPath),
    ]);
    await Promise.all([
      fs.writeFile(parentInputPath, parentSource.buffer),
      fs.writeFile(appendInputPath, appendSource.buffer),
    ]);

    const dimensions = await probeDimensions(parentInputPath);
    const [parentDuration, appendDuration, parentFrameCount, appendFrameCount, parentHasAudio, appendHasAudio] = await Promise.all([
      probeDuration(parentInputPath),
      probeDuration(appendInputPath),
      probeFrameCount(parentInputPath),
      probeFrameCount(appendInputPath),
      probeHasAudio(parentInputPath),
      probeHasAudio(appendInputPath),
    ]);
    const parentKeepFrames = Math.min(parentFrameCount, input.parent.frameIndex + 1);
    const parentTrimDuration = parentKeepFrames / input.frameRate;
    // LTX uses the temporal prefix as model conditioning. It does not return
    // those source frames as a literal prefix in the child artifact, so the
    // child must always be assembled from frame zero. The parent is already
    // bounded to the selected frame above.
    const appendedTailFrames = appendFrameCount;
    const preserveAudio = parentHasAudio && appendHasAudio;
    const normalizeFilter = `fps=${input.frameRate},scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;

    const encodeSegment = async (
      sourcePath: string,
      destinationPath: string,
      options: { startFrame: number; endFrame?: number; audioStartSeconds?: number; audioDurationSeconds?: number },
      withAudio = false,
    ) => {
      const args = ["-y", "-i", sourcePath];
      const selector = typeof options.endFrame === "number"
        ? `select=between(n\\,${options.startFrame}\\,${options.endFrame})`
        : `select=gte(n\\,${options.startFrame})`;
      args.push("-map", "0:v:0", "-vf", `${selector},setpts=N/${input.frameRate}/TB,${normalizeFilter}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-fps_mode", "cfr");
      if (withAudio) {
        args.push("-map", "0:a:0", "-c:a", "aac", "-ar", "48000", "-ac", "2");
        const audioFilters = [];
        if (options.audioStartSeconds && options.audioStartSeconds > 0) audioFilters.push(`atrim=start=${options.audioStartSeconds.toFixed(6)}`);
        if (options.audioDurationSeconds && options.audioDurationSeconds > 0) audioFilters.push(`atrim=duration=${options.audioDurationSeconds.toFixed(6)}`);
        if (audioFilters.length) args.push("-af", `${audioFilters.join(",")},asetpts=PTS-STARTPTS`);
      }
      else args.push("-an");
      args.push("-movflags", "+faststart", destinationPath);
      await runFfmpeg(args);
    };

    await encodeSegment(parentInputPath, parentSegmentPath, {
      startFrame: 0,
      endFrame: parentKeepFrames - 1,
      audioDurationSeconds: parentTrimDuration,
    }, preserveAudio);
    await encodeSegment(appendInputPath, appendSegmentPath, {
      startFrame: 0,
      audioStartSeconds: 0,
      audioDurationSeconds: appendedTailFrames / input.frameRate,
    }, preserveAudio);
    const [encodedParentFrames, encodedAppendFrames] = await Promise.all([
      probeFrameCount(parentSegmentPath),
      probeFrameCount(appendSegmentPath),
    ]);
    if (encodedParentFrames !== parentKeepFrames || encodedAppendFrames !== appendedTailFrames) {
      throw new Error(
        `Video chain frame invariant failed: parent ${encodedParentFrames}/${parentKeepFrames}, `
        + `append ${encodedAppendFrames}/${appendedTailFrames}.`,
      );
    }
    const concatArgs = ["-y", "-i", parentSegmentPath, "-i", appendSegmentPath];
    if (preserveAudio) {
      concatArgs.push(
        "-filter_complex", "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]",
        "-map", "[v]", "-map", "[a]",
      );
    } else {
      concatArgs.push(
        "-filter_complex", "[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]",
        "-map", "[v]",
      );
    }
    concatArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(input.frameRate));
    if (preserveAudio) concatArgs.push("-c:a", "aac", "-ar", "48000", "-ac", "2");
    concatArgs.push("-movflags", "+faststart", outputPath);
    await runFfmpeg(concatArgs);

    const chainDuration = await probeDuration(outputPath);
    const chainFrameCount = await probeFrameCount(outputPath);
    const expectedChainFrames = parentKeepFrames + appendedTailFrames;
    if (chainFrameCount !== expectedChainFrames) {
      throw new Error(`Video chain frame invariant failed: output ${chainFrameCount}/${expectedChainFrames}.`);
    }
    const outputBuffer = await fs.readFile(outputPath);
    const outputStats = await fs.stat(outputPath);
    const objectPath = buildObjectPath(["remote-generation", "chains", input.userId, chainId, "video-chain.mp4"]);
    const manifestObjectPath = buildObjectPath(["remote-generation", "chains", input.userId, chainId, "manifest.json"]);
    const segments: VideoChainSegment[] = [
      {
        sourceType: input.parent.sourceType,
        sourceJobId: input.parent.sourceJobId,
        sourceChainId: input.parent.sourceChainId,
        objectPath: input.parent.sourceArtifactObjectPath,
        startSeconds: 0,
        endSeconds: parentTrimDuration,
        frameRate: input.frameRate,
      },
      {
        sourceType: "job",
        sourceJobId: input.append.jobId,
        objectPath: input.append.artifactObjectPath,
        startSeconds: 0,
        endSeconds: appendDuration,
        frameRate: input.frameRate,
      },
    ];
    const manifest = {
      schemaVersion: 1,
      chainId,
      title: input.title,
      frameRate: input.frameRate,
      durationSeconds: chainDuration,
      audioPreserved: preserveAudio,
      overlapFrames: 0,
      outputIncludesPrefix: false,
      conditioningPrefixFrames: input.append.conditioningPrefixFrames ?? 0,
      parentFrameCount: parentKeepFrames,
      appendFrameCount,
      appendedTailFrames,
      parentFrame: input.parent,
      append: input.append,
      segments,
      createdAt: new Date().toISOString(),
    };
    const digest = crypto.createHash("sha256").update(outputBuffer).digest("hex");
    await uploadBufferToBunny({ buffer: outputBuffer, objectPath, contentType: "video/mp4" });
    await uploadTextToBunny({ text: JSON.stringify(manifest, null, 2), objectPath: manifestObjectPath, contentType: "application/json" });

    return {
      chainId,
      title: input.title,
      objectPath,
      publicUrl: buildBunnyPublicUrl(objectPath),
      proxyUrl: `/api/remote-generation/assets/file?path=${encodeURIComponent(objectPath)}`,
      manifestObjectPath,
      manifestPublicUrl: buildBunnyPublicUrl(manifestObjectPath),
      mimeType: "video/mp4",
      sizeBytes: outputStats.size,
      sha256: digest,
      durationSeconds: chainDuration,
      frameRate: input.frameRate,
      audioPreserved: preserveAudio,
      segments,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
