import { CloudBriefView } from "@/components/cloud-brief-view";
import { requireDashboardSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BriefPage() {
  await requireDashboardSession("/brief");

  return <CloudBriefView />;
}
