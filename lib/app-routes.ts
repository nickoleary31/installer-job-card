/**
 * Centralizes the handful of navigation paths shared screens need, so they
 * don't have to know whether they're running in the normal Installer
 * Sheetz web app (dynamic file-based routes, e.g.
 * /companies/[companyId]/projects/[projectId]) or the mobile-web static
 * export, which can't have dynamic [param] routes at all — see
 * mobile-web/next.config.ts's `output: "export"` and the Phase 1B/1C
 * architecture notes in docs/Mobile_Development.md. The mobile build
 * resolves the same logical destinations to static routes with query
 * parameters instead (e.g. /project?companyId=...&projectId=...).
 *
 * Reuses NEXT_PUBLIC_API_ORIGIN (see lib/api-base.ts) as the "which build
 * is this" signal rather than introducing a second env var — in this
 * project's topology the mobile-web build is the one build that always
 * sets it, so the two concerns (API origin, route shape) happen to share
 * one on/off switch. Deliberately a build-time check (inlined by Next at
 * build time), not a runtime Capacitor check — these are two separate
 * static bundles with two different route sets, not one bundle branching
 * at runtime.
 */
function isMobileStaticBuild(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_ORIGIN);
}

export const appRoutes = {
  login(): string {
    return isMobileStaticBuild() ? "/" : "/login";
  },
  /**
   * "Go to my work" destination. Web keeps its existing /home hub
   * (unchanged). Mobile has no /home surface at all — it lands on Installs,
   * the cross-company active-projects list, which is now mobile's actual
   * post-login landing page.
   */
  home(): string {
    return isMobileStaticBuild() ? "/installs" : "/home";
  },
  /** The cross-company active-projects landing page — same path on both platforms. */
  installs(): string {
    return "/installs";
  },
  companies(): string {
    return "/companies";
  },
  /**
   * Company-scoped project list. Web keeps the existing admin/company
   * drill-down page (unchanged). Mobile no longer has a company-scoped
   * projects route — the closest equivalent "list of my projects" is now
   * Installs, so callers on mobile (e.g. ProjectDetailScreen's "back" link)
   * land there instead. companyId is unused on the mobile branch.
   */
  projects(companyId: string): string {
    return isMobileStaticBuild() ? "/installs" : `/companies/${encodeURIComponent(companyId)}/projects`;
  },
  project(companyId: string, projectId: string): string {
    return isMobileStaticBuild()
      ? `/project?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`
      : `/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}`;
  },
  newSubmission(): string {
    return "/new-submission";
  },
  /**
   * Phase 2H — native Saved Job Cards (LocalSubmission rows not yet
   * technician-submitted). Web keeps its existing Cloud Draft /drafts page
   * unchanged; mobile has no equivalent route today, so this is a genuinely
   * new mobile-only screen, not a query-param mirror of an existing web
   * route — see components/SavedJobCardsScreen.tsx's own scope doc.
   */
  savedJobCards(companyId: string, projectId: string): string {
    return isMobileStaticBuild()
      ? `/saved-job-cards?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`
      : "/drafts";
  },
  /**
   * Phase 2H — native Submitted (technician-submitted, local+server merged
   * — see components/SubmittedJobCardsScreen.tsx). Web keeps its existing
   * /submitted page unchanged.
   */
  submitted(companyId: string, projectId: string): string {
    return isMobileStaticBuild()
      ? `/submitted-job-cards?companyId=${encodeURIComponent(companyId)}&projectId=${encodeURIComponent(projectId)}`
      : "/submitted";
  },
};
