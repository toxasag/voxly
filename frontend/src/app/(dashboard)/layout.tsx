import { cookies } from "next/headers";
import { TenantPortalGuard } from "@/components/auth/TenantPortalGuard";
import { DashboardShell } from "@/components/layout/DashboardShell";

export const metadata = {
  title: "Рабочее пространство — GETVOXLY",
};

const SIDEBAR_COOKIE = "voxly_sidebar_collapsed";

// AuthProvider lives in the root layout so /login shares the same session.
//
// Состояние сайдбара читается из cookie на сервере: SSR сразу рендерит нужную
// ширину панели и отступ контента. localStorage для этого негоден — он доступен
// только после гидратации, и свёрнутый сайдбар при обновлении страницы успевал
// отрисоваться развёрнутым.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <TenantPortalGuard>
      <DashboardShell initialCollapsed={collapsed}>{children}</DashboardShell>
    </TenantPortalGuard>
  );
}
