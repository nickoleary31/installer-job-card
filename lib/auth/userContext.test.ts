import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { User } from "@supabase/supabase-js";
import type { UserContextDeps } from "./userContext.ts";

/**
 * iOS offline-auth latency fix — proves resolveAuthUserContext()'s native
 * definitively-offline fast path (see this file's own doc on
 * UserContextDeps) actually skips the network-bound path rather than merely
 * being designed to. `resolveOnlineUser` below throws on any call so a test
 * that reaches it fails loudly instead of silently passing by accident.
 *
 * userContext.ts's real `supabase` client throws at module-evaluation time
 * if NEXT_PUBLIC_SUPABASE_URL/ANON_KEY are unset (see lib/supabase/client.ts)
 * — never actually needed by the fast-path logic under test here, but the
 * import still has to resolve. Dummy values set before the dynamic import
 * below (which, unlike a static import, is NOT hoisted) satisfy that without
 * touching lib/supabase/client.ts or the shared test env for every other file.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { resolveAuthUserContext } = await import("./userContext.ts");

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    email: "jane@example.com",
    ...overrides,
  } as User;
}

function networkPathShouldNotBeCalled(): Promise<User | null> {
  throw new Error("resolveOnlineUser() must not be called when native connectivity is already definitively offline");
}

function fakeDeps(overrides: Partial<UserContextDeps> = {}): UserContextDeps {
  return {
    isNative: () => true,
    isOnlineFresh: async () => true,
    getLocalSessionUser: async () => null,
    resolveOnlineUser: networkPathShouldNotBeCalled,
    ...overrides,
  };
}

describe("resolveAuthUserContext — native definitively-offline fast path", () => {
  it("native + definitively offline + a local session user exists -> resolves via the offline fallback WITHOUT ever calling resolveOnlineUser (the network-bound path)", async () => {
    const deps = fakeDeps({
      isOnlineFresh: async () => false,
      getLocalSessionUser: async () => fakeUser(),
    });
    const result = await resolveAuthUserContext(deps);
    // Never throws — proves resolveOnlineUser (which throws if called) was never invoked.
    assert.equal(result.source.kind, "offline-transport");
    assert.equal(result.context.userId, "user-1");
  });

  it("native + definitively offline + NO local session -> signed-out, still without calling resolveOnlineUser", async () => {
    const deps = fakeDeps({
      isOnlineFresh: async () => false,
      getLocalSessionUser: async () => null,
    });
    const result = await resolveAuthUserContext(deps);
    assert.equal(result.source.kind, "signed-out");
    assert.equal(result.context.userId, null);
  });

  it("native + online (isOnlineFresh true) -> takes the normal path, calling resolveOnlineUser", async () => {
    let called = false;
    const deps = fakeDeps({
      isOnlineFresh: async () => true,
      resolveOnlineUser: async () => {
        called = true;
        return null; // short-circuits to signed-out before ever touching real Supabase profile/membership calls
      },
    });
    const result = await resolveAuthUserContext(deps);
    assert.equal(called, true, "the online path must call resolveOnlineUser");
    assert.equal(result.source.kind, "signed-out");
  });

  it("native + connectivity check throws (ambiguous) -> falls through to the normal online path, never silently treated as offline", async () => {
    let onlinePathCalled = false;
    const deps = fakeDeps({
      isOnlineFresh: async () => {
        throw new Error("simulated native connectivity check failure");
      },
      resolveOnlineUser: async () => {
        onlinePathCalled = true;
        return null;
      },
    });
    const result = await resolveAuthUserContext(deps);
    assert.equal(onlinePathCalled, true, "an ambiguous/failed connectivity check must not skip to the offline fast path");
    assert.equal(result.source.kind, "signed-out");
  });

  it("web/PWA (isNative false) -> never even evaluates isOnlineFresh, always uses the normal resolveOnlineUser path", async () => {
    let isOnlineFreshCalled = false;
    let onlinePathCalled = false;
    const deps = fakeDeps({
      isNative: () => false,
      isOnlineFresh: async () => {
        isOnlineFreshCalled = true;
        return false;
      },
      resolveOnlineUser: async () => {
        onlinePathCalled = true;
        return null;
      },
    });
    const result = await resolveAuthUserContext(deps);
    assert.equal(isOnlineFreshCalled, false, "web must never consult the native connectivity fast path at all");
    assert.equal(onlinePathCalled, true);
    assert.equal(result.source.kind, "signed-out");
  });
});
