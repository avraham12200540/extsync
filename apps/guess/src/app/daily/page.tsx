"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, createOrResumeDailyGame } from "@/lib/guess-client";
import { useTranslation } from "@/lib/use-translation";

type ErrorKind = "offline" | "rateLimited" | "insufficientContent" | "generic";

function classifyError(err: unknown): ErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 429) return "rateLimited";
    if (err.status === 503) return "insufficientContent";
    return "generic";
  }
  if (err instanceof TypeError) return "offline";
  return "generic";
}

function errorKeyFor(kind: ErrorKind): string {
  switch (kind) {
    case "offline":
      return "state.offline";
    case "rateLimited":
      return "state.rateLimited";
    case "insufficientContent":
      return "state.insufficientContent";
    default:
      return "state.genericError";
  }
}

/** Direct-link entry point for the daily challenge: creates/resumes today's game and hands off to the round UI. */
export default function DailyEntryPage() {
  const t = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<ErrorKind | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const game = await createOrResumeDailyGame();
        if (!cancelled) router.replace(`/game/${game.gameId}`);
      } catch (err) {
        if (!cancelled) setError(classifyError(err));
      }
    }
    void start();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <p role="alert" className="text-sm text-ink-muted">
            {t(errorKeyFor(error))}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            {t("state.retry")}
          </button>
        </>
      ) : (
        <p className="text-sm text-ink-muted">{t("state.loading")}</p>
      )}
    </main>
  );
}
