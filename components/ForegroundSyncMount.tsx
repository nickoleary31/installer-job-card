"use client";

import { useEffect, useRef } from "react";
import { useAuthUserContext } from "@/app/providers/AuthUserContextProvider";
import { subscribeToNativeResume } from "@/lib/native/app-lifecycle";
import { isNativeRuntime } from "@/lib/native/runtime";
import { runForegroundSync } from "@/lib/submission-sync";

/**
 * Phase 2H's ONLY sync trigger, mounted once for the whole mobile-web app
 * (see mobile-web/app/layout.tsx) so it fires regardless of which screen a
 * technician is on — a local-only submit can happen on NewSubmissionForm
 * and later sync from ProjectDetailScreen, Installs, or anywhere else.
 *
 * Deliberately reactive-only: the first effect re-runs exactly when authMode
 * transitions to "online" (mount, or AuthUserContextProvider's own
 * network-status-subscribe re-resolving auth on an offline->online flip —
 * see that file's own doc on why it does that). Checkpoint 1 adds the
 * second trigger: the native app returning to the foreground (see
 * lib/native/app-lifecycle.ts). Both go through runForegroundSync's
 * single-flight runner, so overlapping triggers never produce overlapping
 * passes. No setInterval/polling loop, no native background task — see
 * lib/submission-sync.ts's own "foreground-only, no background
 * service/scheduler" doc. Renders nothing.
 */
export function ForegroundSyncMount() {
  const { authMode, context } = useAuthUserContext();
  const latestAuthRef = useRef({ authMode, userId: context.userId });

  useEffect(() => {
    latestAuthRef.current = { authMode, userId: context.userId };
  }, [authMode, context.userId]);

  useEffect(() => {
    if (authMode !== "online" || !context.userId) return;
    void runForegroundSync(context.userId);
  }, [authMode, context.userId]);

  useEffect(() => {
    if (!isNativeRuntime()) return;
    return subscribeToNativeResume(document, () => {
      const { authMode: currentMode, userId } = latestAuthRef.current;
      if (currentMode !== "online" || !userId) return;
      void runForegroundSync(userId);
    });
  }, []);

  return null;
}
