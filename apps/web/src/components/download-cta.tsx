"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/components/locale-context";
import { LogoIcon } from "@/components/logo";
import { Button } from "@/components/ui";
import { Download, TriangleAlert } from "lucide-react";

const DOWNLOAD_URL =
  "https://github.com/avraham12200540/extsync/releases/latest/download/ExtSyncAgentSetup.exe";

/** OS-aware download CTA. The Agent is Windows-only; Mac visitors get pointed to
 *  the manual (load-unpacked) path via the store instead of a Windows .exe that
 *  won't run. Defaults to the Windows view before mount (and on SSR) so there is
 *  no hydration mismatch; it swaps to the Mac view after detecting macOS. */
export function DownloadCta() {
  const { t } = useLocale();
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    const mac = /Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
    if (mac) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMac(true);
    }
  }, []);

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl bg-brand-navy p-8 text-center text-white shadow-lift sm:p-12">
        <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-brand-teal/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-brand-sky/20 blur-3xl" />
        <div className="relative">
          <div className="mx-auto mb-5 w-fit animate-float rounded-3xl bg-white/10 p-4 backdrop-blur">
            <LogoIcon size={64} />
          </div>
          <h2 className="text-2xl font-bold">{t("dl.card.title")}</h2>
          <p className="mt-2 text-slate-300">{t("dl.card.sub")}</p>

          {isMac ? (
            <>
              <p className="mx-auto mt-4 max-w-md text-sm text-slate-300">{t("dl.mac.note")}</p>
              <Link href="/store" className="mt-6 inline-block">
                <Button variant="glass" className="px-8 py-3 text-base">{t("dl.mac.cta")}</Button>
              </Link>
            </>
          ) : (
            <>
              <a href={DOWNLOAD_URL} className="mt-6 inline-block">
                <Button variant="glass" className="px-8 py-3 text-base"><Download className="h-4 w-4" /> {t("dl.cta")}</Button>
              </a>
              <p className="mt-4 text-xs text-slate-400">
                {t("dl.releases.1")}
                <a href="https://github.com/avraham12200540/extsync/releases" className="underline hover:text-white">
                  {t("dl.releases.2")}
                </a>
              </p>
            </>
          )}
        </div>
      </div>

      {!isMac && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300 dark:border-amber-400/30 bg-amber-50 dark:bg-amber-400/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{t("dl.smartscreen")}</p>
        </div>
      )}
    </>
  );
}
