import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyIfReadonly, denyUnlessFeature } from "@/lib/plan-guards";
import { canForUser } from "@/lib/permissions";
import { ensureRecurringOccurrences } from "@/lib/finance";

// Gera as ocorrências que faltam das despesas fixas até o fim do mês. É uma ESCRITA (por isso POST): a tela do Financeiro
// chama ao abrir, antes de listar. Exige acesso ao Financeiro (finance:access, não só finance:manage: quem apenas consulta
// também precisa ver o mês em dia), o recurso `finance` no plano da clínica e acesso completo (nunca em somente leitura).
// Só INSERE ocorrências que faltam (índice único + skipDuplicates): nunca altera nem apaga despesa existente. Idempotente,
// escopada pela clínica da sessão; devolve quantas criou para a tela atualizar só quando houve mudança.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const readonlyDenied = denyIfReadonly(user);
  if (readonlyDenied) return readonlyDenied;
  if (!canForUser(user, "finance:access")) return NextResponse.json({ message: "Seu cargo não tem permissão para esta ação." }, { status: 403 });
  const planDenied = denyUnlessFeature(user, "finance", "write");
  if (planDenied) return planDenied;
  const created = await ensureRecurringOccurrences(user.clinicId);
  return NextResponse.json({ created }, { headers: { "Cache-Control": "private, no-store" } });
}
