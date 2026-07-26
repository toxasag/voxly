import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-9 w-full rounded-[18px] border-0 bg-canvas px-2.5 py-2 text-sm text-ink shadow-none transition-[box-shadow,background-color] duration-[var(--duration-fast)] placeholder:text-mid-gray focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
