import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-8 flex flex-wrap items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 rounded-[6px] text-sm text-mid-gray transition-colors duration-[var(--duration-fast)] hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel || 'Назад'}
          </Link>
        )}
        <h1
          className={cn(
            'text-[30px] font-semibold tracking-[-0.025em] text-ink',
            backHref ? 'mt-2' : '',
          )}
        >
          {title}
        </h1>
        {description && <div className="mt-1 text-sm text-mid-gray">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
