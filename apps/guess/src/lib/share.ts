"use client";

export type ShareOutcome = "shared" | "copied" | "manual";

/**
 * Tries the Web Share API, falls back to clipboard, falls back to letting
 * the caller render the text for manual copy. Callers must only ever pass
 * answer-free text (score/progress, never usernames or choices).
 */
export async function shareOrCopy(text: string, url?: string): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(url ? { text, url } : { text });
      return "shared";
    } catch {
      // User cancelled, or the platform rejected the share - fall through to clipboard.
    }
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
      return "copied";
    } catch {
      // Clipboard permission denied - fall through to manual copy.
    }
  }
  return "manual";
}
