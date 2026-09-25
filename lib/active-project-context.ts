/**
 * Canonical location for the current selected-project boundary — the
 * company/project a technician is currently NAVIGATING in. It is a mutable,
 * device-wide UI pointer, NOT the project a job card belongs to: a native
 * local submission's company/project is captured once, when it is created or
 * resumed, and is authoritative from then on (see lib/submission-binding.ts).
 *
 * This is NOT the offline project-package/local-first architecture. It's
 * just today's selected-project pointer, unchanged in scope from what
 * ProjectDetailScreen already did before this was consolidated here.
 *
 * The pointer records which signed-in user set it
 * (SELECTED_CONTEXT_USER_ID_KEY) so one user's selection can never become
 * another user's project context on the same device — the native app has no
 * explicit logout control today, so a session can end (expiry, denial)
 * without clearActiveProject() ever running. readActiveProjectForUser() only
 * returns a pointer set by that same user. Web readers still read the raw
 * keys directly and are unaffected.
 */
export const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
export const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";
export const SELECTED_CONTEXT_USER_ID_KEY = "installer-selected-context-user-id";

export type ActiveProjectStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): ActiveProjectStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function setActiveProject(
  { companyId, projectId, userId }: { companyId: string; projectId: string; userId?: string | null },
  storage: ActiveProjectStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
    storage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
    // Never leave a previous owner attached to a pointer this call replaced.
    if (userId) storage.setItem(SELECTED_CONTEXT_USER_ID_KEY, userId);
    else storage.removeItem(SELECTED_CONTEXT_USER_ID_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * The selected company/project, but only when it was set by `userId` and both
 * ids are present. Anything else — no user, a pointer set by a different user,
 * a pointer with no recorded owner, a half-written pointer — is `null`: the
 * caller must treat that as "no project selected", never guess.
 */
export function readActiveProjectForUser(
  userId: string | null | undefined,
  storage: ActiveProjectStorage | null = defaultStorage(),
): { companyId: string; projectId: string } | null {
  if (!userId || !storage) return null;
  try {
    const owner = storage.getItem(SELECTED_CONTEXT_USER_ID_KEY)?.trim() || "";
    const companyId = storage.getItem(SELECTED_COMPANY_ID_KEY)?.trim() || "";
    const projectId = storage.getItem(SELECTED_PROJECT_ID_KEY)?.trim() || "";
    if (owner !== userId || !companyId || !projectId) return null;
    return { companyId, projectId };
  } catch {
    return null;
  }
}

/** Clears the navigation pointer only — never touches local submissions, photos, or outbox rows. */
export function clearActiveProject(storage: ActiveProjectStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SELECTED_COMPANY_ID_KEY);
    storage.removeItem(SELECTED_PROJECT_ID_KEY);
    storage.removeItem(SELECTED_CONTEXT_USER_ID_KEY);
  } catch {
    // ignore storage errors
  }
}
