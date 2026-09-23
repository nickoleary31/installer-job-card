import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Phase 2H security reconciliation — classifySyncResponseStatus is the
 * pure heart of the terminal-vs-retryable-vs-authorization classification:
 * every server response lib/submission-sync.ts's sync engine sees (from
 * /api/job-card-submissions/finalize and /photo-upload-url) is run through
 * this exact function before deciding how to record an outbox failure. See
 * lib/local-submission-outbox.ts's OutboxErrorKind and
 * lib/native/local-submission-outbox.ts's isOutboxRowClaimable for what
 * consumes the result.
 *
 * submission-sync.ts's real `supabase` client (lib/supabase/client.ts)
 * throws at module-evaluation time if NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are
 * unset — never actually needed by classifySyncResponseStatus itself, but
 * the import still has to resolve. Same established workaround as
 * lib/auth/userContext.test.ts's own doc: dummy values set before the
 * dynamic import below (NOT hoisted, unlike a static import), touching
 * neither lib/supabase/client.ts nor the shared test env for every other file.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { classifySyncResponseStatus } = await import("./submission-sync.ts");
describe("classifySyncResponseStatus (pure)", () => {
  it("401 (no/invalid/expired session) -> authorization", () => {
    assert.equal(classifySyncResponseStatus(401), "authorization");
  });

  it("403 (authenticated but not currently allowed) -> authorization", () => {
    assert.equal(classifySyncResponseStatus(403), "authorization");
  });

  it("409 (immutable identity conflict — project/company mismatch OR snapshot-hash conflict) -> terminal", () => {
    assert.equal(classifySyncResponseStatus(409), "terminal");
  });

  it("400 and 422 (payload validation) -> terminal", () => {
    assert.equal(classifySyncResponseStatus(400), "terminal");
    assert.equal(classifySyncResponseStatus(422), "terminal");
  });

  it("500/502/503 (transient server failure) -> retryable", () => {
    assert.equal(classifySyncResponseStatus(500), "retryable");
    assert.equal(classifySyncResponseStatus(502), "retryable");
    assert.equal(classifySyncResponseStatus(503), "retryable");
  });

  it("an unrecognized/unexpected status defaults to retryable — never silently classified terminal by surprise", () => {
    assert.equal(classifySyncResponseStatus(418), "retryable");
    assert.equal(classifySyncResponseStatus(0), "retryable");
  });
});
