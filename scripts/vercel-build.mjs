// Build da Vercel: em Production aplica as migrations pendentes antes do `next build`.
// Em Preview NÃO migra: Preview e Production compartilham o mesmo banco, então só o deploy de produção altera o schema.
// Se a migration falhar, o build é abortado e a versão atual do site continua no ar.
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const isProduction = process.env.VERCEL_ENV === "production";
const skip = process.env.SKIP_PRISMA_MIGRATE === "1";

if (isProduction && !skip) {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
    console.error("DATABASE_URL e DIRECT_URL precisam estar definidas no ambiente Production para aplicar as migrations.");
    process.exit(1);
  }
  console.log("Production: aplicando migrations pendentes (prisma migrate deploy)...");
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log(`Migrations ignoradas (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}${skip ? ", SKIP_PRISMA_MIGRATE=1" : ""}).`);
}

run("npx", ["next", "build"]);
