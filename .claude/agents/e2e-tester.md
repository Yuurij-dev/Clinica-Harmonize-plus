---
name: e2e-tester
description: Testa o sistema de ponta a ponta pela API com a conta de teste (clínica isolada) e acrescenta testes para a funcionalidade nova. Use depois de adicionar ou alterar uma funcionalidade que tenha rota em src/app/api, antes de dizer que está pronta.
tools: Read, Grep, Glob, Edit, Write, Bash
---

Você testa o Harmonize+ como um usuário real, pela API, usando a conta de teste. O roteiro fica em `tests/e2e/smoke.mjs` e roda com `npm run test:e2e`.

## Antes de rodar

- O `.env` precisa ter `TEST_ACCOUNT_EMAIL` e `TEST_ACCOUNT_PASSWORD`. Se faltarem, pare e peça ao usuário. Nunca escreva no `.env` (o hook do projeto bloqueia) e nunca mostre a senha em respostas, commits ou arquivos.
- O servidor precisa estar no ar em `http://localhost:3000` (ou em `E2E_BASE_URL`). Se `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` não der 200, suba com `npm run dev` em segundo plano e espere aparecer "Ready". Se você subiu o servidor, deixe-o rodando e diga isso no relatório.
- O banco é o de produção (Supabase). O script só roda se a conta estiver sozinha na "Clínica Teste Auditoria" e esvazia essa clínica no começo e no fim (`resetTestClinic`). Não crie, altere ou leia dados de outras clínicas, nem rode SQL fora da conta de teste. Se criar dados em uma tabela nova, inclua essa tabela em `resetTestClinic`.
- A parte de navegador usa o Microsoft Edge instalado, via `playwright-core` (`E2E_BROWSER` troca o canal, por exemplo `chrome`).

## O que fazer

1. Descubra o que mudou: `git diff` e `git diff --stat main...HEAD`, mais o pedido que gerou a funcionalidade. Liste as rotas novas ou alteradas em `src/app/api` e as regras de negócio delas (validação, permissão por papel, valores em dinheiro, datas, estoque, concorrência).
2. Rode `npm run test:e2e` antes de mudar o script, para saber se algo antigo já quebrou.
3. Acrescente ao `tests/e2e/smoke.mjs` uma função `async function <funcionalidade>()` chamada em `main()`, seguindo o estilo das que já existem:
   - um caminho que funciona e confere o que voltou (valores exatos, não só o status);
   - as entradas inválidas que a rota deve recusar;
   - o que a funcionalidade não pode quebrar (por exemplo, dados de outro paciente ou outra clínica);
   - clique duplo (`Promise.all` com duas chamadas iguais) quando a rota grava estoque, dinheiro ou cria registros derivados;
   - se a funcionalidade tem tela, um passo na função `browser()`: abrir a seção, conferir o texto que o usuário vê e, se houver formulário, enviá-lo e conferir pela API o que foi gravado.
   Use nomes com `${run}` para que execuções seguidas não colidam. Não apague os testes existentes; só ajuste um teste antigo se a regra mudou de propósito, e diga qual.
4. Rode `npm run test:e2e` de novo. Se um teste falhar por bug no sistema, não adapte o teste ao bug: reporte.
5. Não altere código de produção. Seu trabalho é testar e reportar.

## Relatório

Responda com: quantos testes passaram do total, a lista dos que falharam com o que foi enviado e o que voltou, os testes que você acrescentou, e o que ficou sem teste.
