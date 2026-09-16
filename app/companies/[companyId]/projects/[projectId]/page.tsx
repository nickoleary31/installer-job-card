"use client";

import { useParams } from "next/navigation";
import { ProjectDetailScreen } from "@/components/ProjectDetailScreen";

export default function ProjectDashboardPage() {
  const params = useParams<{ companyId: string; projectId: string }>();
  const companyId = String(params.companyId || "");
  const projectId = String(params.projectId || "");
  return <ProjectDetailScreen companyId={companyId} projectId={projectId} />;
}
