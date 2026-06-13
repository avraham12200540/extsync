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
