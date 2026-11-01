"use client";

import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import { AdminIntegrationsEditor } from "@/components/admin/AdminIntegrationsEditor";

export default function AdminIntegrationsPage() {
  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">
            Шлюзы и ИИ-провайдеры
          </h1>
          <p className="mt-1 text-sm text-[#666666]">
            Подключение платёжного шлюза Robokassa и ключей провайдеров искусственного интеллекта
          </p>
        </div>

        <AdminIntegrationsEditor />
      </div>
    </PlatformOwnerGuard>
  );
}
