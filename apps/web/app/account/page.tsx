import { AccountPage } from "@/components/account-page";

export default async function OperatorAccountPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  return <AccountPage initialTab={rawTab === "settings" ? "settings" : "profile"} />;
}
