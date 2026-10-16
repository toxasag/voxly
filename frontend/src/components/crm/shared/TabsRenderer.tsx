"use client";

import { useMemo, type ReactNode } from "react";

import {
  FALLBACK_PAGE_LAYOUT_TABS,
  resolvePageLayoutTabs,
} from "@/components/crm/shared/resolve-page-layout-tabs";
import type { RecordDetailTab } from "@/components/crm/shared/RecordDetailShell";
import {
  usePageLayoutTabs,
  type PageLayoutObjectType,
} from "@/lib/api/use-page-layout-tabs";
import { useAuth } from "@/lib/auth/use-auth";
import type { Permission } from "@/types";

// ---------------------------------------------------------------------------
// TabsRenderer — состав вкладок из БД, содержимое из реестра компонентов.
//
// Карточка передаёт `contents: { home: <...>, tasks: <...> }`. Неизвестный
// ключ из БД пропускается. Пока GET в полёте — показывается запасной сид,
// иначе полоса вкладок мигала бы пустой.
// ---------------------------------------------------------------------------

interface TabsRendererProps {
  objectType: PageLayoutObjectType;
  contents: Readonly<Record<string, ReactNode>>;
}

export function useTabsRenderer({
  objectType,
  contents,
}: TabsRendererProps): RecordDetailTab[] {
  const { user, tenant } = useAuth();
  const query = usePageLayoutTabs(objectType);

  return useMemo(() => {
    const rows = query.data ?? FALLBACK_PAGE_LAYOUT_TABS[objectType];
    const permissions = user?.permissions;

    return resolvePageLayoutTabs(rows, contents, {
      installedModules: tenant?.installedModules ?? [],
      hasPermission: (permission) =>
        permissions?.has(permission as Permission) ?? false,
    });
  }, [contents, objectType, query.data, tenant?.installedModules, user?.permissions]);
}
