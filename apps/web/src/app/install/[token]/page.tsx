"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError, type InstallPage } from "@/lib/api";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useLocale } from "@/components/locale-context";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default function InstallTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useLocale();
  const [data, setData] = useState<InstallPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.post<InstallPage>(`/install-links/${token}/resolve`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Error"));
  }, [token]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        {!data && !error && <div className="flex justify-center py-20"><Spinner /></div>}
        {error && (
          <Card className="text-center">
            <h1 className="text-xl font-semibold text-ink">{t("inst.unavailable")}</h1>
            <p className="mt-2 text-ink-muted">{error}</p>
          </Card>
        )}
        {data && <InstallContent data={data} />}
      </main>
      <SiteFooter />
    </div>
  );
}

function InstallContent({ data }: { data: InstallPage }) {
  const { t } = useLocale();
  const [agentMissing, setAgentMissing] = useState(false);
  const onInstall = () => {
    // Only fired by an explicit user click (§16) - never auto-launched.
    setAgentMissing(false);
    window.location.href = data.installUri;
    // If the extsync:// handler exists, launching it blurs/hides this tab. If
    // nothing handles it (Agent not installed) the page stays visible, so after a
    // short grace period surface a hint - the click must never be a silent dead end.
    let timer = 0;
    const settled = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", settled);
      window.removeEventListener("blur", settled);
      window.removeEventListener("pagehide", settled);
    };
    document.addEventListener("visibilitychange", settled);
    window.addEventListener("blur", settled);
    window.addEventListener("pagehide", settled);
    timer = window.setTimeout(() => {
      settled();
      if (document.visibilityState === "visible") setAgentMissing(true);
    }, 2500);
  };

  return (
    <Card>
      <div className="flex items-center gap-4">
        {data.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.iconUrl} alt="" className="h-16 w-16 rounded-lg" />
        ) : (
          <div className="h-16 w-16 rounded-lg bg-brand-muted dark:bg-brand/20" />
        )}
        <div>
          <h1 className="text-2xl font-semibold text-ink">{data.name}</h1>
          <p className="text-sm text-ink-muted">{t("inst.by")} {data.developerName}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge>{data.visibility === "public" ? t("inst.public") : t("inst.private")}</Badge>
            <Badge>{t("inst.channel")} {data.channel}</Badge>
            {data.version && <Badge>{t("inst.version")} {data.version}</Badge>}
            {data.hasBridge && <Badge>{t("inst.bridge")}</Badge>}
          </div>
        </div>
      </div>

      {data.shortDescription && <p className="mt-4 text-ink">{data.shortDescription}</p>}

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-ink">{t("inst.perms")}</h2>
        {data.permissions.permissions.length === 0 && data.permissions.hostPermissions.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("inst.noperms")}</p>
        ) : (
          <ul className="space-y-1 text-sm text-ink-muted">
            {data.permissions.permissions.map((p) => <li key={p}>• {p}</li>)}
            {data.permissions.hostPermissions.length > 0 && (
              <li>• {t("inst.hosts")} {data.permissions.hostPermissions.join(", ")}</li>
            )}
            {data.permissions.usesNativeMessaging && <li>• {t("inst.native")}</li>}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-ink-muted">
        {data.publishedAt && <span>{t("inst.published")} {formatDate(data.publishedAt)}</span>}
        {data.repoUrl && <a href={data.repoUrl} className="text-brand hover:underline">{t("inst.source")}</a>}
        {data.privacyPolicyUrl && <a href={data.privacyPolicyUrl} className="text-brand hover:underline">{t("inst.privacy")}</a>}
      </div>

      {!data.usable ? (
        <div className="mt-6 rounded-md bg-amber-50 dark:bg-amber-400/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("inst.unusable")} ({data.reason === "expired" ? t("inst.expired") : data.reason === "limit_reached" ? t("inst.limit") : t("inst.disabled")}).
        </div>
      ) : (
        <>
          <div className="mt-8">
            <Button size="md" onClick={onInstall} className="w-full sm:w-auto">
              {t("inst.cta")}
            </Button>
          </div>
          {agentMissing && (
            <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              <p className="font-semibold">{t("inst.notdetected.title")}</p>
              <p className="mt-1">{t("inst.notdetected.body")}</p>
              <div className="mt-3">
                <Link href="/download"><Button size="sm" variant="secondary">{t("inst.dl")}</Button></Link>
              </div>
            </div>
          )}
          <div className="mt-4 rounded-md bg-surface-2 p-4 text-sm text-ink-muted">
            {t("inst.need.1")} <strong className="text-ink">ExtSync Agent</strong>{t("inst.need.2")}
            <div className="mt-2">
              <Link href="/download"><Button size="sm" variant="secondary">{t("inst.dl")}</Button></Link>
            </div>
          </div>
          {data.requiresAccount && (
            <p className="mt-3 text-xs text-ink-muted">{t("inst.account")}</p>
          )}
          {data.downloadUrl && (
            <div className="mt-4 border-t border-line pt-4">
              <h2 className="text-sm font-semibold text-ink">{t("inst.manual.title")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t("inst.manual.hint")}</p>
              <a href={data.downloadUrl} download className="mt-2 inline-block">
                <Button size="sm" variant="secondary">{t("inst.manual.dl")}</Button>
              </a>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
