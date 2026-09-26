import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeCompanyUserManager, type SupabaseServerEnv } from "./admin-api.ts";
import type { AddExistingDeps, AddExistingMembership, AddExistingProfile } from "./add-existing-user.ts";
import type { CompanyUserSearchDeps, CompanyUserSearchMembership, CompanyUserSearchProfile } from "./company-user-search.ts";

/**
 * Real Supabase wiring for the company-user search and add-existing routes.
 * Each factory's authorize() goes through authorizeCompanyUserManager, which
 * fails closed without the service-role key and refuses inactive or
 * non-admin requesters. Only after it succeeds is the service client it
 * returns captured for the data functions. A data function called without a
 * successful authorize() throws: it can never run with a different client.
 */
function authorizedClientHolder(env: SupabaseServerEnv) {
  let client: SupabaseClient | null = null;
  return {
    async authorize(args: { accessToken: string; companyId: string }) {
      const auth = await authorizeCompanyUserManager({ env, ...args });
      if (!auth.ok) return auth;
      client = auth.dataClient;
      return { ok: true as const, requesterUserId: auth.requesterUserId };
    },
    client(): SupabaseClient {
      if (!client) throw new Error("Company-user data access attempted before authorization succeeded.");
      return client;
    },
  };
}

export function createCompanyUserSearchDeps(env: SupabaseServerEnv): CompanyUserSearchDeps {
  const holder = authorizedClientHolder(env);
  return {
    authorize: holder.authorize,
    async searchProfiles({ pattern, exactUserId, limit }) {
      const client = holder.client();
      const select = "id, email, display_name, is_active";
      const byEmail = await client.from("user_profiles").select(select).ilike("email", pattern).limit(limit);
      if (byEmail.error) return { profiles: [], error: byEmail.error.message };
      const byName = await client.from("user_profiles").select(select).ilike("display_name", pattern).limit(limit);
      if (byName.error) return { profiles: [], error: byName.error.message };
      const profiles = [
        ...((byEmail.data as CompanyUserSearchProfile[] | null) || []),
        ...((byName.data as CompanyUserSearchProfile[] | null) || []),
      ];
      if (exactUserId) {
        const byId = await client.from("user_profiles").select(select).eq("id", exactUserId).limit(1);
        if (byId.error) return { profiles: [], error: byId.error.message };
        profiles.push(...((byId.data as CompanyUserSearchProfile[] | null) || []));
      }
      return { profiles, error: null };
    },
    async loadCompanyMemberships(companyId, userIds) {
      const { data, error } = await holder
        .client()
        .from("company_memberships")
        .select("user_id, company_id, role, is_active")
        .eq("company_id", companyId)
        .in("user_id", userIds);
      if (error) return { memberships: [], error: error.message };
      return { memberships: (data as CompanyUserSearchMembership[] | null) || [], error: null };
    },
    async loadCompanyName(companyId) {
      const { data, error } = await holder
        .client()
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle<{ name: string | null }>();
      if (error) return { name: null, error: error.message };
      return { name: data?.name ?? null, error: null };
    },
  };
}

export function createAddExistingDeps(env: SupabaseServerEnv): AddExistingDeps {
  const holder = authorizedClientHolder(env);
  return {
    authorize: holder.authorize,
    async loadProfile(userId) {
      const { data, error } = await holder
        .client()
        .from("user_profiles")
        .select("id, email, display_name, is_active")
        .eq("id", userId)
        .maybeSingle<AddExistingProfile>();
      if (error) return { profile: null, error: error.message };
      return { profile: data ?? null, error: null };
    },
    async loadMembership(companyId, userId) {
      const { data, error } = await holder
        .client()
        .from("company_memberships")
        .select("user_id, role, is_active")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .maybeSingle<AddExistingMembership>();
      if (error) return { membership: null, error: error.message };
      return { membership: data ?? null, error: null };
    },
    async upsertMembership({ companyId, userId, role, updatedAt }) {
      const { error } = await holder
        .client()
        .from("company_memberships")
        .upsert(
          { company_id: companyId, user_id: userId, role, is_active: true, updated_at: updatedAt },
          { onConflict: "user_id,company_id" },
        );
      return { error: error?.message ?? null };
    },
  };
}
