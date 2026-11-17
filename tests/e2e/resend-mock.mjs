import { createServer } from "node:http";

const port = Number(process.env.E2E_RESEND_PORT ?? 4011);
const server = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/emails") { response.writeHead(404).end(); return; }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let subject = "";
    try { subject = JSON.parse(Buffer.concat(chunks).toString("utf8")).subject ?? ""; } catch {}
    if (subject.includes("convidou você para a clínica")) {
      response.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ name: "validation_error" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "e2e-local" }));
  });
});

server.listen(port, "127.0.0.1", () => console.log(`E2E mail mock listening on 127.0.0.1:${port}`));
