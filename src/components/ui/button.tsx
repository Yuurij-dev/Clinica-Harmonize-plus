import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "hp-pressable inline-flex items-center justify-center gap-2 rounded-full text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6257e8] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:scale-100",
  {
    variants: {
      variant: {
        primary:
          "bg-[#5147dc] text-white shadow-[0_7px_16px_rgba(81,71,220,0.22)] hover:bg-[#4036c9]",
        secondary:
          "border border-[#dddfea] bg-white text-[#26273a] hover:border-[#5147dc] hover:text-[#5147dc]",
        ghost: "text-[#6e7082] hover:bg-[#f2f1ff] hover:text-[#5147dc]",
        dark: "bg-[#24253a] text-white hover:bg-[#33344d]",
      },
      size: {
        sm: "h-8 px-4",
        md: "h-10 px-5",
        icon: "h-9 w-9 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
