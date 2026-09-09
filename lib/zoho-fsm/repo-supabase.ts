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
        .select("id, project_id, company_id, projects:project_id(customer_id, customers:customer_id(zoho_site_code))")
        .eq("zoho_service_appointment_id", zohoServiceAppointmentId)
        .maybeSingle<{
          id: string;
          project_id: string;
          company_id: string;
          projects: { customer_id: string | null; customers: { zoho_site_code: string | null } | null } | null;
        }>();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        projectId: data.project_id,
        companyId: data.company_id,
        zohoSiteCode: data.projects?.customers?.zoho_site_code ?? null,
      };
    },

    async refreshLinkSnapshot(linkId, args) {
      const { error } = await serviceClient
        .from("zoho_fsm_service_appointments")
        .update({
          raw_snapshot: args.rawSnapshot,
          zoho_work_order_number: args.zohoWorkOrderNumber,
          zoho_service_appointment_number: args.zohoServiceAppointmentNumber,
          inbound_status: "updated",
          inbound_last_event_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", linkId);
      if (error) throw error;
    },

    async refreshSiteAndProjectDisplayFields(projectId, args) {
      // Independently blank-safe — treats whitespace-only candidates as absent rather than
      // relying solely on callers to have already trimmed their input.
      const nonBlank = (value: string | null): string | null => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };

      const { data: project, error: projectLookupError } = await serviceClient
        .from("projects")
        .select("customer_id")
        .eq("id", projectId)
        .maybeSingle<{ customer_id: string | null }>();
      if (projectLookupError) throw projectLookupError;

      if (project?.customer_id) {
        const customerUpdate: Record<string, string> = {};
        const fullAddress = nonBlank(args.fullAddress);
        const siteContactName = nonBlank(args.siteContactName);
        const contactNumber = nonBlank(args.contactNumber);
        const contactEmail = nonBlank(args.contactEmail);
        if (fullAddress) customerUpdate.full_address = fullAddress;
        if (siteContactName) customerUpdate.site_contact_name = siteContactName;
        if (contactNumber) customerUpdate.contact_number = contactNumber;
        if (contactEmail) customerUpdate.contact_email = contactEmail;
        if (Object.keys(customerUpdate).length > 0) {
          const { error: customerError } = await serviceClient
            .from("customers")
            .update(customerUpdate)
            .eq("id", project.customer_id);
          if (customerError) throw customerError;
        }
      }

      const location = nonBlank(args.location);
      if (location) {
        const { error: projectUpdateError } = await serviceClient
          .from("projects")
          .update({ location })
          .eq("id", projectId);
        if (projectUpdateError) throw projectUpdateError;
      }
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

    async findSiteByCode(companyId, zohoSiteCode) {
      const { data, error } = await serviceClient
        .from("customers")
        .select("id")
        .eq("company_id", companyId)
        .eq("zoho_site_code", zohoSiteCode)
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
          zoho_site_code: args.zohoSiteCode,
          customer_name: args.name,
          full_address: args.fullAddress,
          site_contact_name: args.siteContactName,
          contact_number: args.contactNumber,
          contact_email: args.contactEmail,
          end_customer_name: args.endCustomerName,
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
          zoho_work_order_id: args.zohoWorkOrderId,
          zoho_service_appointment_id: args.zohoServiceAppointmentId,
          zoho_work_order_number: args.zohoWorkOrderNumber,
          zoho_service_appointment_number: args.zohoServiceAppointmentNumber,
          zoho_company_id: args.zohoCompanyId,
          raw_snapshot: args.rawSnapshot,
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
        zoho_site_code_value: args.zohoSiteCodeValue,
        outcome: args.outcome,
        detail: args.detail,
        project_id: args.projectId,
      });
      if (error) console.error("[zoho-fsm] failed to log inbound event", error);
    },
  };
}
