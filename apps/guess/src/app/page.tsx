"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PreferencesToggle } from "@/components/preferences-toggle";
import { ApiError, createFreeplayGame, createOrResumeDailyGame } from "@/lib/guess-client";
import { useTranslation } from "@/lib/use-translation";

type StartError = "offline" | "rateLimited" | "insufficientContent" | "generic" | null;

function errorKeyFor(error: StartError): string {
  switch (error) {
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

function classifyError(err: unknown): StartError {
  if (err instanceof ApiError) {
    if (err.status === 429) return "rateLimited";
    if (err.status === 503) return "insufficientContent";
    return "generic";
  }
  if (err instanceof TypeError) return "offline";
  return "generic";
}

export default function GuessHomePage() {
  const t = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState<"daily" | "freeplay" | null>(null);
  const [error, setError] = useState<StartError>(null);

  async function startFreeplay() {
    setPending("freeplay");
    setError(null);
    try {
      const game = await createFreeplayGame();
      router.push(`/game/${game.gameId}`);
    } catch (err) {
      setError(classifyError(err));
      setPending(null);
    }
  }

  async function startDaily() {
    setPending("daily");
    setError(null);
    try {
      const game = await createOrResumeDailyGame();
      router.push(`/game/${game.gameId}`);
    } catch (err) {
      setError(classifyError(err));
      setPending(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-sm text-ink-muted">{t("home.kicker")}</span>
        <PreferencesToggle />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 py-16 text-center">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{t("home.headline")}</h1>
          <p className="mx-auto max-w-md text-lg text-ink-muted">{t("home.subhead")}</p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={startFreeplay}
            disabled={pending !== null}
            className="rounded border border-ink bg-ink px-8 py-3 text-base font-medium text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending === "freeplay" ? t("state.loading") : t("home.startFreeplay")}
          </button>

          <button
            type="button"
            onClick={startDaily}
            disabled={pending !== null}
            className="text-sm text-ink-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
          >
            {pending === "daily" ? t("state.loading") : t("home.dailyCta")}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-ink-muted">
            {t(errorKeyFor(error))}
          </p>
        )}
      </div>
    </main>
  );
}
