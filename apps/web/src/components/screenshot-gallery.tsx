"use client";

import { useCallback, useEffect, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/** A horizontal thumbnail strip + a full-screen lightbox (keyboard + arrows).
 *  Client island so it works under the strict nonce-CSP. Images are served from
 *  the files domain (same origin policy as the icon, already CSP-allowed). */
export function ScreenshotGallery({ images, alt }: { images: string[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = images.length;

  const close = useCallback(() => setOpen(null), []);
  const go = useCallback(
    (dir: number) => setOpen((i) => (i === null ? i : (i + dir + count) % count)),
    [count],
  );

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock scroll behind the lightbox
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close, go]);

  if (count === 0) return null;

  return (
    <>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {images.map((src, i) => (
          <button
            key={src}
            onClick={() => setOpen(i)}
            aria-label={`${alt} ${i + 1}`}
            className="group relative aspect-video h-40 shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-surface-2 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </button>
        ))}
      </div>

      {open !== null && (
        <div
          onClick={close}
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
        >
          <button
            onClick={close}
            aria-label="Close"
            className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>

          {count > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); go(-1); }}
                aria-label="Previous"
                className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
              >
                <ChevronLeft className="h-6 w-6 rtl:rotate-180" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); go(1); }}
                aria-label="Next"
                className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/25"
              >
                <ChevronRight className="h-6 w-6 rtl:rotate-180" />
              </button>
            </>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={images[open]}
            alt=""
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
          />

          {count > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm tabular-nums text-white">
              {open + 1} / {count}
            </div>
          )}
        </div>
      )}
    </>
  );
}
