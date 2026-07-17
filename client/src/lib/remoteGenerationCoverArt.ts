const configuredBase = (import.meta.env.VITE_GENERATION_COVER_CDN_BASE_URL as string | undefined)?.trim();
const fallbackBase = "https://faceless-dancer.b-cdn.net/static/generation-covers";
const coverBase = (configuredBase || fallbackBase).replace(/\/+$/, "");

const fallbackCovers = [1, 2, 3].map((number) => `${coverBase}/remote-generation-${number}.webp`);

export function fallbackGenerationCoverUrl(jobId: string): string {
  let hash = 0;
  for (const character of jobId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return fallbackCovers[hash % fallbackCovers.length];
}
