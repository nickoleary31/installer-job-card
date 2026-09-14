import { NextResponse } from "next/server";
import { asString, authorizeGlobalAdmin, extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { companyIdsForResource, fetchObservedResourceCatalog } from "@/lib/zoho-fsm/resource-map";

type ProfileRow = { id: string; is_active: boolean };
type MembershipRow = { company_id: string; is_active: boolean };

/**
 * Creates or updates (remaps) the confirmed identity mapping for one Zoho Service Resource id.
 * Mapping foundation only — never assigns the user to any project, never touches
 * project_assignments. See supabase/migrations/20260914000000_zoho_resource_map.sql.
 */
export async function POST(req: Request) {
  const env = getSupabaseServerEnv();
  let body: { zohoResourceId?: unknown; userId?: unknown };
  try {
    body = (await req.json()) as { zohoResourceId?: unknown; userId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const zohoResourceId = asString(body.zohoResourceId).trim();
  const userId = asString(body.userId).trim();
  if (!zohoResourceId) {
    return NextResponse.json({ error: "zohoResourceId is required." }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const auth = await authorizeGlobalAdmin({ env, accessToken: extractBearerToken(req) });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { serviceClient, requesterUserId } = auth;

  try {
    // Never trust a resource id the browser merely claims exists — only one we have actually
    // observed on a stored Service Appointment snapshot may be confirmed as a mapping.
    const catalog = await fetchObservedResourceCatalog(serviceClient);
    const observed = catalog.get(zohoResourceId);
    if (!observed) {
      return NextResponse.json(
        { error: "This Zoho resource id has not been observed on any stored Service Appointment." },
        { status: 400 },
      );
    }

    const { data: targetProfile, error: profileError } = await serviceClient
      .from("user_profiles")
      .select("id, is_active")
      .eq("id", userId)
      .maybeSingle<ProfileRow>();
    if (profileError) throw profileError;
    if (!targetProfile) {
      return NextResponse.json({ error: "Selected Installer Sheetz user was not found." }, { status: 400 });
    }
    if (!targetProfile.is_active) {
      return NextResponse.json({ error: "Selected Installer Sheetz user is not active." }, { status: 400 });
    }

    const { data: memberships, error: membershipError } = await serviceClient
      .from("company_memberships")
      .select("company_id, is_active")
      .eq("user_id", userId)
      .eq("is_active", true);
    if (membershipError) throw membershipError;
    const userCompanyIds = new Set(((memberships as MembershipRow[] | null) || []).map((m) => m.company_id));
    const resourceCompanyIds = companyIdsForResource(observed);
    const sharesCompany = [...resourceCompanyIds].some((id) => userCompanyIds.has(id));
    if (!sharesCompany) {
      return NextResponse.json(
        {
          error:
            "Selected user is not an active member of any company this Zoho resource has been observed on. " +
            "Mapping would grant cross-company access and was rejected.",
        },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const { error: upsertError } = await serviceClient.from("zoho_resource_map").upsert(
      {
        zoho_resource_id: zohoResourceId,
        zoho_user_id: observed.zohoUserId,
        user_id: userId,
        mapped_by: requesterUserId,
        mapped_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "zoho_resource_id" },
    );
    if (upsertError) throw upsertError;

    return NextResponse.json({
      ok: true,
      zohoResourceId,
      userId,
      message: `Mapped "${observed.name || zohoResourceId}" to the selected user.`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save the resource mapping.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
