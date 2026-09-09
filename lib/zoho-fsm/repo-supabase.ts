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
        .select("id, project_id")
        .eq("zoho_service_appointment_id", zohoServiceAppointmentId)
        .maybeSingle<{ id: string; project_id: string }>();
      if (error) throw error;
      return data ? { id: data.id, projectId: data.project_id } : null;
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
