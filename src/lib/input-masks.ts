export function onlyDigits(value: FormDataEntryValue | string | null) {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);

  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatInteger(value: string, maxLength = 4) {
  return onlyDigits(value).slice(0, maxLength);
}

export function formatPercent(value: string) {
  const digits = formatInteger(value, 3);
  if (!digits) return "";
  return `${Math.min(Number(digits), 100)}%`;
}

export function formatDate(value: string) {
  const digits = onlyDigits(value).slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function formatCurrency(value: string) {
  const digits = onlyDigits(value).slice(0, 12);
  if (!digits) return "";

  const amount = Number(digits) / 100;
  return amount.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function parseCurrency(value: FormDataEntryValue | string | null) {
  const digits = onlyDigits(value);
  return digits ? Number(digits) / 100 : 0;
}

export function parseInteger(value: FormDataEntryValue | string | null) {
  const digits = onlyDigits(value);
  return digits ? Number(digits) : 0;
}
