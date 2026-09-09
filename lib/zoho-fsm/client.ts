import type { ZohoFsmServerEnv } from "./env";
import type { ZohoServiceAppointmentRecord, ZohoWorkOrderRecord } from "./field-mapping";

/**
 * Server-only Zoho FSM API client. Refreshes an access token on every call rather than caching
 * one across serverless invocations (this repo has no shared server state store, and Phase 1's
 * call volume is low — one inbound event per Work Order/Service Appointment pair, not a hot
 * path). Never import from client components; the refresh token and client secret must not
 * reach the browser.
 */

export class ZohoFsmApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ZohoFsmApiError";
  }
}

async function fetchAccessToken(env: ZohoFsmServerEnv): Promise<string> {
  const url = new URL("/oauth/v2/token", env.accountsBaseUrl);
  url.searchParams.set("refresh_token", env.refreshToken);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("client_secret", env.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url.toString(), { method: "POST" });
  const body = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!res.ok || !body?.access_token) {
    throw new ZohoFsmApiError(`Zoho FSM OAuth token refresh failed: ${body?.error || res.statusText}`, res.status);
  }
  return body.access_token;
}

async function zohoFsmGet<T>(env: ZohoFsmServerEnv, accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ZohoFsmApiError(
      `Zoho FSM API request failed (${path}): ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  return body as T;
}

export async function fetchWorkOrder(env: ZohoFsmServerEnv, workOrderId: string): Promise<ZohoWorkOrderRecord> {
  const accessToken = await fetchAccessToken(env);
  const body = await zohoFsmGet<{ data: ZohoWorkOrderRecord[] }>(
    env,
    accessToken,
    `/Work_Orders/${encodeURIComponent(workOrderId)}`,
  );
  const record = body.data?.[0];
  if (!record) throw new ZohoFsmApiError(`Zoho FSM Work Order ${workOrderId} not found.`);
  return record;
}

export async function fetchServiceAppointment(
  env: ZohoFsmServerEnv,
  serviceAppointmentId: string,
): Promise<ZohoServiceAppointmentRecord> {
  const accessToken = await fetchAccessToken(env);
  const body = await zohoFsmGet<{ data: ZohoServiceAppointmentRecord[] }>(
    env,
    accessToken,
    `/Service_Appointments/${encodeURIComponent(serviceAppointmentId)}`,
  );
  const record = body.data?.[0];
  if (!record) throw new ZohoFsmApiError(`Zoho FSM Service Appointment ${serviceAppointmentId} not found.`);
  return record;
}
