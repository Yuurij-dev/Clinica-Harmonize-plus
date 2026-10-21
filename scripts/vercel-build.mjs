// Build da Vercel: em Production aplica as migrations pendentes antes do `next build`.
// Em Preview NÃO migra: Preview e Production compartilham o mesmo banco, então só o deploy de produção altera o schema.
// Se a migration falhar, o build é abortado e a versão atual do site continua no ar.
import { spawnSync } from "node:child_process";

function run(command, args, { env = process.env, timeout } = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32", env, timeout, killSignal: "SIGKILL" });
  if (result.error?.code === "ETIMEDOUT") {
    console.error(`Tempo esgotado (${timeout / 1000}s) em: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Mostra só host:porta (sem usuário nem senha) no log do deploy.
function hostOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}`;
  } catch {
    return "URL inválida";
  }
}

const isProduction = process.env.VERCEL_ENV === "production";
const skip = process.env.SKIP_PRISMA_MIGRATE === "1";

if (isProduction && !skip) {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
    console.error("DATABASE_URL e DIRECT_URL precisam estar definidas no ambiente Production para aplicar as migrations.");
    process.exit(1);
  }
  // Migrations precisam de conexão direta ou de sessão: o pooler de transações (porta 6543) trava o lock do Prisma.
  // O prisma.config.ts usa DATABASE_URL, então ela é trocada pela DIRECT_URL só neste comando.
  console.log(`Production: aplicando migrations pendentes (prisma migrate deploy) em ${hostOf(process.env.DIRECT_URL)}...`);
  if (hostOf(process.env.DIRECT_URL).endsWith(":6543")) {
    console.error("DIRECT_URL aponta para o pooler de transações (6543), que trava migrations. Use a conexão direta ou o pooler em modo sessão (porta 5432).");
    process.exit(1);
  }
  run("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: process.env.DIRECT_URL }, timeout: 240000 });
} else {
  console.log(`Migrations ignoradas (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}${skip ? ", SKIP_PRISMA_MIGRATE=1" : ""}).`);
}

run("npx", ["next", "build"]);
