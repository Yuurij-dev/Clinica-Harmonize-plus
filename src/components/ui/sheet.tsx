"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Sheet({ open, onOpenChange, title, side = "left", className, showCloseButton = true, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; side?: "left" | "right" | "top" | "bottom"; className?: string; showCloseButton?: boolean; children: React.ReactNode }) {
  const positions = { left: "inset-y-0 left-0 h-full w-[min(20rem,85vw)] border-r", right: "inset-y-0 right-0 h-full w-[min(20rem,85vw)] border-l", top: "inset-x-0 top-0 max-h-[85vh] border-b", bottom: "inset-x-0 bottom-0 max-h-[85vh] border-t" };
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-foreground/35 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out" /><DialogPrimitive.Content className={cn("fixed z-50 overflow-y-auto border-border bg-card text-card-foreground shadow-xl outline-none", positions[side], className)}><DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>{showCloseButton ? <DialogPrimitive.Close asChild><Button className="absolute right-3 top-3 z-10" variant="ghost" size="icon" aria-label="Fechar"><X className="h-4 w-4" /></Button></DialogPrimitive.Close> : null}{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
