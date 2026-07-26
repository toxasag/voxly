import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Alert({
  children,
  variant = 'error',
  className,
}: {
  children: React.ReactNode;
  variant?: 'error' | 'success' | 'info';
  className?: string;
}) {
  if (!children) return null;
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'info' ? Info : AlertCircle;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm',
        variant === 'error' &&
          'border-destructive/40 bg-destructive/5 text-destructive animate-error',
        variant === 'success' &&
          'border-emerald-200 bg-emerald-50 text-emerald-900 animate-fade',
        variant === 'info' && 'border-primary/20 bg-primary/5 text-foreground animate-fade',
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  );
}
