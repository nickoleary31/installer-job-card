import { requirePrivilegedServiceClient, type SupabaseServerEnv } from "../company-users/admin-api.ts";
import { authorizeProjectAccess } from "../project-access.ts";
import { normalizeRecipientEmailList, type SendEmailAuthDeps } from "./authorize-send-email.ts";

/** Real Supabase wiring for authorizeSendEmailRequest — fails closed (500) without a privileged key, like every other privileged route. */
export function createSendEmailAuthDeps(env: SupabaseServerEnv): { ok: true; deps: SendEmailAuthDeps } | { ok: false; status: number; error: string } {
  const privileged = requirePrivilegedServiceClient(env);
  if (!privileged.ok) return privileged;
  const { serviceClient } = privileged;
  return {
    ok: true,
    deps: {
      async loadSubmissionScope(submissionId) {
        const { data, error } = await serviceClient
          .from("job_card_submissions")
          .select("company_id, project_id")
          .eq("submission_id", submissionId)
          .maybeSingle<{ company_id: string | null; project_id: string | null }>();
        if (error) return { scope: null, error: true };
        if (!data?.company_id || !data.project_id) return { scope: null };
        return { scope: { companyId: data.company_id, projectId: data.project_id } };
      },
      async authorizeProject(args) {
        const auth = await authorizeProjectAccess({ env, ...args });
        return auth.ok ? { ok: true, requesterUserId: auth.requesterUserId } : auth;
      },
      async loadProjectRecipientEmails(projectId) {
        const { data, error } = await serviceClient
          .from("projects")
          .select("external_recipient_emails")
          .eq("id", projectId)
          .maybeSingle<{ external_recipient_emails: unknown }>();
        if (error) return { emails: [], error: true };
        return { emails: normalizeRecipientEmailList(data?.external_recipient_emails) };
      },
    },
  };
}
