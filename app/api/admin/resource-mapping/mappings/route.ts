import { NextResponse } from "next/server";
import { authorizeGlobalAdmin, extractBearerToken, getSupabaseServerEnv } from "@/lib/company-users/admin-api";
import { fetchObservedResourceCatalog, type ZohoResourceMapRow } from "@/lib/zoho-fsm/resource-map";

type ProfileLookupRow = { id: string; display_name: string | null; email: string | null };

export async function GET(req: Request) {
  const env = getSupabaseServerEnv();
  const auth = await authorizeGlobalAdmin({ env, accessToken: extractBearerToken(req) });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { serviceClient } = auth;

  try {
    const [{ data: mapRows, error: mapError }, catalog] = await Promise.all([
      serviceClient
        .from("zoho_resource_map")
        .select("zoho_resource_id, zoho_user_id, user_id, mapped_by, mapped_at, created_at, updated_at")
        .order("mapped_at", { ascending: false }),
      fetchObservedResourceCatalog(serviceClient),
    ]);
    if (mapError) throw mapError;
    const mappings = (mapRows as ZohoResourceMapRow[] | null) || [];

    const profileIds = Array.from(
      new Set(mappings.flatMap((m) => [m.user_id, m.mapped_by].filter((id): id is string => Boolean(id)))),
    );
    let profilesById = new Map<string, ProfileLookupRow>();
    if (profileIds.length > 0) {
      const { data: profileRows, error: profileError } = await serviceClient
        .from("user_profiles")
        .select("id, display_name, email")
        .in("id", profileIds);
      if (profileError) throw profileError;
      profilesById = new Map(((profileRows as ProfileLookupRow[] | null) || []).map((p) => [p.id, p]));
    }

    const result = mappings.map((m) => {
      const observed = catalog.get(m.zoho_resource_id);
      const mappedUser = profilesById.get(m.user_id);
      const mappedByUser = m.mapped_by ? profilesById.get(m.mapped_by) : null;
      return {
        zohoResourceId: m.zoho_resource_id,
        zohoUserId: m.zoho_user_id,
        zohoResourceName: observed?.name ?? null,
        zohoResourceType: observed?.type ?? null,
        stillObserved: Boolean(observed),
        userId: m.user_id,
        userDisplayName: mappedUser?.display_name || mappedUser?.email || m.user_id,
        userEmail: mappedUser?.email ?? null,
        mappedBy: m.mapped_by,
        mappedByDisplayName: mappedByUser?.display_name || mappedByUser?.email || m.mapped_by,
        mappedAt: m.mapped_at,
        updatedAt: m.updated_at,
      };
    });

    return NextResponse.json({ mappings: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load Zoho resource mappings.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
