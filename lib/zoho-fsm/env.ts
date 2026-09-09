// Server-only Zoho FSM configuration. Never import this from client components.
//
// Field API names are configurable via env var override, but the defaults below are the
// confirmed live API names for these two Work Order custom fields (verified directly against
// the Zoho FSM test organization) — not a guess from the field labels.

export type ZohoFsmServerEnv = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  apiBaseUrl: string;
  accountsBaseUrl: string;
  webhookSecret: string;
  workOrderCompanyFieldApiName: string;
  workOrderSiteCodeFieldApiName: string;
  missing: string[];
};

const DEFAULT_API_BASE_URL = "https://fsm.zoho.com/fsm/v1";
const DEFAULT_ACCOUNTS_BASE_URL = "https://accounts.zoho.com";
const DEFAULT_COMPANY_FIELD_API_NAME = "Installer_Sheetz_Company__C";
const DEFAULT_SITE_CODE_FIELD_API_NAME = "Installer_Sheetz_Site_Code__C";

export function getZohoFsmServerEnv(): ZohoFsmServerEnv {
  const clientId = process.env.ZOHO_FSM_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.ZOHO_FSM_CLIENT_SECRET?.trim() || "";
  const refreshToken = process.env.ZOHO_FSM_REFRESH_TOKEN?.trim() || "";
  const apiBaseUrl = process.env.ZOHO_FSM_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const accountsBaseUrl = process.env.ZOHO_FSM_ACCOUNTS_BASE_URL?.trim() || DEFAULT_ACCOUNTS_BASE_URL;
  const webhookSecret = process.env.ZOHO_FSM_WEBHOOK_SECRET?.trim() || "";
  const workOrderCompanyFieldApiName =
    process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_COMPANY?.trim() || DEFAULT_COMPANY_FIELD_API_NAME;
  const workOrderSiteCodeFieldApiName =
    process.env.ZOHO_FSM_FIELD_INSTALLER_SHEETZ_SITE_CODE?.trim() || DEFAULT_SITE_CODE_FIELD_API_NAME;

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
    workOrderSiteCodeFieldApiName,
    missing,
  };
}
