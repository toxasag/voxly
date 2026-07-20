import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-[border-color,box-shadow] duration-[var(--duration-fast)] placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
