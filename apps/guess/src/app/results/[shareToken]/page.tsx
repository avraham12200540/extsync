"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PreferencesToggle } from "@/components/preferences-toggle";
import { ResultsView } from "@/components/game/results-view";
import { ApiError, createFreeplayGame, getShareResults } from "@/lib/guess-client";
import type { ShareResultsView } from "@/game/view-models";
import { useTranslation } from "@/lib/use-translation";

type LoadState = "loading" | "ready" | "error" | "notFound";
type ErrorKind = "offline" | "rateLimited" | "generic";

function classifyError(err: unknown): "offline" | "rateLimited" | "generic" | "notFound" {
  if (err instanceof ApiError) {
    if (err.status === 404) return "notFound";
    if (err.status === 429) return "rateLimited";
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
    default:
      return "state.genericError";
  }
}

/** Public, unauthenticated, answer-free share view - no session/CSRF required by design (see share-results.ts). */
export default function PublicShareResultsPage() {
  const t = useTranslation();
  const router = useRouter();
  const params = useParams<{ shareToken: string }>();
  const shareToken = params.shareToken;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [results, setResults] = useState<ShareResultsView | null>(null);
  const [playBusy, setPlayBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const shared = await getShareResults(shareToken);
      setResults(shared);
      setLoadState("ready");
    } catch (err) {
      const kind = classifyError(err);
      if (kind === "notFound") {
        setLoadState("notFound");
      } else {
        setErrorKind(kind);
        setLoadState("error");
      }
    }
  }, [shareToken]);

  // The ref indirection (rather than calling load directly) keeps the fetch
  // effect's own body free of a direct setState call, matching
  // react-hooks/set-state-in-effect while still re-running exactly when
  // load's own dependency (shareToken) changes - the same behavior [load]
  // gave.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    void loadRef.current();
  }, [shareToken]);

  async function handlePlay() {
    setPlayBusy(true);
    try {
      const game = await createFreeplayGame();
      router.push(`/game/${game.gameId}`);
    } catch (err) {
      const kind = classifyError(err);
      setErrorKind(kind === "notFound" ? "generic" : kind);
      setLoadState("error");
      setPlayBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-ink-muted">{t("state.loading")}</p>
      </main>
    );
  }

  if (loadState === "notFound") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold text-ink">{t("state.notFoundTitle")}</h1>
        <p className="text-sm text-ink-muted">{t("state.notFoundBody")}</p>
        <Link
          href="/"
          className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          {t("state.backHome")}
        </Link>
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

  const currentUrl = typeof window !== "undefined" ? window.location.href : null;

  return (
    <>
      <div className="mx-auto flex max-w-2xl justify-end px-6 pt-6">
        <PreferencesToggle />
      </div>
      <ResultsView
        mode={results.mode}
        totalScore={results.totalScore}
        totalRounds={results.totalRounds}
        shareUrl={currentUrl}
        onPlayAgain={() => void handlePlay()}
        playAgainBusy={playBusy}
        playAgainLabelKey="home.startFreeplay"
      />
    </>
  );
}
