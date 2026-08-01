"use client";

import { useEffect } from "react";
import {
  ACCEPT_INVITE_PATH,
  buildAcceptInviteCallbackHref,
  urlLooksLikeInviteAuthCallback,
} from "@/lib/auth/onboarding";

/**
 * If Supabase redirects an invite callback to Site URL ("/") or another non-accept path,
 * forward query/hash to /auth/accept-invite before Home/login guards can steal the flow.
 */
export default function InviteCallbackForwarder() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const href = window.location.href;
    const path = window.location.pathname;
    if (path === ACCEPT_INVITE_PATH) return;
    if (!urlLooksLikeInviteAuthCallback(href)) return;
    window.location.replace(buildAcceptInviteCallbackHref(href));
  }, []);

  return null;
}
