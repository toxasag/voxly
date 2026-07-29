'use client';

import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface HeroBannerProps {
  greeting?: string;
  date?: string;
  actions?: Array<{
    label: string;
    href: string;
    variant?: 'primary' | 'white';
  }>;
}

export function HeroBanner({
  greeting = 'Добрый день!',
  date,
  actions = [
    { label: '+ Новый документ', href: '#', variant: 'white' },
    { label: '+ Заказ', href: '#', variant: 'primary' },
    { label: '+ Контрагент', href: '#', variant: 'primary' },
  ],
}: HeroBannerProps) {
  return (
    <div 
      className="mb-8 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 px-6 py-8 sm:px-8 sm:py-10"
      style={{
        background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            {greeting}
          </h2>
          {date && (
            <p className="mt-1 text-sm text-blue-100">
              {date}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((action, idx) => (
            <Button
              key={idx}
              asChild
              variant={action.variant === 'white' ? 'outline' : 'default'}
              className={
                action.variant === 'white'
                  ? 'border-white bg-white/10 text-white hover:bg-white/20'
                  : 'bg-blue-50 text-blue-900 hover:bg-blue-100'
              }
              size="sm"
            >
              <Link href={action.href}>
                {action.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
