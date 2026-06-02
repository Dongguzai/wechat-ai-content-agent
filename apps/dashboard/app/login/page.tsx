import { LoginForm } from "@/components/login-form";
import { isDashboardAuthConfigured, safeNextPath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  return <LoginForm nextPath={nextPath} authConfigured={isDashboardAuthConfigured()} />;
}
