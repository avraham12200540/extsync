"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { DashHeader } from "@/components/dashboard";
import { useLocale } from "@/components/locale-context";
import { useAuth } from "@/components/providers";
import { api, type SaveBridgeCredential } from "@/lib/api";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";

/**
 * SaveBridge client access - platform administrators only.
 *
 * Every distributed copy of the SaveBridge extension carries one credential,
 * and the credential is what decides whether the NetFree availability check
 * applies. That decision lives entirely on the server: nothing on this page,
 * and nothing in the extension, can select a policy for a request.
 *
 * Two things this screen is responsible for being honest about:
 *
 *   - What an unrestricted credential actually does. It is the bypass. The
 *     warning says so plainly rather than hiding behind a label.
 *   - What revocation is for. A credential in someone's hands can be read out
 *     of the build - that is unavoidable and is not the property being claimed.
 *     What IS guaranteed is that it is attributable to one recipient and can be
 *     withdrawn without touching anyone else.
 */

export default function SaveBridgeCredentialsPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const qc = useQueryClient();

  const [label, setLabel] = useState("");
  const [policy, setPolicy] = useState<"netfree_required" | "unrestricted_private">(
    "netfree_required",
  );
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [issued, setIssued] = useState<{ label: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["savebridge", "credentials"],
    queryFn: () => api.get<SaveBridgeCredential[]>("/admin/savebridge/credentials"),
    enabled: user?.role === "platform_admin",
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<SaveBridgeCredential & { token: string }>(
        "/admin/savebridge/credentials",
        {
          label,
          policy,
          credentialType:
            policy === "netfree_required" ? "public_distribution" : "private_distribution",
          notes: notes || undefined,
          confirmUnrestricted: policy === "unrestricted_private",
        },
      ),
    onSuccess: (res) => {
      setIssued({ label: res.label, token: res.token });
      setLabel("");
      setNotes("");
      setConfirmed(false);
      setCopied(false);
      qc.invalidateQueries({ queryKey: ["savebridge"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      api.post(`/admin/savebridge/credentials/${id}/revoke`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["savebridge"] }),
  });

  if (user && user.role !== "platform_admin") {
    return <p className="text-ink-muted">{t("sb.forbidden")}</p>;
  }

  const rows = data ?? [];
  const unrestricted = policy === "unrestricted_private";
  const canCreate = label.trim().length > 0 && (!unrestricted || confirmed);

  return (
    <div>
      <DashHeader
        icon={<KeyRound className="h-5 w-5" />}
        title={t("sb.title")}
        subtitle={t("sb.subtitle")}
        action={
          <Link href="/app/moderation">
            <Button variant="secondary" size="sm">{t("sb.backToModeration")}</Button>
          </Link>
        }
      />

      {/* The token, once. */}
      {issued && (
        <Card className="mb-6 border-brand">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <ShieldCheck className="h-5 w-5 text-success" />
            {t("sb.issued")}: {issued.label}
          </h2>
          <p className="mt-1 text-sm font-semibold text-warning">{t("sb.copyNow")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink">
              {issued.token}
            </code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(issued.token);
                setCopied(true);
              }}
            >
              <Copy className="me-1 inline h-4 w-4" />
              {copied ? t("sb.copied") : t("sb.copy")}
            </Button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">{t("sb.buildHint")}</p>
          <code className="mt-1 block overflow-x-auto rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-ink-muted">
            node scripts/package-extension.mjs --token &lt;TOKEN&gt; --label &quot;{issued.label}&quot;
          </code>
          <Button variant="ghost" size="sm" className="mt-3"
                  onClick={() => setIssued(null)}>
            {t("sb.dismiss")}
          </Button>
        </Card>
      )}

      {/* Issue */}
      <Card className="mb-6">
        <h2 className="text-lg font-semibold text-ink">{t("sb.create")}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-ink-muted" htmlFor="sb-label">
              {t("sb.label")}
            </label>
            <Input id="sb-label" value={label} placeholder={t("sb.labelHint")}
                   onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-ink-muted" htmlFor="sb-policy">
              {t("sb.policy")}
            </label>
            <select
              id="sb-policy"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
              value={policy}
              onChange={(e) => {
                setPolicy(e.target.value as typeof policy);
                setConfirmed(false);
              }}
            >
              <option value="netfree_required">{t("sb.policy.netfree")}</option>
              <option value="unrestricted_private">{t("sb.policy.unrestricted")}</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-ink-muted" htmlFor="sb-notes">
              {t("sb.notes")}
            </label>
            <Input id="sb-notes" value={notes}
                   onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        {unrestricted && (
          <div className="mt-4 rounded-lg border border-warning/60 bg-warning/5 p-4">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
              {t("sb.warn.title")}
            </p>
            <p className="mt-1 text-sm text-ink">{t("sb.warn.body")}</p>
            <p className="mt-2 text-sm text-ink-muted">{t("sb.warn.extractable")}</p>
            <label className="mt-3 flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" checked={confirmed} className="mt-1 h-4 w-4"
                     onChange={(e) => setConfirmed(e.target.checked)} />
              {t("sb.warn.confirm")}
            </label>
          </div>
        )}

        <div className="mt-4">
          <Button disabled={!canCreate || create.isPending}
                  onClick={() => create.mutate()}>
            {create.isPending ? t("sb.creating") : t("sb.create")}
          </Button>
          {create.isError && (
            <p className="mt-2 text-sm text-danger">{(create.error as Error).message}</p>
          )}
        </div>
      </Card>

      {isLoading && <div className="flex justify-center py-12"><Spinner /></div>}

      {!isLoading && (
        <Card>
          <h2 className="text-lg font-semibold text-ink">
            {t("sb.existing")} ({rows.length})
          </h2>
          {rows.length === 0 && (
            <p className="mt-3 text-sm text-ink-muted">{t("sb.none")}</p>
          )}
          <div className="mt-4 space-y-3">
            {rows.map((c) => (
              <div key={c.id}
                   className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{c.label}</span>
                  <Badge status={c.status === "active" ? "approved" : "rejected"}>
                    {c.status === "active" ? t("sb.active") : t("sb.revoked")}
                  </Badge>
                  <Badge status={c.policy === "unrestricted_private"
                    ? "legacy_pending" : undefined}>
                    {c.policy === "unrestricted_private"
                      ? t("sb.policy.unrestricted") : t("sb.policy.netfree")}
                  </Badge>
                  <Badge>{c.credentialType === "public_distribution"
                    ? t("sb.type.public") : t("sb.type.private")}</Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-ink-muted">
                  {t("sb.tokenId")}: {c.tokenId}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  {t("sb.created")}: {c.createdAt ?? "-"}
                  {c.createdByEmail ? ` · ${c.createdByEmail}` : ""}
                  {" · "}{t("sb.lastUsed")}: {c.lastUsedAt ?? t("sb.never")}
                  {" · "}{t("sb.uses")}: {c.useCount}
                  {c.expiresAt ? ` · ${t("sb.expires")}: ${c.expiresAt}` : ""}
                </p>
                {c.revokedAt && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {t("sb.revoked")}: {c.revokedAt}
                    {c.revokedByEmail ? ` · ${c.revokedByEmail}` : ""}
                    {c.revokedReason ? ` · ${c.revokedReason}` : ""}
                  </p>
                )}
                {c.notes && <p className="mt-1 text-sm text-ink-muted">{c.notes}</p>}

                {c.status === "active" && (
                  <div className="mt-3">
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (window.confirm(`${t("sb.confirmRevoke")}\n\n${c.label}`)) {
                          revoke.mutate(c.id);
                        }
                      }}
                    >
                      {t("sb.revokeAction")}
                    </Button>
                    {c.credentialType === "public_distribution" && (
                      <span className="ms-3 inline-flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {t("sb.publicRevokeWarning")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
