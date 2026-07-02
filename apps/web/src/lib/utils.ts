import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Serialize an object for embedding inside a <script> tag. JSON.stringify does
 *  NOT escape "</script>", so developer-controlled fields (extension name,
 *  description) could break out of a JSON-LD block and inject markup. Escaping
 *  every "<" to "\\u003c" keeps the JSON valid while making "</script>"
 *  breakout impossible. */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Return `url` only if it is an http(s) link, else undefined. Developer-controlled
 *  fields (website, repo, privacy-policy) render into <a href>; this blocks a
 *  javascript:/data:/custom scheme from becoming a clickable link (phishing / XSS). */
export function safeHref(url?: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url.trim()) ? url : undefined;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
