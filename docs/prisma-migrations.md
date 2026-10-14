# Fluxo de migrations Prisma

O Prisma instalado no projeto é 6.19.x. `prisma.config.ts` é a fonte das URLs dos comandos Prisma. Para desenvolvimento e testes locais, use o PostgreSQL definido em `compose.yaml`; `DATABASE_URL` e `DIRECT_URL` apontam para localhost e `SHADOW_DATABASE_URL` para um banco separado no mesmo serviço local. Não use as URLs do Supabase no fluxo local de migrations.

## PostgreSQL local

Inicie o Docker Desktop e então suba o banco persistente local:

```bash
npm run db:local:up
npm run db:migrate:deploy
npm run db:generate
npm run db:migrate:status
```

O serviço publica a porta `5433` para evitar conflito com um PostgreSQL já instalado e cria `harmonize` e `harmonize_shadow`. `npm run db:local:down` apenas para o container; não remove o volume nem os dados locais. Para testes totalmente limpos, use outra instância/volume descartável, sem remover o volume de trabalho por engano.

Para testar recursos específicos do Supabase, mantenha um ambiente de integração separado. Em hospedagem Supabase, `DATABASE_URL` pode usar o pooler de transações (6543), enquanto `DIRECT_URL` deve usar a conexão direta ou o pooler de sessão (5432). Nunca use a URL do pooler de transações como `DIRECT_URL`.

## Banco novo

Configure as duas URLs e aplique todas as migrations versionadas:

```bash
npm ci
npm run db:migrate:deploy
npm run db:generate
```

## Criar uma migration em desenvolvimento

`prisma migrate dev` exige `SHADOW_DATABASE_URL`, apontando para um banco PostgreSQL descartável e separado. Nunca use a URL de produção nem a mesma URL de `DIRECT_URL` como shadow. Com as URLs configuradas:

```bash
npm run db:migrate:dev -- --name descricao_da_mudanca
npm run db:generate
npm run db:migration:check
```

Revise e versione o SQL gerado junto do schema. Não edite migrations que já foram compartilhadas; crie outra migration corretiva. O CI aplica o histórico ativo em PostgreSQL vazio, além de validar o schema e barrar sintaxe SQLite.

## Comandos e ambientes

- `prisma migrate dev`: desenvolvimento; usa shadow database, detecta drift e cria/aplica migrations.
- `prisma migrate deploy`: aplica migrations pendentes em ambientes compartilhados, homologação e produção; não cria migrations nem precisa de shadow database.
- `prisma migrate status`: consulta o estado entre migrations locais e `_prisma_migrations` no banco configurado.
- `prisma migrate reset`: destrutivo, apaga e recria o schema local. Não execute em banco compartilhado ou produção.

## Bancos existentes e a baseline `0_init`

As migrations antigas foram arquivadas em `prisma/legacy-migrations-before-postgresql-baseline`; não fazem mais parte do histórico ativo porque começavam com DDL SQLite e não formavam uma sequência reproduzível. A baseline `prisma/migrations/0_init/migration.sql` descreve o schema PostgreSQL consolidado e preserva também a coluna `Product.cost` e o trigger de compatibilidade ainda utilizados por versões publicadas.

Para uma base já criada antes desta mudança, não aplique o DDL da baseline sobre as tabelas existentes. Primeiro faça backup e compare o schema remoto com o schema local. Somente se for exatamente equivalente e não houver migrations antigas registradas, registre a baseline sem executar seu SQL:

```bash
npx prisma migrate resolve --applied 0_init
npm run db:migrate:status
```

Se a comparação encontrar diferença, não marque a baseline como aplicada nem rode `migrate deploy`; crie um plano de reconciliação não destrutivo para aquele banco. A resolução acima altera apenas o histórico `_prisma_migrations`.

Na auditoria desta correção, o banco Supabase que estava configurado mostrou diferenças em relação ao schema desta branch (incluindo tabelas `PatientDocument`, `PatientProcedureSession` e campos adicionais de avaliação/orçamento). Portanto, não execute `migrate resolve` nesse banco até a reconciliação explícita dessas diferenças.

Em branches de funcionalidade, atualize a branch a partir de `develop` antes de criar migrations. Faça merge/rebase das migrations compartilhadas e mantenha todos os arquivos em ordem cronológica no mesmo diretório ativo. Após a integração, confira o CI e use `migrate deploy` nos ambientes compartilhados.
