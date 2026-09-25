/**
 * Checkpoint 1 — the company/project a native job card belongs to.
 *
 * A native local submission is bound to exactly one (user, company, project)
 * when it is created or resumed, and that binding is authoritative from then
 * on: autosave, durable photo saves and the final technician submit all use
 * it, never the mutable device-wide selected-project pointer
 * (lib/active-project-context.ts). The local_submissions row stores the same
 * three ids and never changes them after the row is first written (see
 * lib/native/local-submission.ts), so the stored row is the durable record of
 * the binding.
 *
 * If the binding cannot be proven, native submission fails closed with a
 * user-visible error. There is deliberately NO default project on native —
 * the web-only Powerfleet "Default Project" fallback in NewSubmissionForm is
 * never reachable from the native runtime.
 */

export type SubmissionBinding = {
  userId: string;
  companyId: string;
  projectId: string;
};

export const NATIVE_SUBMISSION_UNBOUND_MESSAGE =
  "This job card isn't linked to a project on this device, so it can't be saved or submitted. Go back to Active Projects, open the project, and start the job card from there.";

export const NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE =
  "This job card is saved on this device under a different project or user than the one open now, so it wasn't submitted. Go back to Active Projects, open the job card's own project, and resume it from Saved Job Cards.";

export class SubmissionBindingError extends Error {}

/** `null` unless all three ids are present — a partial binding is no binding. */
export function toSubmissionBinding(
  userId: string | null | undefined,
  context: { companyId: string; projectId: string } | null | undefined,
): SubmissionBinding | null {
  const u = userId?.trim() || "";
  const c = context?.companyId?.trim() || "";
  const p = context?.projectId?.trim() || "";
  if (!u || !c || !p) return null;
  return { userId: u, companyId: c, projectId: p };
}

export function sameSubmissionBinding(a: SubmissionBinding, b: SubmissionBinding): boolean {
  return a.userId === b.userId && a.companyId === b.companyId && a.projectId === b.projectId;
}

/**
 * The company/project NewSubmissionForm uses for every project-scoped
 * operation. Native: the form's own binding, or a SubmissionBindingError —
 * never the selected-project pointer and never a default project. Web:
 * unchanged — the selected pointer, else the caller's web-only default.
 */
export async function resolveSubmissionContextIds(args: {
  isNative: boolean;
  nativeBinding: SubmissionBinding | null;
  selectedCompanyId: string;
  selectedProjectId: string;
  resolveWebDefault: () => Promise<{ companyId: string; projectId: string }>;
}): Promise<{ companyId: string; projectId: string }> {
  if (args.isNative) {
    if (!args.nativeBinding) throw new SubmissionBindingError(NATIVE_SUBMISSION_UNBOUND_MESSAGE);
    return { companyId: args.nativeBinding.companyId, projectId: args.nativeBinding.projectId };
  }
  if (args.selectedCompanyId && args.selectedProjectId) {
    return { companyId: args.selectedCompanyId, projectId: args.selectedProjectId };
  }
  return args.resolveWebDefault();
}

export type NativeSubmitBindingResult = { ok: true; binding: SubmissionBinding } | { ok: false; error: string };

/**
 * The final-submit check. `sessionBinding` is what this form instance
 * captured when it created or resumed the job card; `storedBinding` is the
 * local_submissions row for the same id, if one exists. Both must belong to
 * the signed-in user and, when a stored row exists, describe exactly the same
 * company/project — otherwise the submit fails closed rather than choosing
 * one of them.
 */
export function verifyNativeSubmitBinding(args: {
  currentUserId: string | null | undefined;
  sessionBinding: SubmissionBinding | null;
  storedBinding: SubmissionBinding | null;
}): NativeSubmitBindingResult {
  const { currentUserId, sessionBinding, storedBinding } = args;
  if (!currentUserId || !sessionBinding || sessionBinding.userId !== currentUserId) {
    return { ok: false, error: NATIVE_SUBMISSION_UNBOUND_MESSAGE };
  }
  if (storedBinding && !sameSubmissionBinding(storedBinding, sessionBinding)) {
    return { ok: false, error: NATIVE_SUBMISSION_BINDING_MISMATCH_MESSAGE };
  }
  return { ok: true, binding: sessionBinding };
}
