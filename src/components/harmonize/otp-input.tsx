"use client";

import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { OTP_LENGTH, otpInsert } from "@/lib/security-ui-rules";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  value: string[];
  onChange: (cells: string[]) => void;
  label?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Muda para devolver o foco à primeira célula (ex.: depois de um código recusado). */
  focusSignal?: number;
  describedBy?: string;
  /** "auth": visual da tela de login (roxo, fundo claro fixo). "app": tokens do tema do app. */
  variant?: "auth" | "app";
};

const cellStyles = {
  auth: "h-12 w-full min-w-0 rounded-[8px] border border-[#dfe7f2] bg-[#f5f8ff] text-center text-xl font-black text-[#172033] outline-none transition focus:border-[#5947ee] focus:bg-white focus:shadow-[0_0_0_4px_rgba(89,71,238,0.08)] aria-invalid:border-[#d92d20]",
  app: "h-12 w-full min-w-0 rounded-[8px] border border-input bg-white text-center text-xl font-black text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 aria-invalid:border-destructive",
};

// Seis campos de um dígito: avança ao digitar, Backspace volta, colar (ou o preenchimento automático do SO) distribui o código.
export function OtpInput({ value, onChange, label = "Código de verificação", disabled = false, invalid = false, autoFocus = false, focusSignal = 0, describedBy, variant = "app" }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (autoFocus || focusSignal > 0) refs.current[0]?.focus();
  }, [autoFocus, focusSignal]);

  function apply(index: number, raw: string) {
    const result = otpInsert(value, index, raw);
    onChange(result.cells);
    if (raw.replace(/\D/g, "")) refs.current[result.focus]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !value[index] && index > 0) {
      event.preventDefault();
      const next = [...value];
      next[index - 1] = "";
      onChange(next);
      refs.current[index - 1]?.focus();
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    apply(index, event.clipboardData.getData("text"));
  }

  return (
    <div aria-label={label} className="grid grid-cols-6 gap-2 sm:gap-2.5" role="group">
      {value.map((digit, index) => (
        <input
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-label={`${label}, dígito ${index + 1} de ${OTP_LENGTH}`}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          className={cn(cellStyles[variant], "disabled:cursor-not-allowed disabled:opacity-60")}
          disabled={disabled}
          inputMode="numeric"
          key={index}
          onChange={(event) => apply(index, event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={(event) => handlePaste(index, event)}
          pattern="[0-9]*"
          ref={(element) => { refs.current[index] = element; }}
          type="text"
          value={digit}
        />
      ))}
    </div>
  );
}
