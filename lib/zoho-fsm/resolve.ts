import type { InboundServiceAppointmentInput } from "./field-mapping";

export type InboundOutcome =
  | "ignored_not_opted_in"
  | "error_company_unmapped"
  | "error_site_code_missing"
  | "error_missing_zoho_company_id"
  | "error_work_order_unresolvable"
  | "created"
  | "reused_existing";

export type InboundResolutionResult = {
  outcome: InboundOutcome;
  detail: string | null;
  projectId: string | null;
};

/**
 * Minimal persistence surface resolveInboundServiceAppointment() needs. Kept as a plain
 * interface (rather than a direct Supabase dependency) so the branching business logic below
 * can be unit tested with an in-memory fake — this repo has no live-database test harness.
 * The real implementation (lib/zoho-fsm/repo-supabase.ts) wires this to the service-role client.
 */
export interface ZohoFsmRepo {
  findActiveCompanyMapping(zohoValue: string): Promise<{ companyId: string } | null>;
  findExistingLink(zohoServiceAppointmentId: string): Promise<{ id: string; projectId: string } | null>;
  refreshLinkSnapshot(
    linkId: string,
    args: {
      rawSnapshot: unknown;
      zohoWorkOrderNumber: string | null;
      zohoServiceAppointmentNumber: string | null;
    },
  ): Promise<void>;
  findCustomerAccountByZohoCompanyId(companyId: string, zohoCompanyId: string): Promise<{ id: string } | null>;
  createCustomerAccount(args: { companyId: string; name: string; zohoCompanyId: string }): Promise<{ id: string }>;
  findSiteByCode(companyId: string, zohoSiteCode: string): Promise<{ id: string } | null>;
  createSite(args: {
    companyId: string;
    customerAccountId: string;
    zohoSiteCode: string;
    name: string;
    fullAddress: string | null;
    siteContactName: string | null;
    contactNumber: string | null;
    endCustomerName: string | null;
  }): Promise<{ id: string }>;
  createProject(args: {
    companyId: string;
    customerId: string;
    projectName: string;
    customerName: string;
    location: string;
  }): Promise<{ id: string }>;
  createLink(args: {
    projectId: string;
    companyId: string;
    zohoWorkOrderId: string;
    zohoServiceAppointmentId: string;
    zohoWorkOrderNumber: string | null;
    zohoServiceAppointmentNumber: string | null;
    zohoCompanyId: string;
    rawSnapshot: unknown;
  }): Promise<{ id: string }>;
  logInboundEvent(args: {
    zohoWorkOrderId: string | null;
    zohoServiceAppointmentId: string | null;
    installerSheetzCompanyValue: string | null;
    zohoSiteCodeValue: string | null;
    outcome: InboundOutcome;
    detail: string | null;
    projectId: string | null;
  }): Promise<void>;
}

function fallbackSiteName(input: InboundServiceAppointmentInput): string {
  return input.siteAddressName || input.zohoSiteCode || "Zoho site";
}

function projectNameFor(input: InboundServiceAppointmentInput): string {
  const label = input.zohoServiceAppointmentNumber || input.zohoServiceAppointmentId;
  return `Zoho SA ${label}`;
}

/**
 * Resolves one inbound Zoho Service Appointment event into a create-or-reuse decision, per the
 * approved Phase 1 behavior:
 *   - Installer Sheetz Company blank -> ignore, not opted in.
 *   - Company value nonblank with no active mapping -> actionable error, no project.
 *   - Company recognized + Site Code blank -> actionable error, no project.
 *   - Company recognized + Site Code matches an existing Site -> reuse it.
 *   - Company recognized + Site Code is new -> resolve/create customer_account by stable
 *     Zoho Company.id, auto-create the Site, create the project.
 *   - Repeated delivery for an already-linked zoho_service_appointment_id -> reuse the existing
 *     project/site/customer_account; only refresh non-authoritative snapshot/diagnostic fields.
 * Every branch is logged to zoho_fsm_inbound_events, including ones that never produce a
 * project, so failures are actionable rather than silently swallowed.
 */
export async function resolveInboundServiceAppointment(
  repo: ZohoFsmRepo,
  input: InboundServiceAppointmentInput,
): Promise<InboundResolutionResult> {
  const log = (outcome: InboundOutcome, detail: string | null, projectId: string | null) =>
    repo.logInboundEvent({
      zohoWorkOrderId: input.zohoWorkOrderId,
      zohoServiceAppointmentId: input.zohoServiceAppointmentId,
      installerSheetzCompanyValue: input.installerSheetzCompanyValue,
      zohoSiteCodeValue: input.zohoSiteCode,
      outcome,
      detail,
      projectId,
    });

  // Idempotency first: a repeated delivery for an already-linked SA must never create another
  // customer_account, Site, or project, regardless of what the Company/Site Code branches below
  // would otherwise decide.
  const existingLink = await repo.findExistingLink(input.zohoServiceAppointmentId);
  if (existingLink) {
    await repo.refreshLinkSnapshot(existingLink.id, {
      rawSnapshot: input.raw,
      zohoWorkOrderNumber: input.zohoWorkOrderNumber,
      zohoServiceAppointmentNumber: input.zohoServiceAppointmentNumber,
    });
    await log("reused_existing", null, existingLink.projectId);
    return { outcome: "reused_existing", detail: null, projectId: existingLink.projectId };
  }

  const companyValue = (input.installerSheetzCompanyValue || "").trim();
  if (!companyValue) {
    await log("ignored_not_opted_in", "Installer Sheetz Company is blank on the Work Order.", null);
    return { outcome: "ignored_not_opted_in", detail: null, projectId: null };
  }

  const mapping = await repo.findActiveCompanyMapping(companyValue);
  if (!mapping) {
    const detail = `No active Installer Sheetz Company mapping for Zoho value "${companyValue}".`;
    await log("error_company_unmapped", detail, null);
    return { outcome: "error_company_unmapped", detail, projectId: null };
  }

  const siteCode = (input.zohoSiteCode || "").trim();
  if (!siteCode) {
    const detail = "Installer Sheetz Site Code is blank on the Work Order.";
    await log("error_site_code_missing", detail, null);
    return { outcome: "error_site_code_missing", detail, projectId: null };
  }

  const companyId = mapping.companyId;

  if (!input.zohoCompanyId) {
    // No stable Zoho Company (dealer) reference on this Work Order. Do not guess a match and
    // do not create a throwaway customer_account — this is an actionable data problem on the
    // Zoho side, not a normal branch.
    const detail = "Work Order has no Zoho Company reference; cannot resolve the true Customer/dealer.";
    await log("error_missing_zoho_company_id", detail, null);
    return { outcome: "error_missing_zoho_company_id", detail, projectId: null };
  }

  const existingAccount = await repo.findCustomerAccountByZohoCompanyId(companyId, input.zohoCompanyId);
  const customerAccountId =
    existingAccount?.id ??
    (
      await repo.createCustomerAccount({
        companyId,
        name: input.dealerName || "Zoho customer",
        zohoCompanyId: input.zohoCompanyId,
      })
    ).id;

  const existingSite = await repo.findSiteByCode(companyId, siteCode);
  const siteId =
    existingSite?.id ??
    (
      await repo.createSite({
        companyId,
        customerAccountId,
        zohoSiteCode: siteCode,
        name: fallbackSiteName(input),
        fullAddress: input.siteAddressLine,
        siteContactName: input.siteContactName,
        contactNumber: input.siteContactPhone,
        endCustomerName: input.siteAddressName,
      })
    ).id;

  const project = await repo.createProject({
    companyId,
    customerId: siteId,
    projectName: projectNameFor(input),
    customerName: fallbackSiteName(input),
    location: input.siteAddressLine || "",
  });

  await repo.createLink({
    projectId: project.id,
    companyId,
    zohoWorkOrderId: input.zohoWorkOrderId,
    zohoServiceAppointmentId: input.zohoServiceAppointmentId,
    zohoWorkOrderNumber: input.zohoWorkOrderNumber,
    zohoServiceAppointmentNumber: input.zohoServiceAppointmentNumber,
    zohoCompanyId: input.zohoCompanyId || "",
    rawSnapshot: input.raw,
  });

  await log("created", null, project.id);
  return { outcome: "created", detail: null, projectId: project.id };
}
