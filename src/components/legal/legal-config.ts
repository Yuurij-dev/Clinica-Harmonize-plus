// Dados dos documentos legais (/termos e /privacidade).
//
// PENDENTE DE FORMALIZAÇÃO: o Harmonize+ ainda não tem CNPJ. Preencha os campos abaixo SOMENTE com dados reais, quando a empresa
// existir; campos `null` não aparecem nas páginas (elas mostram o aviso de "em formalização"). Nada aqui deve ser inventado.
export const LEGAL_ENTITY = {
  /** Razão social registrada. */
  legalName: null as string | null,
  /** CNPJ, no formato 00.000.000/0000-00. */
  cnpj: null as string | null,
  /** Endereço empresarial completo. */
  address: null as string | null,
  /** Encarregado pelo tratamento de dados pessoais (DPO): nome e canal. */
  dpo: null as string | null,
};

// Canal de contato público (dúvidas, direitos dos titulares, incidentes). CONFIRMAR que a caixa existe antes de publicar.
export const LEGAL_CONTACT_EMAIL = "contato@harmonizeplus.com.br";

export const LEGAL_UPDATED_AT = "12 de novembro de 2026";

const ENTITY_LABELS: Record<keyof typeof LEGAL_ENTITY, string> = {
  legalName: "Razão social",
  cnpj: "CNPJ",
  address: "Endereço",
  dpo: "Encarregado pelo tratamento de dados (DPO)",
};

export type EntityField = { key: keyof typeof LEGAL_ENTITY; label: string; value: string | null };

/** Campos de identificação na ordem de exibição, com o valor (ou null se ainda pendente). */
export function legalEntityFields(entity: Record<keyof typeof LEGAL_ENTITY, string | null> = LEGAL_ENTITY): EntityField[] {
  return (Object.keys(ENTITY_LABELS) as Array<keyof typeof LEGAL_ENTITY>).map((key) => ({ key, label: ENTITY_LABELS[key], value: entity[key]?.trim() || null }));
}

/** Campos ainda não preenchidos (pendentes de formalização). */
export function pendingLegalFields(entity?: Record<keyof typeof LEGAL_ENTITY, string | null>) {
  return legalEntityFields(entity).filter((field) => !field.value);
}
