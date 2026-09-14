/**
 * Phase 0B auto-publish: after a completed Installer Sheetz job card is first submitted or an
 * existing completed submission is revised, notify the hosted Zoho FSM orchestrator so it can run
 * its own publish/revision/idempotency logic. This module intentionally owns NONE of that logic
 * (no PDF generation, no Zoho upload, no ledger, no retries) — it only resolves "which Zoho
 * Service Appointment does this project map to" and fires one POST.
 *
 * Kept as plain interfaces (rather than a direct Supabase/fetch dependency) so the branching
 * logic below can be unit tested with in-memory fakes, matching this repo's existing convention
 * (see resolve.ts's ZohoFsmRepo). Real implementations live in ./orchestrator-client.ts.
 */

export interface ZohoAutoPublishRepo {
  /** Returns null when the project has no linked Zoho Service Appointment (unlinked project). */
  resolveServiceAppointmentId(projectId: string): Promise<string | null>;
}

export interface ZohoAutoPublishNotifier {
  publish(zohoServiceAppointmentId: string): Promise<{ ok: boolean; status?: number }>;
}

export type AutoPublishOutcome =
  | "disabled" // orchestrator env not configured — treated as auto-publish being off
  | "unlinked" // project has no linked Zoho Service Appointment
  | "notified" // orchestrator accepted the notification (2xx)
  | "notify_failed"; // resolving the link, or the orchestrator call itself, failed

export type AutoPublishResult = {
  outcome: AutoPublishOutcome;
  zohoServiceAppointmentId?: string;
};

function logFailure(message: string, error: unknown): void {
  console.error(`[zoho-fsm] auto-publish: ${message}`, error instanceof Error ? error.message : error);
}

/**
 * Never throws — this is designed to run where nothing awaits or reacts to its result (e.g.
 * inside next/server's after()), so a downstream failure must only ever be logged, never
 * surfaced as a failure of the Installer Sheetz submission/revision that triggered it. The
 * orchestrator is the sole authority on publish/idempotency/revision logic; duplicate
 * notifications for the same Service Appointment are expected and safe.
 */
export async function triggerZohoPublishForProject(
  projectId: string,
  repo: ZohoAutoPublishRepo,
  notifier: ZohoAutoPublishNotifier | null,
): Promise<AutoPublishResult> {
  if (!notifier) {
    console.warn(`[zoho-fsm] auto-publish disabled (orchestrator env not configured) — skipped project ${projectId}`);
    return { outcome: "disabled" };
  }

  let zohoServiceAppointmentId: string | null;
  try {
    zohoServiceAppointmentId = await repo.resolveServiceAppointmentId(projectId);
  } catch (error) {
    logFailure(`failed to resolve linked Service Appointment for project ${projectId}`, error);
    return { outcome: "notify_failed" };
  }

  if (!zohoServiceAppointmentId) {
    return { outcome: "unlinked" };
  }

  try {
    const result = await notifier.publish(zohoServiceAppointmentId);
    if (!result.ok) {
      logFailure(
        `orchestrator rejected publish-sa for SA ${zohoServiceAppointmentId} (status ${result.status ?? "unknown"})`,
        null,
      );
      return { outcome: "notify_failed", zohoServiceAppointmentId };
    }
    return { outcome: "notified", zohoServiceAppointmentId };
  } catch (error) {
    logFailure(`request to orchestrator failed for SA ${zohoServiceAppointmentId}`, error);
    return { outcome: "notify_failed", zohoServiceAppointmentId };
  }
}

// ---------------------------------------------------------------------------------------------
// Route-level request handling: authentication/authorization gate in front of the trigger above.
// Kept as an injectable-dependency function (same rationale as triggerZohoPublishForProject) so
// the auth-gating branches — the security-critical part of this route — can be unit tested
// without a live Supabase project or a constructed Next.js Request. The real route
// (app/api/integrations/zoho-fsm/auto-publish/route.ts) wires this to
// lib/project-access.ts's authorizeProjectAccess, the same check already used to gate other
// project-scoped server operations (e.g. the expense report export) for a global admin, an
// active company admin, or a technician with an active assignment on this specific project.
// ---------------------------------------------------------------------------------------------

export type ProjectAuthResult = { ok: true } | { ok: false; status: number; error: string };

export interface AutoPublishAuthorizer {
  authorize(args: { accessToken: string; companyId: string; projectId: string }): Promise<ProjectAuthResult>;
}

export type AutoPublishRequestResult =
  | { status: number; body: { error: string } }
  | {
      status: 202;
      body: { status: "accepted" };
      /**
       * The slow orchestrator work, deferred for the route to schedule via next/server's after()
       * — NOT invoked by handleAutoPublishRequest itself. This is what keeps "authorize and
       * respond" and "resolve the SA link and notify the orchestrator" as two separate phases:
       * the former gates the response the caller waits on, the latter runs only after that
       * response has already been sent and can never change it.
       */
      scheduleAfterWork: () => Promise<AutoPublishResult>;
    };

/**
 * No projectId is ever privileged on its own: every path here goes through the authorizer first,
 * and repo/notifier (the only things that can reach Zoho) are never touched unless it approves.
 */
export async function handleAutoPublishRequest(
  input: { accessToken: string; companyId: string; projectId: string },
  authorizer: AutoPublishAuthorizer,
  repo: ZohoAutoPublishRepo,
  notifier: ZohoAutoPublishNotifier | null,
): Promise<AutoPublishRequestResult> {
  const auth = await authorizer.authorize(input);
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  return {
    status: 202,
    body: { status: "accepted" },
    scheduleAfterWork: () => triggerZohoPublishForProject(input.projectId, repo, notifier),
  };
}
