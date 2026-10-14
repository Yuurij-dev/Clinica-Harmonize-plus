import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const migrationsPath = join(process.cwd(), "prisma", "migrations");
const lockPath = join(migrationsPath, "migration_lock.toml");
const errors = [];

if (!statSync(migrationsPath, { throwIfNoEntry: false })?.isDirectory()) {
  errors.push("Diretório prisma/migrations não encontrado.");
} else {
  const lock = readFileSync(lockPath, "utf8");
  if (!/^provider\s*=\s*"postgresql"\s*$/m.test(lock)) {
    errors.push("migration_lock.toml deve declarar provider = \"postgresql\".");
  }

  const directories = readdirSync(migrationsPath)
    .map((name) => join(migrationsPath, name))
    .filter((path) => statSync(path).isDirectory());

  if (directories.length === 0) errors.push("Nenhuma migration ativa encontrada.");

  for (const directory of directories) {
    const migrationPath = join(directory, "migration.sql");
    if (!statSync(migrationPath, { throwIfNoEntry: false })?.isFile()) {
      errors.push(`${directory} não contém migration.sql.`);
      continue;
    }

    const sql = readFileSync(migrationPath, "utf8");
    const sqliteSyntax = [
      ["DATETIME", /\bDATETIME\b/i],
      ["AUTOINCREMENT", /\bAUTOINCREMENT\b/i],
      ["PRAGMA", /\bPRAGMA\b/i],
      ["WITHOUT ROWID", /\bWITHOUT\s+ROWID\b/i],
      ["INSERT OR REPLACE", /\bINSERT\s+OR\s+REPLACE\b/i],
    ];

    for (const [syntax, pattern] of sqliteSyntax) {
      if (pattern.test(sql)) errors.push(`${directory} contém sintaxe SQLite: ${syntax}.`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Migrations ativas: PostgreSQL, lock válido e nenhum padrão SQLite detectado.");
}
