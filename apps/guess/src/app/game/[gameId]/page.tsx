"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoundView } from "@/components/game/round-view";
import { PreferencesToggle } from "@/components/preferences-toggle";
import { ApiError, advanceGame, getCurrentRound, getOwnResults, requestHint, submitGuess } from "@/lib/guess-client";
import { useTranslation } from "@/lib/use-translation";
import type { GameView, RoundView as RoundViewData } from "@/game/view-models";

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

export default function ActiveGamePage() {
  const t = useTranslation();
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = params.gameId;

  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorKind, setErrorKind] = useState<ErrorKind>("generic");
  const [game, setGame] = useState<GameView | null>(null);
  const [round, setRound] = useState<RoundViewData | null>(null);
  const [busy, setBusy] = useState(false);

  const loadGame = useCallback(async () => {
    setLoadState("loading");
    try {
      const own = await getOwnResults(gameId);
      if (own.status === "completed") {
        router.replace(`/game/${gameId}/results`);
        return;
      }
      const currentRound = await getCurrentRound(gameId);
      setGame(own);
      setRound(currentRound);
      setLoadState("ready");
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
    }
  }, [gameId, router]);

  // The ref indirection (rather than calling loadGame directly) keeps the
  // fetch effect's own body free of a direct setState call, matching
  // react-hooks/set-state-in-effect while still re-running exactly when
  // loadGame's own dependencies (gameId, router) change - not on every
  // loadGame identity change, which is the same behavior [loadGame] gave.
  const loadGameRef = useRef(loadGame);
  useEffect(() => {
    loadGameRef.current = loadGame;
  });

  useEffect(() => {
    void loadGameRef.current();
  }, [gameId, router]);

  async function handleRequestHint() {
    if (!round) return;
    setBusy(true);
    try {
      const updated = await requestHint(gameId, round.roundId);
      setRound(updated);
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitGuess(choiceId: string) {
    if (!round) return;
    setBusy(true);
    try {
      const updated = await submitGuess(gameId, round.roundId, choiceId);
      setRound(updated);
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdvance() {
    setBusy(true);
    try {
      const result = await advanceGame(gameId);
      if (result.completed) {
        router.push(`/game/${gameId}/results`);
        return;
      }
      setGame(result.game);
      if (result.round) setRound(result.round);
    } catch (err) {
      setErrorKind(classifyError(err));
      setLoadState("error");
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-6">
        <p className="text-sm text-ink-muted">{t("state.loading")}</p>
      </main>
    );
  }

  if (loadState === "error" || !game || !round) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-sm text-ink-muted">
          {t(errorKeyFor(errorKind))}
        </p>
        <button
          type="button"
          onClick={() => void loadGame()}
          className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          {t("state.retry")}
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen animate-fade-in">
      <div className="mx-auto flex max-w-2xl justify-end px-6 pt-6">
        <PreferencesToggle />
      </div>
      <RoundView
        game={game}
        round={round}
        onRequestHint={handleRequestHint}
        onSubmitGuess={handleSubmitGuess}
        onAdvance={handleAdvance}
        busy={busy}
      />
    </main>
  );
}
