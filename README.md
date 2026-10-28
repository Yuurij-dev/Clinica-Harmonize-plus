This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Banco de dados

O desenvolvimento e os testes usam PostgreSQL. As variáveis de `.env.local` sobrescrevem as de `.env`; confira `DATABASE_URL` e `DIRECT_URL` para garantir que apontam para o banco que você pretende usar. Para Supabase, configure `DATABASE_URL` com o pooler de transações (6543) e `DIRECT_URL` com conexão direta ou pooler de sessão (5432). O PostgreSQL local via Docker é opcional:

```bash
npm run db:local:up
npm run db:migrate:deploy
npm run db:generate
npm run dev
```

As URLs locais estão no `.env.example`. `SHADOW_DATABASE_URL` deve apontar para um banco separado e descartável para criar migrations com `prisma migrate dev`.

Gere valores aleatórios distintos para `AUTH_SECRET` e `SEED_ADMIN_PASSWORD` com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. A aplicação exige pelo menos 32 bytes para `AUTH_SECRET` e não usa uma chave padrão.
Antes de executar `npm run db:seed`, defina `SEED_ADMIN_PASSWORD` com uma senha única de pelo menos 12 caracteres. O seed cria ou atualiza a senha da conta `admin`; as contas opcionais `teste` e `pro` só são criadas quando `SEED_TEST_PASSWORD` e `SEED_PRO_PASSWORD` também forem definidas com senhas únicas. O script não imprime as senhas.
Em bancos que já receberam as credenciais de demonstração antigas, altere as senhas dessas contas antes de expor a aplicação.

## Multi-clínica

Cada usuário precisa estar vinculado a uma clínica por `ClinicMembership`. As entidades de negócio possuem `clinicId`, e as APIs filtram os registros pela clínica da sessão autenticada. Para preparar um banco local novo:

```bash
npm ci
npm run db:migrate:deploy
npm run db:generate
npm run db:seed
npm run db:tenant-seed
```

O `db:tenant-seed` cria a clínica inicial, vincula a ela os usuários que ainda não têm clínica e associa os registros legados a ela. Para uma clínica nova, crie a clínica e um `ClinicMembership` para cada funcionário; o usuário só conseguirá acessar os dados da clínica à qual estiver vinculado.

## Atualizar um banco que já tem dados

O histórico anterior foi preservado em `prisma/legacy-migrations-before-postgresql-baseline` para auditoria; a pasta ativa contém uma baseline PostgreSQL limpa. Em uma base existente, **não execute o SQL da baseline sobre as tabelas atuais**. Faça backup, compare o schema existente com o schema Prisma e, somente quando estiver confirmado que representam o mesmo estado, registre a baseline como aplicada com `npx prisma migrate resolve --applied 0_init`. Esse comando altera apenas o controle de migrations; não cria nem apaga tabelas. Se a comparação apontar diferenças, pare e prepare uma migration de reconciliação específica antes de continuar.

O fluxo de desenvolvimento, produção e reconciliação está em [docs/prisma-migrations.md](docs/prisma-migrations.md).

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
