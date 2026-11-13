import { NextResponse } from "next/server";
import { invalidateUserAuthCache } from "@/lib/auth";
import { loadOwnProfile } from "@/lib/own-profile";
import { OWN_NAME_TAKEN_MESSAGE, parseOwnProfile, professionalNameTaken } from "@/lib/own-profile-rules";
import { prisma } from "@/lib/prisma";
import { noStore, requireSecurityUser, securityError } from "@/lib/security-api";

const MAX_BODY_BYTES = 16 * 1024;

// Edita os dados pessoais do próprio usuário. E-mail, papel e clínica não mudam aqui. Campo ausente = manter.
export async function PATCH(request: Request) {
  const { user, error } = await requireSecurityUser(request, { mutation: true });
  if (error) return error;
  // Perfil tem poucos campos curtos: corpo grande é abuso (confere o cabeçalho e o tamanho realmente lido).
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return securityError("Requisição grande demais.", 413);
  const raw = await request.text().catch(() => null);
  if (raw === null) return securityError("Requisição inválida.", 400);
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return securityError("Requisição grande demais.", 413);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw) as Record<string, unknown> | null; } catch { /* corpo inválido: tratado abaixo */ }
  if (!body || typeof body !== "object" || Array.isArray(body)) return securityError("Requisição inválida.", 400);
  const parsed = parseOwnProfile(body);
  if (!parsed.ok) return securityError(parsed.message, 400, { fields: parsed.fields });
  if (parsed.value.name !== undefined) {
    // Relatórios de PROFISSIONAL são escopados pelo nome: recusa nome igual ao de outro membro das clínicas em que ele é profissional.
    const professionalClinics = await prisma.clinicMembership.findMany({ where: { userId: user.id, role: "PROFESSIONAL" }, select: { clinicId: true } });
    if (professionalClinics.length > 0) {
      const clinicIds = professionalClinics.map((item) => item.clinicId);
      // Nomes proibidos: outros membros (sem limite: poucos por clínica) e nomes que existem só nos agendamentos/orçamentos
      // das clínicas (ex-colega, rótulo digitado). Sempre escopado pelas clínicas do solicitante.
      const [members, appointmentNames, quoteNames] = await Promise.all([
        prisma.user.findMany({ where: { id: { not: user.id }, memberships: { some: { clinicId: { in: clinicIds } } } }, select: { name: true } }),
        prisma.appointment.groupBy({ by: ["professional"], where: { clinicId: { in: clinicIds } } }),
        prisma.quote.groupBy({ by: ["createdBy"], where: { clinicId: { in: clinicIds } } }),
      ]);
      const taken = [...members.map((member) => member.name), ...appointmentNames.map((item) => item.professional), ...quoteNames.map((item) => item.createdBy)];
      if (professionalNameTaken(parsed.value.name, user.name, taken)) return securityError(OWN_NAME_TAKEN_MESSAGE, 409, { fields: { name: OWN_NAME_TAKEN_MESSAGE } });
    }
  }
  if (Object.keys(parsed.value).length) {
    await prisma.user.update({ where: { id: user.id }, data: parsed.value });
    invalidateUserAuthCache(user.id); // o nome vem do cache de autenticação
  }
  const profile = await loadOwnProfile(user);
  if (!profile) return securityError("Não autenticado.", 401);
  return NextResponse.json(profile, { headers: noStore });
}
