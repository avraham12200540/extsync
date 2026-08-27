"use client";

import { useState } from "react";
import Link from "next/link";
import type { GameView } from "@/game/view-models";
import { shareOrCopy } from "@/lib/share";
import { useTranslation } from "@/lib/use-translation";

export interface ResultsViewProps {
  mode: GameView["mode"];
  totalScore: number;
  totalRounds: number;
  /** Absolute or app-relative URL for the answer-free share link, when one exists. */
  shareUrl: string | null;
  onPlayAgain: () => void;
  playAgainBusy: boolean;
  playAgainLabelKey?: string;
}

/**
 * Shared by both the owning-session results page and the public
 * /results/:shareToken page. Only ever renders server-returned score /
 * round-count / mode - never a username, choice, or answer.
 */
export function ResultsView({
  mode,
  totalScore,
  totalRounds,
  shareUrl,
  onPlayAgain,
  playAgainBusy,
  playAgainLabelKey = "results.playAgain",
}: ResultsViewProps) {
  const t = useTranslation();
  const [shareStatus, setShareStatus] = useState<"idle" | "copied" | "manual">("idle");
  const shareText = t("results.shareText", { score: totalScore, rounds: totalRounds });

  async function handleShare() {
    const outcome = await shareOrCopy(shareText, shareUrl ?? undefined);
    setShareStatus(outcome === "copied" ? "copied" : outcome === "manual" ? "manual" : "idle");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl animate-fade-up flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <p className="text-sm text-ink-muted">{mode === "daily" ? t("results.dailyMode") : t("results.freeplayMode")}</p>
      <h1 className="text-3xl font-semibold tracking-tight text-ink">{t("results.title")}</h1>
      <p className="text-xl text-ink">{t("results.finalScore", { score: totalScore })}</p>

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => void handleShare()}
          className="rounded border border-ink bg-ink px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          {t("results.shareButton")}
        </button>
        <p role="status" className="min-h-[1em] max-w-sm text-xs text-ink-muted">
          {shareStatus === "copied" && t("results.shareCopied")}
          {shareStatus === "manual" && t("results.shareUnavailable", { text: shareUrl ? `${shareText} ${shareUrl}` : shareText })}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 pt-4">
        <button
          type="button"
          onClick={onPlayAgain}
          disabled={playAgainBusy}
          className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
        >
          {playAgainBusy ? t("state.loading") : t(playAgainLabelKey)}
        </button>
        <Link href="/" className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink">
          {t("results.backHome")}
        </Link>
      </div>
    </main>
  );
}
