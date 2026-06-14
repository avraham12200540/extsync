"use client";

import { useEffect } from "react";
import Link from "next/link";
import { MarketingShell, HeroArt } from "@/components/marketing";
import { LogoIcon } from "@/components/logo";
import { useLocale } from "@/components/locale-context";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    // Server-side renders are already logged by Next; this surfaces client crashes.
    console.error(error);
  }, [error]);

  return (
    <MarketingShell>
      <section className="relative isolate overflow-hidden">
        <HeroArt />
        <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-28 text-center sm:py-36">
          <div className="fade-up animate-float"><LogoIcon size={72} /></div>
          <h1 className="fade-up mt-6 text-2xl font-bold text-white" style={{ ["--d" as never]: "140ms" }}>
            {t("err.title")}
          </h1>
          <p className="fade-up mt-2 max-w-md text-slate-300" style={{ ["--d" as never]: "210ms" }}>
            {t("err.body")}
          </p>
          <div className="fade-up mt-8 flex flex-wrap justify-center gap-3" style={{ ["--d" as never]: "280ms" }}>
            <button
              onClick={reset}
              className="rounded-md bg-brand-gradient px-6 py-2.5 text-sm font-medium text-white shadow-glow hover:brightness-110"
            >
              {t("err.retry")}
            </button>
            <Link
              href="/"
              className="rounded-md border border-white/30 bg-white/10 px-6 py-2.5 text-sm font-medium text-white backdrop-blur hover:bg-white/20"
            >
              {t("nf.home")}
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
