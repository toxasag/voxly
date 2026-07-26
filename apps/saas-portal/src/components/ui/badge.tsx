import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-[18px] border px-2 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-ink-soft text-paper',
        secondary: 'border-transparent bg-canvas text-ink-soft',
        success: 'border-transparent bg-canvas text-ink-soft',
        warning: 'border border-hairline bg-paper text-mid-gray',
        outline: 'border-hairline bg-transparent text-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
