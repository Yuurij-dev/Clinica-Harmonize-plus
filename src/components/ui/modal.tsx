"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Label } from "./label";
import { inputVariants } from "./input";
import { cn } from "@/lib/utils";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  overlayContent?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  panelClassName?: string;
  bodyClassName?: string;
  overlayClassName?: string;
  hideHeader?: boolean;
};

export function Modal({ open, title, description, children, onClose, overlayContent, closeOnOverlayClick = true, panelClassName = "max-w-xl", bodyClassName, overlayClassName, hideHeader = false }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("modal-overlay fixed inset-0 z-[1000]", overlayClassName)} />
        <DialogPrimitive.Content
          className={cn("modal-content pointer-events-none fixed inset-0 z-[1001] grid min-h-dvh place-items-center p-3 outline-none sm:p-4", !hideHeader && "max-lg:place-items-end max-lg:p-0")}
          onInteractOutside={(event) => { if (!closeOnOverlayClick) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (!open) event.preventDefault(); }}
        >
          {overlayContent}
          <section className={cn("modal-panel pointer-events-auto my-3 max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_80px_rgba(32,33,54,0.24)] sm:my-4 sm:max-h-[calc(100dvh-2rem)]", panelClassName, !hideHeader && "modal-panel-sheet max-lg:my-0 max-lg:max-h-[92dvh] max-lg:max-w-none max-lg:rounded-b-none max-lg:rounded-t-2xl max-lg:border-b-0")}>
            {hideHeader ? (
              <div className="sr-only">
                <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                <DialogPrimitive.Description>{description ?? "Detalhes e ações do diálogo"}</DialogPrimitive.Description>
              </div>
            ) : (
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
                <div className="min-w-0">
                  <DialogPrimitive.Title className="text-base font-semibold text-foreground sm:text-lg">{title}</DialogPrimitive.Title>
                  {description ? <DialogPrimitive.Description className="mt-1 text-xs leading-5 text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Detalhes e ações do diálogo</DialogPrimitive.Description>}
                </div>
                <DialogPrimitive.Close asChild>
                  <Button variant="ghost" size="icon" aria-label="Fechar"><X className="h-4 w-4" /></Button>
                </DialogPrimitive.Close>
              </header>
            )}
            <div className={cn("modal-body p-4 [--modal-pad:1rem] sm:p-6 sm:[--modal-pad:1.5rem]", bodyClassName)}>{children}</div>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function FormField({ label, children, htmlFor, description, required = false }: { label: string; children: React.ReactNode; htmlFor?: string; description?: string; required?: boolean }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground">{label}{required ? <span aria-hidden="true" className="ml-1 text-destructive">*</span> : null}</Label>
      {children}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export const fieldClassName = inputVariants;
