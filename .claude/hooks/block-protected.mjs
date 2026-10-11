// PreToolUse: bloqueia edição de .env* e de migrations Prisma já existentes.
import { existsSync } from "node:fs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const file = String(input.tool_input?.file_path ?? "").replaceAll("\\", "/");

const isEnv = /(^|\/)\.env[^/]*$/.test(file) && !/\.env\.example$/.test(file);
const isMigration = /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/.test(file) && existsSync(file);

if (isEnv || isMigration) {
  console.error(
    isEnv
      ? `Bloqueado: ${file} contém segredos. Edite manualmente.`
      : `Bloqueado: ${file} é uma migration existente. Crie uma nova migration em vez de reescrever.`,
  );
  process.exit(2);
}
