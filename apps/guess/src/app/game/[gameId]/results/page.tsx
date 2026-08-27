"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PreferencesToggle } from "@/components/preferences-toggle";
import { ResultsView } from "@/components/game/results-view";
import { ApiError, createFreeplayGame, getOwnResults, type OwnResultsView } from "@/lib/guess-client";
import { useTranslation } from "@/lib/use-translation";

type LoadState = "loading" | "ready" | "error";
type ErrorKind = "offline" | "rateLimited" | "expired" | "generic";

function classifyError(err: unknown): ErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 429) return "rateLimited";
    if (err.status === 401 || err.status === 404) return "expired";
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
    case "expired":
      return "state.sessionExpiredRetrying";
    default:
      return "state.genericError";
  }
}

export default function OwnResultsPage() {
  const t = useTranslation();
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [results, setResults] = useState<OwnResultsView | null>(null);
  const [playAgainBusy, setPlayAgainBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const own = await getOwnResults(gameId);
      if (own.status !== "completed") {
        router.replace(`/game/${gameId}`);
        return;
      }
      setResults(own);
      setLoadState("ready");
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
    }
  }, [gameId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePlayAgain() {
    setPlayAgainBusy(true);
    try {
      const game = await createFreeplayGame();
      router.push(`/game/${game.gameId}`);
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
      setPlayAgainBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-ink-muted">{t("state.loading")}</p>
      </main>
    );
  }

  if (loadState === "error" || !results) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-sm text-ink-muted">
          {t(errorKeyFor(errorKind))}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          {t("state.retry")}
        </button>
      </main>
    );
  }

  const absoluteShareUrl =
    results.shareUrl && typeof window !== "undefined" ? `${window.location.origin}${results.shareUrl}` : results.shareUrl;

  return (
    <>
      <div className="mx-auto flex max-w-2xl justify-end px-6 pt-6">
        <PreferencesToggle />
      </div>
      <ResultsView
        mode={results.mode}
        totalScore={results.totalScore}
        totalRounds={results.totalRounds}
        shareUrl={absoluteShareUrl}
        onPlayAgain={() => void handlePlayAgain()}
        playAgainBusy={playAgainBusy}
      />
    </>
  );
}
