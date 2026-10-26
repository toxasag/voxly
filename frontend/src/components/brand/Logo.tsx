import Link from "next/link";
import { cn } from "@/lib/utils";

export interface LogoProps {
  /**
   * 'full': Mark + typography "GETVOXLY"
   * 'mark': Only the icon mark
   * 'wordmark': Only the typography "GETVOXLY"
   */
  variant?: "full" | "mark" | "wordmark";

  /**
   * Preset sizes:
   * 'xs' = h-4 (16px), text-xs
   * 'sm' = h-5 (20px), text-[13px]
   * 'md' = h-7 (28px), text-[16px]
   * 'lg' = h-10 (40px), text-[22px]
   * 'xl' = h-14 (56px), text-[28px]
   */
  size?: "xs" | "sm" | "md" | "lg" | "xl";

  /**
   * Theme mode:
   * 'auto': Dark mark in light mode, White mark in dark mode (Tailwind dark: classes)
   * 'light': Always dark mark
   * 'dark': Always white mark
   */
  theme?: "auto" | "light" | "dark";

  /**
   * Optional destination link. If specified, the logo will be wrapped in <Link>.
   */
  href?: string;

  /**
   * Additional CSS classes for the container.
   */
  className?: string;

  /**
   * Additional CSS classes specifically for the mark SVG.
   */
  markClassName?: string;

  /**
   * Additional CSS classes specifically for the wordmark text.
   */
  textClassName?: string;

  /**
   * Optional subtitle / descriptor below or beside the wordmark.
   */
  subtitle?: string;
}

const SIZE_STYLES = {
  xs: {
    mark: "h-4 w-[18px]",
    text: "text-xs font-bold tracking-tight",
    gap: "gap-1.5",
  },
  sm: {
    mark: "h-5 w-[23px]",
    text: "text-[13px] font-bold tracking-tight",
    gap: "gap-2",
  },
  md: {
    mark: "h-7 w-[32px]",
    text: "text-[16px] font-bold tracking-tight",
    gap: "gap-2.5",
  },
  lg: {
    mark: "h-10 w-[46px]",
    text: "text-[22px] font-extrabold tracking-tight",
    gap: "gap-3",
  },
  xl: {
    mark: "h-14 w-[64px]",
    text: "text-[28px] font-extrabold tracking-tight",
    gap: "gap-3.5",
  },
} as const;

/**
 * Universal Brand Logo component for GETVOXLY.
 * Supports light/dark themes seamlessly without hydration mismatch.
 */
export function Logo({
  variant = "full",
  size = "md",
  theme = "auto",
  href,
  className,
  markClassName,
  textClassName,
  subtitle,
}: LogoProps) {
  const sizeConfig = SIZE_STYLES[size];

  // Render the black SVG icon
  const renderBlackMark = (cls: string) => (
    <svg
      viewBox="0 0 1024 889"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none", sizeConfig.mark, markClassName, cls)}
      aria-hidden="true"
    >
      <path
        d="M147.918 0.90854C167.696 -0.79546 193.469 0.396554 213.683 0.522554C257.378 0.795554 301.431 -5.27048 337.022 25.9485C343.262 31.4675 348.634 37.8955 352.958 45.0155C372.814 77.0435 391.624 113.24 409.914 146.337L497.964 303.43C543.444 383.097 588.404 463.057 632.844 543.317C652.964 579.287 673.974 614.857 693.454 651.157C707.224 676.317 708.024 713.537 693.054 739.017C670.384 777.607 649.184 825.027 621.694 860.427C608.224 877.767 581.564 887.637 559.974 888.657C527.154 888.887 494.334 888.947 461.514 888.827C442.534 888.797 418.644 889.947 400.244 886.647C376.074 882.307 355.154 866.837 342.756 845.647C325.291 815.787 308.525 785.117 291.633 754.727L195.299 581.647L89.0816 390.077C63.5257 344.483 36.5796 300.069 13.4906 253.144C-3.94236 217.713 -5.37736 183.162 14.4726 148.634C35.4876 112.016 54.2887 71.6636 78.2677 37.0406C92.0537 17.1336 124.526 3.23354 147.918 0.90854Z"
        fill="url(#voxly-b-grad)"
      />
      <path
        d="M739.144 1.02756L844.954 0.836524C865.014 0.819524 887.354 0.358511 907.144 1.24851C913.204 8.89851 921.214 23.8855 926.064 32.6385L952.204 79.8085C975.394 120.807 1002.11 163.701 1023.73 205.397C1018.31 216.77 1008.94 232.228 1002.52 243.752C984.664 275.806 965.294 309.806 946.224 341.031C936.304 357.268 914.554 400.087 904.874 411.707C897.344 415.497 849.574 414.016 837.764 413.986L723.954 414.126C714.494 414.126 674.484 414.817 668.574 413.067C662.104 404.697 652.094 385.787 646.594 376.067L612.394 316.162L571.774 244.956C565.754 234.495 554.364 216.82 550.194 206.527C553.364 196.414 563.464 180.857 569.154 171.153L595.684 125.328C613.134 94.3786 630.884 63.6045 648.954 33.0105C653.234 25.8665 664.114 6.81653 669.214 1.53953L739.144 1.02756Z"
        fill="#242228"
      />
      <defs>
        <linearGradient
          id="voxly-b-grad"
          x1="315.258"
          y1="876.019"
          x2="387.81"
          y2="14.5731"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#111114" />
          <stop offset="1" stopColor="#2B2A31" />
        </linearGradient>
      </defs>
    </svg>
  );

  // Render the white SVG icon
  const renderWhiteMark = (cls: string) => (
    <svg
      viewBox="0 0 1024 889"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none", sizeConfig.mark, markClassName, cls)}
      aria-hidden="true"
    >
      <path
        d="M147.918 0.90854C167.696 -0.79546 193.469 0.396554 213.683 0.522554C257.378 0.795554 301.431 -5.27048 337.022 25.9485C343.262 31.4675 348.634 37.8955 352.958 45.0155C372.814 77.0435 391.624 113.24 409.914 146.337L497.964 303.43C543.444 383.097 588.404 463.057 632.844 543.317C652.964 579.287 673.974 614.857 693.454 651.157C707.224 676.317 708.024 713.537 693.054 739.017C670.384 777.607 649.184 825.027 621.694 860.427C608.224 877.767 581.564 887.637 559.974 888.657C527.154 888.887 494.334 888.947 461.514 888.827C442.534 888.797 418.644 889.947 400.244 886.647C376.074 882.307 355.154 866.837 342.756 845.647C325.291 815.787 308.525 785.117 291.633 754.727L195.299 581.647L89.0816 390.077C63.5257 344.483 36.5796 300.069 13.4906 253.144C-3.94236 217.713 -5.37736 183.162 14.4726 148.634C35.4876 112.016 54.2887 71.6636 78.2677 37.0406C92.0537 17.1336 124.526 3.23354 147.918 0.90854Z"
        fill="url(#voxly-w-grad)"
      />
      <path
        d="M739.144 1.02756L844.954 0.836524C865.014 0.819524 887.354 0.358511 907.144 1.24851C913.204 8.89851 921.214 23.8855 926.064 32.6385L952.204 79.8085C975.394 120.807 1002.11 163.701 1023.73 205.397C1018.31 216.77 1008.94 232.228 1002.52 243.752C984.664 275.806 965.294 309.806 946.224 341.031C936.304 357.268 914.554 400.087 904.874 411.707C897.344 415.497 849.574 414.016 837.764 413.986L723.954 414.126C714.494 414.126 674.484 414.817 668.574 413.067C662.104 404.697 652.094 385.787 646.594 376.067L612.394 316.162L571.774 244.956C565.754 234.495 554.364 216.82 550.194 206.527C553.364 196.414 563.464 180.857 569.154 171.153L595.684 125.328C613.134 94.3786 630.884 63.6045 648.954 33.0105C653.234 25.8665 664.114 6.81653 669.214 1.53953L739.144 1.02756Z"
        fill="white"
      />
      <defs>
        <linearGradient
          id="voxly-w-grad"
          x1="315.258"
          y1="876.019"
          x2="387.81"
          y2="14.5731"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" />
          <stop offset="1" stopColor="#F6F6F7" />
        </linearGradient>
      </defs>
    </svg>
  );

  const markElement = (
    <>
      {theme === "light" && renderBlackMark("block")}
      {theme === "dark" && renderWhiteMark("block")}
      {theme === "auto" && (
        <>
          {renderBlackMark("block dark:hidden")}
          {renderWhiteMark("hidden dark:block")}
        </>
      )}
    </>
  );

  const textElement = (
    <div className="flex flex-col leading-none">
      <span
        className={cn(
          sizeConfig.text,
          theme === "light" && "text-[#111111]",
          theme === "dark" && "text-white",
          theme === "auto" && "text-[#111111] dark:text-white",
          textClassName,
        )}
      >
        GETVOXLY
      </span>
      {subtitle && (
        <span
          className={cn(
            "mt-0.5 text-[10px] font-medium tracking-normal",
            theme === "light" && "text-[#666666]",
            theme === "dark" && "text-[#a1a1aa]",
            theme === "auto" && "text-[#666666] dark:text-[#a1a1aa]",
          )}
        >
          {subtitle}
        </span>
      )}
    </div>
  );

  const content = (
    <span
      className={cn(
        "inline-flex items-center",
        sizeConfig.gap,
        className,
      )}
    >
      {variant !== "wordmark" && markElement}
      {variant !== "mark" && textElement}
      {variant === "mark" && <span className="sr-only">GETVOXLY</span>}
    </span>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex items-center transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a38f5] rounded-md"
        aria-label="GETVOXLY"
      >
        {content}
      </Link>
    );
  }

  return content;
}
