import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requirePrivilegedServiceClient, type SupabaseServerEnv } from "./admin-api.ts";

/**
 * Phase 2H security reconciliation — requirePrivilegedServiceClient is the
 * fail-closed gate every privileged Phase 2H route must call first. These
 * tests build SupabaseServerEnv values directly (never real env vars, never
 * a live Supabase call) — see getSupabaseServerEnv's own doc for how the
 * new/legacy key names actually get read into this shape at runtime.
 */
function env(overrides: Partial<SupabaseServerEnv> = {}): SupabaseServerEnv {
  return {
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    serviceRoleKey: "secret-key",
    missingPublic: [],
    missingServiceRole: [],
    ...overrides,
  };
}

describe("requirePrivilegedServiceClient (fail-closed privileged gate)", () => {
  it("succeeds when a privileged key is present (modeling SUPABASE_SECRET_KEY)", () => {
    const result = requirePrivilegedServiceClient(env());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.serviceClient, "must hand back a real, usable service-role client");
    }
  });

  it("succeeds identically when the key came from the legacy SUPABASE_SERVICE_ROLE_KEY fallback — getSupabaseServerEnv already folds both into the same serviceRoleKey field, so this gate cannot and need not distinguish them", () => {
    // getSupabaseServerEnv's own fallback (SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY)
    // means a legacy-only deployment produces the exact same env shape this gate sees.
    const result = requirePrivilegedServiceClient(env({ serviceRoleKey: "legacy-service-role-key" }));
    assert.equal(result.ok, true);
  });

  it("fails closed with a 500 configuration error when neither privileged key is present", () => {
    const result = requirePrivilegedServiceClient(
      env({ serviceRoleKey: null, missingServiceRole: ["SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"] }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 500);
      assert.match(result.error, /SUPABASE_SECRET_KEY/);
    }
  });

  it("never returns ok:true using only the publishable/anon key — a privileged Phase 2H route cannot proceed with just anonKey/url set", () => {
    const result = requirePrivilegedServiceClient(
      env({ serviceRoleKey: null, missingServiceRole: ["SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"] }),
    );
    assert.equal(result.ok, false, "url + anonKey alone must never be treated as sufficient for a privileged operation");
  });

  it("fails closed (500, not a thrown exception) when url is also missing, even if a service role key string is present", () => {
    const result = requirePrivilegedServiceClient(env({ url: "" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 500);
  });
});
