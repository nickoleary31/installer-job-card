import { timingSafeEqual } from "node:crypto";

/**
 * Validates the shared secret configured on the Zoho FSM webhook (sent as a static header
 * value on the workflow-rule webhook config — Zoho FSM webhooks have no built-in HMAC
 * signing). Must be checked before any privileged operation, and before the request body is
 * trusted for anything beyond identifying which Zoho record changed.
 */
export function isValidWebhookSecret(providedSecret: string | null | undefined, expectedSecret: string): boolean {
  const provided = (providedSecret || "").trim();
  const expected = expectedSecret.trim();
  if (!expected || !provided) return false;
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export const ZOHO_FSM_WEBHOOK_SECRET_HEADER = "x-zoho-fsm-webhook-secret";

/**
 * Header carrying the read-only evidence endpoint's own shared secret (see
 * app/api/integrations/zoho-fsm/evidence/route.ts) — a future external orchestrator's
 * server-to-server credential. Deliberately a separate secret/header from the inbound SA
 * webhook's above: different trust direction (Zoho pushing in vs. the orchestrator pulling
 * out), so compromising or rotating one never affects the other. Validated with the same
 * isValidWebhookSecret() comparison — its logic is generic, not specific to the inbound webhook.
 */
export const ZOHO_FSM_EVIDENCE_SECRET_HEADER = "x-zoho-fsm-evidence-secret";
