/**
 * Canonical location for the current selected-project boundary — the
 * company/project a technician is currently working in, used by
 * NewSubmissionForm to know which project a job card belongs to.
 *
 * This is NOT the offline project-package/local-first architecture. It's
 * just today's selected-project pointer, unchanged in scope from what
 * ProjectDetailScreen already did before this was consolidated here.
 */
export const SELECTED_COMPANY_ID_KEY = "installer-selected-company-id";
export const SELECTED_PROJECT_ID_KEY = "installer-selected-project-id";

export function setActiveProject({ companyId, projectId }: { companyId: string; projectId: string }): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_COMPANY_ID_KEY, companyId);
    window.localStorage.setItem(SELECTED_PROJECT_ID_KEY, projectId);
  } catch {
    // ignore storage errors
  }
}
