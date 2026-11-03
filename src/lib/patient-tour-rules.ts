import { tourKeyWithPrefix, type TourStep } from "./tour-rules.ts";

/** Tour de primeiro acesso da ficha da paciente. A marca de "já viu" é separada da do tour geral (ver tour-rules). */
const KEY_PREFIX = "harmonize_tour_patient_v1_";

export type PatientTourStep = Omit<TourStep, "section"> & {
  /** Aba principal exibida atrás do tour. */
  tab?: string;
  /** Área do Prontuário exibida atrás do tour (implica a aba Prontuário). */
  recordTab?: string;
  /** Valor de `data-tour-patient` do elemento destacado (ausente = sem destaque). */
  target?: string;
  /** Passo que só existe para quem lê dados clínicos. */
  clinicalOnly?: boolean;
};

export const PATIENT_TOUR_STEPS: readonly PatientTourStep[] = [
  { key: "inicio", title: "Esta é a ficha da paciente", text: "Tudo sobre uma paciente num só lugar: dados de cadastro, tratamentos, prontuário e financeiro. Vou te mostrar cada parte.", pose: "wave" },
  { key: "cabecalho", title: "Dados da paciente", text: "Nome, contato e informações de cadastro ficam aqui no topo. Em “Editar dados” você atualiza o cadastro quando precisar.", target: "cabecalho", pose: "point" },
  { key: "visao-geral", title: "Visão geral: o retrato do momento", text: "Mostra em que etapa cada tratamento está, as próximas ações e os atendimentos agendados. É por onde começar quando a paciente chega.", tab: "Visão geral", target: "visao-geral", pose: "point" },
  { key: "tratamentos", title: "Tratamentos: a jornada de cada caso", text: "Cada tratamento é uma jornada que percorre avaliação, orçamento, procedimento, retorno e pós. Aqui você acompanha a etapa atual e avança para a próxima.", plainText: "Cada tratamento é uma jornada com etapas. Aqui você acompanha a etapa atual de cada caso.", tab: "Tratamentos", target: "tratamentos", pose: "peek" },
  { key: "prontuario", title: "Prontuário: o histórico clínico", text: "Reúne o resumo clínico, os agendamentos, a anamnese, os documentos e as fotos da paciente.", plainTitle: "Prontuário: o histórico da paciente", plainText: "Reúne o resumo, os agendamentos, a anamnese e os documentos da paciente. O conteúdo clínico fica restrito à equipe clínica.", tab: "Prontuário", target: "prontuario", pose: "point" },
  { key: "resumo-clinico", title: "Resumo clínico", text: "As observações clínicas e o essencial do histórico, para consultar antes de atender.", plainText: "O resumo clínico é restrito à equipe clínica. Aqui você consulta as observações administrativas da paciente.", tab: "Prontuário", recordTab: "Resumo clínico", target: "resumo-clinico", pose: "think" },
  { key: "agendamentos", title: "Agendamentos", text: "Todos os horários desta paciente, passados e futuros, com o status de cada atendimento.", tab: "Prontuário", recordTab: "Agendamentos", target: "agendamentos", pose: "nod" },
  { key: "anamnese", title: "Anamnese", text: "O questionário de saúde: alergias, medicações e histórico. Preencha uma vez e atualize quando mudar — é a base da segurança do procedimento.", plainText: "A anamnese da paciente fica nesta área. O conteúdo das respostas é restrito à equipe clínica.", tab: "Prontuário", recordTab: "Anamnese", target: "anamnese", pose: "think" },
  { key: "documentos", title: "Documentos clínicos", text: "Termos de consentimento e arquivos assinados, guardados junto da paciente.", plainText: "Termos de consentimento, declarações e orientações da paciente, guardados junto do cadastro. Outras categorias de documento ficam restritas à equipe clínica.", tab: "Prontuário", recordTab: "Documentos clínicos", target: "documentos", pose: "point" },
  { key: "fotos", title: "Fotos clínicas", text: "Registre o antes e o depois, compare a evolução e faça marcações sobre a imagem.", tab: "Prontuário", recordTab: "Fotos", target: "fotos", pose: "peek", clinicalOnly: true },
  { key: "financeiro", title: "Financeiro", text: "Os orçamentos desta paciente, os pagamentos registrados e o que ainda está em aberto.", tab: "Financeiro", target: "financeiro", pose: "point" },
  { key: "fim", title: "Pronto!", text: "Para rever este tour, clique no “?” lá em cima com uma paciente aberta. Bom trabalho!", pose: "cheer" },
];

export function patientTourKey(userId: string): string {
  return tourKeyWithPrefix(KEY_PREFIX, userId);
}

/** Passos que o usuário pode ver: sem acesso clínico sai "Fotos" e os textos que citam conteúdo clínico trocam pela variante simples. Só abertura e fim = sem tour. */
export function visiblePatientTourSteps(canReadClinical: boolean): PatientTourStep[] {
  const steps = PATIENT_TOUR_STEPS.filter((step) => canReadClinical || !step.clinicalOnly).map((step) =>
    canReadClinical ? step : { ...step, title: step.plainTitle ?? step.title, text: step.plainText ?? step.text },
  );
  return steps.some((step) => step.target) ? steps : [];
}

/** Valor de `data-tour-patient` para uma aba principal ou área do prontuário (rótulo da interface). */
export function patientTourTarget(label: string, kind: "tab" | "record"): string | undefined {
  return PATIENT_TOUR_STEPS.find((step) => (kind === "tab" ? step.tab === label && !step.recordTab : step.recordTab === label))?.target;
}

/** Seletor CSS do elemento destacado pelo passo. */
export function patientTourSelector(step: Pick<PatientTourStep, "target"> | undefined): string | undefined {
  return step?.target ? `[data-tour-patient="${step.target}"]` : undefined;
}
