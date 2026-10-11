This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Banco de dados

O projeto usa Prisma com PostgreSQL quando conectado ao Supabase.

1. Crie um projeto no Supabase.
2. Copie as URLs do Pooler e da conexão direta para o `.env`:

```env
DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://...:5432/postgres?sslmode=require"
AUTH_SECRET=""
SEED_ADMIN_PASSWORD=""
```

3. Num banco vazio, crie as tabelas com `npx prisma db push`.

`DATABASE_URL` é usada pela aplicação. `DIRECT_URL` é usada pelo Prisma em migrações. Gere valores aleatórios distintos para `AUTH_SECRET` e `SEED_ADMIN_PASSWORD` com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. A aplicação exige pelo menos 32 bytes para `AUTH_SECRET` e não usa uma chave padrão.
Antes de executar `npm run db:seed`, defina `SEED_ADMIN_PASSWORD` com uma senha única de pelo menos 12 caracteres. O seed cria ou atualiza a senha da conta `admin`; as contas opcionais `teste` e `pro` só são criadas quando `SEED_TEST_PASSWORD` e `SEED_PRO_PASSWORD` também forem definidas com senhas únicas. O script não imprime as senhas.
Em bancos que já receberam as credenciais de demonstração antigas, altere as senhas dessas contas antes de expor a aplicação.

## Multi-clínica

Cada usuário precisa estar vinculado a uma clínica por `ClinicMembership`. As entidades de negócio possuem `clinicId`, e as APIs filtram os registros pela clínica da sessão autenticada. Para preparar um banco novo:

```bash
npx prisma db push
npx prisma generate
npm run db:seed
npm run db:tenant-seed
```

O `db:tenant-seed` cria a clínica inicial, vincula a ela os usuários que ainda não têm clínica e associa os registros legados a ela. Para uma clínica nova, crie a clínica e um `ClinicMembership` para cada funcionário; o usuário só conseguirá acessar os dados da clínica à qual estiver vinculado.

## Atualizar um banco que já tem dados

O histórico em `prisma/migrations` não serve para `prisma migrate deploy` (a primeira migration foi gerada para SQLite e o banco foi criado com `db push`). Não use `db push` num banco com dados: ele troca colunas renomeadas por colunas novas e perde os valores. Para cada migration nova:

1. `npm run db:backup`
2. Rode o `migration.sql` dentro de `BEGIN;` ... `COMMIT;` com `npx prisma db execute --url <conexão direta, porta 5432> --file <arquivo>`.
3. Confira com `npx prisma migrate diff --from-url <conexão direta> --to-schema-datamodel prisma/schema.prisma --script`.

## Backup

`npm run db:backup` grava todas as tabelas em `backups/<data-hora>/` (uma linha JSON por registro e um `manifest.json` com colunas e contagens) e confere a contagem de cada tabela. Não precisa de `pg_dump`. Os arquivos têm dados de pacientes: a pasta fica fora do Git; guarde uma cópia em local com acesso restrito e apague as antigas.

`npm run db:restore -- backups/<data-hora>` restaura num banco com as mesmas tabelas e colunas do backup e vazio. Ele recusa se alguma tabela já tiver linhas ou se as colunas forem diferentes, e grava tudo numa transação só.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
