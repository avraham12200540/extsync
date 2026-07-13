"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/components/providers";
import { api } from "@/lib/api";

/**
 * The store's managed-install button. Launches the extsync:// URI like a plain
 * anchor, and - when the visitor is signed in - also records the extension in
 * their library (/me/extensions) so it can be reinstalled on any computer.
 * Fire-and-forget: tracking must never block or break the install itself.
 *
 * After a hard refresh the AuthProvider restores the session asynchronously, so
 * `user` is briefly null while `loading` is true. If the user clicks in that
 * window we defer the tracking call until auth settles instead of dropping it.
 */
export function InstallButton({
  installUri,
  slug,
  className,
  children,
}: {
  installUri: string;
  slug: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pending = useRef(false);

  const send = () => void api.post("/me/extensions", { slug }).catch(() => {});

  const track = () => {
    if (user) send();
    else if (loading) pending.current = true; // flush once auth resolves
  };

  useEffect(() => {
    if (pending.current && !loading) {
      pending.current = false;
      if (user) send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  return (
    <a href={installUri} onClick={track} className={className}>
      {children}
    </a>
  );
}
