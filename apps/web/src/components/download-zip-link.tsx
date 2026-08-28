"use client";

import { api } from "@/lib/api";

/**
 * The store's manual "download ZIP" link.
 *
 * Renders a plain anchor so the browser starts the real download from the
 * artifact URL exactly as before, and reports the download to the API on the
 * side so the store can show a downloads count next to the installs count.
 *
 * Fire-and-forget by design: the report is not awaited and its failure is
 * swallowed, because a counter must never be able to break an actual download.
 */
export function DownloadZipLink({
  href,
  slug,
  className,
  children,
}: {
  href: string;
  slug: string;
  className?: string;
  children: React.ReactNode;
}) {
  const track = () => {
    void api.post(`/catalog/${encodeURIComponent(slug)}/download`).catch(() => {});
  };

  return (
    <a href={href} download onClick={track} className={className}>
      {children}
    </a>
  );
}
