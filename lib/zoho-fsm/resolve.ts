import type { InboundServiceAppointmentInput } from "./field-mapping";

export type InboundOutcome =
  | "ignored_not_opted_in"
  | "error_company_unmapped"
  | "error_site_code_missing"
  | "error_missing_zoho_company_id"
  | "error_work_order_unresolvable"
  | "created"
  | "reused_existing"
  | "identity_mismatch_on_reuse";

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
  /**
   * Returns the recorded identity (companyId, the site's zoho_site_code) alongside the link
   * itself, so a repeat delivery can detect whether the incoming Company/Site Code still
   * matches what this SA was originally linked under before refreshing anything.
   */
  findExistingLink(zohoServiceAppointmentId: string): Promise<{
    id: string;
    projectId: string;
    companyId: string;
    zohoSiteCode: string | null;
  } | null>;
  refreshLinkSnapshot(
    linkId: string,
    args: {
      rawSnapshot: unknown;
      zohoWorkOrderNumber: string | null;
      zohoServiceAppointmentNumber: string | null;
    },
  ): Promise<void>;
  /**
   * Non-destructive: implementations must only overwrite a field when its candidate value is
   * non-null/non-blank. A null/blank candidate means "Zoho didn't supply this this time" and
   * must leave the existing stored value untouched, never erase it.
   */
  refreshSiteAndProjectDisplayFields(
    projectId: string,
    args: {
      fullAddress: string | null;
      siteContactName: string | null;
      contactNumber: string | null;
      contactEmail: string | null;
      location: string | null;
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
    contactEmail: string | null;
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
 *   - Repeated delivery for an already-linked zoho_service_appointment_id with matching Company/
 *     Site Code -> reuse the existing project/site/customer_account; refresh the link snapshot
 *     plus non-destructively refresh Zoho-owned descriptive fields (full_address,
 *     site_contact_name, contact_number, contact_email, project.location) from any non-blank
 *     incoming values. Identity/linkage (company, site code, customer_account, project id, the
 *     SA->project relationship) is never touched.
 *   - Repeated delivery whose Company/Site Code no longer matches what this SA was originally
 *     linked under -> identity_mismatch_on_reuse. The link snapshot still refreshes, but no
 *     descriptive fields are touched and nothing is reassigned; the existing project id is
 *     still returned so the caller can log/alert without entering a retry loop.
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
    // Always safe: this just records the latest raw Zoho state for this SA, independent of
    // whether our downstream Company/Site resolution below still matches.
    await repo.refreshLinkSnapshot(existingLink.id, {
      rawSnapshot: input.raw,
      zohoWorkOrderNumber: input.zohoWorkOrderNumber,
      zohoServiceAppointmentNumber: input.zohoServiceAppointmentNumber,
    });

    const incomingCompanyValue = (input.installerSheetzCompanyValue || "").trim();
    const incomingMapping = incomingCompanyValue ? await repo.findActiveCompanyMapping(incomingCompanyValue) : null;
    const incomingSiteCode = (input.zohoSiteCode || "").trim() || null;

    // Blank/unmapped incoming company counts as a mismatch too — the recorded link always has a
    // real company, so "no company this time" is itself a divergence from what was recorded.
    const companyMismatch = !incomingMapping || incomingMapping.companyId !== existingLink.companyId;
    const siteCodeMismatch = incomingSiteCode !== existingLink.zohoSiteCode;

    if (companyMismatch || siteCodeMismatch) {
      const detail =
        `Identity mismatch on reuse for SA ${input.zohoServiceAppointmentId}: ` +
        `recorded company_id="${existingLink.companyId}", site_code="${existingLink.zohoSiteCode ?? "(none)"}" ` +
        `vs incoming Installer Sheetz Company="${incomingCompanyValue || "(blank)"}"` +
        `${incomingMapping ? ` (resolved company_id="${incomingMapping.companyId}")` : incomingCompanyValue ? " (unmapped)" : ""}, ` +
        `Site Code="${incomingSiteCode ?? "(blank)"}". Not reassigning or refreshing descriptive fields.`;
      await log("identity_mismatch_on_reuse", detail, existingLink.projectId);
      return { outcome: "identity_mismatch_on_reuse", detail, projectId: existingLink.projectId };
    }

    // Identity confirmed unchanged — safe to non-destructively refresh Zoho-owned descriptive
    // fields. Identity/linkage fields (company, site code, customer_account, project id, the
    // SA->project relationship itself) are never touched here.
    await repo.refreshSiteAndProjectDisplayFields(existingLink.projectId, {
      fullAddress: input.siteAddressLine,
      siteContactName: input.siteContactName,
      contactNumber: input.siteContactPhone,
      contactEmail: input.siteContactEmail,
      location: input.siteAddressLine,
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
        contactEmail: input.siteContactEmail,
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
