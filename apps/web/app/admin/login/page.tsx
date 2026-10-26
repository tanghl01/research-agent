import { AdminLoginPage } from "@/components/admin-console";

export default async function OperatorAdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  return <AdminLoginPage nextPath={safeNextPath(rawNext)} />;
}

function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/admin";
  if (!value.startsWith("/admin")) return "/admin";
  return value;
}
