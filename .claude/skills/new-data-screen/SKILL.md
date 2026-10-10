---
name: new-data-screen
description: Checklist para criar ou alterar uma tela que carrega dados da API ou muda uma resposta de API. Use ao adicionar tela com dados, endpoint ou mutação.
---

# Tela com dados (regras do AGENTS.md)

Leia `docs/data-loading.md` antes de começar.

- **Leitura:** use `getCachedJson` de `src/lib/client-cache.ts`. A chave é a URL completa, com ID do recurso e todos os filtros. Para UI imediata, leia `readClientCache` e depois revalide. Não crie efeitos com GET cru para o mesmo recurso.
- **Cleanup:** proteja o efeito contra atualização após trocar de paciente ou aba.
- **Sem cache:** `/api/auth/*` e alertas em tempo real da agenda.
- **Privacidade:** nunca grave dados de paciente em localStorage, sessionStorage ou service worker. O escopo do cache vem do usuário e da clínica autenticados.
- **Mutações:** após sucesso de POST, PATCH ou DELETE, chame `invalidateClientCache` só com as chaves afetadas, incluindo listas se resumos ou etapas da jornada mudaram. Em falha, não invalide.
- **API:** use `select` do Prisma, devolva só o que a tela usa, nada de imagens completas ou históricos em listas. Evite N+1. Todo `where` filtra por clínica.
- **Polling:** nada de polling em endpoints amplos; use endpoint pequeno e específico.
- **Testes:** se mudou comportamento compartilhado de cache, adicione teste em `tests/client-cache.test.mjs`.
- **Verificação:** `node --test tests/client-cache.test.mjs`, `npx tsc --noEmit`, lint dos arquivos tocados.
