import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizeCompanyUserManager,
  decideCompanyUserManager,
  requirePrivilegedServiceClient,
  type CompanyUserManagerReads,
  type RequesterMembership,
  type RequesterProfile,
  type SupabaseServerEnv,
} from "./admin-api.ts";

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

// ---------------------------------------------------------------------------
// authorizeCompanyUserManager / decideCompanyUserManager
// ---------------------------------------------------------------------------

const COMPANY_A = "company-A";
const COMPANY_B = "company-B";

type World = {
  users: Record<string, string>; // accessToken -> userId
  profiles: Record<string, RequesterProfile>;
  memberships: Record<string, RequesterMembership>; // `${companyId}::${userId}`
  companies: string[];
  failProfileRead?: boolean;
  failMembershipRead?: boolean;
  failCompanyRead?: boolean;
};

function readsFor(world: World): CompanyUserManagerReads & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async verifyAccessToken(token) {
      calls.push("verify");
      const userId = world.users[token];
      return userId ? { userId } : null;
    },
    async loadProfile(userId) {
      calls.push(`profile:${userId}`);
      if (world.failProfileRead) return { profile: null, error: true };
      return { profile: world.profiles[userId] ?? null };
    },
    async loadMembership(companyId, userId) {
      calls.push(`membership:${companyId}:${userId}`);
      if (world.failMembershipRead) return { membership: null, error: true };
      return { membership: world.memberships[`${companyId}::${userId}`] ?? null };
    },
    async companyExists(companyId) {
      calls.push(`company:${companyId}`);
      if (world.failCompanyRead) return { exists: false, error: true };
      return { exists: world.companies.includes(companyId) };
    },
  };
}

function baseWorld(): World {
  return {
    users: {
      "t-ga": "ga",
      "t-ga-inactive": "ga-inactive",
      "t-admin-a": "admin-a",
      "t-admin-a-inactive-profile": "admin-a-inactive-profile",
      "t-admin-a-inactive-membership": "admin-a-inactive-membership",
      "t-tech-a": "tech-a",
      "t-admin-b": "admin-b",
      "t-no-profile": "no-profile",
    },
    profiles: {
      ga: { id: "ga", global_role: "admin", is_active: true },
      "ga-inactive": { id: "ga-inactive", global_role: "admin", is_active: false },
      "admin-a": { id: "admin-a", global_role: "technician", is_active: true },
      "admin-a-inactive-profile": { id: "admin-a-inactive-profile", global_role: "technician", is_active: false },
      "admin-a-inactive-membership": { id: "admin-a-inactive-membership", global_role: "technician", is_active: true },
      "tech-a": { id: "tech-a", global_role: "technician", is_active: true },
      "admin-b": { id: "admin-b", global_role: "technician", is_active: true },
    },
    memberships: {
      [`${COMPANY_A}::admin-a`]: { role: "admin", is_active: true },
      [`${COMPANY_A}::admin-a-inactive-profile`]: { role: "admin", is_active: true },
      [`${COMPANY_A}::admin-a-inactive-membership`]: { role: "admin", is_active: false },
      [`${COMPANY_A}::tech-a`]: { role: "technician", is_active: true },
      [`${COMPANY_B}::admin-b`]: { role: "admin", is_active: true },
    },
    companies: [COMPANY_A, COMPANY_B],
  };
}

describe("decideCompanyUserManager (who may manage a company's users)", () => {
  it("active company admin of A -> allowed for A (legitimate management keeps working)", async () => {
    const result = await decideCompanyUserManager({ accessToken: "t-admin-a", companyId: COMPANY_A }, readsFor(baseWorld()));
    assert.deepEqual(result, { ok: true, requesterUserId: "admin-a", isGlobalAdmin: false });
  });

  it("active global admin -> allowed for any existing company", async () => {
    for (const companyId of [COMPANY_A, COMPANY_B]) {
      const result = await decideCompanyUserManager({ accessToken: "t-ga", companyId }, readsFor(baseWorld()));
      assert.deepEqual(result, { ok: true, requesterUserId: "ga", isGlobalAdmin: true });
    }
  });

  it("global admin + non-existent company -> 404 (never a silent success)", async () => {
    const result = await decideCompanyUserManager({ accessToken: "t-ga", companyId: "no-such-company" }, readsFor(baseWorld()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 404);
  });

  it("company admin whose PROFILE is inactive -> denied, even though the admin membership is still active", async () => {
    const result = await decideCompanyUserManager(
      { accessToken: "t-admin-a-inactive-profile", companyId: COMPANY_A },
      readsFor(baseWorld()),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 403);
      assert.match(result.error, /not active/i);
    }
  });

  it("company admin whose MEMBERSHIP is inactive -> denied", async () => {
    const result = await decideCompanyUserManager(
      { accessToken: "t-admin-a-inactive-membership", companyId: COMPANY_A },
      readsFor(baseWorld()),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("inactive global admin -> denied (not treated as a company admin either)", async () => {
    const result = await decideCompanyUserManager({ accessToken: "t-ga-inactive", companyId: COMPANY_A }, readsFor(baseWorld()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("ordinary technician -> denied user management", async () => {
    const result = await decideCompanyUserManager({ accessToken: "t-tech-a", companyId: COMPANY_A }, readsFor(baseWorld()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("admin of company A supplying company B's id -> denied (the supplied id is checked, never trusted)", async () => {
    const reads = readsFor(baseWorld());
    const result = await decideCompanyUserManager({ accessToken: "t-admin-a", companyId: COMPANY_B }, reads);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
    assert.ok(reads.calls.includes(`membership:${COMPANY_B}:admin-a`), "membership must be looked up for the SUPPLIED company");
  });

  it("admin of A supplying a non-existent company id -> the same 403 as any other foreign company (no existence oracle)", async () => {
    const result = await decideCompanyUserManager({ accessToken: "t-admin-a", companyId: "no-such-company" }, readsFor(baseWorld()));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 403);
  });

  it("missing profile -> 403; missing/invalid token -> 401; missing company -> 400", async () => {
    const world = baseWorld();
    const noProfile = await decideCompanyUserManager({ accessToken: "t-no-profile", companyId: COMPANY_A }, readsFor(world));
    assert.equal(noProfile.ok ? 0 : noProfile.status, 403);
    const badToken = await decideCompanyUserManager({ accessToken: "forged", companyId: COMPANY_A }, readsFor(world));
    assert.equal(badToken.ok ? 0 : badToken.status, 401);
    const noToken = await decideCompanyUserManager({ accessToken: "", companyId: COMPANY_A }, readsFor(world));
    assert.equal(noToken.ok ? 0 : noToken.status, 401);
    const noCompany = await decideCompanyUserManager({ accessToken: "t-admin-a", companyId: "" }, readsFor(world));
    assert.equal(noCompany.ok ? 0 : noCompany.status, 400);
  });

  it("an unusable privileged client (reads error, e.g. an invalid service key) -> 500, never an allow", async () => {
    const cases: Array<{ failure: "failProfileRead" | "failMembershipRead" | "failCompanyRead"; token: string }> = [
      { failure: "failProfileRead", token: "t-admin-a" },
      { failure: "failProfileRead", token: "t-ga" },
      { failure: "failMembershipRead", token: "t-admin-a" },
      { failure: "failCompanyRead", token: "t-ga" },
    ];
    for (const { failure, token } of cases) {
      const result = await decideCompanyUserManager(
        { accessToken: token, companyId: COMPANY_A },
        readsFor({ ...baseWorld(), [failure]: true }),
      );
      assert.equal(result.ok, false, `${failure}/${token} must not allow`);
      if (!result.ok) assert.equal(result.status, 500, `${failure}/${token} must be a server error`);
    }
  });
});

describe("authorizeCompanyUserManager (fail-closed env gate; no network on these paths)", () => {
  it("missing service-role key -> 500 before any token verification or data access, never a user-scoped fallback", async () => {
    const result = await authorizeCompanyUserManager({
      env: env({ serviceRoleKey: null, missingServiceRole: ["SUPABASE_SERVICE_ROLE_KEY"] }),
      accessToken: "any-token",
      companyId: COMPANY_A,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 500);
      assert.match(result.error, /SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it("missing public configuration -> 500; missing token -> 401; missing company -> 400", async () => {
    const noPublic = await authorizeCompanyUserManager({
      env: env({ url: "", missingPublic: ["NEXT_PUBLIC_SUPABASE_URL"] }),
      accessToken: "t",
      companyId: COMPANY_A,
    });
    assert.equal(noPublic.ok ? 0 : noPublic.status, 500);
    const noToken = await authorizeCompanyUserManager({ env: env(), accessToken: "", companyId: COMPANY_A });
    assert.equal(noToken.ok ? 0 : noToken.status, 401);
    const noCompany = await authorizeCompanyUserManager({ env: env(), accessToken: "t", companyId: "" });
    assert.equal(noCompany.ok ? 0 : noCompany.status, 400);
  });
});
