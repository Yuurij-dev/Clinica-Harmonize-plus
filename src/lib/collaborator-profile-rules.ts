import { validCpf } from "./patient-registration-rules.ts";

// Dados pessoais do colaborador: nome e CPF obrigatorios; CEP, endereco, pais, estado e cidade opcionais (vazio vira null) (cadastro direto em /api/team e aceite de convite que cria conta).
// Regra unica e pura: sem Prisma, sem Next.

export type CollaboratorProfile = {
  name: string;
  cpf: string;
  postalCode: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
};

export const COLLABORATOR_NAME_MAX = 100;
export const COLLABORATOR_ADDRESS_MAX = 200;
export const COLLABORATOR_PLACE_MAX = 100; // pais, estado e cidade
export const COLLABORATOR_NAME_MESSAGE = "Informe o nome completo com até 100 caracteres.";
export const COLLABORATOR_PROFILE_MESSAGE = "Informe um CPF válido. O CEP, quando informado, deve ter 8 dígitos.";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const digits = (value: unknown) => (typeof value === "string" ? value : "").replace(/\D/g, "");

export function parseCollaboratorProfile(input: Record<string, unknown> | null | undefined): { ok: true; value: CollaboratorProfile } | { ok: false; message: string } {
  const source = input ?? {};
  const name = text(source.name);
  if (!name || name.length > COLLABORATOR_NAME_MAX) return { ok: false, message: COLLABORATOR_NAME_MESSAGE };
  const cpf = digits(source.cpf);
  const postalCode = digits(source.postalCode) || null;
  const address = text(source.address) || null;
  const country = text(source.country) || null;
  const state = text(source.state) || null;
  const city = text(source.city) || null;
  if (!validCpf(cpf) ||
    (address && address.length > COLLABORATOR_ADDRESS_MAX) || (country && country.length > COLLABORATOR_PLACE_MAX) || (state && state.length > COLLABORATOR_PLACE_MAX) || (city && city.length > COLLABORATOR_PLACE_MAX) || (postalCode && postalCode.length !== 8)) {
    return { ok: false, message: COLLABORATOR_PROFILE_MESSAGE };
  }
  return { ok: true, value: { name, cpf, postalCode, address, country, state, city } };
}
