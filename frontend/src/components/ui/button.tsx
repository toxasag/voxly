import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-[8px] text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#4a38f5] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-[#4a38f5] text-white shadow-2xs hover:bg-[#3d2ee0]",
        destructive: "bg-rose-600 text-white shadow-2xs hover:bg-rose-700",
        outline: "border border-[#e5e5e5] bg-white text-[#111111] shadow-2xs hover:bg-[#f0f0f0] hover:text-[#111111]",
        secondary: "bg-[#f5f5f5] text-[#111111] hover:bg-[#ebebeb]",
        ghost: "hover:bg-black/[0.04] text-[#111111]",
        link: "text-[#4a38f5] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3.5 py-1.5",
        sm: "h-7 rounded-[6px] px-2.5 text-[11px]",
        lg: "h-9 rounded-[8px] px-4 text-sm",
        icon: "h-7 w-7 rounded-[6px] p-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
