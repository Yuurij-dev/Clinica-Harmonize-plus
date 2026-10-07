"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "./button";
import { Label } from "./label";
import { inputVariants } from "./input";

type ModalProps = {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose: () => void;
  overlayContent?: React.ReactNode;
  closeOnOverlayClick?: boolean;
};

export function Modal({ open, title, description, children, onClose, overlayContent, closeOnOverlayClick = true }: ModalProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1000] bg-[#202136]/48 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="pointer-events-none fixed inset-0 z-[1001] grid min-h-dvh place-items-center p-3 outline-none sm:p-4"
          onInteractOutside={(event) => { if (!closeOnOverlayClick) event.preventDefault(); }}
          onEscapeKeyDown={(event) => { if (!open) event.preventDefault(); }}
        >
          {overlayContent}
          <section className="hp-panel-enter pointer-events-auto my-3 max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card text-card-foreground shadow-[0_24px_80px_rgba(32,33,54,0.24)] sm:my-4 sm:max-h-[calc(100dvh-2rem)]">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-base font-semibold text-foreground sm:text-lg">{title}</DialogPrimitive.Title>
                {description ? <DialogPrimitive.Description className="mt-1 text-xs leading-5 text-muted-foreground">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Detalhes e ações do diálogo</DialogPrimitive.Description>}
              </div>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Fechar"><X className="h-4 w-4" /></Button>
              </DialogPrimitive.Close>
            </header>
            <div className="p-4 sm:p-6">{children}</div>
          </section>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function FormField({ label, children, htmlFor, description }: { label: string; children: React.ReactNode; htmlFor?: string; description?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-foreground">{label}</Label>
      {children}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export const fieldClassName = inputVariants;
