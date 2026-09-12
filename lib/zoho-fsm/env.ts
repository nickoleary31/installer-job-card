// Server-only Zoho FSM configuration. Never import this from client components.
//
// The Work Order custom field API name is configurable via env var override, but the default
// below is the confirmed live API name (verified directly against the Zoho FSM test
// organization) — not a guess from the field label. This is the sole remaining custom-field
// dependency: "Installer Sheetz Site Code" was removed from the integration design — Site
// identity is now Zoho's own Service_Address.id, which requires no custom field at all.

export type ZohoFsmServerEnv = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiBaseUrl: string;
  accountsBaseUrl: string;
  webhookSecret: string;
  workOrderCompanyFieldApiName: string;
  /**
   * Shared secret for the read-only evidence endpoint (see app/api/integrations/zoho-fsm/
   * evidence/route.ts) — a future external orchestrator's server-to-server credential, separate
   * from webhookSecret (a different trust direction: Zoho pushing in vs. the orchestrator
   * pulling out). Deliberately NOT included in `missing` below — it is optional until the
   * evidence endpoint is actually configured, and must never block the unrelated inbound SA
   * webhook from functioning. The evidence route checks for its own presence itself.
   */
  evidenceApiSecret: string;
  missing: string[];
};

const DEFAULT_API_BASE_URL = "https://fsm.zoho.com/fsm/v1";
const DEFAULT_ACCOUNTS_BASE_URL = "https://accounts.zoho.com";
const DEFAULT_COMPANY_FIELD_API_NAME = "Installer_Sheetz_Company__C";

export function getZohoFsmServerEnv(): ZohoFsmServerEnv {
  const clientId = process.env.ZOHO_FSM_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.ZOHO_FSM_CLIENT_SECRET?.trim() || "";
  const refreshToken = process.env.ZOHO_FSM_REFRESH_TOKEN?.trim() || "";
  const apiBaseUrl = process.env.ZOHO_FSM_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const accountsBaseUrl = process.env.ZOHO_FSM_ACCOUNTS_BASE_URL?.trim() || DEFAULT_ACCOUNTS_BASE_URL;
  const webhookSecret = process.env.ZOHO_FSM_WEBHOOK_SECRET?.trim() || "";
  const workOrderCompanyFieldApiName =
    process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY?.trim() || DEFAULT_COMPANY_FIELD_API_NAME;
  const evidenceApiSecret = process.env.ZOHO_FSM_EVIDENCE_API_SECRET?.trim() || "";

  const missing: string[] = [];
  if (!clientId) missing.push("ZOHO_FSM_CLIENT_ID");
  if (!clientSecret) missing.push("ZOHO_FSM_CLIENT_SECRET");
  if (!refreshToken) missing.push("ZOHO_FSM_REFRESH_TOKEN");
  if (!webhookSecret) missing.push("ZOHO_FSM_WEBHOOK_SECRET");

  return {
    clientId,
    clientSecret,
    refreshToken,
    apiBaseUrl,
    accountsBaseUrl,
    webhookSecret,
    workOrderCompanyFieldApiName,
    evidenceApiSecret,
    missing,
  };
}
