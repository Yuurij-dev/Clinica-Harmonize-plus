import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  blue: "bg-[#efefff] text-[#5147dc]",
  green: "bg-[#eaf8ef] text-[#157a3b]",
  amber: "bg-[#fff4dc] text-[#a56400]",
  red: "bg-[#fff0ed] text-[#c24124]",
  purple: "bg-[#f2efff] text-[#7554c8]",
  slate: "bg-[#f1f4f9] text-[#536078]",
};

export function Badge({
  className,
  variant = "slate",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-bold uppercase",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
