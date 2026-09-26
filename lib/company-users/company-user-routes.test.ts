import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseServerEnv } from "./admin-api.ts";
import { handleAddExistingUser, type AddExistingDeps, type AddExistingMembership } from "./add-existing-user.ts";
import { createAddExistingDeps, createCompanyUserSearchDeps } from "./company-user-routes-server.ts";
import {
  handleCompanyUserSearch,
  type CompanyUserSearchDeps,
  type CompanyUserSearchMembership,
  type CompanyUserSearchProfile,
} from "./company-user-search.ts";

/**
 * Adversarial tests for the company-user search and add-existing routes. The
 * handlers are exercised with recorded fake deps (no Supabase). The real
 * server wiring is exercised only on paths that return before any network
 * call.
 */

const COMPANY_A = "11111111-1111-4111-8111-111111111111";
const COMPANY_B = "22222222-2222-4222-8222-222222222222";

/** token -> companies that token may manage (stands in for authorizeCompanyUserManager). */
const MANAGERS: Record<string, string[]> = {
  "t-admin-a": [COMPANY_A],
  "t-global-admin": [COMPANY_A, COMPANY_B],
};

async function fakeAuthorize({ accessToken, companyId }: { accessToken: string; companyId: string }) {
  if (!accessToken) return { ok: false as const, status: 401, error: "Missing authorization token." };
  if (!MANAGERS[accessToken]) return { ok: false as const, status: 403, error: "Only global admins or active company admins can manage company users." };
  if (!MANAGERS[accessToken].includes(companyId)) {
    return { ok: false as const, status: 403, error: "Only global admins or active company admins can manage company users." };
  }
  return { ok: true as const, requesterUserId: accessToken };
}

const PROFILES: CompanyUserSearchProfile[] = [
  { id: "u-alice", email: "alice@example.com", display_name: "Alice", is_active: true },
  { id: "u-bob", email: "bob@example.com", display_name: "Bob", is_active: false },
  { id: "u-carol", email: "carol@example.com", display_name: "Carol", is_active: true },
];

// Alice: A admin + B technician. Bob: B only. Carol: none.
const ALL_MEMBERSHIPS: CompanyUserSearchMembership[] = [
  { user_id: "u-alice", company_id: COMPANY_A, role: "admin", is_active: true },
  { user_id: "u-alice", company_id: COMPANY_B, role: "technician", is_active: true },
  { user_id: "u-bob", company_id: COMPANY_B, role: "admin", is_active: false },
];

function searchDeps(opts: { authorize?: CompanyUserSearchDeps["authorize"]; leakyMemberships?: boolean } = {}) {
  const calls: string[] = [];
  const deps: CompanyUserSearchDeps = {
    authorize: opts.authorize ?? fakeAuthorize,
    async searchProfiles({ pattern }) {
      calls.push(`search:${pattern}`);
      const needle = pattern.replace(/%/g, "").toLowerCase();
      return {
        profiles: PROFILES.filter((p) => `${p.email} ${p.display_name}`.toLowerCase().includes(needle)),
        error: null,
      };
    },
    async loadCompanyMemberships(companyId, userIds) {
      calls.push(`memberships:${companyId}`);
      // A "leaky" dependency returns every company's rows; the handler must still filter.
      const rows = ALL_MEMBERSHIPS.filter((m) => userIds.includes(m.user_id));
      return { memberships: opts.leakyMemberships ? rows : rows.filter((m) => m.company_id === companyId), error: null };
    },
    async loadCompanyName(companyId) {
      calls.push(`companyName:${companyId}`);
      return { name: companyId === COMPANY_A ? "Company A" : "Company B", error: null };
    },
  };
  return { deps, calls };
}

describe("POST /api/company-users/search (handleCompanyUserSearch)", () => {
  it("authorization failure (e.g. missing service key -> 500) stops before ANY directory read", async () => {
    const { deps, calls } = searchDeps({
      authorize: async () => ({ ok: false, status: 500, error: "This operation is unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured on the server." }),
    });
    const result = await handleCompanyUserSearch({ accessToken: "t-admin-a", companyId: COMPANY_A, query: "example" }, deps);
    assert.equal(result.status, 500);
    assert.deepEqual(calls, [], "no profile/membership/company read may happen when authorization fails");
  });

  it("an ordinary technician / unknown token is denied and reads nothing", async () => {
    const { deps, calls } = searchDeps();
    const result = await handleCompanyUserSearch({ accessToken: "t-technician", companyId: COMPANY_A, query: "example" }, deps);
    assert.equal(result.status, 403);
    assert.deepEqual(calls, []);
  });

  it("admin of company A cannot search on behalf of company B (crafted companyId)", async () => {
    const { deps, calls } = searchDeps();
    const result = await handleCompanyUserSearch({ accessToken: "t-admin-a", companyId: COMPANY_B, query: "example" }, deps);
    assert.equal(result.status, 403);
    assert.deepEqual(calls, []);
  });

  it("never discloses memberships in other companies, even if a dependency returned them", async () => {
    const { deps, calls } = searchDeps({ leakyMemberships: true });
    const result = await handleCompanyUserSearch({ accessToken: "t-admin-a", companyId: COMPANY_A, query: "example" }, deps);
    assert.equal(result.status, 200);
    assert.ok(calls.includes(`memberships:${COMPANY_A}`), "memberships are requested for the authorized company only");
    assert.ok(!calls.some((c) => c.startsWith("memberships:") && c !== `memberships:${COMPANY_A}`));
    const body = JSON.stringify(result.body);
    assert.ok(!body.includes(COMPANY_B), "company B's id must never appear");
    assert.ok(!body.includes("Company B"), "company B's name must never appear");
    const results = (result.body as { results: Array<Record<string, unknown>> }).results;
    const alice = results.find((r) => r.userId === "u-alice")!;
    assert.deepEqual(alice.companyMemberships, [{ companyId: COMPANY_A, companyName: "Company A", role: "admin", isActive: true }]);
    assert.deepEqual(alice.targetCompanyMembership, { role: "admin", isActive: true });
    const bob = results.find((r) => r.userId === "u-bob")!;
    assert.deepEqual(bob.companyMemberships, [], "Bob's company-B membership must not be disclosed to company A");
    assert.equal(bob.targetCompanyMembership, null);
  });

  it("keeps the response contract the add-user UI relies on (shape, inactive profiles flagged)", async () => {
    const { deps } = searchDeps();
    const result = await handleCompanyUserSearch({ accessToken: "t-admin-a", companyId: COMPANY_A, query: "example" }, deps);
    assert.equal(result.status, 200);
    const results = (result.body as { results: Array<Record<string, unknown>> }).results;
    assert.deepEqual(results.map((r) => r.userId), ["u-alice", "u-bob", "u-carol"], "sorted by display name");
    for (const r of results) {
      assert.deepEqual(Object.keys(r).sort(), [
        "companyMemberships",
        "displayName",
        "email",
        "profileIsActive",
        "targetCompanyMembership",
        "userId",
      ]);
    }
    assert.equal(results.find((r) => r.userId === "u-bob")!.profileIsActive, false);
  });

  it("global admin may search for any company; results are still scoped to that company", async () => {
    const { deps, calls } = searchDeps({ leakyMemberships: true });
    const result = await handleCompanyUserSearch({ accessToken: "t-global-admin", companyId: COMPANY_B, query: "example" }, deps);
    assert.equal(result.status, 200);
    assert.ok(calls.includes(`memberships:${COMPANY_B}`));
    const alice = (result.body as { results: Array<Record<string, unknown>> }).results.find((r) => r.userId === "u-alice")!;
    assert.deepEqual(alice.targetCompanyMembership, { role: "technician", isActive: true });
    assert.ok(!JSON.stringify(result.body).includes(COMPANY_A));
  });

  it("rejects too-short queries before authorization or any read", async () => {
    const { deps, calls } = searchDeps();
    const result = await handleCompanyUserSearch({ accessToken: "t-admin-a", companyId: COMPANY_A, query: " a " }, deps);
    assert.equal(result.status, 400);
    assert.deepEqual(calls, []);
  });
});

function addExistingDeps(opts: { authorize?: AddExistingDeps["authorize"]; existing?: AddExistingMembership | null } = {}) {
  const calls: string[] = [];
  const upserts: Array<{ companyId: string; userId: string; role: string }> = [];
  const deps: AddExistingDeps = {
    authorize: opts.authorize ?? fakeAuthorize,
    async loadProfile(userId) {
      calls.push(`profile:${userId}`);
      const p = PROFILES.find((x) => x.id === userId) ?? null;
      return { profile: p, error: null };
    },
    async loadMembership(companyId, userId) {
      calls.push(`membership:${companyId}:${userId}`);
      return { membership: opts.existing === undefined ? null : opts.existing, error: null };
    },
    async upsertMembership(row) {
      calls.push(`upsert:${row.companyId}:${row.userId}:${row.role}`);
      upserts.push(row);
      return { error: null };
    },
  };
  return { deps, calls, upserts };
}

describe("POST /api/company-users/add-existing (handleAddExistingUser)", () => {
  it("authorization failure (e.g. missing service key -> 500) writes nothing and reads nothing", async () => {
    const { deps, calls } = addExistingDeps({
      authorize: async () => ({ ok: false, status: 500, error: "This operation is unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured on the server." }),
    });
    const result = await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_A, userId: "u-carol", role: "technician" }, deps);
    assert.equal(result.status, 500);
    assert.deepEqual(calls, []);
  });

  it("admin of company A cannot add a user to company B (crafted companyId) - no write", async () => {
    const { deps, calls } = addExistingDeps();
    const result = await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_B, userId: "u-carol", role: "admin" }, deps);
    assert.equal(result.status, 403);
    assert.deepEqual(calls, []);
  });

  it("ordinary technician is denied - no write", async () => {
    const { deps, calls } = addExistingDeps();
    const result = await handleAddExistingUser({ accessToken: "t-technician", companyId: COMPANY_A, userId: "u-carol", role: "technician" }, deps);
    assert.equal(result.status, 403);
    assert.deepEqual(calls, []);
  });

  it("active company admin adds a new member: writes ONLY the authorized company, keeps the contract", async () => {
    const { deps, upserts } = addExistingDeps({ existing: null });
    const result = await handleAddExistingUser(
      { accessToken: "t-admin-a", companyId: COMPANY_A, userId: "u-carol", role: "technician" },
      deps,
      () => new Date("2026-09-25T00:00:00.000Z"),
    );
    assert.equal(result.status, 200);
    assert.deepEqual(upserts, [{ companyId: COMPANY_A, userId: "u-carol", role: "technician", updatedAt: "2026-09-25T00:00:00.000Z" }]);
    assert.deepEqual(result.body, {
      ok: true,
      userId: "u-carol",
      alreadyActive: false,
      reactivated: false,
      created: true,
      displayName: "Carol",
      email: "carol@example.com",
      message: "Existing user added to this company.",
    });
  });

  it("reactivates an inactive membership (contract: reactivated true, created false)", async () => {
    const { deps, upserts } = addExistingDeps({ existing: { user_id: "u-bob", role: "technician", is_active: false } });
    const result = await handleAddExistingUser({ accessToken: "t-global-admin", companyId: COMPANY_B, userId: "u-bob", role: "technician" }, deps);
    assert.equal(result.status, 200);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].companyId, COMPANY_B);
    assert.equal((result.body as { reactivated: boolean }).reactivated, true);
    assert.equal((result.body as { created: boolean }).created, false);
  });

  it("already-active member: no write, alreadyActive true", async () => {
    const { deps, upserts } = addExistingDeps({ existing: { user_id: "u-alice", role: "admin", is_active: true } });
    const result = await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_A, userId: "u-alice", role: "technician" }, deps);
    assert.equal(result.status, 200);
    assert.equal(upserts.length, 0);
    assert.equal((result.body as { alreadyActive: boolean }).alreadyActive, true);
  });

  it("validates input before authorization: missing user 400, invalid role 400", async () => {
    const { deps, calls } = addExistingDeps();
    assert.equal((await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_A, userId: " ", role: "admin" }, deps)).status, 400);
    assert.equal((await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_A, userId: "u-carol", role: "owner" }, deps)).status, 400);
    assert.deepEqual(calls, []);
  });

  it("unknown target user -> 404, no write", async () => {
    const { deps, upserts } = addExistingDeps();
    const result = await handleAddExistingUser({ accessToken: "t-admin-a", companyId: COMPANY_A, userId: "u-nobody", role: "technician" }, deps);
    assert.equal(result.status, 404);
    assert.equal(upserts.length, 0);
  });
});

describe("real server wiring (fail closed; no network on these paths)", () => {
  const noKeyEnv: SupabaseServerEnv = {
    url: "https://example.supabase.co",
    anonKey: "anon-key",
    serviceRoleKey: null,
    missingPublic: [],
    missingServiceRole: ["SUPABASE_SERVICE_ROLE_KEY"],
  };

  it("search: missing service key -> 500 from the real authorize, and the route returns it", async () => {
    const result = await handleCompanyUserSearch(
      { accessToken: "any", companyId: COMPANY_A, query: "example" },
      createCompanyUserSearchDeps(noKeyEnv),
    );
    assert.equal(result.status, 500);
    assert.match(String((result.body as { error: string }).error), /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("add-existing: missing service key -> 500 from the real authorize, no write attempted", async () => {
    const result = await handleAddExistingUser(
      { accessToken: "any", companyId: COMPANY_A, userId: "u-carol", role: "technician" },
      createAddExistingDeps(noKeyEnv),
    );
    assert.equal(result.status, 500);
  });

  it("data access before a successful authorize() is impossible (throws, never uses another client)", async () => {
    const searchDepsReal = createCompanyUserSearchDeps(noKeyEnv);
    await assert.rejects(() => searchDepsReal.searchProfiles({ pattern: "%x%", exactUserId: null, limit: 25 }), /before authorization/);
    await assert.rejects(() => searchDepsReal.loadCompanyMemberships(COMPANY_A, ["u"]), /before authorization/);
    const addDepsReal = createAddExistingDeps(noKeyEnv);
    await assert.rejects(
      () => addDepsReal.upsertMembership({ companyId: COMPANY_A, userId: "u", role: "admin", updatedAt: "now" }),
      /before authorization/,
    );
    // A failed authorize() does not unlock data access either.
    await addDepsReal.authorize({ accessToken: "any", companyId: COMPANY_A });
    await assert.rejects(() => addDepsReal.loadProfile("u"), /before authorization/);
  });
});
