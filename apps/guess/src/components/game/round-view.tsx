"use client";

import { useEffect, useRef, useState } from "react";
import type { GameView, RoundView as RoundViewData } from "@/game/view-models";
import { useTranslation } from "@/lib/use-translation";

export interface RoundViewProps {
  game: GameView;
  round: RoundViewData;
  onRequestHint: () => Promise<void>;
  onSubmitGuess: (choiceId: string) => Promise<void>;
  onAdvance: () => Promise<void>;
  busy: boolean;
}

/**
 * Pure presentation of one round: the forum post(s) dominate the screen,
 * chrome stays quiet. The client never computes score or correctness -
 * every value rendered here comes straight from the server's RoundView/
 * GameView (see src/game/view-models.ts's anti-leak contract).
 */
export function RoundView({ game, round, onRequestHint, onSubmitGuess, onAdvance, busy }: RoundViewProps) {
  const t = useTranslation();
  const resolved = round.status !== "active";
  const isLastRound = round.orderInGame >= game.totalRounds;
  const [pendingChoiceId, setPendingChoiceId] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const feedbackRef = useRef<HTMLDivElement | null>(null);
  const previousStatusRef = useRef(round.status);
  const previousHintCountRef = useRef(round.hintsRevealedCount);
  const previousRoundIdRef = useRef(round.roundId);

  useEffect(() => {
    if (previousStatusRef.current === "active" && resolved) {
      setLiveMessage(t("game.liveRegionRoundResolved"));
      feedbackRef.current?.focus();
    }
    previousStatusRef.current = round.status;
  }, [round.status, resolved, t]);

  useEffect(() => {
    if (round.hintsRevealedCount > previousHintCountRef.current) {
      setLiveMessage(t("game.liveRegionHintRevealed"));
    }
    previousHintCountRef.current = round.hintsRevealedCount;
  }, [round.hintsRevealedCount, t]);

  useEffect(() => {
    if (previousRoundIdRef.current !== round.roundId) {
      setLiveMessage(t("game.liveRegionNewRound"));
      previousRoundIdRef.current = round.roundId;
    }
  }, [round.roundId, t]);

  async function handleChoiceClick(choiceId: string) {
    if (busy || resolved) return;
    setPendingChoiceId(choiceId);
    try {
      await onSubmitGuess(choiceId);
    } finally {
      setPendingChoiceId(null);
    }
  }

  const canRequestHint = !resolved && round.hintsRevealedCount < round.maxHints;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <div aria-live="polite" className="sr-only-live">
        {liveMessage}
      </div>

      <header className="flex items-baseline justify-between text-sm text-ink-muted">
        <span>{t("game.roundProgress", { current: round.orderInGame, total: game.totalRounds })}</span>
        <span>
          {t("game.score")}: <span className="font-medium text-ink">{game.totalScore}</span>
        </span>
      </header>

      <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("game.headline")}</h1>

      <div className="flex flex-col gap-5">
        {round.revealedPosts.map((post) => (
          <article
            key={post.displayOrder}
            className="border-s-2 border-line py-1 ps-5"
            aria-label={t("game.postLabel", { index: post.displayOrder })}
          >
            <p dir="auto" className="whitespace-pre-wrap text-lg leading-relaxed text-ink">
              {post.cleanText}
            </p>
          </article>
        ))}
      </div>

      {!resolved && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={onRequestHint}
            disabled={busy || !canRequestHint}
            className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
          >
            {canRequestHint ? t("game.hintAction") : t("game.hintExhausted")}
          </button>
          <span className="text-xs text-ink-muted">{t("game.availableScore", { score: round.currentAvailableScore })}</span>
        </div>
      )}

      <div role="group" aria-label={t("game.headline")} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {round.choices.map((choice) => {
          const isCorrectChoice = resolved && round.correctChoiceId === choice.choiceId;
          const isPending = pendingChoiceId === choice.choiceId && busy;
          return (
            <button
              key={choice.choiceId}
              type="button"
              onClick={() => handleChoiceClick(choice.choiceId)}
              disabled={busy || resolved}
              aria-label={t("game.choiceLabel", { username: choice.username })}
              aria-pressed={isCorrectChoice}
              className={`rounded border px-4 py-3 text-start text-base transition-colors disabled:cursor-not-allowed ${
                isCorrectChoice
                  ? "border-accent bg-accent/10 font-medium text-ink"
                  : "border-line text-ink hover:border-ink disabled:opacity-60"
              }`}
            >
              <span dir="auto" className="block truncate">
                {isCorrectChoice ? "✓ " : ""}
                {choice.username}
              </span>
              {isPending && <span className="text-xs text-ink-muted">{t("game.submitting")}</span>}
            </button>
          );
        })}
      </div>

      {round.wrongGuessCount > 0 && !resolved && (
        <p className="text-sm text-ink-muted">{t("game.wrongTryAgain")}</p>
      )}

      {resolved && (
        <div ref={feedbackRef} tabIndex={-1} className="flex flex-col gap-3 border-t border-line pt-6 outline-none">
          <p className="text-lg font-medium text-ink">
            {round.status === "resolved_correct" ? t("game.correctFeedback") : t("game.incorrectFeedback")}
            {round.scoreAwarded !== null && round.scoreAwarded > 0 ? ` (+${round.scoreAwarded})` : ""}
          </p>
          {round.status !== "resolved_correct" && round.correctUsername && (
            <p dir="auto" className="text-sm text-ink-muted">
              {t("game.correctAnswerReveal", { username: round.correctUsername })}
            </p>
          )}
          <button
            type="button"
            onClick={onAdvance}
            disabled={busy}
            className="mt-2 w-fit rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isLastRound ? t("game.finishGame") : t("game.nextRound")}
          </button>
        </div>
      )}
    </div>
  );
}
