import type { JobCardSubmissionPayload } from "../job-card-submission.ts";
import { isSafePathSegment, validatePayloadStorageReferences } from "../storage-references.ts";

/**
 * Checkpoint 2 — the authorization gate in front of POST /api/send-email.
 *
 * What was wrong: the route accepted any body from anyone (no token at
 * all), downloaded whatever photo/product-file paths — and even whatever
 * bucket — the body named, using the service role, and emailed the result
 * to whatever project recipients the body listed. That is an
 * unauthenticated "read any object in Storage and mail it anywhere"
 * endpoint.
 *
 * Callers (both in-repo, both web-only, both already signed in): the
 * post-submit email step in components/NewSubmissionForm.tsx and the
 * resend buttons on app/submitted/page.tsx. The native app never calls it.
 *
 * What the gate proves, in order, before the route touches Storage or
 * Resend:
 *  1. identity — a verified Supabase session (Bearer token), never the
 *     body's own sentByUserId;
 *  2. scope — the submission's company/project come from the stored
 *     job_card_submissions row for payload.submissionId, never from the
 *     body, and the requester must pass the shared project-access check
 *     (global admin / active company admin / assigned technician; inactive
 *     users and projects are refused there);
 *  3. references — every photo and product-file path in the body must lie
 *     inside that submission's own storage scope (lib/storage-references.ts);
 *     buckets are fixed, never taken from the body;
 *  4. recipients — the project's external recipients are re-read from the
 *     projects table; the body's own recipient lists are discarded.
 *
 * Pure given its deps, so every branch is unit-tested — see
 * authorize-send-email.test.ts. The real wiring is
 * authorize-send-email-server.ts.
 */

export type SendEmailAuthDeps = {
  /** The stored row's own company/project for this submission id — the ONLY scope the route acts in. */
  loadSubmissionScope(submissionId: string): Promise<{ scope: { companyId: string; projectId: string } | null; error?: boolean }>;
  authorizeProject(args: {
    accessToken: string;
    companyId: string;
    projectId: string;
  }): Promise<{ ok: true; requesterUserId: string } | { ok: false; status: number; error: string }>;
  loadProjectRecipientEmails(projectId: string): Promise<{ emails: string[]; error?: boolean }>;
};

export type SendEmailAuthResult =
  | {
      ok: true;
      requesterUserId: string;
      companyId: string;
      projectId: string;
      /** The body's payload with its recipient lists replaced by the project's own. */
      payload: JobCardSubmissionPayload;
    }
  | { ok: false; status: number; error: string };

export const SEND_EMAIL_SIGN_IN_MESSAGE = "Please sign in again to send this email.";

export async function authorizeSendEmailRequest(
  input: { accessToken: string; payload: JobCardSubmissionPayload },
  deps: SendEmailAuthDeps,
): Promise<SendEmailAuthResult> {
  if (!input.accessToken) {
    return { ok: false, status: 401, error: SEND_EMAIL_SIGN_IN_MESSAGE };
  }
  const submissionId = (input.payload.submissionId || "").trim();
  if (!submissionId || !isSafePathSegment(submissionId)) {
    return { ok: false, status: 400, error: "A submission payload with a valid submissionId is required." };
  }

  const { scope, error: scopeError } = await deps.loadSubmissionScope(submissionId);
  if (scopeError) {
    return { ok: false, status: 500, error: "Could not look up this submission." };
  }
  if (!scope) {
    return { ok: false, status: 404, error: "This submission has not been saved yet, so its email cannot be sent." };
  }

  const auth = await deps.authorizeProject({ accessToken: input.accessToken, ...scope });
  if (!auth.ok) {
    return { ok: false, status: auth.status, error: auth.error };
  }

  const references = validatePayloadStorageReferences(input.payload, {
    companyId: scope.companyId,
    projectId: scope.projectId,
    submissionId,
    uploaderUserId: null,
    allowLegacyWebPhotoPaths: true,
  });
  if (!references.ok) {
    return { ok: false, status: 400, error: references.error };
  }

  const { emails, error: recipientsError } = await deps.loadProjectRecipientEmails(scope.projectId);
  if (recipientsError) {
    return { ok: false, status: 500, error: "Could not look up this project's recipients." };
  }

  // Replace, never merge: lib/email-recipients.ts's readProjectExternalEmails
  // reads three body fields; all three are overridden by the server-derived list.
  const sanitized = { ...input.payload, submissionId, projectRecipientEmails: emails } as JobCardSubmissionPayload & {
    externalRecipientEmails?: unknown;
    project?: unknown;
  };
  delete sanitized.externalRecipientEmails;
  delete sanitized.project;

  return { ok: true, requesterUserId: auth.requesterUserId, companyId: scope.companyId, projectId: scope.projectId, payload: sanitized };
}

/** Pure — projects.external_recipient_emails is text[]; tolerate a JSON-encoded string or a single address for older rows. */
export function normalizeRecipientEmailList(value: unknown): string[] {
  const out: string[] = [];
  const push = (item: unknown) => {
    if (typeof item !== "string") return;
    const trimmed = item.trim().toLowerCase();
    if (trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && !out.includes(trimmed)) out.push(trimmed);
  };
  if (Array.isArray(value)) {
    value.forEach(push);
    return out;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return out;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) parsed.forEach(push);
        return out;
      } catch {
        // fall through — treat as a single address
      }
    }
    push(trimmed);
  }
  return out;
}
