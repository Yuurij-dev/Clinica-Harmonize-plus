import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";
import { buildQuotePdf } from "@/lib/quote-pdf";
import { parseQuoteDetails, proposalRowsFromQuote, quoteFinancialSnapshot } from "@/lib/quote-proposal";
import { sendQuoteEmail } from "@/lib/patient-emails";

// Envia o orçamento ao paciente por e-mail com o PDF anexado. Não muda o status; só registra sentAt/sentBy se o e-mail saiu.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const denied = denyUnless(user, "quotes:manage");
  if (denied) return denied;
  const id = (await params).id;
  const quote = await prisma.quote.findFirst({
    where: { id, clinicId: user.clinicId },
    select: { id: true, patientId: true, items: true, details: true, totalCents: true, expires: true, installments: true, paymentMethod: true, createdAt: true },
  });
  if (!quote) return NextResponse.json({ message: "Orçamento não encontrado." }, { status: 404 });
  const patient = quote.patientId
    ? await prisma.patient.findFirst({
        where: { id: quote.patientId, clinicId: user.clinicId },
        select: { name: true, email: true, clinic: { select: { name: true, phone: true, cnpj: true, address: true } } },
      })
    : null;
  if (!patient || !patient.clinic) return NextResponse.json({ message: "Paciente do orçamento não encontrado." }, { status: 404 });
  const to = patient.email?.trim();
  if (!to) return NextResponse.json({ message: "O paciente não tem e-mail cadastrado. Cadastre um e-mail para enviar o orçamento." }, { status: 422 });

  const rows = proposalRowsFromQuote(quote);
  const financial = quoteFinancialSnapshot(quote.details, quote.totalCents);
  const totalCents = parseQuoteDetails(quote.details)?.totalCents ?? quote.totalCents;
  // Validade como dia (YYYY-MM-DD) — mesma base do e-mail, sem converter fuso (evita divergir um dia).
  const expires = quote.expires?.toISOString().slice(0, 10) ?? null;
  const expiresBr = expires ? `${expires.slice(8, 10)}/${expires.slice(5, 7)}/${expires.slice(0, 4)}` : null;
  const pdf = await buildQuotePdf({
    clinic: patient.clinic,
    patientName: patient.name,
    dateLabel: quote.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    validUntil: expiresBr,
    rows,
    financial,
    paymentMethod: quote.paymentMethod,
    installments: quote.installments,
    proposalNumber: quote.id.slice(-6).toUpperCase(),
  });

  const result = await sendQuoteEmail({
    to,
    patientName: patient.name,
    clinicName: patient.clinic.name,
    clinicPhone: patient.clinic.phone,
    clinicCnpj: patient.clinic.cnpj,
    clinicAddress: patient.clinic.address,
    totalCents,
    expires,
    itemCount: rows.length,
    attachment: { filename: "orcamento.pdf", content: Buffer.from(pdf).toString("base64") },
  });
  if (!result.sent) {
    return result.reason === "not_configured"
      ? NextResponse.json({ message: "Envio de e-mail não está configurado." }, { status: 503 })
      : NextResponse.json({ message: "Não foi possível enviar o e-mail agora." }, { status: 502 });
  }
  const sentAt = new Date();
  await prisma.quote.updateMany({ where: { id, clinicId: user.clinicId }, data: { sentAt, sentBy: user.name } });
  return NextResponse.json({ ok: true, sentAt });
}
