import path from "node:path";

export interface SfzRegionDefinition {
  sample: string;
  fileName: string;
  low: number;
  high: number;
  root: number;
  volume?: number;
  tune?: number;
  loopStart?: number;
  loopEnd?: number;
}

export interface SfzInstrumentDefinition {
  format: "sfz";
  sourceName: string;
  regions: SfzRegionDefinition[];
  warnings: string[];
}

const supportedOpcodes = new Set([
  "sample",
  "key",
  "pitch_keycenter",
  "lokey",
  "hikey",
  "lovel",
  "hivel",
  "volume",
  "tune",
  "loop_start",
  "loop_end",
  "loop_mode",
  "ampeg_release",
]);

function numberOpcode(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSampleReference(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function safeSampleReference(value: string): string {
  const normalized = normalizeSampleReference(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("..")) {
    throw new Error(`SFZ sample path is not allowed: ${value}`);
  }
  if (/^(?:https?|file|ftp):/i.test(normalized)) {
    throw new Error(`SFZ sample URL is not allowed: ${value}`);
  }
  return normalized;
}

function parseSfzText(text: string): { regions: Array<Record<string, string>>; warnings: string[] } {
  if (text.includes("\u0000")) throw new Error("SFZ contains invalid binary data");
  if (/#(?:include|define|set|if|else)\b/i.test(text)) {
    throw new Error("SFZ preprocessor directives are not supported; upload a self-contained SFZ file");
  }

  const regions: Array<Record<string, string>> = [];
  let scope: "global" | "group" | "region" = "global";
  let global: Record<string, string> = {};
  let group: Record<string, string> = {};
  let current: Record<string, string> | null = null;
  const warnings = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const tokens = line.match(/<[^>]+>|[^\s]+/g) ?? [];
    for (const token of tokens) {
      const header = token.match(/^<([^>]+)>$/);
      if (header) {
        const next = header[1].toLowerCase();
        if (next === "global") scope = "global";
        else if (next === "group") {
          scope = "group";
          group = {};
        } else if (next === "region") {
          scope = "region";
          current = { ...global, ...group };
          regions.push(current);
        } else {
          throw new Error(`SFZ section <${header[1]}> is not supported`);
        }
        continue;
      }
      const separator = token.indexOf("=");
      if (separator < 1) {
        warnings.add(`Ignored SFZ token ${token}`);
        continue;
      }
      const key = token.slice(0, separator).trim().toLowerCase();
      const value = token.slice(separator + 1).trim();
      if (!supportedOpcodes.has(key)) {
        warnings.add(`Ignored unsupported opcode ${key}`);
        continue;
      }
      if (scope === "global") global[key] = value;
      else if (scope === "group") group[key] = value;
      else if (current) current[key] = value;
    }
  }

  if (!regions.length) throw new Error("SFZ does not contain any <region> entries");
  return { regions, warnings: [...warnings] };
}

export function parseSfzInstrument(input: {
  buffer: Buffer;
  sourceName: string;
  sampleNames: string[];
}): SfzInstrumentDefinition {
  const parsed = parseSfzText(input.buffer.toString("utf8"));
  const rawRegions = parsed.regions;
  const sampleByReference = new Map<string, string>();
  const sampleByBaseName = new Map<string, string[]>();
  for (const sampleName of input.sampleNames) {
    const normalized = normalizeSampleReference(sampleName);
    sampleByReference.set(normalized.toLowerCase(), sampleName);
    const baseName = path.posix.basename(normalized).toLowerCase();
    const matches = sampleByBaseName.get(baseName) ?? [];
    matches.push(sampleName);
    sampleByBaseName.set(baseName, matches);
  }

  const warnings = new Set(parsed.warnings);
  const regions = rawRegions.map((raw, index) => {
    const reference = safeSampleReference(raw.sample ?? "");
    const exact = sampleByReference.get(reference.toLowerCase());
    const basenameMatches = sampleByBaseName.get(path.posix.basename(reference).toLowerCase()) ?? [];
    const fileName = exact ?? (basenameMatches.length === 1 ? basenameMatches[0] : "");
    if (!fileName) {
      if (basenameMatches.length > 1) throw new Error(`SFZ sample reference is ambiguous: ${reference}`);
      throw new Error(`Missing uploaded sample for SFZ region ${index + 1}: ${reference}`);
    }
    const key = numberOpcode(raw.key, 60);
    const low = Math.max(0, Math.min(127, numberOpcode(raw.lokey, key)));
    const high = Math.max(0, Math.min(127, numberOpcode(raw.hikey, key)));
    const root = Math.max(0, Math.min(127, numberOpcode(raw.pitch_keycenter, key)));
    if (high < low) throw new Error(`SFZ region ${index + 1} has an invalid key range`);
    if (raw.sample === undefined) throw new Error(`SFZ region ${index + 1} is missing a sample opcode`);
    return {
      sample: reference,
      fileName,
      low,
      high,
      root,
      ...(raw.volume !== undefined ? { volume: numberOpcode(raw.volume, 0) } : {}),
      ...(raw.tune !== undefined ? { tune: numberOpcode(raw.tune, 0) } : {}),
      ...(raw.loop_start !== undefined ? { loopStart: numberOpcode(raw.loop_start, 0) } : {}),
      ...(raw.loop_end !== undefined ? { loopEnd: numberOpcode(raw.loop_end, 0) } : {}),
    };
  });
  for (const warning of warnings) warnings.add(warning);
  return {
    format: "sfz",
    sourceName: input.sourceName,
    regions,
    warnings: [...warnings],
  };
}
