import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked = false,
      onCheckedChange,
      disabled,
      onClick,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        type="button"
        role="switch"
        ref={ref}
        aria-checked={checked}
        disabled={disabled}
        onClick={(e) => {
          if (disabled) return;
          onClick?.(e);
          onCheckedChange?.(!checked);
        }}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20 disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-[#4a38f5]" : "bg-[#e5e5e5]",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";
