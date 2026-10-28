"use client";

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, ClipboardList, Download, ExternalLink, Eye, FileImage, FileText, FolderOpen, Link2, Lock, MoreVertical, PenLine, Search, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { Sheet } from "@/components/ui/sheet";
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";
import {
  documentCategories, documentCategoryLabels, documentPageSizes, formatBytes, isDocumentCategory, signatureLabels, signatureStatuses, type DocumentCategory, type SignatureStatus,
} from "@/lib/clinical-files-rules";
import { cn } from "@/lib/utils";
import { isImageFile, postForm, prepareImage, sendJson, type UploadEntry } from "./clinical-upload";
import { type EncountersResponse, formatDate, formatTime, encountersKey, useCachedResource } from "./patient-clinical-data";
import { useCan } from "./current-user";
import { PaginationBar } from "./clinical-pagination";
import { EmptyState, LoadingSkeleton } from "./shared";

export type DocumentItem = {
  id: string; system: boolean; name: string; category: DocumentCategory; date: string; professional: string;
  mimeType?: string; sizeBytes?: number; signatureStatus?: SignatureStatus; journeyId?: string | null; encounterType?: string | null; encounterId?: string | null; archived?: boolean;
  kind?: "anamnesis" | "evaluation"; status?: string; originRef?: string;
};
type DocumentsResponse = {
  items: DocumentItem[]; total: number; page: number; pageSize: number; counts: Record<string, number>; professionals: string[];
  access: { visibleCategories: DocumentCategory[]; canArchive: boolean; canDelete: boolean; maxUploadBytes: number };
};
type JourneyOption = { id: string; name: string };

const base = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/documents`;
const categoryTone: Record<DocumentCategory, string> = { TERMOS: "bg-violet-100 text-violet-700", EXAMES: "bg-indigo-100 text-indigo-700", RECEITAS: "bg-orange-100 text-orange-700", ORIENTACOES: "bg-emerald-100 text-emerald-700", DECLARACOES: "bg-fuchsia-100 text-fuchsia-700", OUTROS: "bg-slate-100 text-slate-700" };
const periods = [{ id: "", label: "Todos os períodos" }, { id: "30", label: "Últimos 30 dias" }, { id: "90", label: "Últimos 90 dias" }, { id: "365", label: "Último ano" }, { id: "custom", label: "Personalizado" }];

function isoDay(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date); }

export function PatientClinicalDocuments({ patientId, initialCategory, onOpenAnamnesis, onOpenEvaluation }: {
  patientId: string; initialCategory?: DocumentCategory | null; onOpenAnamnesis: () => void; onOpenEvaluation: (evaluationId: string) => void;
}) {
  const canClinical = useCan("clinical:read");
  const [category, setCategory] = useState<DocumentCategory | "">(initialCategory ?? "");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("");
  const [presetFrom, setPresetFrom] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [professional, setProfessional] = useState("");
  const [journeyId, setJourneyId] = useState("");
  const [sort, setSort] = useState("recent");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<DocumentItem | null>(null);
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState<DocumentItem | null>(null);
  const [dragging, setDragging] = useState(false);
  const [journeys, setJourneys] = useState<JourneyOption[]>([]);

  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    let active = true;
    getCachedJson<{ journeys?: JourneyOption[] }>(`/api/patients/${encodeURIComponent(patientId)}/journeys`).then((data) => { if (active) setJourneys((data.journeys ?? []).map((item) => ({ id: item.id, name: item.name }))); }).catch(() => undefined);
    return () => { active = false; };
  }, [patientId]);

  const range = period === "custom" ? { from: customFrom, to: customTo } : { from: presetFrom, to: "" };
  const key = useMemo(() => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (professional) params.set("professional", professional);
    if (journeyId) params.set("journeyId", journeyId);
    if (archived) params.set("archived", "1");
    params.set("sort", sort); params.set("page", String(page)); params.set("pageSize", String(pageSize));
    return `${base(patientId)}?${params.toString()}`;
  }, [patientId, category, query, range.from, range.to, professional, journeyId, sort, page, pageSize, archived]);
  const { data, loading, error, retry } = useCachedResource<DocumentsResponse>(key);

  const refresh = useCallback(() => invalidateClientCache(base(patientId)), [patientId]);
  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(1); };
  const visibleCategories = data?.access.visibleCategories ?? [];

  function onDrop(event: DragEvent) {
    event.preventDefault(); setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) { setPendingFiles(files); setUploadOpen(true); }
  }

  async function patch(item: DocumentItem, body: Record<string, unknown>, success: string) {
    const result = await sendJson(`${base(patientId)}/${encodeURIComponent(item.id)}`, "PATCH", body);
    if (!result.ok) { toast.error(result.message); return false; }
    refresh(); toast.success(success); return true;
  }

  return <div className="space-y-4" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={onDrop}>
    <Card className={cn("p-4 sm:p-5", dragging && "ring-2 ring-primary")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><FolderOpen className="h-5 w-5" aria-hidden="true" /></span>
          <div><h3 className="text-base font-bold">Documentos clínicos</h3><p className="mt-0.5 text-xs text-muted-foreground">Gerencie todos os documentos relacionados ao prontuário do paciente.</p></div>
        </div>
        <Button onClick={() => { setPendingFiles([]); setUploadOpen(true); }}><Upload className="h-4 w-4" />Adicionar documento</Button>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Categorias">
        {(["", ...documentCategories.filter((item) => visibleCategories.includes(item))] as const).map((item) => {
          const count = item ? data?.counts[item] : data?.counts.all;
          const active = category === item;
          return <button key={item || "all"} type="button" aria-pressed={active} onClick={() => resetPage(setCategory)(item)} className={cn("min-w-[120px] shrink-0 rounded-lg border p-3 text-left transition hover:border-primary/50", active ? "border-primary bg-primary/5" : "border-border bg-card")}>
            <span className="block text-xs font-medium leading-tight text-muted-foreground">{item ? documentCategoryLabels[item] : "Todos"}</span>
            <strong className="mt-2 block text-xl text-foreground">{count ?? "–"}</strong>
          </button>;
        })}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
        <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">Buscar documentos</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" placeholder="Buscar documentos..." value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <FilterSelect label="Data" value={period} onChange={(value) => { setPeriod(value); setPresetFrom(value && value !== "custom" ? isoDay(new Date(Date.now() - Number(value) * 86_400_000)) : ""); setPage(1); }}>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</FilterSelect>
        <FilterSelect label="Profissional" value={professional} onChange={resetPage(setProfessional)}><option value="">Todos</option>{(data?.professionals ?? []).map((name) => <option key={name} value={name}>{name}</option>)}</FilterSelect>
        <FilterSelect label="Tratamento" value={journeyId} onChange={resetPage(setJourneyId)}><option value="">Todos</option>{journeys.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</FilterSelect>
        <FilterSelect label="Ordenar por" value={sort} onChange={resetPage(setSort)}><option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option><option value="name">Nome (A-Z)</option></FilterSelect>
      </div>
      {period === "custom" ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><label className="flex items-center gap-2">De<input className="text-sm h-9 rounded-md border border-input px-2" type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} /></label><label className="flex items-center gap-2">até<input className="text-sm h-9 rounded-md border border-input px-2" type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} /></label></div> : null}
      {data?.access.canArchive ? <label className="mt-3 flex w-fit items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); }} />Mostrar arquivados</label> : null}

      <div className="mt-4">
        {loading && !data ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} className="h-40 w-full" />)}</div>
          : error && !data ? <EmptyState title="Não foi possível carregar os documentos" description="Verifique sua conexão e tente novamente." action={<Button size="sm" variant="outline" onClick={retry}>Tentar novamente</Button>} />
            : data && data.total === 0 ? <EmptyState title={archived ? "Nenhum documento arquivado" : query || category || period || professional || journeyId ? "Nenhum documento encontrado" : "Nenhum documento ainda"} description={query || category ? "Ajuste a busca ou os filtros." : "Arraste arquivos para cá ou use Adicionar documento (PDF, JPG, PNG ou WEBP até 4 MB)."} />
              : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data?.items.map((item) => <DocumentCard key={item.id} item={item} patientId={patientId} access={data.access} onView={() => setPreview(item)} onEdit={() => setEditing(item)} onDelete={() => setDeleting(item)} onArchive={(value) => void patch(item, { archived: value }, value ? "Documento arquivado." : "Documento restaurado.")} onOpenOrigin={() => item.kind === "anamnesis" ? onOpenAnamnesis() : item.originRef ? onOpenEvaluation(item.originRef) : undefined} />)}</div>}
      </div>

      {data && data.total > 0 ? <PaginationBar page={page} pageSize={pageSize} total={data.total} sizes={documentPageSizes} noun={["documento", "documentos"]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} /> : null}
    </Card>

    <UploadSheet open={uploadOpen} onOpenChange={setUploadOpen} patientId={patientId} initialFiles={pendingFiles} categories={visibleCategories} journeys={journeys} canClinical={canClinical} onUploaded={refresh} defaultCategory={category && isDocumentCategory(category) ? category : ""} maxBytes={data?.access.maxUploadBytes ?? 4 * 1024 * 1024} />
    <PreviewModal item={preview} patientId={patientId} onClose={() => setPreview(null)} />
    <EditModal item={editing} journeys={journeys} categories={visibleCategories} patientId={patientId} onClose={() => setEditing(null)} onSave={async (body) => { if (editing && await patch(editing, body, "Documento atualizado.")) setEditing(null); }} />
    <DeleteModal item={deleting} onClose={() => setDeleting(null)} onConfirm={async (reason) => {
      if (!deleting) return;
      const result = await sendJson(`${base(patientId)}/${encodeURIComponent(deleting.id)}`, "DELETE", { confirm: true, reason });
      if (!result.ok) { toast.error(result.message); return; }
      refresh(); toast.success("Documento excluído definitivamente."); setDeleting(null);
    }} />
  </div>;
}


export function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="block rounded-lg border border-input bg-background px-3 py-1.5"><span className="block text-xs text-muted-foreground">{label}</span><select className="w-full bg-transparent text-sm font-medium outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function FileGlyph({ item, patientId }: { item: DocumentItem; patientId: string }) {
  if (item.system) return <span className="grid h-11 w-11 place-items-center rounded-lg bg-primary/10 text-primary"><ClipboardList className="h-5 w-5" aria-hidden="true" /></span>;
  if (item.mimeType?.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- bytes vêm de rota autenticada por cookie ou data URL; o otimizador do next/image não tem a sessão
    return <img alt="" loading="lazy" className="h-11 w-11 rounded-lg border border-border object-cover" src={`${base(patientId)}/${encodeURIComponent(item.id)}/file?thumb=1`} />;
  }
  return <span className="grid h-11 w-11 place-items-center rounded-lg bg-red-50 text-red-500"><FileText className="h-5 w-5" aria-hidden="true" /></span>;
}

function DocumentCard({ item, patientId, access, onView, onEdit, onDelete, onArchive, onOpenOrigin }: {
  item: DocumentItem; patientId: string; access: DocumentsResponse["access"]; onView: () => void; onEdit: () => void; onDelete: () => void; onArchive: (archived: boolean) => void; onOpenOrigin: () => void;
}) {
  const ext = item.mimeType === "application/pdf" ? "PDF" : item.mimeType?.split("/")[1]?.toUpperCase().replace("JPEG", "JPG");
  return <article className={cn("flex flex-col rounded-lg border border-border bg-card p-3", item.archived && "opacity-70")}>
    <div className="flex items-start justify-between gap-2">
      <FileGlyph item={item} patientId={patientId} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label={`Ações de ${item.name}`}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {item.system ? <DropdownMenuItem onSelect={onOpenOrigin}><ExternalLink className="h-4 w-4" />Abrir registro</DropdownMenuItem> : <>
            <DropdownMenuItem onSelect={onView}><Eye className="h-4 w-4" />Visualizar</DropdownMenuItem>
            <DropdownMenuItem asChild><a href={`${base(patientId)}/${encodeURIComponent(item.id)}/file?download=1`}><Download className="h-4 w-4" />Baixar</a></DropdownMenuItem>
            {!item.archived ? <DropdownMenuItem onSelect={onEdit}><PenLine className="h-4 w-4" />Renomear / categorizar / vincular</DropdownMenuItem> : null}
            {access.canArchive ? <DropdownMenuItem onSelect={() => onArchive(!item.archived)}>{item.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{item.archived ? "Restaurar" : "Arquivar"}</DropdownMenuItem> : null}
            {access.canDelete ? <><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onSelect={onDelete}><Trash2 className="h-4 w-4" />Excluir definitivamente</DropdownMenuItem></> : null}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <button type="button" className="mt-2 truncate text-left text-sm font-bold hover:text-primary" title={item.name} onClick={item.system ? onOpenOrigin : onView}>{item.name}</button>
    <span className={cn("mt-1 w-fit rounded-full px-2 py-0.5 text-xs font-semibold", categoryTone[item.category])}>{documentCategoryLabels[item.category]}</span>
    <p className="mt-2 text-xs text-muted-foreground">{item.system ? "Registro do sistema" : `${ext} • ${formatBytes(item.sizeBytes ?? 0)}`}</p>
    <p className="text-xs text-muted-foreground">{formatDate(item.date)}{formatTime(item.date) ? ` • ${formatTime(item.date)}` : ""}</p>
    <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><UserRound className="h-3 w-3 shrink-0" aria-hidden="true" />{item.professional || "Não informado"}</p>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {item.system ? <Badge variant="blue">{item.status}</Badge> : item.signatureStatus && item.signatureStatus !== "NAO_APLICAVEL" ? <Badge variant={item.signatureStatus === "ASSINADO" ? "green" : "amber"}>{signatureLabels[item.signatureStatus]}</Badge> : null}
      {item.archived ? <Badge variant="slate">Arquivado</Badge> : null}
      {item.journeyId || item.encounterId ? <Badge variant="outline"><Link2 className="mr-1 h-3 w-3" aria-hidden="true" />Vinculado</Badge> : null}
    </div>
  </article>;
}

function PreviewModal({ item, patientId, onClose }: { item: DocumentItem | null; patientId: string; onClose: () => void }) {
  const url = item ? `${base(patientId)}/${encodeURIComponent(item.id)}/file` : "";
  return <Modal open={Boolean(item)} onClose={onClose} title={item?.name ?? "Documento"} description={item ? `${documentCategoryLabels[item.category]} • ${formatBytes(item.sizeBytes ?? 0)}` : undefined}>
    {item ? <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- bytes vêm de rota autenticada por cookie ou data URL; o otimizador do next/image não tem a sessão */}
      <div className="overflow-hidden rounded-md border border-border bg-muted">{item.mimeType === "application/pdf" ? <iframe title={item.name} src={url} className="h-[60dvh] w-full" /> : <img alt={item.name} src={url} className="max-h-[60dvh] w-full object-contain" />}</div>
      <div className="flex justify-end gap-2"><Button variant="outline" asChild><a href={`${url}?download=1`}><Download className="h-4 w-4" />Baixar</a></Button><Button onClick={onClose}>Fechar</Button></div>
    </div> : null}
  </Modal>;
}

function EditModal({ item, journeys, categories, patientId, onClose, onSave }: { item: DocumentItem | null; journeys: JourneyOption[]; categories: DocumentCategory[]; patientId: string; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  return <Modal open={Boolean(item)} onClose={onClose} title="Editar documento" description="Renomeie, escolha a categoria e vincule a um tratamento ou atendimento.">
    {item ? <EditForm key={item.id} item={item} journeys={journeys} categories={categories} patientId={patientId} onClose={onClose} onSave={onSave} /> : null}
  </Modal>;
}

function EditForm({ item, journeys, categories, patientId, onClose, onSave }: { item: DocumentItem; journeys: JourneyOption[]; categories: DocumentCategory[]; patientId: string; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const canClinical = useCan("clinical:read");
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState<DocumentCategory>(item.category);
  const [journeyId, setJourneyId] = useState(item.journeyId ?? "");
  const [encounter, setEncounter] = useState(item.encounterType && item.encounterId ? `${item.encounterType}:${item.encounterId}` : "");
  const [signature, setSignature] = useState<SignatureStatus>(item.signatureStatus ?? "NAO_APLICAVEL");
  const [saving, setSaving] = useState(false);
  const encounters = useCachedResource<EncountersResponse>(canClinical ? encountersKey(patientId) : "");
  const options = (encounters.data?.items ?? []).filter((entry) => !journeyId || entry.journeyId === journeyId);
  return <form className="space-y-3" onSubmit={async (event) => {
    event.preventDefault(); setSaving(true);
    const [encounterType, encounterId] = encounter ? encounter.split(":") : [null, null];
    await onSave({ name, category, signatureStatus: signature, journeyId: journeyId || null, encounterType, encounterId });
    setSaving(false);
  }}>
    <label className="block text-xs font-semibold">Nome<input className="mt-1 h-10 w-full rounded-md border border-input px-3 text-sm" value={name} maxLength={160} required onChange={(event) => setName(event.target.value)} /></label>
    <label className="block text-xs font-semibold">Categoria<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)}>{categories.map((entry) => <option key={entry} value={entry}>{documentCategoryLabels[entry]}</option>)}</select></label>
    <label className="block text-xs font-semibold">Tratamento<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={journeyId} onChange={(event) => { setJourneyId(event.target.value); setEncounter(""); }}><option value="">Sem vínculo</option>{journeys.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    {canClinical ? <label className="block text-xs font-semibold">Atendimento<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={encounter} onChange={(event) => setEncounter(event.target.value)}><option value="">Sem vínculo</option>{options.map((entry) => <option key={entry.key} value={`${entry.type}:${entry.id}`}>{entry.title} · {formatDate(entry.occurredAt)}</option>)}</select></label> : null}
    <label className="block text-xs font-semibold">Assinatura (registro manual)<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={signature} onChange={(event) => setSignature(event.target.value as SignatureStatus)}>{signatureStatuses.map((entry) => <option key={entry} value={entry}>{signatureLabels[entry]}</option>)}</select></label>
    <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Salvando..." : "Salvar"}</Button></div>
  </form>;
}

function DeleteModal({ item, onClose, onConfirm }: { item: DocumentItem | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return <Modal open={Boolean(item)} onClose={() => { setReason(""); setConfirmed(false); onClose(); }} title="Excluir definitivamente" description="Esta ação não pode ser desfeita.">
    <div className="space-y-3 text-xs">
      <p className="rounded-md bg-destructive/10 p-3 text-destructive">O arquivo <strong>{item?.name}</strong> e seu conteúdo serão apagados. Fica apenas um registro de auditoria (quem excluiu, quando, nome e categoria), sem o conteúdo. Para só ocultar, use Arquivar.</p>
      <label className="block font-semibold">Motivo (opcional)<input className="mt-1 h-10 w-full rounded-md border border-input px-3 text-sm" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Entendo que a exclusão é definitiva.</label>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button variant="destructive" disabled={!confirmed || busy} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); setReason(""); setConfirmed(false); }}>{busy ? "Excluindo..." : "Excluir definitivamente"}</Button></div>
    </div>
  </Modal>;
}

type Queued = UploadEntry & { file: File };

function UploadSheet({ open, onOpenChange, ...props }: {
  open: boolean; onOpenChange: (open: boolean) => void; patientId: string; initialFiles: File[]; categories: DocumentCategory[]; journeys: JourneyOption[]; canClinical: boolean; onUploaded: () => void; defaultCategory: DocumentCategory | ""; maxBytes: number;
}) {
  const [busy, setBusy] = useState(false);
  return <Sheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title="Adicionar documento" side="right" className="w-[min(26rem,100vw)]">{open ? <UploadPanel {...props} onBusyChange={setBusy} /> : null}</Sheet>;
}

function toQueued(files: File[], maxBytes: number): Queued[] {
  return files.map((file, index) => {
    const tooBig = !isImageFile(file) && file.size > maxBytes;
    return { id: `${index}-${file.name}-${file.size}`, file, name: file.name, status: tooBig ? "error" : "queued", progress: 0, error: tooBig ? "O arquivo excede 4 MB." : undefined } satisfies Queued;
  });
}

function UploadPanel({ patientId, initialFiles, categories, journeys, canClinical, onUploaded, defaultCategory, maxBytes, onBusyChange }: {
  onBusyChange: (busy: boolean) => void; patientId: string; initialFiles: File[]; categories: DocumentCategory[]; journeys: JourneyOption[]; canClinical: boolean; onUploaded: () => void; defaultCategory: DocumentCategory | ""; maxBytes: number;
}) {
  const [category, setCategory] = useState<DocumentCategory | "">(defaultCategory);
  const [journeyId, setJourneyId] = useState("");
  const [signature, setSignature] = useState<SignatureStatus>("NAO_APLICAVEL");
  const [entries, setEntries] = useState<Queued[]>(() => toQueued(initialFiles, maxBytes));
  const [busy, setBusyState] = useState(false);
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange(value); };
  const input = useRef<HTMLInputElement>(null);

  function addFiles(files: File[]) {
    setEntries((current) => [...current, ...toQueued(files, maxBytes).map((entry, index) => ({ ...entry, id: `${current.length + index}-${entry.id}` }))]);
  }
  const update = (id: string, patch: Partial<Queued>) => setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));

  async function start() {
    if (!category) { toast.error("Escolha a categoria dos documentos."); return; }
    setBusy(true);
    let sent = 0;
    for (const entry of entries.filter((item) => item.status === "queued" || item.status === "error")) {
      if (entry.status === "error" && entry.file.size > maxBytes && !isImageFile(entry.file)) continue;
      update(entry.id, { status: "uploading", progress: 0, error: undefined });
      const form = new FormData();
      let blob: Blob = entry.file;
      let fileName = entry.file.name;
      if (isImageFile(entry.file)) {
        const prepared = await prepareImage(entry.file);
        if ("error" in prepared) { update(entry.id, { status: "error", error: prepared.error }); continue; }
        blob = prepared.blob; fileName = prepared.name;
      }
      form.set("file", blob, fileName);
      form.set("category", category); form.set("signatureStatus", signature);
      if (journeyId) form.set("journeyId", journeyId);
      const result = await postForm(`${base(patientId)}`, form, (percent) => update(entry.id, { progress: percent }));
      if (result.ok) { sent += 1; update(entry.id, { status: "done", progress: 100 }); } else update(entry.id, { status: "error", error: result.body?.message ?? "Não foi possível enviar." });
    }
    setBusy(false);
    if (sent) { onUploaded(); toast.success(sent === 1 ? "Documento enviado." : `${sent} documentos enviados.`); }
  }

  const pending = entries.filter((entry) => entry.status === "queued" || (entry.status === "error" && (isImageFile(entry.file) || entry.file.size <= maxBytes)));
  return <div className="space-y-4 p-4 text-xs">
      <div role="button" tabIndex={0} className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-8 text-center transition hover:bg-primary/10" onClick={() => input.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addFiles(Array.from(event.dataTransfer.files)); }}>
        <Upload className="h-6 w-6 text-primary" aria-hidden="true" /><strong className="mt-2 text-sm">Arraste arquivos aqui</strong><span className="mt-1 text-muted-foreground">ou clique para escolher (um ou vários)</span><span className="mt-2 text-xs text-muted-foreground">PDF, JPG, PNG ou WEBP · até 4 MB por arquivo</span>
      </div>
      <input ref={input} className="sr-only" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <label className="block font-semibold">Categoria *<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={category} onChange={(event) => setCategory(event.target.value as DocumentCategory)}><option value="">Selecione</option>{categories.map((entry) => <option key={entry} value={entry}>{documentCategoryLabels[entry]}</option>)}</select></label>
      <label className="block font-semibold">Tratamento (opcional)<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={journeyId} onChange={(event) => setJourneyId(event.target.value)}><option value="">Sem vínculo</option>{journeys.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label className="block font-semibold">Assinatura<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={signature} onChange={(event) => setSignature(event.target.value as SignatureStatus)}>{signatureStatuses.map((entry) => <option key={entry} value={entry}>{signatureLabels[entry]}</option>)}</select></label>
      {entries.length ? <ul className="space-y-2" aria-label="Arquivos para enviar">{entries.map((entry) => <li key={entry.id} className="rounded-md border border-border p-2">
        <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2">{isImageFile(entry.file) ? <FileImage className="h-4 w-4 shrink-0 text-primary" /> : <FileText className="h-4 w-4 shrink-0 text-red-500" />}<span className="truncate font-medium">{entry.name}</span></span>
          {entry.status === "queued" || entry.status === "error" ? <button type="button" aria-label={`Remover ${entry.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><X className="h-4 w-4" /></button> : <span className="text-xs text-muted-foreground">{entry.status === "done" ? "Enviado" : `${entry.progress}%`}</span>}</div>
        {entry.status === "uploading" || entry.status === "done" ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", entry.status === "done" ? "bg-success" : "bg-primary")} style={{ width: `${entry.progress}%` }} /></div> : null}
        {entry.error ? <p role="alert" className="mt-1 text-xs text-destructive">{entry.error}</p> : null}
      </li>)}</ul> : null}
      <Button className="w-full" disabled={busy || !pending.length || !category} onClick={() => void start()}>{busy ? "Enviando..." : pending.length > 1 ? `Enviar ${pending.length} arquivos` : "Enviar"}</Button>
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
        <p className="flex items-center gap-1.5 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />Segurança dos documentos</p>
        <ul className="mt-1.5 space-y-1"><li className="flex gap-1.5"><Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />Armazenamento privado: só abre com login e permissão.</li><li>O tipo do arquivo é verificado pelo conteúdo, não pela extensão.</li><li>Envio, visualização, download e alterações ficam registrados.</li>{canClinical ? null : <li>Seu perfil envia e vê Termos, Declarações e Orientações.</li>}</ul>
      </div>
  </div>;
}
