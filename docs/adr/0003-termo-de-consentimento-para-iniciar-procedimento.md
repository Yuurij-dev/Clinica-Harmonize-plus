# 0003. Termo de consentimento assinado para iniciar o procedimento (Fase A)

Status: aceita (fase A); o fluxo digital é a próxima fase

## Contexto

O início da execução do procedimento não exigia consentimento. Termos já são documentos clínicos (categoria `TERMOS`, status de assinatura manual, ADR 0002). O pedido: só iniciar com termo de consentimento assinado, sem bloquear avaliação nem consulta.

## Decisões

1. **Gate por jornada.** Libera o início quando existe ao menos um `ClinicalDocument` com `category = TERMOS`, `signatureStatus = ASSINADO`, `archivedAt = null` e o `journeyId` da sessão (sempre com `clinicId` e `patientId` da sessão). Pendente, Não se aplica, arquivado ou de outra jornada não libera. Limitação aceita: um termo assinado libera todos os procedimentos do mesmo orçamento.
2. **Só na transição `Rascunho -> Em execução`.** `PATCH /api/patients/[id]/procedure-sessions/[sessionId]` responde 409 `{ message, code: "CONSENT_REQUIRED" }`. Sessões já em execução ou concluídas, autosave e retirada posterior do termo não são reavaliados nem reescritos (atendimento em andamento só muda por ação do profissional). A verificação é feita no início do handler e relida dentro da `$transaction` imediatamente antes de gravar o início; sob `READ COMMITTED` resta uma janela mínima entre a releitura e o commit (aceita).
3. **Resumo no GET.** `GET /procedure-sessions` devolve `consent: { signed, signedCount, pendingCount, message }` (contagens, sem listar documentos) e `clinicName`. A UI desabilita os pontos de início e leva ao card "Termos e confirmações"; o servidor continua sendo a autoridade (a UI trata o 409).
4. **Regra para o STAFF.** Marcar um termo como `ASSINADO` é ato clínico: só ADMIN e PROFESSIONAL (`POST /documents` e `PATCH /documents/[docId]` respondem 403 ao STAFF). Um termo TERMOS já `ASSINADO` só pode ser renomeado pelo STAFF: status, categoria, tratamento e atendimento (inclusive remover o vínculo) ficam travados (`canModifySignedTerm`), pois mover o termo para outra jornada ou categoria liberaria ou derrubaria o gate indevidamente. O STAFF continua enviando termos como Pendente ou Não se aplica. Exclusão segue só ADMIN.
5. **Cache.** Mudanças em `/api/patients/{id}/documents` invalidam também `/api/patients/{id}/procedure-sessions` (onde vive `consent`).
6. **"Gerar termo" (Fase A).** Imprime o TCLE padrão pré-preenchido (clínica, paciente, CPF, profissional, procedimento, data) para assinatura em papel; trechos clínicos ficam como lacunas. Não grava nada e não libera o início; depois o termo assinado é anexado como Assinado. O texto não tem aprovação clínica ou jurídica e carrega esse aviso.

## Pendências (próximas fases)

- Fluxo digital: modelos por clínica e procedimento, assinatura na tela, PDF no servidor (`pdf-lib`, só nessa fase) e vínculo ao mesmo `ClinicalDocument`; ver `.scratch/termos/plano.md`.
- Gate por procedimento (hoje por jornada), recusa e retirada de consentimento, registro profissional e logo da clínica.
- Anexo manual "Assinado" continua autodeclarado por profissional/administrador (com auditoria `SIGNATURE`).
- Pré-existente e fora do escopo: o GET de sessões ainda devolve `imageUrl` base64 das fotos da avaliação.
