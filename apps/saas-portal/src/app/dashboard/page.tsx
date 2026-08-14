import { getServerSession, getServerDashboard } from '@/lib/dashboard-server';
import DashboardClient from './dashboard-client';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default async function DashboardPage() {
  let me;
  try {
    me = await getServerSession();
  } catch {
    // redirect handled inside getServerSession
    return null;
  }

  if (!me.tenant) {
    if (me.role === 'superadmin') {
      return (
        <AppShell showNav={false} maxWidth="2xl">
          <div className="py-16 text-center">
            <h1 className="land-display text-[30px] tracking-[-0.025em]">Супер-админ</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Платформенная админка, без клиентского воркспейса.
            </p>
            <Button asChild variant="solid" className="mt-6">
              <Link href="/admin">Открыть /admin</Link>
            </Button>
          </div>
        </AppShell>
      );
    }

    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">Нет воркспейса</Alert>
      </AppShell>
    );
  }

  let data;
  try {
    data = await getServerDashboard();
  } catch (e) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">
          {e instanceof Error ? e.message : 'Не удалось загрузить дашборд'}
        </Alert>
      </AppShell>
    );
  }

  return <DashboardClient data={data} role={me.role} />;
}
