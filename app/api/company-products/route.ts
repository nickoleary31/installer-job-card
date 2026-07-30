import {
  extractBearerToken,
  getSupabaseServerEnv,
  createUserScopedClient,
  createServiceRoleClient,
} from "@/lib/company-users/admin-api";
import { createClient } from "@supabase/supabase-js";
import { fetchCompanyFormProducts } from "@/lib/product-config/repository";

/**
 * Authenticated read of company_form_products for hybrid job-card resolution.
 * Uses the caller's JWT (RLS) when possible; falls back to service role only for
 * active global admins if needed. Technicians rely on membership RLS.
 */
export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  if (env.missingPublic.length > 0) {
    return Response.json({ error: "Server configuration incomplete.", products: [] }, { status: 500 });
  }

  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    return Response.json({ error: "Unauthorized.", products: [] }, { status: 401 });
  }

  const companyId = new URL(req.url).searchParams.get("companyId")?.trim() || "";
  if (!companyId) {
    return Response.json({ error: "companyId is required.", products: [] }, { status: 400 });
  }

  const anon = createClient(env.url, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: userError,
  } = await anon.auth.getUser(accessToken);
  if (userError || !user) {
    return Response.json({ error: "Unauthorized.", products: [] }, { status: 401 });
  }

  const userClient = createUserScopedClient(env, accessToken);
  let { rows, error } = await fetchCompanyFormProducts(userClient, companyId);

  // If RLS/table missing, try service role for global admin only; otherwise report fallback signal.
  if (error) {
    const service = createServiceRoleClient(env);
    if (service) {
      const { data: profile } = await service
        .from("user_profiles")
        .select("global_role, is_active")
        .eq("id", user.id)
        .maybeSingle();
      const isGlobalAdmin =
        profile?.global_role === "admin" && profile?.is_active !== false;
      if (isGlobalAdmin) {
        ({ rows, error } = await fetchCompanyFormProducts(service, companyId));
      }
    }
  }

  if (error) {
    console.error("[api/company-products] fetch failed", { companyId, error });
    return Response.json(
      {
        error,
        products: [],
        fallbackToRegistry: true,
      },
      { status: /does not exist|Could not find the table/i.test(error) ? 200 : 500 },
    );
  }

  return Response.json({ products: rows, fallbackToRegistry: false });
}
