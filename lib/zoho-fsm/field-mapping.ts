// Pure mapping from raw Zoho FSM Work Order / Service Appointment API JSON into the narrow
// shapes the rest of the adapter needs. Kept separate from resolve.ts so the branching business
// logic in resolve.ts never has to know the shape of Zoho's API responses, and so this mapping
// can be unit tested against fixture JSON without any network access.

export type ZohoWorkOrderRecord = {
  id: string;
  Name?: string | null;
  Summary?: string | null;
  Company?: { id: string; name?: string | null } | null;
  // Contact is a reference object only (id + display name) — it does not carry Phone/Mobile/
  // Email inline. Confirmed against the real stored AP-4 Work Order that the descriptive contact
  // info for a job instead lives directly on the Work Order itself (Email/Phone/Mobile below),
  // not on the Contact record, so no separate Contacts GET is needed for V1.
  Contact?: { id: string; name?: string | null } | null;
  // Confirmed against the real stored AP-4 Work Order payload. Phone is displayed as
  // "Phone Primary" and Mobile as "Phone Secondary" in this account's Zoho UI — display labels
  // only, the underlying API field names are still Phone/Mobile. Installer Sheetz only has one
  // customers.contact_number column (a V2 candidate: separate primary/secondary phone columns),
  // so callers pick Phone first, Mobile as fallback, never concatenating both.
  Email?: string | null;
  Phone?: string | null;
  Mobile?: string | null;
  // Confirmed against a real Work Order payload (Zoho FSM, live test org). The granular address
  // fields are prefixed "Service_"; `name` is Zoho's own internal address-record label (e.g.
  // "AD-26"), not a human-meaningful site name — do not use it as one (see siteAddressName
  // below).
  Service_Address?: {
    id?: string;
    name?: string | null;
    Service_Street_1?: string | null;
    Service_Street_2?: string | null;
    Service_City?: string | null;
    Service_State?: string | null;
    Service_Zip_Code?: string | null;
    Service_Country?: string | null;
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

function trimmedOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Formats a human-readable multiline US address from Zoho's structured Service_ prefixed
 * fields, for storage in the existing V1 `customers.full_address` / `projects.location` text
 * columns. V1 intentionally keeps address storage as one text field rather than adding
 * structured address columns — that structured model is a V2 concern. Layout:
 *   Street 1
 *   Street 2 (only if present)
 *   City, State Zip
 * Service_Country is recognized (typed above) so the structured source data is understood
 * correctly, but is deliberately not rendered — not needed for a normal US address.
 */
export function buildServiceAddressLine(address: ZohoWorkOrderRecord["Service_Address"]): string | null {
  if (!address) return null;
  const street1 = trimmedOrEmpty(address.Service_Street_1);
  const street2 = trimmedOrEmpty(address.Service_Street_2);
  const city = trimmedOrEmpty(address.Service_City);
  const stateZip = [trimmedOrEmpty(address.Service_State), trimmedOrEmpty(address.Service_Zip_Code)]
    .filter(Boolean)
    .join(" ");
  const cityStateZip = [city, stateZip].filter(Boolean).join(", ");
  const lines = [street1, street2, cityStateZip].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
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
 *
 * Descriptive contact info (name/phone/email) is read directly off the Work Order — confirmed
 * against a real stored Work Order that Email/Phone/Mobile live there, not on the Contact
 * record, so no separate Contacts GET is needed for V1. Work_Order.Contact.id/name remain the
 * authoritative relationship reference and are used only for siteContactName.
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
    // No confirmed Zoho field currently supplies a genuinely descriptive human site name.
    // Service_Address.name is Zoho's own internal address-record label (e.g. "AD-26"), not a
    // site name, so it is deliberately not used here. siteAddressName stays null for V1;
    // resolve.ts's fallbackSiteName() already falls back to the explicit Zoho Site Code in
    // that case, which is the correct V1 behavior. Revisit if/when a real source is found.
    siteAddressName: null,
    siteAddressLine: buildServiceAddressLine(workOrder.Service_Address),
    siteContactName: workOrder.Contact?.name?.trim() || null,
    // Phone ("Phone Primary" in this account's UI) preferred, Mobile ("Phone Secondary") as
    // fallback — never concatenated (only one contact_number column).
    siteContactPhone: workOrder.Phone?.trim() || workOrder.Mobile?.trim() || null,
    siteContactEmail: workOrder.Email?.trim() || null,
    summary: workOrder.Summary?.trim() || null,
    raw: { workOrder, serviceAppointment },
  };
}
