import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { classifyHttpStatus, classifySupabaseFailure } from "./classify-supabase-error.ts";

describe("classifyHttpStatus (pure status bucketing)", () => {
  it("classifies status 0 (no response at all) as offline-transport", () => {
    assert.equal(classifyHttpStatus(0), "offline-transport");
  });

  it("classifies 401/403 as denied", () => {
    assert.equal(classifyHttpStatus(401), "denied");
    assert.equal(classifyHttpStatus(403), "denied");
  });

  it("classifies 429 and 5xx/infra codes as unavailable", () => {
    for (const status of [429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 530]) {
      assert.equal(classifyHttpStatus(status), "unavailable", `status ${status}`);
    }
  });

  it("classifies an unmapped status (e.g. 400/404/422) as unknown, never assuming every 4xx means the same thing", () => {
    assert.equal(classifyHttpStatus(400), "unknown");
    assert.equal(classifyHttpStatus(404), "unknown");
    assert.equal(classifyHttpStatus(422), "unknown");
  });
});

describe("classifySupabaseFailure against REAL @supabase/supabase-js error instances", () => {
  it("AuthSessionMissingError (the session_not_found signal) -> denied, DESPITE carrying HTTP status 400", () => {
    // The trap this test guards against: a naive "bucket by .status alone"
    // classifier would see status 400 and call this "unknown" (or worse,
    // lump it with generic 4xx), silently discarding a genuine, explicit
    // revocation signal. The library's own type guard must be checked first.
    const error = new AuthSessionMissingError();
    assert.equal(error.status, 400, "sanity check on the real library's own shape");
    assert.equal(classifySupabaseFailure(error), "denied");
  });

  it("AuthApiError(401) -> denied", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("invalid JWT", 401, "invalid_jwt")), "denied");
  });

  it("AuthApiError(403) -> denied", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("forbidden", 403, undefined)), "denied");
  });

  it("AuthApiError(400) -> unknown, NOT denied (do not assume every 4xx means the same thing)", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("bad request", 400, "bad_json")), "unknown");
  });

  it("AuthRetryableFetchError(status 0) -> offline-transport (fetch() itself never got a response)", () => {
    assert.equal(classifySupabaseFailure(new AuthRetryableFetchError("Failed to fetch", 0)), "offline-transport");
  });

  it("AuthRetryableFetchError(503) -> unavailable, NEVER denied (auth-js's own doc: 'should not cause session invalidation')", () => {
    assert.equal(classifySupabaseFailure(new AuthRetryableFetchError("Service Unavailable", 503)), "unavailable");
  });

  it("AuthRetryableFetchError(429-shaped availability condition, via AuthApiError) -> unavailable", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("Too Many Requests", 429, undefined)), "unavailable");
  });

  it("AuthUnknownError (no numeric status at all) -> unknown", () => {
    const error = new AuthUnknownError("mystery failure", new Error("boom"));
    assert.equal(error.status, undefined, "sanity check on the real library's own shape");
    assert.equal(classifySupabaseFailure(error), "unknown");
  });

  it("a plain TypeError (e.g. a raw fetch() throw never wrapped by the library) -> unknown, NOT connectivity", () => {
    // Deliberately does not special-case bare TypeErrors: without a
    // library-attached status, we cannot positively confirm this was a
    // transport failure rather than a programming error — fails closed.
    assert.equal(classifySupabaseFailure(new TypeError("Failed to fetch")), "unknown");
  });

  it("an unrecognized/malformed error object -> unknown, never silently treated as connectivity or denial", () => {
    assert.equal(classifySupabaseFailure({ message: "no status here" }), "unknown");
    assert.equal(classifySupabaseFailure(null), "unknown");
    assert.equal(classifySupabaseFailure(undefined), "unknown");
    assert.equal(classifySupabaseFailure("a plain string"), "unknown");
    assert.equal(classifySupabaseFailure({ status: "401" }), "unknown", "non-numeric status must not match");
  });
});

describe("classifySupabaseFailure — AuthApiError.code precedence over raw HTTP status", () => {
  it("session_not_found -> denied (defense-in-depth alongside the AuthSessionMissingError type guard)", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("session not found", 400, "session_not_found")), "denied");
  });

  it("session_expired -> denied", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("session expired", 401, "session_expired")), "denied");
  });

  it("user_banned -> denied", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("user banned", 403, "user_banned")), "denied");
  });

  it("user_not_found -> denied", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("user not found", 404, "user_not_found")), "denied");
  });

  it("bad_jwt -> unknown, DESPITE carrying HTTP 401 (a naive status-only rule would call this denied)", () => {
    // A project-level signing-key rotation can make every still-legitimate
    // user's token look like bad_jwt simultaneously — treating it as an
    // automatic denial would wipe every technician's offline access from
    // one infra event, not a per-user revocation.
    const error = new AuthApiError("bad jwt", 401, "bad_jwt");
    assert.equal(error.status, 401, "sanity check — status alone would say denied");
    assert.equal(classifySupabaseFailure(error), "unknown");
  });

  it("refresh_token_not_found -> unknown, DESPITE carrying HTTP 401 (documented refresh-race false positive)", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("refresh token not found", 401, "refresh_token_not_found")), "unknown");
  });

  it("refresh_token_already_used -> unknown, DESPITE carrying HTTP 401 (documented refresh-race false positive)", () => {
    assert.equal(
      classifySupabaseFailure(new AuthApiError("refresh token already used", 401, "refresh_token_already_used")),
      "unknown",
    );
  });

  it("an unrecognized code falls through unchanged to the existing status-based rules", () => {
    assert.equal(classifySupabaseFailure(new AuthApiError("weird", 401, "some_future_code")), "denied");
    assert.equal(classifySupabaseFailure(new AuthApiError("weird", 503, "some_future_code")), "unavailable");
  });
});
