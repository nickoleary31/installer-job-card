"use client";

import { useEffect } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { runForegroundSync } from "@/lib/submission-sync";

/**
 * Phase 2H's ONLY sync trigger, mounted once for the whole mobile-web app
 * (see mobile-web/app/layout.tsx) so it fires regardless of which screen a
 * technician is on — a local-only submit can happen on NewSubmissionForm
 * and later sync from ProjectDetailScreen, Installs, or anywhere else.
 *
 * Deliberately reactive-only: this effect re-runs exactly when authMode
 * transitions to "online" (mount, or AuthUserContextProvider's own
 * network-status-subscribe re-resolving auth on an offline->online flip —
 * see that file's own doc on why it does that). No setInterval/polling
 * loop, no native background task — see lib/submission-sync.ts's own
 * "foreground-only, no background service/scheduler" doc. Renders nothing.
 */
export function ForegroundSyncMount() {
  const { authMode, context } = useAuthUserContext();

  useEffect(() => {
    if (authMode !== "online" || !context.userId) return;
    void runForegroundSync(context.userId);
  }, [authMode, context.userId]);

  return null;
}
