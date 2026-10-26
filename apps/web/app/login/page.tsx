import { LoginPage } from "@/components/login-page";

export default async function OperatorLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  return <LoginPage nextPath={safeNextPath(rawNext)} />;
}

function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
