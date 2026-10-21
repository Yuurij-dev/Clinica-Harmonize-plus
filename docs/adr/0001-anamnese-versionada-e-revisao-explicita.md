# 0001. Anamnese versionada e revisão explícita

Status: aceita (Fase 1 do novo Prontuário do Cliente)

## Contexto

A anamnese existia só como texto livre dentro de `Evaluation` (queixa, alergias, contraindicações...), sem tri-estado, sem histórico e sem noção de "revisada". O atendimento precisa saber se a anamnese existe, se foi revisada e quais alertas ela gera, sem declarar o paciente apto ou inapto.

## Decisões

1. **Modelo novo e aditivo `PatientAnamnesis`** (uma linha por versão, `@@unique([patientId, version])`, sempre com `clinicId`). Conteúdo em JSON texto (`content`, `schemaVersion = 1`) com seções fixas e o campo `procedureSpecific` reservado para perguntas por procedimento no futuro (sem formulário dinâmico agora).
2. **Versão concluída é imutável.** Só `RASCUNHO` aceita alteração de conteúdo; editar uma concluída cria o rascunho da versão seguinte (cópia da atual). Há no máximo um rascunho por paciente. Descartar remove apenas rascunhos.
3. **Tri-estado Sim / Não / Não informado.** Campo nunca respondido fica `null` e nunca vira "Não"; só "Sim" gera alerta.
4. **Pendência de revisão não depende do tempo.** `PENDENTE_REVISAO` é uma marcação explícita feita por um profissional (com motivo, autor e data/hora). "Confirmar que continua válida" registra `reviewConfirmedBy/At` e devolve a versão a `CONCLUIDA`; nada é apagado e tudo entra no `auditLog`. A regra por tempo existe como política opcional (`ReviewPolicy.maxAgeDays`, padrão `null` = desligada) em `src/lib/anamnesis-rules.ts`; ainda não há tela de configuração, então hoje ela não está ligada em nenhuma clínica.
5. **Avaliação existente não é migrada nem alterada.** Os campos de anamnese de `Evaluation` continuam como estão. Quando não há anamnese, a tela lê a avaliação mais recente apenas como informação auxiliar (alertas informativos rotulados com a origem) e oferece "usar dados da avaliação", que pré-preenche um **rascunho** com o texto livre (sem inferir Sim/Não).
6. **Permissões:** `anamnesis:read` e `anamnesis:write` para ADMIN e PROFESSIONAL. STAFF só descobre se existe uma anamnese concluída.
7. **Iniciar atendimento** passa por um gate único (`useAnamnesisStartGate`), que recebe o paciente por chamada: ausente/rascunho avisa (não bloqueia o atendimento); revisão pendente exige ver, confirmar ou registrar alterações; revisada segue, com os alertas importantes acessíveis. Pontos cobertos: cabeçalho e menu da ficha, abas Resumo e Atendimentos, "Novo tratamento", "Iniciar atendimento" de agendamento na ficha (aba Agendamentos), painel Procedimentos e "Atender" na Agenda. O rótulo "Continuar para avaliação inicial" só aparece quando o fluxo de fato abre uma avaliação inicial (sem tratamento ativo ou novo tratamento).
8. **Concorrência no rascunho:** a revisão do rascunho é o `updatedAt`. O autosave e a conclusão enviam `expectedUpdatedAt`; a escrita só ocorre se a revisão bater (filtro na própria escrita) e, senão, responde 409 com `code: "stale"` sem sobrescrever. O editor sempre abre com o rascunho lido direto do servidor (sem cache) e, no conflito, oferece recarregar do servidor.
9. **Avaliação de origem:** "usar dados da avaliação" e o fallback de leitura usam a mesma regra (`pickEvaluationSource`): avaliação mais recente COM dados de anamnese, ou o `evaluationId` exibido, validado por clínica e paciente.

10. **Escopo do gate:** vale para iniciar um atendimento, não para continuar um existente. Abrir/continuar um atendimento já criado (linha do tempo, Atendimentos, retornos pela Visão geral) não passa pelo gate; a anamnese é consultada na entrada do atendimento, não a cada reabertura.
11. **Gravações serializadas e descarte com revisão:** o autosave usa uma fila serial (`src/lib/save-pump.ts`), então saves concorrentes nunca enviam a mesma revisão esperada. Concluir e descartar também exigem `expectedUpdatedAt` (400 sem ele, 409 `stale` se não bate); um 404 no save é tratado como conflito.

## Limitações conhecidas

- O Resumo clínico lê a visão geral da anamnese, que inclui o conteúdo completo da versão atual e do rascunho, só para derivar alertas e pendências. Um endpoint de resumo enxuto (apenas alertas, estado e versões) fica para a próxima fase.

## Consequências

- A Fase 2 (nova área de atendimento) deve ler a anamnese atual por `/api/patients/[id]/anamnesis` e decidir se passa a gravar queixa/alergias nela, retirando-as de `Evaluation`.
- Ligar a política de revisão por tempo exige uma configuração por clínica (coluna nova) e uma tela; não foi feito nesta fase.
