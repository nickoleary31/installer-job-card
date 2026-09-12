import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZohoFsmRepo } from "./resolve";

/** Real ZohoFsmRepo implementation backed by a service-role Supabase client (server-only). */
export function createSupabaseZohoFsmRepo(serviceClient: SupabaseClient): ZohoFsmRepo {
  return {
    async findActiveCompanyMapping(zohoValue) {
      const { data, error } = await serviceClient
        .from("zoho_fsm_installer_company_map")
        .select("company_id")
        .eq("zoho_value", zohoValue)
        .eq("active", true)
        .maybeSingle<{ company_id: string }>();
      if (error) throw error;
      return data ? { companyId: data.company_id } : null;
    },

    async findExistingLink(zohoServiceAppointmentId) {
      const { data, error } = await serviceClient
        .from("zoho_fsm_service_appointments")
        .select(
          "id, project_id, company_id, zoho_company_id, projects:project_id(customer_id, customers:customer_id(zoho_service_address_id))",
        )
        .eq("zoho_service_appointment_id", zohoServiceAppointmentId)
        .maybeSingle<{
          id: string;
          project_id: string;
          company_id: string;
          zoho_company_id: string;
          projects: { customer_id: string | null; customers: { zoho_service_address_id: string | null } | null } | null;
        }>();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        projectId: data.project_id,
        siteId: data.projects?.customer_id ?? null,
        companyId: data.company_id,
        zohoCompanyId: data.zoho_company_id,
        zohoServiceAddressId: data.projects?.customers?.zoho_service_address_id ?? null,
      };
    },

    async refreshLinkSnapshot(linkId, args) {
      const { error } = await serviceClient
        .from("zoho_fsm_service_appointments")
        .update({
          raw_snapshot: args.rawSnapshot,
          zoho_work_order_number: args.zohoWorkOrderNumber,
          zoho_service_appointment_number: args.zohoServiceAppointmentNumber,
          // Passive evidence fields — always refreshed alongside raw_snapshot, independent of
          // the identity-mismatch check in resolve.ts. sa_finalized_asset_count intentionally
          // passes through null as null (never coerced to 0) — see field-mapping.ts's
          // readNullableIntegerField.
          parent_work_order_id: args.parentWorkOrderId,
          sa_target_asset_count: args.saTargetAssetCount,
          sa_finalized_asset_count: args.saFinalizedAssetCount,
          zoho_sa_status: args.zohoSaStatus,
          inbound_status: "updated",
          inbound_last_event_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkId);
      if (error) throw error;
    },

    async refreshSiteDisplayFields(siteId, args) {
      // Independently blank-safe — treats whitespace-only candidates as absent rather than
      // relying solely on callers to have already trimmed their input. Does not apply to
      // siteName below: it's derived display metadata with its own guaranteed-non-blank
      // fallback chain (see resolve.ts) and is always applied.
      const nonBlank = (value: string | null): string | null => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };

      const customerUpdate: Record<string, string> = { customer_name: args.siteName };
      const fullAddress = nonBlank(args.fullAddress);
      const siteContactName = nonBlank(args.siteContactName);
      const contactNumber = nonBlank(args.contactNumber);
      const contactEmail = nonBlank(args.contactEmail);
      if (fullAddress) customerUpdate.full_address = fullAddress;
      if (siteContactName) customerUpdate.site_contact_name = siteContactName;
      if (contactNumber) customerUpdate.contact_number = contactNumber;
      if (contactEmail) customerUpdate.contact_email = contactEmail;
      const { error: customerError } = await serviceClient.from("customers").update(customerUpdate).eq("id", siteId);
      if (customerError) throw customerError;
    },

    async refreshProjectDisplayFields(projectId, args) {
      // project_name and the denormalized projects.customer_name are unconditional — both are
      // derived Zoho display metadata with their own nonblank fallback chain. Leaving
      // projects.customer_name stale would make this row internally inconsistent with the Site
      // it's linked to, even though the current project-list screen happens to prefer the
      // joined customers.customer_name when a link exists. location stays non-destructive, same
      // convention as the other optional descriptive fields.
      const projectUpdate: Record<string, string> = { project_name: args.projectName, customer_name: args.customerName };
      const location = typeof args.location === "string" ? args.location.trim() : "";
      if (location) projectUpdate.location = location;
      const { error: projectUpdateError } = await serviceClient
        .from("projects")
        .update(projectUpdate)
        .eq("id", projectId);
      if (projectUpdateError) throw projectUpdateError;
    },

    async findCustomerAccountByZohoCompanyId(companyId, zohoCompanyId) {
      const { data, error } = await serviceClient
        .from("customer_accounts")
        .select("id")
        .eq("company_id", companyId)
        .eq("zoho_company_id", zohoCompanyId)
        .maybeSingle<{ id: string }>();
      if (error) throw error;
      return data ? { id: data.id } : null;
    },

    async createCustomerAccount(args) {
      const { data, error } = await serviceClient
        .from("customer_accounts")
        .insert({
          company_id: args.companyId,
          name: args.name,
          zoho_company_id: args.zohoCompanyId,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      return { id: data.id };
    },

    async findSiteByServiceAddress(customerAccountId, zohoServiceAddressId) {
      const { data, error } = await serviceClient
        .from("customers")
        .select("id")
        .eq("customer_account_id", customerAccountId)
        .eq("zoho_service_address_id", zohoServiceAddressId)
        .maybeSingle<{ id: string }>();
      if (error) throw error;
      return data ? { id: data.id } : null;
    },

    async createSite(args) {
      const { data, error } = await serviceClient
        .from("customers")
        .insert({
          company_id: args.companyId,
          customer_account_id: args.customerAccountId,
          zoho_service_address_id: args.zohoServiceAddressId,
          customer_name: args.name,
          full_address: args.fullAddress,
          site_contact_name: args.siteContactName,
          contact_number: args.contactNumber,
          contact_email: args.contactEmail,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      return { id: data.id };
    },

    async createProject(args) {
      const { data, error } = await serviceClient
        .from("projects")
        .insert({
          company_id: args.companyId,
          customer_id: args.customerId,
          project_name: args.projectName,
          customer_name: args.customerName,
          location: args.location,
          active: true,
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      return { id: data.id };
    },

    async createLink(args) {
      const { data, error } = await serviceClient
        .from("zoho_fsm_service_appointments")
        .insert({
          project_id: args.projectId,
          company_id: args.companyId,
          // Physical column name is unchanged (zoho_work_order_id); args.owningWorkOrderId is
          // the application/type-level name for the same value — see resolve.ts's ZohoFsmRepo.
          zoho_work_order_id: args.owningWorkOrderId,
          zoho_service_appointment_id: args.zohoServiceAppointmentId,
          zoho_work_order_number: args.zohoWorkOrderNumber,
          zoho_service_appointment_number: args.zohoServiceAppointmentNumber,
          zoho_company_id: args.zohoCompanyId,
          raw_snapshot: args.rawSnapshot,
          parent_work_order_id: args.parentWorkOrderId,
          sa_target_asset_count: args.saTargetAssetCount,
          sa_finalized_asset_count: args.saFinalizedAssetCount,
          zoho_sa_status: args.zohoSaStatus,
          inbound_status: "created",
          inbound_last_event_at: new Date().toISOString(),
        })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      return { id: data.id };
    },

    async logInboundEvent(args) {
      // Diagnostics only — never let a logging failure surface as the request's error.
      const { error } = await serviceClient.from("zoho_fsm_inbound_events").insert({
        zoho_work_order_id: args.zohoWorkOrderId,
        zoho_service_appointment_id: args.zohoServiceAppointmentId,
        installer_sheetz_company_value: args.installerSheetzCompanyValue,
        zoho_service_address_id_value: args.zohoServiceAddressIdValue,
        outcome: args.outcome,
        detail: args.detail,
        project_id: args.projectId,
      });
      if (error) console.error("[zoho-fsm] failed to log inbound event", error);
    },
  };
}
