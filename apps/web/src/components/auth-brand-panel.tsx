"use client";

import { CircleCheck } from "lucide-react";
import { useLocale } from "@/components/locale-context";

/** Translated content of the AuthShell brand panel (client island so the
 *  surrounding shell can stay server-safe). */
export function AuthBrandPanel() {
  const { t } = useLocale();
  return (
    <div className="relative">
      <h2 className="text-3xl font-extrabold leading-snug">
        {t("auth.brand.title.1")}<br />{t("auth.brand.title.2")}
      </h2>
      <p className="mt-4 max-w-sm text-slate-300">{t("auth.brand.body")}</p>
      <ul className="mt-6 space-y-2 text-sm text-slate-300">
        <li className="flex items-center gap-2"><CircleCheck className="h-4 w-4 shrink-0 text-brand-teal" /> {t("auth.brand.f1")}</li>
        <li className="flex items-center gap-2"><CircleCheck className="h-4 w-4 shrink-0 text-brand-teal" /> {t("auth.brand.f2")}</li>
        <li className="flex items-center gap-2"><CircleCheck className="h-4 w-4 shrink-0 text-brand-teal" /> {t("auth.brand.f3")}</li>
      </ul>
    </div>
  );
}
