"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/providers";
import { useLocale } from "@/components/locale-context";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// Shared query key. Prefix-matched on invalidation (the user id element is ignored),
// so the inbox can clear the badge with { queryKey: [FEEDBACK_UNREAD_KEY] }.
export const FEEDBACK_UNREAD_KEY = "feedback-unread";

// Only developer-type accounts own extensions and can receive feedback (mirrors
// the dashboard layout's gating).
const isDeveloper = (role?: string) => !!role && role !== "end_user" && role !== "guest";

/**
 * Unread developer-feedback count for the signed-in developer. One cached query
 * shared by every consumer (header button, sidebar item), refreshed on window
 * focus and every 60s while the tab is visible. Returns 0 for anyone who can't
 * own extensions, so the badge simply never shows for them.
 */
export function useUnreadFeedbackCount(): number {
  const { user } = useAuth();
  const enabled = isDeveloper(user?.role);
  const { data } = useQuery({
    queryKey: [FEEDBACK_UNREAD_KEY, user?.id],
    queryFn: () => api.get<{ count: number }>("/me/feedback/unread-count"),
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return enabled ? (data?.count ?? 0) : 0;
}

/**
 * Small red count badge for unread developer messages. Renders nothing when the
 * count is 0 (or the viewer can't receive feedback). Position it via className
 * on the caller side (e.g. absolute over a button corner, or ms-auto in a row).
 */
export function FeedbackBadge({ className }: { className?: string }) {
  const { t } = useLocale();
  const count = useUnreadFeedbackCount();
  if (count <= 0) return null;
  return (
    <span
      dir="ltr"
      className={cn(
        "pointer-events-none flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface",
        className,
      )}
      aria-label={`${count} ${t("fb.badge.unread")}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
