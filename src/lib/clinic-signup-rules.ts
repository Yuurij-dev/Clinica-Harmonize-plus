// Regras puras do cadastro de clinica (compartilhadas por /api/auth/register e pelo cadastro com Google).
// Sem Prisma, sem rede.

export const TRIAL_DAYS = 3;

export type ClinicProfile = {
  clinicName: string;
  name: string;
  phone: string;
  profession: string;
  practiceArea: string;
  hasSecretary: boolean;
};

export const CLINIC_NAME_MESSAGE = "Informe um nome para a clínica com até 100 caracteres.";
export const CLINIC_FIELDS_MESSAGE = "Preencha todos os campos.";

export function slugPart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "clinica";
}

export const clinicSlug = (clinicName: string, suffix: string) => `${slugPart(clinicName)}-${suffix.slice(0, 8)}`;

export function trialWindow(now: Date) {
  return { trialStartedAt: now, trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000) };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export type ClinicProfileResult = { ok: true; value: ClinicProfile } | { ok: false; code: "clinic_name" | "fields"; message: string };

// Campos alem da clinica (ex.: email/senha no register) sao checados pelo chamador.
export function parseClinicProfile(body: Record<string, unknown> | null | undefined): ClinicProfileResult {
  const clinicName = text(body?.clinicName);
  if (!clinicName || clinicName.length > 100) return { ok: false, code: "clinic_name", message: CLINIC_NAME_MESSAGE };
  const name = text(body?.name);
  const phone = text(body?.phone);
  const profession = text(body?.profession);
  const practiceArea = text(body?.practiceArea);
  const hasSecretary = body?.hasSecretary === "Sim" ? true : body?.hasSecretary === "Não" ? false : null;
  if (!name || !phone || !profession || !practiceArea || hasSecretary === null) return { ok: false, code: "fields", message: CLINIC_FIELDS_MESSAGE };
  return { ok: true, value: { clinicName, name, phone, profession, practiceArea, hasSecretary } };
}
