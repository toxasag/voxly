'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[18px] text-sm font-medium transition-[color,background-color,border-color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border border-hairline bg-transparent text-ink hover:bg-canvas',
        secondary: 'border-0 bg-canvas text-ink hover:bg-hairline/60',
        outline: 'border border-hairline bg-transparent text-ink hover:bg-canvas',
        ghost: 'border-0 text-ink hover:bg-canvas',
        destructive: 'border-0 bg-ember text-paper hover:bg-ember/90',
        solid: 'border-0 bg-ink text-paper hover:bg-ink-soft',
        link: 'border-0 text-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-[13px]',
        lg: 'h-10 px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
