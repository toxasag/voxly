'use client';

import type { ReactNode } from 'react';

interface HeroBannerProps {
  greeting?: string;
  date?: string;
  actions?: ReactNode;
}

export function HeroBanner({
  greeting = 'Добрый день!',
  date,
  actions,
}: HeroBannerProps) {
  return (
    <div
      className="mb-8 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 px-6 py-8 sm:px-8 sm:py-10"
      style={{
        background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            {greeting}
          </h2>
          {date && (
            <p className="mt-1 text-sm text-blue-100">
              {date}
            </p>
          )}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
