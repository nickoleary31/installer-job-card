import type { InboundServiceAppointmentInput } from "./field-mapping";

export type InboundOutcome =
  | "ignored_not_opted_in"
  | "error_company_unmapped"
  | "error_missing_service_address_id"
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
   * Returns the recorded identity (OE companyId, Zoho dealer/Company id, the linked Site's id
   * and zoho_service_address_id) alongside the link itself, so a repeat delivery can detect
   * whether the incoming OE/dealer/Service Address identity still matches what this SA was
   * originally linked under before refreshing anything.
   */
  findExistingLink(zohoServiceAppointmentId: string): Promise<{
    id: string;
    projectId: string;
    siteId: string | null;
    companyId: string;
    zohoCompanyId: string;
    zohoServiceAddressId: string | null;
  } | null>;
  /**
   * Always safe to call for ANY existing link, independent of the identity-mismatch check below
   * — raw_snapshot and these four passive evidence fields (owning Work Order's Parent_Work_Order
   * relationship, this SA's own Target/Finalized Asset Count, this SA's own Status) are Zoho
   * integration state, not identity, so they refresh unconditionally on every redelivery. Read-
   * only evidence for a future orchestrator (see lib/zoho-fsm/evidence.ts) — V1 never acts on
   * these values itself.
   */
  refreshLinkSnapshot(
    linkId: string,
    args: {
      rawSnapshot: unknown;
      zohoWorkOrderNumber: string | null;
      zohoServiceAppointmentNumber: string | null;
      parentWorkOrderId: string | null;
      saTargetAssetCount: number | null;
      saFinalizedAssetCount: number | null;
      zohoSaStatus: string | null;
    },
  ): Promise<void>;
  /**
   * Zoho is the source of truth for a Zoho-linked Site's descriptive metadata — this is called
   * whenever incoming Zoho data resolves to an EXISTING Site by its machine identity
   * (customer_account_id + zoho_service_address_id), regardless of whether that happened via a
   * same-SA redelivery or a brand-new SA landing on an already-known Site. siteName is always
   * recomputed from current Zoho data via a guaranteed-non-blank fallback chain (see
   * fallbackSiteName) and is applied unconditionally — it's derived display metadata, not
   * user-owned freeform text. The remaining fields stay non-destructive: implementations must
   * only overwrite a field when its candidate value is non-null/non-blank. A null/blank
   * candidate means "Zoho didn't supply this this time" and must leave the existing stored
   * value untouched, never erase it.
   */
  refreshSiteDisplayFields(
    siteId: string,
    args: {
      siteName: string;
      fullAddress: string | null;
      siteContactName: string | null;
      contactNumber: string | null;
      contactEmail: string | null;
    },
  ): Promise<void>;
  /**
   * project_name and the denormalized projects.customer_name are always recomputed from current
   * Zoho data and applied unconditionally, for the same reason as siteName above — so the
   * project row stays internally coherent even outside the one screen that currently prefers
   * the joined customer row over its own denormalized copy. Scoped to same-SA redelivery only:
   * a brand-new SA landing on an existing Site creates its own new project instead (via
   * createProject), it never calls this.
   */
  refreshProjectDisplayFields(
    projectId: string,
    args: {
      projectName: string;
      customerName: string;
      location: string | null;
    },
  ): Promise<void>;
  findCustomerAccountByZohoCompanyId(companyId: string, zohoCompanyId: string): Promise<{ id: string } | null>;
  createCustomerAccount(args: { companyId: string; name: string; zohoCompanyId: string }): Promise<{ id: string }>;
  /** Scoped to customerAccountId, not just companyId — a Site's machine identity is composite. */
  findSiteByServiceAddress(customerAccountId: string, zohoServiceAddressId: string): Promise<{ id: string } | null>;
  createSite(args: {
    companyId: string;
    customerAccountId: string;
    zohoServiceAddressId: string;
    name: string;
    fullAddress: string | null;
    siteContactName: string | null;
    contactNumber: string | null;
    contactEmail: string | null;
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
    // The Work Order directly associated with this Service Appointment — see
    // InboundServiceAppointmentInput.owningWorkOrderId. Persisted in the existing
    // zoho_work_order_id column (unchanged at the DB level; renamed only at this
    // application/type layer to remove the "parent Work Order" ambiguity).
    owningWorkOrderId: string;
    zohoServiceAppointmentId: string;
    zohoWorkOrderNumber: string | null;
    zohoServiceAppointmentNumber: string | null;
    zohoCompanyId: string;
    rawSnapshot: unknown;
    parentWorkOrderId: string | null;
    saTargetAssetCount: number | null;
    saFinalizedAssetCount: number | null;
    zohoSaStatus: string | null;
  }): Promise<{ id: string }>;
  logInboundEvent(args: {
    zohoWorkOrderId: string | null;
    zohoServiceAppointmentId: string | null;
    installerSheetzCompanyValue: string | null;
    zohoServiceAddressIdValue: string | null;
    outcome: InboundOutcome;
    detail: string | null;
    projectId: string | null;
  }): Promise<void>;
}

/**
 * Deterministic Site display-name fallback chain (customer_name is DISPLAY metadata, not
 * identity — see zohoServiceAddressId for the real machine identity):
 *   1. Service_Address_Name, when nonblank (the normal path — dispatchers are expected to give
 *      a saved/reusable address a meaningful name).
 *   2. "<Zoho Company name> — <first line of the address>" when the address name is blank.
 *   3. Whichever of Company name / first address line is present, alone.
 *   4. "Zoho site" — final nonblank floor, only reachable if Zoho supplied neither.
 * Never Service_Address.name (Zoho's internal record label, e.g. "AD-26") and never a Site Code
 * — that identity model has been removed entirely.
 */
function fallbackSiteName(input: InboundServiceAppointmentInput): string {
  if (input.siteAddressName) return input.siteAddressName;
  const firstAddressLine = input.siteAddressLine?.split("\n")[0]?.trim() || null;
  if (input.dealerName && firstAddressLine) return `${input.dealerName} — ${firstAddressLine}`;
  if (firstAddressLine) return firstAddressLine;
  if (input.dealerName) return input.dealerName;
  return "Zoho site";
}

/**
 * The descriptive-field payload for repo.refreshSiteDisplayFields(), shared by both callers that
 * resolve to an EXISTING Site by its machine identity (customer_account_id +
 * zoho_service_address_id) — a same-SA redelivery and a brand-new SA landing on an already-known
 * Site both need the identical refresh, so this is computed once rather than duplicated.
 */
function siteRefreshArgsFor(input: InboundServiceAppointmentInput, siteName: string) {
  return {
    siteName,
    fullAddress: input.siteAddressLine,
    siteContactName: input.siteContactName,
    contactNumber: input.siteContactPhone,
    contactEmail: input.siteContactEmail,
  };
}

/**
 * "<Site> — <Service Appointment Summary> — <Service Appointment Number>", e.g.
 * "Evergreen Acworth — Install One AHD system with Speed Control — AP-8". Site is the current
 * Site display name (siteName, computed via fallbackSiteName), never the Customer Account or
 * OE/Company name, which already exist as separate hierarchy levels. `input.summary` is this
 * SA's own Summary (see field-mapping.ts's business-model note) — a Work Order is the umbrella
 * scope, a Service Appointment is one visit's own scope, so the project name reflects THIS
 * visit, not the whole Work Order. The Service Appointment number is what guarantees uniqueness
 * within a company (projects_company_project_name_key) even when the same Site has repeated
 * visits or multiple Service Appointments share a similar Summary — never a synthetic (2)/(3)
 * suffix.
 *
 * project_name is derived Zoho-owned display metadata, not user-owned freeform text: this is
 * recomputed both at creation AND on every matching-identity redelivery of THIS SAME Service
 * Appointment (see resolveInboundServiceAppointment), so an Address Name correction or a Summary
 * revision on this specific SA updates the SAME project's name rather than requiring a new one.
 * There is no Work Order webhook, so a Work Order Summary edit alone never triggers this —
 * only an actual edit/redelivery of the Service Appointment itself does.
 */
function projectNameFor(input: InboundServiceAppointmentInput, siteName: string): string {
  const serviceAppointmentNumber = input.zohoServiceAppointmentNumber || input.zohoServiceAppointmentId;
  // Defensive fallback only: a Summary (SA's own, or the Work Order's as a narrower fallback —
  // see field-mapping.ts) is expected in the normal Zoho workflow, but a blank/malformed one is
  // simply omitted rather than producing a name with a stray separator.
  const parts = [siteName, input.summary, serviceAppointmentNumber].filter((part): part is string => Boolean(part));
  return parts.join(" — ");
}

/**
 * Resolves one inbound Zoho Service Appointment event into a create-or-reuse decision, per the
 * final Phase 1 Site identity model:
 *   - Installer Sheetz Company blank -> ignore, not opted in.
 *   - Company value nonblank with no active mapping -> actionable error, no project.
 *   - Company recognized but the Work Order has no Service_Address.id -> actionable error, no
 *     project. No fallback to address-text matching.
 *   - Company recognized + Service_Address.id matches an existing Site under the resolved
 *     customer_account -> reuse it. Zoho is the source of truth for a Zoho-linked Site's
 *     descriptive metadata, so this Site is refreshed from the CURRENT Work Order (display name,
 *     full_address, site_contact_name, contact_number, contact_email — non-destructively for the
 *     optional fields) before the new project is created for this new SA.
 *   - Company recognized + Service_Address.id is new for that customer_account -> resolve/create
 *     customer_account by stable Zoho Company.id, auto-create the Site, create the project.
 *   - Repeated delivery for an already-linked zoho_service_appointment_id whose OE company,
 *     Zoho dealer (Company) id, and Service_Address.id all still match what was recorded ->
 *     reuse the existing project/site/customer_account; refresh the link snapshot plus the same
 *     Site descriptive refresh as above, plus THIS SA's own project_name (and the denormalized
 *     projects.customer_name) from current Zoho data — this half is specific to same-SA
 *     redelivery, since a brand-new SA creates its own new project instead, and it only ever
 *     touches the redelivered SA's OWN project row. When multiple SAs share one Site (e.g. AP-10
 *     and AP-11 both at the same physical location), redelivering AP-10 refreshes the shared
 *     Site row (visible to both) but never rewrites AP-11's own project_name — that only happens
 *     when AP-11 itself is synchronized/edited, preserving "one project follows only its own SA's
 *     lifecycle." Identity/linkage (company, customer_account, Service_Address.id, project id,
 *     the SA->project relationship) is never touched. A Service_Address_Name correction, this
 *     SA's own Summary revision, or any other purely descriptive change is NOT a mismatch — it's
 *     a rename, handled here.
 *   - Repeated delivery whose OE company, Zoho dealer, or Service_Address.id no longer matches
 *     what this SA was originally linked under -> identity_mismatch_on_reuse. The link snapshot
 *     still refreshes, but no descriptive fields are touched and nothing is reassigned; the
 *     existing project id is still returned so the caller can log/alert without entering a
 *     retry loop.
 * Every branch is logged to zoho_fsm_inbound_events, including ones that never produce a
 * project, so failures are actionable rather than silently swallowed.
 */
export async function resolveInboundServiceAppointment(
  repo: ZohoFsmRepo,
  input: InboundServiceAppointmentInput,
): Promise<InboundResolutionResult> {
  const log = (outcome: InboundOutcome, detail: string | null, projectId: string | null) =>
    repo.logInboundEvent({
      zohoWorkOrderId: input.owningWorkOrderId,
      zohoServiceAppointmentId: input.zohoServiceAppointmentId,
      installerSheetzCompanyValue: input.installerSheetzCompanyValue,
      zohoServiceAddressIdValue: input.zohoServiceAddressId,
      outcome,
      detail,
      projectId,
    });

  // Idempotency first: a repeated delivery for an already-linked SA must never create another
  // customer_account, Site, or project, regardless of what the branches below would otherwise
  // decide.
  const existingLink = await repo.findExistingLink(input.zohoServiceAppointmentId);
  if (existingLink) {
    // Always safe: this just records the latest raw Zoho state for this SA, independent of
    // whether our downstream identity check below still matches. Includes the four passive
    // evidence fields (parentWorkOrderId, saTargetAssetCount, saFinalizedAssetCount,
    // zohoSaStatus) — Zoho integration state, not identity, so they refresh unconditionally too.
    await repo.refreshLinkSnapshot(existingLink.id, {
      rawSnapshot: input.raw,
      zohoWorkOrderNumber: input.zohoWorkOrderNumber,
      zohoServiceAppointmentNumber: input.zohoServiceAppointmentNumber,
      parentWorkOrderId: input.parentWorkOrderId,
      saTargetAssetCount: input.saTargetAssetCount,
      saFinalizedAssetCount: input.saFinalizedAssetCount,
      zohoSaStatus: input.zohoSaStatus,
    });

    const incomingCompanyValue = (input.installerSheetzCompanyValue || "").trim();
    const incomingMapping = incomingCompanyValue ? await repo.findActiveCompanyMapping(incomingCompanyValue) : null;

    // Blank/unmapped incoming company counts as a mismatch too — the recorded link always has a
    // real company, so "no company this time" is itself a divergence from what was recorded.
    const companyMismatch = !incomingMapping || incomingMapping.companyId !== existingLink.companyId;
    const dealerMismatch = (input.zohoCompanyId || null) !== existingLink.zohoCompanyId;
    const serviceAddressMismatch = (input.zohoServiceAddressId || null) !== existingLink.zohoServiceAddressId;

    if (companyMismatch || dealerMismatch || serviceAddressMismatch) {
      const detail =
        `Identity mismatch on reuse for SA ${input.zohoServiceAppointmentId}: ` +
        `recorded company_id="${existingLink.companyId}", zoho_company_id="${existingLink.zohoCompanyId}", ` +
        `service_address_id="${existingLink.zohoServiceAddressId ?? "(none)"}" ` +
        `vs incoming Installer Sheetz Company="${incomingCompanyValue || "(blank)"}"` +
        `${incomingMapping ? ` (resolved company_id="${incomingMapping.companyId}")` : incomingCompanyValue ? " (unmapped)" : ""}, ` +
        `zoho_company_id="${input.zohoCompanyId ?? "(blank)"}", ` +
        `service_address_id="${input.zohoServiceAddressId ?? "(blank)"}". Not reassigning or refreshing descriptive fields.`;
      await log("identity_mismatch_on_reuse", detail, existingLink.projectId);
      return { outcome: "identity_mismatch_on_reuse", detail, projectId: existingLink.projectId };
    }

    // Identity confirmed unchanged — refresh the Site's derived display name and descriptive
    // fields (Zoho is the source of truth; non-destructive for the optional fields), plus this
    // same-SA-redelivery-specific project_name/customer_name regeneration (always nonblank via
    // the fallback chain, applied unconditionally). True identity/linkage fields (company,
    // customer_account, Service_Address.id, project id, the SA->project relationship itself)
    // are never touched here.
    const siteName = fallbackSiteName(input);
    if (existingLink.siteId) {
      await repo.refreshSiteDisplayFields(existingLink.siteId, siteRefreshArgsFor(input, siteName));
    }
    await repo.refreshProjectDisplayFields(existingLink.projectId, {
      projectName: projectNameFor(input, siteName),
      customerName: siteName,
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

  const serviceAddressId = input.zohoServiceAddressId;
  if (!serviceAddressId) {
    // No fallback to address-text matching — a Site cannot be resolved without Zoho's own
    // stable Service_Address.id.
    const detail = "Work Order has no Service_Address.id; cannot resolve a Site without a valid Zoho Service Address.";
    await log("error_missing_service_address_id", detail, null);
    return { outcome: "error_missing_service_address_id", detail, projectId: null };
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

  const siteName = fallbackSiteName(input);
  const existingSite = await repo.findSiteByServiceAddress(customerAccountId, serviceAddressId);
  let siteId: string;
  if (existingSite) {
    // A brand-new SA landing on an already-known Site (same customer_account +
    // zoho_service_address_id) still refreshes that Site from the CURRENT Work Order — Zoho is
    // the source of truth for descriptive metadata regardless of which SA triggered the delivery.
    siteId = existingSite.id;
    await repo.refreshSiteDisplayFields(siteId, siteRefreshArgsFor(input, siteName));
  } else {
    siteId = (
      await repo.createSite({
        companyId,
        customerAccountId,
        zohoServiceAddressId: serviceAddressId,
        name: siteName,
        fullAddress: input.siteAddressLine,
        siteContactName: input.siteContactName,
        contactNumber: input.siteContactPhone,
        contactEmail: input.siteContactEmail,
      })
    ).id;
  }

  const project = await repo.createProject({
    companyId,
    customerId: siteId,
    projectName: projectNameFor(input, siteName),
    customerName: siteName,
    location: input.siteAddressLine || "",
  });

  await repo.createLink({
    projectId: project.id,
    companyId,
    owningWorkOrderId: input.owningWorkOrderId,
    zohoServiceAppointmentId: input.zohoServiceAppointmentId,
    zohoWorkOrderNumber: input.zohoWorkOrderNumber,
    zohoServiceAppointmentNumber: input.zohoServiceAppointmentNumber,
    zohoCompanyId: input.zohoCompanyId || "",
    rawSnapshot: input.raw,
    parentWorkOrderId: input.parentWorkOrderId,
    saTargetAssetCount: input.saTargetAssetCount,
    saFinalizedAssetCount: input.saFinalizedAssetCount,
    zohoSaStatus: input.zohoSaStatus,
  });

  await log("created", null, project.id);
  return { outcome: "created", detail: null, projectId: project.id };
}
