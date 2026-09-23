"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SavedJobCardsScreen } from "@/components/SavedJobCardsScreen";

/** companyId/projectId come from the query string here instead of a dynamic route segment — see lib/app-routes.ts's savedJobCards(). */
function SavedJobCardsRouteContent() {
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId") || "";
  const projectId = searchParams.get("projectId") || "";
  return <SavedJobCardsScreen companyId={companyId} projectId={projectId} />;
}

export default function SavedJobCardsPage() {
  return (
    <Suspense fallback={null}>
      <SavedJobCardsRouteContent />
    </Suspense>
  );
}
