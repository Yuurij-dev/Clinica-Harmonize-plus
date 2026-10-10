// PostToolUse: roda tsc --noEmit após editar .ts/.tsx e devolve os erros ao Claude.
import { spawnSync } from "node:child_process";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");
const file = String(input.tool_input?.file_path ?? "");

if (!/\.(ts|tsx)$/.test(file)) process.exit(0);

const result = spawnSync("npx tsc --noEmit --pretty false", {
  cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  encoding: "utf8",
  shell: true,
});

if (result.status !== 0) {
  console.error(`Erros de tipo após editar ${file}:\n${(result.stdout || result.stderr).slice(0, 4000)}`);
  process.exit(2);
}
