"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ProjectDetailScreen } from "@/components/ProjectDetailScreen";

/** companyId/projectId come from the query string here (see lib/app-routes.ts) instead of [companyId]/[projectId] file segments — static export can't have dynamic routes. */
function ProjectRouteContent() {
  const searchParams = useSearchParams();
  const companyId = searchParams.get("companyId") || "";
  const projectId = searchParams.get("projectId") || "";
  return <ProjectDetailScreen companyId={companyId} projectId={projectId} />;
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectRouteContent />
    </Suspense>
  );
}
