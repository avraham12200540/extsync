"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/components/providers";

function Star({ fill }: { fill: number }) {
  // fill: 0..1 (supports half stars for averages)
  const id = `g${Math.round(fill * 100)}`;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id={id}>
          <stop offset={`${fill * 100}%`} stopColor="#f59e0b" />
          <stop offset={`${fill * 100}%`} stopColor="rgb(var(--line))" />
        </linearGradient>
      </defs>
      <path
        fill={fill >= 1 ? "#f59e0b" : fill <= 0 ? "rgb(var(--line))" : `url(#${id})`}
        d="M12 2.5l2.95 6.2 6.8.86-5 4.73 1.3 6.71L12 17.77 5.95 21l1.3-6.71-5-4.73 6.8-.86z"
      />
    </svg>
  );
}

/** Read-only average display: ★★★★☆ 4.3 (12) */
export function RatingDisplay({ avg, count, className = "" }: { avg: number; count: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} dir="ltr" title={`${avg} מתוך 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} fill={Math.min(1, Math.max(0, avg - (i - 1)))} />
      ))}
      <span className="ms-1 text-xs text-ink-muted">
        {count > 0 ? `${avg.toFixed(1)} (${count})` : "אין דירוגים"}
      </span>
    </span>
  );
}

/** Interactive 1-5 rating. Signed-in users only; clicking again changes the vote. */
export function RateWidget({
  slug, myRating, onRated,
}: { slug: string; myRating: number | null; onRated?: (stars: number) => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const [hover, setHover] = useState(0);
  const [mine, setMine] = useState(myRating ?? 0);
  const [busy, setBusy] = useState(false);

  const rate = async (stars: number) => {
    if (!user) { router.push("/login"); return; }
    if (busy) return;
    setBusy(true);
    try {
      await api.put(`/catalog/${slug}/rating`, { stars });
      setMine(stars);
      onRated?.(stars);
    } finally { setBusy(false); }
  };

  const active = hover || mine;
  return (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex" dir="ltr" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            disabled={busy}
            onMouseEnter={() => setHover(i)}
            onClick={() => rate(i)}
            className="p-0.5 transition-transform hover:scale-125"
            aria-label={`דרג ${i} כוכבים`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24">
              <path
                fill={i <= active ? "#f59e0b" : "rgb(var(--line))"}
                d="M12 2.5l2.95 6.2 6.8.86-5 4.73 1.3 6.71L12 17.77 5.95 21l1.3-6.71-5-4.73 6.8-.86z"
              />
            </svg>
          </button>
        ))}
      </div>
      <span className="text-xs text-ink-muted">
        {user ? (mine ? "הדירוג שלך נשמר — אפשר לשנות" : "דרג את התוסף") : "התחבר כדי לדרג"}
      </span>
    </div>
  );
}
