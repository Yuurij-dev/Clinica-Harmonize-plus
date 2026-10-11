// PostToolUse: roda tsc --noEmit após editar .ts/.tsx e devolve os erros ao Claude.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const file = String(input.tool_input?.file_path ?? "");

if (!/\.(ts|tsx)$/.test(file)) process.exit(0);

const tscPath = fileURLToPath(new URL("../../node_modules/typescript/bin/tsc", import.meta.url));
const result = spawnSync(process.execPath, [tscPath, "--noEmit", "--pretty", "false"], {
  cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  encoding: "utf8",
});

if (result.status !== 0) {
  console.error(`Erros de tipo após editar ${file}:\n${(result.stdout || result.stderr || result.error?.message || "Falha ao executar o TypeScript.").slice(0, 4000)}`);
  process.exit(2);
}
