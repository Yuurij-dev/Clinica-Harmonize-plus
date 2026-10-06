"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "./button";

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
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] grid min-h-dvh place-items-center overflow-y-auto bg-[#202136]/48 p-4 backdrop-blur-sm">
      <button className="fixed inset-0 cursor-default" aria-label={closeOnOverlayClick ? "Fechar" : "Modal aberto"} onClick={closeOnOverlayClick ? onClose : undefined} />
      {overlayContent}
      <div className="hp-panel-enter relative z-10 my-6 w-full max-w-xl rounded-[8px] border border-[#e5e5ee] bg-white shadow-[0_24px_80px_rgba(32,33,54,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#ededf3] px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-[#25263a]">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-[#858698]">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-xs font-bold text-[#555668]">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const fieldClassName =
  "h-10 w-full rounded-[7px] border border-[#dddfea] bg-white px-3 text-sm text-[#303144] outline-none transition focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10";
