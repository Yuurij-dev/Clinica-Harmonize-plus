This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Banco de dados

O projeto usa Prisma com PostgreSQL quando conectado ao Supabase.

1. Crie um projeto no Supabase.
2. Execute `database/schema.sql` no SQL Editor.
3. Copie as URLs do Pooler e da conexão direta para o `.env`:

```env
DATABASE_URL="postgresql://...:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://...:5432/postgres?sslmode=require"
AUTH_SECRET="uma-chave-secreta-longa"
```

`DATABASE_URL` é usada pela aplicação. `DIRECT_URL` é usada pelo Prisma em migrações.

## Multi-clínica

Cada usuário precisa estar vinculado a uma clínica por `ClinicMembership`. As entidades de negócio possuem `clinicId`, e as APIs filtram os registros pela clínica da sessão autenticada. Para aplicar o modelo no banco existente:

```bash
npx prisma db push --accept-data-loss
npx prisma generate
npm run db:seed
npm run db:tenant-seed
```

O `db:tenant-seed` cria a clínica inicial, vincula os usuários existentes e associa os registros legados a ela. Para uma clínica nova, crie a clínica e um `ClinicMembership` para cada funcionário; o usuário só conseguirá acessar os dados da clínica à qual estiver vinculado.

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
