import * as React from "react";
import { cn } from "@/lib/utils";

export const inputVariants = "flex h-10 w-full rounded-[8px] border border-input bg-white px-3.5 py-2 text-sm font-medium text-foreground shadow-sm outline-none transition-[border-color,box-shadow,background-color] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/15";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input ref={ref} type={type} className={cn(inputVariants, className)} {...props} />
));
Input.displayName = "Input";
