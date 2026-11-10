// Disparado quando o item "Clientes" do menu é clicado estando já na seção: a tela de Clientes volta à lista.
export const clientsHomeEvent = "harmonize-clients-home";

// Disparado por Configurações ("Rever o tour guiado"): o tour limpa a marca de "já viu" e reabre.
export const tourReplayEvent = "harmonize-tour-replay";

// Disparado pelo "?" da topbar ("Tour desta página") com uma ficha de paciente aberta: o tour da ficha reabre.
export const patientTourReplayEvent = "harmonize-patient-tour-replay";

// Disparado ao fim do tour guiado: se o administrador ainda não decidiu sobre o assistente de configuração, o convite abre.
export const setupInviteEvent = "harmonize-setup-invite";

// Disparado pelo card do Dashboard e por Configurações: abre o assistente de configuração da clínica.
export const setupOpenEvent = "harmonize-setup-open";

// Disparado após gravar o assistente: leva o estado novo (detail) aos outros componentes, sem novo GET.
export const setupUpdatedEvent = "harmonize-setup-updated";
