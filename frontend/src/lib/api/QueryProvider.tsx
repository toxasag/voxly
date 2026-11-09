"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientError } from "@/lib/api/apiClient";

/**
 * React Query provider.
 *
 * The client is created inside `useState` rather than at module scope: a
 * module-level instance would be shared across requests during SSR and leak
 * one user's cached data into another's response.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Tenant data changes from other users' actions, so a short
            // freshness window beats aggressive caching here.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // 4xx responses are deterministic: retrying a validation error
              // or a permission denial only adds latency. 401 is already
              // handled by apiClient's refresh-and-retry.
              if (error instanceof ApiClientError && error.status < 500 && error.status > 0) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            // Mutations are not idempotent — a retry could double-create.
            retry: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
