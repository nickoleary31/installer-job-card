import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requirePrivilegedServiceClient, type SupabaseServerEnv } from "./admin-api.ts";

/**
 * requirePrivilegedServiceClient is the fail-closed gate every privileged
 * route (send-email, the Zoho project routes) must call first. These tests
 * build SupabaseServerEnv values directly (never real env vars, never a live
 * Supabase call) — see getSupabaseServerEnv's own doc for how the env is
 * actually read into this shape at runtime.
 */
function env(overrides: Partial<SupabaseServerEnv> = {}): SupabaseServerEnv {
  return {
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    serviceRoleKey: "service-role-key",
    missingPublic: [],
    missingServiceRole: [],
    ...overrides,
  };
}

describe("requirePrivilegedServiceClient (fail-closed privileged gate)", () => {
  it("succeeds when a service-role key is present", () => {
    const result = requirePrivilegedServiceClient(env());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.serviceClient, "must hand back a real, usable service-role client");
    }
  });

  it("fails closed with a 500 configuration error when the service-role key is missing", () => {
    const result = requirePrivilegedServiceClient(env({ serviceRoleKey: null, missingServiceRole: ["SUPABASE_SERVICE_ROLE_KEY"] }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 500);
      assert.match(result.error, /SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("never returns ok:true using only the anon key — a privileged route cannot proceed with just anonKey/url set", () => {
    const result = requirePrivilegedServiceClient(env({ serviceRoleKey: null, missingServiceRole: ["SUPABASE_SERVICE_ROLE_KEY"] }));
    assert.equal(result.ok, false, "url + anonKey alone must never be treated as sufficient for a privileged operation");
  });

  it("fails closed (500, not a thrown exception) when url is also missing, even if a service role key string is present", () => {
    const result = requirePrivilegedServiceClient(env({ url: "" }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 500);
  });
});
