---
name: create-migration
description: Cria uma migration Prisma para uma mudança de schema e valida o resultado. Use quando o usuário pedir para alterar o banco, adicionar modelo ou campo.
disable-model-invocation: true
---

# Criar migration Prisma

1. Edite `prisma/schema.prisma` com a mudança pedida. Todo modelo privado precisa de vínculo com a clínica.
2. Rode `npx prisma migrate dev --name <descricao-curta-em-kebab-case>`.
3. Rode `npm run db:generate` e `npx tsc --noEmit`.
4. Confira o `migration.sql` gerado: sem `DROP` inesperado e sem perda de dados. Migrations já aplicadas nunca são editadas.
5. Se a mudança afeta o que as telas leem, atualize os `select` das rotas em `src/app/api` e as chaves de `invalidateClientCache` (veja `docs/data-loading.md`).
6. Se precisar de dados iniciais, atualize `prisma/seed.mjs` ou `prisma/tenant-seed.mjs`.
7. Rode `npm test`.
