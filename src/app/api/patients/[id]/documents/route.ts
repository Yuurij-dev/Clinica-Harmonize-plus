import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { denyUnless } from "@/lib/api-guards";
import { prisma } from "@/lib/prisma";
import {
  canArchiveFiles, canAssignSignatureStatus, canDeleteFiles, canSeeSystemDocument, canWriteDocumentCategory, checkUpload, displayNameFromFile, documentCategories, filterSystemDocuments, isDocumentCategory, isSignatureStatus,
  maxUploadBytes, parseDocumentQuery, sanitizeFileName, sortByDate, visibleDocumentCategories, type DocumentCategory, type SystemDocumentItem,
} from "@/lib/clinical-files-rules";
import { auditEntry, findPatientScoped, readUploadForm, resolveLinks, sha256 } from "@/lib/clinical-files-server";
import { can } from "@/lib/permissions";
import { prepareStorage, removeStoredBytes } from "@/lib/clinical-storage";

const mergeCeiling = 3000;
const listSelect = { id: true, name: true, category: true, mimeType: true, sizeBytes: true, signatureStatus: true, uploadedByName: true, uploadedAt: true, journeyId: true, encounterType: true, encounterId: true, archivedAt: true } satisfies Prisma.ClinicalDocumentSelect;

// Lista paginada e enxuta (sem bytes). Junta os documentos enviados com itens do sistema por referência (anamnese, avaliação concluída).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  const visible = visibleDocumentCategories(user.role, user.rolePermissions);
  if (!visible.length) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  if (!await findPatientScoped(clinicId, patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });
  const query = parseDocumentQuery(new URL(request.url).searchParams);

  const base: Prisma.ClinicalDocumentWhereInput = { clinicId, patientId, category: { in: visible }, archivedAt: query.archived ? { not: null } : null };
  const filtered: Prisma.ClinicalDocumentWhereInput = {
    ...base,
    ...(query.q ? { name: { contains: query.q, mode: "insensitive" } } : {}),
    ...(query.professional ? { uploadedByName: { contains: query.professional, mode: "insensitive" } } : {}),
    ...(query.journeyId ? { journeyId: query.journeyId } : {}),
    ...(query.from || query.to ? { uploadedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
  };
  // AND (e não spread): a categoria pedida nunca pode ampliar o conjunto de categorias visíveis ao papel.
  const where: Prisma.ClinicalDocumentWhereInput = query.category ? { AND: [filtered, { category: query.category }] } : filtered;

  const system: SystemDocumentItem[] = [];
  if (!query.archived) {
    if (canSeeSystemDocument(user.role, "anamnesis")) {
      const versions = await prisma.patientAnamnesis.findMany({ where: { clinicId, patientId, status: { in: ["CONCLUIDA", "PENDENTE_REVISAO"] } }, select: { id: true, version: true, status: true, completedAt: true, updatedAt: true, completedBy: true, createdBy: true } });
      for (const row of versions) system.push({ id: `sys-anamnesis-${row.id}`, system: true, kind: "anamnesis", name: `Anamnese (v${row.version})`, category: "OUTROS", date: (row.completedAt ?? row.updatedAt).toISOString(), professional: row.completedBy ?? row.createdBy, status: row.status === "PENDENTE_REVISAO" ? "Revisão pendente" : "Concluída", originRef: row.id });
    }
    if (canSeeSystemDocument(user.role, "evaluation")) {
      const evaluations = await prisma.evaluation.findMany({ where: { clinicId, patientId, status: "Concluída" }, select: { id: true, professional: true, createdAt: true } });
      for (const row of evaluations) system.push({ id: `sys-evaluation-${row.id}`, system: true, kind: "evaluation", name: "Avaliação inicial", category: "OUTROS", date: row.createdAt.toISOString(), professional: row.professional, status: "Concluída", originRef: row.id });
    }
  }
  const systemInFilter = filterSystemDocuments(system, query, visible);

  // Sem itens de sistema no filtro, a página sai direto do banco (skip/take). Com itens de sistema (poucos: anamneses e avaliações),
  // a mesclagem por data precisa dos enviados em memória: limite explícito de ${mergeCeiling} documentos por consulta (ver ADR 0002).
  const pageInDb = systemInFilter.length === 0;
  const start = (query.page - 1) * query.pageSize;
  // Desempate por id mantém a paginação estável entre páginas.
  const dbOrder: Prisma.ClinicalDocumentOrderByWithRelationInput[] = [query.sort === "name" ? { name: "asc" } : { uploadedAt: query.sort === "oldest" ? "asc" : "desc" }, { id: "asc" }];
  const [uploaded, dbTotal, grouped, professionals] = await Promise.all([
    pageInDb ? prisma.clinicalDocument.findMany({ where, select: listSelect, orderBy: dbOrder, skip: start, take: query.pageSize }) : prisma.clinicalDocument.findMany({ where, select: listSelect, orderBy: { uploadedAt: "desc" }, take: mergeCeiling }),
    pageInDb ? prisma.clinicalDocument.count({ where }) : Promise.resolve(0),
    prisma.clinicalDocument.groupBy({ by: ["category"], where: filtered, _count: { _all: true } }),
    prisma.clinicalDocument.findMany({ where: base, distinct: ["uploadedByName"], select: { uploadedByName: true }, take: 100 }),
  ]);

  const items = sortByDate([
    ...uploaded.map((row) => ({ id: row.id, system: false as const, name: row.name, category: row.category, date: row.uploadedAt.toISOString(), mimeType: row.mimeType, sizeBytes: row.sizeBytes, signatureStatus: row.signatureStatus, professional: row.uploadedByName, journeyId: row.journeyId, encounterType: row.encounterType, encounterId: row.encounterId, archived: Boolean(row.archivedAt) })),
    ...systemInFilter,
  ], query.sort);
  const total = pageInDb ? dbTotal : items.length;

  const counts: Record<string, number> = Object.fromEntries(documentCategories.filter((category) => visible.includes(category)).map((category) => [category, 0]));
  for (const row of grouped) counts[row.category] = (counts[row.category] ?? 0) + row._count._all;
  const systemForCounts = filterSystemDocuments(system, { ...query, category: null }, visible);
  for (const item of systemForCounts) counts[item.category] = (counts[item.category] ?? 0) + 1;
  const all = Object.values(counts).reduce((sum, value) => sum + value, 0);

  return NextResponse.json({
    items: pageInDb ? items : items.slice(start, start + query.pageSize), total, page: query.page, pageSize: query.pageSize, counts: { all, ...counts },
    professionals: [...new Set([...professionals.map((row) => row.uploadedByName), ...system.map((item) => item.professional)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")),
    access: { visibleCategories: visible, canArchive: canArchiveFiles(user.role, user.rolePermissions), canDelete: canDeleteFiles(user.role, user.rolePermissions), maxUploadBytes },
  });
}

// Upload de UM arquivo por requisição (o cliente envia vários em sequência, com progresso e erro por arquivo).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser({ requireActiveTrial: true });
  if (!user) return NextResponse.json({ message: "Não autenticado." }, { status: 401 });
  const patientDenied = denyUnless(user, "patients:access");
  if (patientDenied) return patientDenied;
  if (!visibleDocumentCategories(user.role, user.rolePermissions).length) return NextResponse.json({ message: "Acesso restrito." }, { status: 403 });
  const patientId = (await params).id;
  const clinicId = user.clinicId;
  if (!await findPatientScoped(clinicId, patientId)) return NextResponse.json({ message: "Paciente não encontrado." }, { status: 404 });

  // 413 antes de bufferizar o corpo.
  const read = await readUploadForm(request);
  if ("response" in read) return read.response;
  const form = read.form;
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Envie um arquivo." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ message: "O arquivo excede 4 MB." }, { status: 413 });
  const category = form.get("category");
  if (!isDocumentCategory(category)) return NextResponse.json({ message: "Escolha a categoria do documento." }, { status: 400 });
  if (!canWriteDocumentCategory(user.role, category, user.rolePermissions)) return NextResponse.json({ message: "Seu perfil não pode enviar documentos desta categoria." }, { status: 403 });
  const signature = form.get("signatureStatus");
  if (signature !== null && signature !== "" && !isSignatureStatus(signature)) return NextResponse.json({ message: "Status de assinatura inválido." }, { status: 400 });

  if (typeof signature === "string" && !canAssignSignatureStatus(user.role, category, signature, user.rolePermissions)) return NextResponse.json({ message: "Seu perfil não pode marcar um termo como assinado. Envie como pendente." }, { status: 403 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes, file.type || undefined);
  if (!check.ok) return NextResponse.json({ message: check.message }, { status: check.status });

  const links = await resolveLinks(clinicId, patientId, { journeyId: form.get("journeyId"), encounterType: form.get("encounterType"), encounterId: form.get("encounterId") }, can(user.role, "clinical:read", user.rolePermissions));
  if (!links.ok) return NextResponse.json({ message: links.message }, { status: 400 });

  const originalName = sanitizeFileName(file.name, `documento.${check.file.ext}`);
  const rawName = form.get("name");
  const name = (typeof rawName === "string" && sanitizeFileName(rawName, "")) || displayNameFromFile(originalName);
  const id = crypto.randomUUID().replace(/-/g, "");
  const stored = await prepareStorage("document", clinicId, patientId, id, bytes as Uint8Array<ArrayBuffer>, check.file.mime).catch(() => null);
  if (!stored) return NextResponse.json({ message: "Não foi possível gravar o arquivo." }, { status: 502 });

  // Registro e auditoria na mesma transação; se falhar, remove o objeto já enviado ao bucket (driver supabase).
  const [created] = await prisma.$transaction([prisma.clinicalDocument.create({
    data: {
      id, clinicId, patientId, ...links.links, category, name, originalName, mimeType: check.file.mime, sizeBytes: bytes.length, sha256: sha256(bytes),
      storageDriver: stored.storageDriver, storageKey: stored.storageKey, signatureStatus: typeof signature === "string" && signature ? signature : "NAO_APLICAVEL",
      uploadedBy: user.id, uploadedByName: user.name, blob: stored.blob,
    },
    select: listSelect,
  }), auditEntry(user, patientId, "DOCUMENT", id, "UPLOAD", { fileName: name, category })]).catch(async (error) => { await removeStoredBytes(stored); throw error; });
  return NextResponse.json({ item: { ...created, uploadedAt: created.uploadedAt.toISOString(), archivedAt: null } }, { status: 201 });
}

export type { DocumentCategory };
