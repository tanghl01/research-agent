import { AdminUserDetailPage } from "@/components/admin-console";

export default async function OperatorAdminUserDetailRoute({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <AdminUserDetailPage userId={userId} />;
}
