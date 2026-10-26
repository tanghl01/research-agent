import { Suspense } from "react";
import { AdminUsersPage } from "@/components/admin-console";

export default function OperatorAdminUsersPage() {
  return (
    <Suspense fallback={null}>
      <AdminUsersPage />
    </Suspense>
  );
}
