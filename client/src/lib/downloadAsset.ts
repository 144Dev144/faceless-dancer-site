function safeFileName(fileName: string, fallback: string): string {
  const normalized = fileName.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return normalized || fallback;
}

export async function downloadAsset(url: string, fileName: string, fallbackUrl?: string): Promise<void> {
  const candidates = [url, fallbackUrl].filter((candidate, index, values): candidate is string => Boolean(candidate) && values.indexOf(candidate) === index);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { credentials: "include" });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = safeFileName(fileName, "download");
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("The file could not be downloaded.");
}
