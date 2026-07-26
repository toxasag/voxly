import * as React from 'react';
import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-[18px] border-0 bg-canvas px-2.5 py-2 text-sm text-ink shadow-none transition-[box-shadow,background-color] duration-[var(--duration-fast)] placeholder:text-mid-gray focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export { Textarea };
