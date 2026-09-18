import { isAuthSessionMissingError } from "@supabase/supabase-js";

/**
 * Phase 2C — a real 4-category classification of a Supabase/PostgREST
 * failure, built from the ACTUAL error shapes this repo's dependencies
 * throw (inspected directly in node_modules/@supabase/auth-js and
 * node_modules/@supabase/postgrest-js, not assumed):
 *
 *  - "denied": explicit, confirmed evidence the server rejected this
 *    session/authorization — safe to clear the provisioned session over.
 *  - "unavailable": the server responded but reported its OWN temporary
 *    trouble (5xx, 429, Cloudflare infra codes) — never a denial.
 *  - "offline-transport": no response ever came back at all (status 0 —
 *    both @supabase/auth-js's AuthRetryableFetchError and
 *    @supabase/postgrest-js's PostgrestBuilder use exactly this convention
 *    for a failed fetch()) — a genuine connectivity/transport failure.
 *  - "unknown": anything we don't have positive evidence to classify
 *    either way. Must fail closed: never treated as a denial (so it can
 *    never clear a valid provisioned session), and never treated as
 *    positive offline/unavailable evidence on its own either.
 *
 * Critical, easy-to-get-wrong case found by actually instantiating these
 * classes (see classify-supabase-error.test.ts): @supabase/auth-js's
 * AuthSessionMissingError — thrown for PostgREST/GoTrue's "session_not_found"
 * response, i.e. "the session_id inside the JWT does not correspond to a
 * row in the sessions table... the user has signed out, been deleted, or
 * their session has somehow been terminated" — carries HTTP status 400, NOT
 * 401. A naive "401/403 = denied" status-only rule would silently
 * misclassify this explicit revocation signal as "unknown". The library's
 * own isAuthSessionMissingError() type guard is checked first specifically
 * to avoid that trap; every other case buckets on the real numeric status.
 */
export type SupabaseFailureCategory = "denied" | "unavailable" | "offline-transport" | "unknown";

/**
 * Confirmed HTTP statuses meaning "the server understood who's asking and
 * explicitly refused" — never a set we should extend to every 4xx, since
 * e.g. 400/404/422 carry no such confident meaning for a session/profile
 * re-validation call.
 */
const DENIED_HTTP_STATUSES = new Set([401, 403]);

/**
 * Confirmed HTTP statuses meaning the server (or the infrastructure in
 * front of it) reported its OWN temporary trouble, not a decision about
 * this user: 429 rate limiting, 500/502/504 standard server/gateway
 * errors, and Cloudflare's 520-524/530 edge-error codes (the same set
 * @supabase/auth-js's own NETWORK_ERROR_CODES flags as retryable/
 * non-session-invalidating, plus 429/500 which that list doesn't cover but
 * which are equally clearly "temporary", not "denied").
 */
const UNAVAILABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 530]);

/**
 * Phase 2C revision — @supabase/auth-js's AuthApiError also carries a
 * stable `code` string (see node_modules/@supabase/auth-js/.../
 * error-codes.d.ts's ErrorCode union) that in some cases gives STRONGER,
 * more specific evidence than the HTTP status alone. Checked before the
 * status-based fallback below, same "more specific signal beats coarser
 * one" precedence AuthSessionMissingError's own type-guard check already
 * established.
 *
 * Codes treated as unambiguous, explicit server evidence that the
 * session/user itself is no longer valid — safe to invalidate the offline
 * access lease over:
 *  - session_not_found: redundant with isAuthSessionMissingError() above
 *    for the one call path that throws that specific class, kept here too
 *    as defense-in-depth for any AuthApiError constructed with this code
 *    directly.
 *  - session_expired: the server confirms the session's own lifetime
 *    genuinely ended, not a transient problem.
 *  - user_banned / user_not_found: explicit statements about the
 *    ACCOUNT's standing, not about a request's momentary trouble.
 */
const DENIED_ERROR_CODES = new Set(["session_not_found", "session_expired", "user_banned", "user_not_found"]);

/**
 * Codes deliberately classified as "unknown" — NOT denied — despite
 * typically arriving with HTTP 401 (which the status-only fallback below
 * would otherwise call "denied"). This is a judgment call, documented so
 * it can be revisited with real telemetry rather than left implicit:
 *  - bad_jwt: can fire from a project-level signing-key rotation affecting
 *    every user's still-valid token at once, not only from a genuinely
 *    revoked individual session — treating it as an automatic denial would
 *    let one infra event silently wipe every technician's offline access.
 *  - refresh_token_not_found / refresh_token_already_used: Supabase's own
 *    community-documented false-positive source (refresh races), most
 *    associated with multi-tab browser usage but not proven absent from a
 *    single native WebView's own background-refresh timing. Given a wrong
 *    "denied" here revokes up to 7 days of legitimate offline access while
 *    a wrong "unknown" merely withholds a NEW grant (an already-valid
 *    lease is untouched either way — see auth-state.ts), erring toward
 *    "unknown" is the safer default.
 */
const AMBIGUOUS_ERROR_CODES = new Set(["bad_jwt", "refresh_token_not_found", "refresh_token_already_used"]);

/**
 * Pure — buckets a real HTTP status (including the 0-for-no-response
 * convention both @supabase/auth-js and @supabase/postgrest-js use for a
 * failed fetch()) into a failure category.
 */
export function classifyHttpStatus(status: number): SupabaseFailureCategory {
  if (status === 0) return "offline-transport";
  if (DENIED_HTTP_STATUSES.has(status)) return "denied";
  if (UNAVAILABLE_HTTP_STATUSES.has(status)) return "unavailable";
  return "unknown";
}

/**
 * Classifies anything caught from a supabase.auth.* call (AuthApiError,
 * AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, or an
 * unrecognized error) or from lib/auth/userContext.ts's PostgrestStatusError
 * wrapper around a PostgREST query failure (which carries a real status
 * since PostgrestError itself does not — see that file's own comment).
 *
 * Precedence: type-guard (AuthSessionMissingError) > stable error `code` >
 * raw HTTP status > unknown. Each step only narrows what the previous step
 * left ambiguous — a `code` never gets overridden by a coarser status
 * bucket, and an unrecognized/absent `code` always falls through to the
 * existing status-based rules unchanged.
 */
export function classifySupabaseFailure(error: unknown): SupabaseFailureCategory {
  if (isAuthSessionMissingError(error)) return "denied";

  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string") {
    if (AMBIGUOUS_ERROR_CODES.has(code)) return "unknown";
    if (DENIED_ERROR_CODES.has(code)) return "denied";
  }

  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number") return classifyHttpStatus(status);
  return "unknown";
}
