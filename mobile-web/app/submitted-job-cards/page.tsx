"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SubmittedJobCardsScreen } from "@/components/SubmittedJobCardsScreen";

/** companyId/projectId come from the query string here instead of a dynamic route segment — see lib/app-routes.ts's submitted(). */
function SubmittedJobCardsRouteContent() {
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId") || "";
  const projectId = searchParams.get("projectId") || "";
  return <SubmittedJobCardsScreen companyId={companyId} projectId={projectId} />;
}

export default function SubmittedJobCardsPage() {
  return (
    <Suspense fallback={null}>
      <SubmittedJobCardsRouteContent />
    </Suspense>
  );
}
