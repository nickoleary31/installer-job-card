import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SELECTED_COMPANY_ID_KEY,
  SELECTED_CONTEXT_USER_ID_KEY,
  SELECTED_PROJECT_ID_KEY,
  clearActiveProject,
  readActiveProjectForUser,
  setActiveProject,
  type ActiveProjectStorage,
} from "./active-project-context.ts";

class MemoryStorage implements ActiveProjectStorage {
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

describe("active-project-context — the selected-project navigation pointer", () => {
  it("readActiveProjectForUser returns the pointer only for the user who set it", () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    assert.deepEqual(readActiveProjectForUser("user-A", storage), { companyId: "company-A", projectId: "project-A" });
    assert.equal(readActiveProjectForUser("user-B", storage), null, "User B must never inherit User A's project context");
    assert.equal(readActiveProjectForUser(null, storage), null);
  });

  it("a pointer set without a known user (or a legacy pointer from before owners were recorded) is no project for anyone", () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    setActiveProject({ companyId: "company-B", projectId: "project-B" }, storage);
    assert.equal(storage.getItem(SELECTED_CONTEXT_USER_ID_KEY), null, "replacing the pointer must drop the previous owner");
    assert.equal(readActiveProjectForUser("user-A", storage), null);

    const legacy = new MemoryStorage();
    legacy.setItem(SELECTED_COMPANY_ID_KEY, "company-A");
    legacy.setItem(SELECTED_PROJECT_ID_KEY, "project-A");
    assert.equal(readActiveProjectForUser("user-A", legacy), null);
  });

  it("a half-written pointer is no project", () => {
    const storage = new MemoryStorage();
    storage.setItem(SELECTED_CONTEXT_USER_ID_KEY, "user-A");
    storage.setItem(SELECTED_PROJECT_ID_KEY, "project-A");
    assert.equal(readActiveProjectForUser("user-A", storage), null);
  });

  it("clearActiveProject removes exactly the three pointer keys and nothing else", () => {
    const storage = new MemoryStorage();
    setActiveProject({ companyId: "company-A", projectId: "project-A", userId: "user-A" }, storage);
    storage.setItem("installer-offline-draft-id", "draft-1");
    storage.setItem("jobCard_autosave", "{}");

    clearActiveProject(storage);

    assert.equal(storage.getItem(SELECTED_COMPANY_ID_KEY), null);
    assert.equal(storage.getItem(SELECTED_PROJECT_ID_KEY), null);
    assert.equal(storage.getItem(SELECTED_CONTEXT_USER_ID_KEY), null);
    assert.equal(storage.getItem("installer-offline-draft-id"), "draft-1");
    assert.equal(storage.getItem("jobCard_autosave"), "{}");
  });
});
