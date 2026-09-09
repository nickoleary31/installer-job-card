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
