// Backup de todas as tabelas do schema public em backups/<data-hora>/<Tabela>.ndjson (uma linha JSON por registro),
// com manifest.json (colunas e contagem por tabela). Não precisa de pg_dump. Restaura com prisma/restore.mjs.
// Os arquivos têm dados de pacientes: guarde fora do repositório e com acesso restrito.
import "dotenv/config";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const batchSize = 200;

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("backups", stamp);
  mkdirSync(dir, { recursive: true });

  const tables = (await prisma.$queryRaw`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`).map((row) => row.table_name);
  const manifest = { createdAt: new Date().toISOString(), tables: {} };

  for (const table of tables) {
    const columns = (await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table} ORDER BY ordinal_position`).map((row) => row.column_name);
    const quoted = `"${table.replaceAll('"', '""')}"`;
    const out = createWriteStream(join(dir, `${table}.ndjson`));
    let count = 0;
    if (columns.includes("id")) {
      // Paginação por id: tabelas com fotos em base64 não cabem numa consulta só.
      let lastId = "";
      for (;;) {
        const rows = await prisma.$queryRawUnsafe(`SELECT "id", row_to_json(t)::text AS j FROM ${quoted} t WHERE "id" > $1 ORDER BY "id" LIMIT ${batchSize}`, lastId);
        for (const row of rows) if (!out.write(`${row.j}\n`)) await once(out, "drain");
        count += rows.length;
        if (rows.length < batchSize) break;
        lastId = rows.at(-1).id;
      }
    } else {
      const rows = await prisma.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM ${quoted} t`);
      for (const row of rows) out.write(`${row.j}\n`);
      count = rows.length;
    }
    out.end();
    await once(out, "finish");
    const [{ total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS total FROM ${quoted}`);
    if (total !== count) throw new Error(`${table}: exportou ${count} linhas, mas a tabela tem ${total}. Rode o backup de novo com o sistema parado.`);
    manifest.tables[table] = { columns, count };
    console.log(`${table}: ${count}`);
  }

  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Backup completo em ${dir}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
