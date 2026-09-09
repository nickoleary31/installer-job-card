// Pure mapping from raw Zoho FSM Work Order / Service Appointment API JSON into the narrow
// shapes the rest of the adapter needs. Kept separate from resolve.ts so the branching business
// logic in resolve.ts never has to know the shape of Zoho's API responses, and so this mapping
// can be unit tested against fixture JSON without any network access.

export type ZohoWorkOrderRecord = {
  id: string;
  Name?: string | null;
  Summary?: string | null;
  Company?: { id: string; name?: string | null } | null;
  Contact?: { id: string; name?: string | null; Phone?: string | null; Email?: string | null } | null;
  Service_Address?: {
    Address_Name?: string | null;
    Street_1?: string | null;
    Street_2?: string | null;
    City?: string | null;
    State?: string | null;
    Zip_Code?: string | null;
    Country?: string | null;
  } | null;
  [customFieldApiName: string]: unknown;
};

export type ZohoServiceAppointmentRecord = {
  id: string;
  Name?: string | null;
  // The parent Work Order is not a top-level field on a Service Appointment — it is carried
  // per service line in Appointments_X_Services. All lines on one SA belong to the same Work
  // Order, so the first entry's reference is authoritative. Confirmed against the live "Get a
  // Service Appointment" API response shape.
  Appointments_X_Services?: Array<{ Work_Order?: { id: string; name?: string | null } | null }> | null;
  [key: string]: unknown;
};

/**
 * Derives the parent Work Order id from a fetched Service Appointment record. Returns null if
 * it cannot be determined (e.g. the SA has no service lines yet) — callers must treat that as
 * an actionable failure, not fall back to guessing.
 */
export function extractWorkOrderIdFromServiceAppointment(sa: ZohoServiceAppointmentRecord): string | null {
  const lines = Array.isArray(sa.Appointments_X_Services) ? sa.Appointments_X_Services : [];
  for (const line of lines) {
    const workOrderId = line?.Work_Order?.id;
    if (workOrderId) return workOrderId;
  }
  return null;
}

function readTextField(record: Record<string, unknown> | null | undefined, apiName: string): string | null {
  if (!record) return null;
  const value = record[apiName];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Reads a Work Order custom field by its confirmed API name (see lib/zoho-fsm/env.ts). */
export function extractWorkOrderCustomFieldValue(
  workOrder: ZohoWorkOrderRecord,
  fieldApiName: string,
): string | null {
  return readTextField(workOrder as Record<string, unknown>, fieldApiName);
}

export function buildServiceAddressLine(address: ZohoWorkOrderRecord["Service_Address"]): string | null {
  if (!address) return null;
  const parts = [address.Street_1, address.Street_2, address.City, address.State, address.Zip_Code]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export type InboundServiceAppointmentInput = {
  zohoWorkOrderId: string;
  zohoServiceAppointmentId: string;
  zohoWorkOrderNumber: string | null;
  zohoServiceAppointmentNumber: string | null;
  installerSheetzCompanyValue: string | null;
  zohoSiteCode: string | null;
  zohoCompanyId: string | null;
  dealerName: string | null;
  siteAddressName: string | null;
  siteAddressLine: string | null;
  siteContactName: string | null;
  siteContactPhone: string | null;
  siteContactEmail: string | null;
  summary: string | null;
  raw: { workOrder: ZohoWorkOrderRecord; serviceAppointment: ZohoServiceAppointmentRecord };
};

/**
 * Normalizes raw Zoho Work Order + Service Appointment records into the shape
 * resolveInboundServiceAppointment() consumes. This is the only place that knows Zoho's
 * response shape; resolve.ts works entirely in terms of this normalized input.
 */
export function mapZohoRecordsToInboundInput(args: {
  workOrder: ZohoWorkOrderRecord;
  serviceAppointment: ZohoServiceAppointmentRecord;
  companyFieldApiName: string;
  siteCodeFieldApiName: string;
}): InboundServiceAppointmentInput {
  const { workOrder, serviceAppointment, companyFieldApiName, siteCodeFieldApiName } = args;
  return {
    zohoWorkOrderId: workOrder.id,
    zohoServiceAppointmentId: serviceAppointment.id,
    zohoWorkOrderNumber: workOrder.Name?.trim() || null,
    zohoServiceAppointmentNumber: serviceAppointment.Name?.trim() || null,
    installerSheetzCompanyValue: extractWorkOrderCustomFieldValue(workOrder, companyFieldApiName),
    zohoSiteCode: extractWorkOrderCustomFieldValue(workOrder, siteCodeFieldApiName),
    zohoCompanyId: workOrder.Company?.id || null,
    dealerName: workOrder.Company?.name?.trim() || null,
    siteAddressName: workOrder.Service_Address?.Address_Name?.trim() || null,
    siteAddressLine: buildServiceAddressLine(workOrder.Service_Address),
    siteContactName: workOrder.Contact?.name?.trim() || null,
    siteContactPhone: workOrder.Contact?.Phone?.trim() || null,
    siteContactEmail: workOrder.Contact?.Email?.trim() || null,
    summary: workOrder.Summary?.trim() || null,
    raw: { workOrder, serviceAppointment },
  };
}
