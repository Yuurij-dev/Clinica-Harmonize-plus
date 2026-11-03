import assert from "node:assert/strict";
import { test } from "node:test";
import { MASCOT_POSES, isMascotPose, poseForKey } from "../src/lib/mascot-rules.ts";
import { TOUR_STEPS } from "../src/lib/tour-rules.ts";

test("poseForKey devolve sempre a mesma pose para a mesma chave", () => {
  assert.equal(poseForKey("Novo procedimento"), poseForKey("Novo procedimento"));
  assert.ok(MASCOT_POSES.includes(poseForKey("Novo procedimento")));
});

test("poseForKey espalha bem entre títulos reais", () => {
  // Títulos de verdade do sistema: um hash fraco agrupava vários deles na mesma pose.
  const titulos = ["Novo procedimento", "Excluir procedimento: cu", "Deseja iniciar o tour?", "Novo agendamento", "Novo cliente", "Novo orçamento", "Registrar pagamento", "Nova compra", "Editar material", "Novo material", "Editar cliente", "Nova despesa", "Novo usuário", "Confirmar exclusão", "Detalhes do atendimento"];
  const contagem = new Map();
  for (const titulo of titulos) {
    const pose = poseForKey(titulo);
    contagem.set(pose, (contagem.get(pose) ?? 0) + 1);
  }
  assert.ok(contagem.size >= 5, `esperava ao menos 5 poses diferentes, veio ${contagem.size}`);
  const maior = Math.max(...contagem.values());
  assert.ok(maior <= titulos.length / 3, `uma pose dominou (${maior} de ${titulos.length} títulos)`);
});

test("poseForKey aceita chave vazia e lista de poses restrita", () => {
  assert.ok(MASCOT_POSES.includes(poseForKey("")));
  assert.equal(poseForKey("qualquer", ["cheer"]), "cheer");
  assert.equal(poseForKey("qualquer", []), "wave");
});

test("isMascotPose separa pose de outros valores", () => {
  assert.equal(isMascotPose("wink"), true);
  assert.equal(isMascotPose("sorrir"), false);
  assert.equal(isMascotPose(true), false);
  assert.equal(isMascotPose(undefined), false);
});

test("os passos do tour usam poses conhecidas e não repetem só uma", () => {
  const poses = TOUR_STEPS.map((step) => step.pose);
  for (const pose of poses) assert.ok(isMascotPose(pose), `pose desconhecida: ${pose}`);
  assert.ok(new Set(poses).size >= 5, `o tour ficou repetitivo: só ${new Set(poses).size} poses`);
});
