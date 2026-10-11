// Restaura um backup de prisma/backup.mjs: node prisma/restore.mjs backups/<data-hora>
// O banco de destino precisa ter as mesmas tabelas e colunas do backup e estar vazio nessas tabelas;
// caso contrário nada é gravado. Tudo roda numa transação: ou entra tudo, ou nada.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const maxBatchBytes = 4_000_000;

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error("Informe a pasta do backup: node prisma/restore.mjs backups/<data-hora>");
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const tables = Object.keys(manifest.tables);

  for (const table of tables) {
    const columns = (await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`).map((row) => row.column_name);
    if (columns.join(",") !== manifest.tables[table].columns.join(",")) throw new Error(`${table}: as colunas do banco não batem com as do backup.`);
    const [{ total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM ${quote(table)}`);
    if (total > 0) throw new Error(`${table} já tem ${total} linhas. Restaure num banco vazio.`);
  }

  // Tabelas referenciadas entram antes das que apontam para elas.
  const foreignKeys = await prisma.$queryRaw`SELECT tc.relname AS child, tp.relname AS parent FROM pg_constraint c JOIN pg_class tc ON tc.oid = c.conrelid JOIN pg_class tp ON tp.oid = c.confrelid JOIN pg_namespace n ON n.oid = tc.relnamespace WHERE c.contype = 'f' AND n.nspname = 'public'`;
  const ordered = [];
  const pending = new Set(tables);
  while (pending.size) {
    const ready = [...pending].filter((table) => !foreignKeys.some((fk) => fk.child === table && fk.parent !== table && pending.has(fk.parent)));
    if (!ready.length) throw new Error(`Dependência circular entre: ${[...pending].join(", ")}`);
    for (const table of ready) { ordered.push(table); pending.delete(table); }
  }

  await prisma.$transaction(async (tx) => {
    for (const table of ordered) {
      // Linhas na ordem do id (cuid cresce com o tempo): a original vem antes do estorno que aponta para ela.
      const lines = readFileSync(join(dir, `${table}.ndjson`), "utf8").split("\n").filter(Boolean);
      let batch = [];
      let bytes = 0;
      const flush = async () => {
        if (!batch.length) return;
        await tx.$executeRawUnsafe(`INSERT INTO ${quote(table)} SELECT * FROM json_populate_recordset(NULL::${quote(table)}, $1::json)`, `[${batch.join(",")}]`);
        batch = [];
        bytes = 0;
      };
      for (const line of lines) {
        batch.push(line);
        bytes += line.length;
        if (bytes >= maxBatchBytes) await flush();
      }
      await flush();
      if (lines.length !== manifest.tables[table].count) throw new Error(`${table}: o arquivo tem ${lines.length} linhas, o manifest diz ${manifest.tables[table].count}.`);
      console.log(`${table}: ${lines.length}`);
    }
  }, { timeout: 600_000, maxWait: 60_000 });
  console.log("Restauração completa.");
}

function quote(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
