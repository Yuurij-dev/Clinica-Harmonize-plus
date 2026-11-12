// Consulta de CEP no ViaCEP (feita pelo navegador, sem dado de paciente). Mesmo mapeamento do formulário de colaborador.
export type CepLookup = { ok: true; address: string; country: string; state: string; city: string } | { ok: false; message: string };

export async function lookupViaCep(cep: string): Promise<CepLookup> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return { ok: false, message: "Informe um CEP com 8 dígitos." };
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    const data = await response.json() as { erro?: boolean | string; logradouro?: string; complemento?: string; bairro?: string; localidade?: string; uf?: string; estado?: string };
    if (!response.ok || data.erro) return { ok: false, message: "CEP não encontrado. Confira o número e tente novamente." };
    return { ok: true, address: [data.logradouro, data.complemento, data.bairro].filter(Boolean).join(", "), country: "Brasil", state: data.estado || data.uf || "", city: data.localidade || "" };
  } catch {
    return { ok: false, message: "Não foi possível consultar o CEP. Tente novamente." };
  }
}
