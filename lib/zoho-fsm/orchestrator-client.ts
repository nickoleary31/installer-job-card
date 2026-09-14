import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseServerEnv } from "../company-users/admin-api.ts";
import { authorizeProjectAccess } from "../project-access.ts";
import type { AutoPublishAuthorizer, ZohoAutoPublishNotifier, ZohoAutoPublishRepo } from "./auto-publish.ts";
import { getZohoFsmOrchestratorEnv } from "./orchestrator-env.ts";

/**
 * Real AutoPublishAuthorizer, delegating to lib/project-access.ts's authorizeProjectAccess — the
 * same server-side check already used to gate other project-scoped operations (e.g. the expense
 * report export): a global admin, an active company admin, or a technician with an active
 * assignment on this specific project. Anything less would be weaker than the access already
 * required elsewhere in this app for project-scoped work.
 */
export function createProjectAuthorizer(env: SupabaseServerEnv): AutoPublishAuthorizer {
  return {
    async authorize({ accessToken, companyId, projectId }) {
      const result = await authorizeProjectAccess({ env, accessToken, companyId, projectId });
      return result.ok ? { ok: true } : { ok: false, status: result.status, error: result.error };
    },
  };
}

/** Real ZohoAutoPublishRepo implementation backed by a service-role Supabase client (server-only). */
export function createSupabaseAutoPublishRepo(serviceClient: SupabaseClient): ZohoAutoPublishRepo {
  return {
    async resolveServiceAppointmentId(projectId) {
      const { data, error } = await serviceClient
        .from("zoho_fsm_service_appointments")
        .select("zoho_service_appointment_id")
        .eq("project_id", projectId)
        .maybeSingle<{ zoho_service_appointment_id: string }>();
      if (error) throw error;
      return data?.zoho_service_appointment_id ?? null;
    },
  };
}

const PUBLISH_SA_PATH = "/api/admin/publish-sa";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Real ZohoAutoPublishNotifier, POSTing to the hosted orchestrator's admin publish endpoint.
 * Returns null when the orchestrator isn't configured (missing base URL and/or admin token) —
 * callers must treat that as auto-publish being disabled, not an error.
 */
export function createOrchestratorNotifier(): ZohoAutoPublishNotifier | null {
  const env = getZohoFsmOrchestratorEnv();
  if (env.missing.length > 0) return null;

  return {
    async publish(zohoServiceAppointmentId: string) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${env.baseUrl}${PUBLISH_SA_PATH}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Never log this header — see auto-publish.ts, which only ever logs status codes.
            Authorization: `Bearer ${env.adminToken}`,
          },
          body: JSON.stringify({ zohoServiceAppointmentId, dryRun: false }),
          signal: controller.signal,
        });
        return { ok: res.ok, status: res.status };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
