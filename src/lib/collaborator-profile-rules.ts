import { validCpf } from "./patient-registration-rules.ts";

// Dados pessoais obrigatorios do colaborador (cadastro direto em /api/team e aceite de convite que cria conta).
// Regra unica e pura: sem Prisma, sem Next.

export type CollaboratorProfile = {
  name: string;
  cpf: string;
  postalCode: string | null;
  address: string;
  country: string;
  state: string;
  city: string;
};

export const COLLABORATOR_NAME_MAX = 100;
export const COLLABORATOR_ADDRESS_MAX = 200;
export const COLLABORATOR_PLACE_MAX = 100; // pais, estado e cidade
export const COLLABORATOR_NAME_MESSAGE = "Informe o nome completo com até 100 caracteres.";
export const COLLABORATOR_PROFILE_MESSAGE = "Preencha os campos obrigatórios. O CPF deve ter 11 dígitos e o CEP, quando informado, deve ter 8.";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const digits = (value: unknown) => (typeof value === "string" ? value : "").replace(/\D/g, "");

export function parseCollaboratorProfile(input: Record<string, unknown> | null | undefined): { ok: true; value: CollaboratorProfile } | { ok: false; message: string } {
  const source = input ?? {};
  const name = text(source.name);
  if (!name || name.length > COLLABORATOR_NAME_MAX) return { ok: false, message: COLLABORATOR_NAME_MESSAGE };
  const cpf = digits(source.cpf);
  const postalCode = digits(source.postalCode) || null;
  const address = text(source.address);
  const country = text(source.country);
  const state = text(source.state);
  const city = text(source.city);
  if (!validCpf(cpf) || !address || !country || !state || !city ||
    address.length > COLLABORATOR_ADDRESS_MAX || country.length > COLLABORATOR_PLACE_MAX || state.length > COLLABORATOR_PLACE_MAX || city.length > COLLABORATOR_PLACE_MAX || (postalCode && postalCode.length !== 8)) {
    return { ok: false, message: COLLABORATOR_PROFILE_MESSAGE };
  }
  return { ok: true, value: { name, cpf, postalCode, address, country, state, city } };
}
