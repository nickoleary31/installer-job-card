import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SignOutDeps } from "./sign-out.ts";

/**
 * sign-out.ts imports the real `supabase` client, which needs these env vars
 * at module-evaluation time — same established workaround as
 * lib/submission-sync.test.ts: dummy values set before a dynamic import.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.local";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

const { signOutAndClearOfflineState } = await import("./sign-out.ts");
const { SELECTED_COMPANY_ID_KEY, SELECTED_CONTEXT_USER_ID_KEY, SELECTED_PROJECT_ID_KEY, clearActiveProject, setActiveProject } =
  await import("../active-project-context.ts");

class MemoryStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

function recordingDeps(storage: MemoryStorage, overrides: Partial<SignOutDeps> = {}) {
  const calls: string[] = [];
  const deps: SignOutDeps = {
    deleteStarterDataSnapshot: async (userId) => {
      calls.push(`deleteStarterDataSnapshot:${userId}`);
    },
    isNative: () => true,
    clearLease: async () => {
      calls.push("clearLease");
    },
    clearActiveProject: () => {
      calls.push("clearActiveProject");
      clearActiveProject(storage);
    },
    signOut: async () => {
      calls.push("signOut");
      return { error: null };
    },
    ...overrides,
  };
  return { deps, calls };
}

describe("signOutAndClearOfflineState — explicit logout (Checkpoint 1)", () => {
  it("C: clears the selected company/project context so the next user starts with none", async () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    const { deps } = recordingDeps(storage);

    await signOutAndClearOfflineState("user-A", deps);

    assert.equal(storage.getItem(SELECTED_COMPANY_ID_KEY), null);
    assert.equal(storage.getItem(SELECTED_PROJECT_ID_KEY), null);
    assert.equal(storage.getItem(SELECTED_CONTEXT_USER_ID_KEY), null);
  });

  it("C: touches nothing but the starter cache, the lease, the navigation pointer and the Supabase session — pending local work is never deleted", async () => {
    const storage = new MemoryStorage();
    const { deps, calls } = recordingDeps(storage);

    await signOutAndClearOfflineState("user-A", deps);

    // SignOutDeps has no local-submission, local-photo or outbox operation at
    // all, so logout structurally cannot delete this user's (or any other
    // user's) pending work; this pins the exact side effects it does have.
    assert.deepEqual(calls, ["deleteStarterDataSnapshot:user-A", "clearLease", "clearActiveProject", "signOut"]);
  });

  it("clears the pointer even when an earlier cleanup step fails, and still signs out", async () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    const { deps, calls } = recordingDeps(storage, {
      deleteStarterDataSnapshot: async () => {
        throw new Error("IndexedDB unavailable");
      },
      clearLease: async () => {
        throw new Error("secure storage unavailable");
      },
    });

    await signOutAndClearOfflineState("user-A", deps);

    assert.equal(storage.getItem(SELECTED_PROJECT_ID_KEY), null);
    assert.deepEqual(calls, ["clearActiveProject", "signOut"]);
  });

  it("web (not native) keeps its existing logout behavior: no lease, and the pointer is left alone", async () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    const { deps, calls } = recordingDeps(storage, { isNative: () => false });

    await signOutAndClearOfflineState("user-A", deps);

    assert.deepEqual(calls, ["deleteStarterDataSnapshot:user-A", "signOut"]);
    assert.equal(storage.getItem(SELECTED_PROJECT_ID_KEY), "project-A");
  });

  it("surfaces a Supabase sign-out error", async () => {
    const storage = new MemoryStorage();
    const { deps } = recordingDeps(storage, { signOut: async () => ({ error: new Error("network down") }) });
    await assert.rejects(() => signOutAndClearOfflineState("user-A", deps), /network down/);
  });
});
