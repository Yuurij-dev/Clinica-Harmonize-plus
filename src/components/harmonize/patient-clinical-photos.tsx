"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArchiveRestore, Camera, ChevronDown, ChevronLeft, ChevronRight, Columns2, Download, Eye, EyeOff, Filter, Images, PenLine, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { Sheet } from "@/components/ui/sheet";
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";
import { photoCategoryNames, photoPageSizes, photoPhases } from "@/lib/clinical-files-rules";
import {
  beforeAfterPairs, countByView, defaultPhotoFilters, encounterKindLabels, filterPhotos, groupByEncounter, groupByProcedure, neighbors, photoPhaseLabels, visiblePhotos,
  type BeforeAfterPair, type GalleryPhase, type GalleryPhoto, type GalleryView, type PhotoFilters, type ProcedureGroup,
} from "@/lib/photo-gallery-rules";
import { pollOutcomeForStatus } from "@/lib/evaluation-photo-sync-rules";
import { IncomingPhotoStatus } from "./incoming-photo-status";
import { usePhotoSyncPoll } from "./use-photo-sync-poll";
import { cn } from "@/lib/utils";
import { PaginationBar } from "./clinical-pagination";
import { postForm, prepareImage, sendJson, type UploadEntry } from "./clinical-upload";
import { formatDate, formatTime, useCachedResource } from "./patient-clinical-data";
import { EmptyState, LoadingSkeleton } from "./shared";

type PhotosResponse = {
  stamp?: string; photos: GalleryPhoto[]; journeys: Array<{ id: string; name: string }>;
  encounters: Array<{ type: "evaluation" | "session"; id: string; journeyId: string | null; title: string; date: string }>;
  access: { canWrite: boolean; canArchive: boolean; canDelete: boolean; maxUploadBytes: number };
};

const base = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/photos`;
const imageUrl = (patientId: string, photo: GalleryPhoto, extra = "") => `${base(patientId)}/${encodeURIComponent(photo.id)}/image${extra}`;
const viewLabels: Array<{ id: GalleryView; label: string }> = [{ id: "all", label: "Todas" }, { id: "evaluations", label: "Avaliações" }, { id: "procedures", label: "Procedimentos" }, { id: "evolutions", label: "Evoluções" }, { id: "beforeafter", label: "Antes e depois" }];
const periods = [{ id: "", label: "Todos os períodos" }, { id: "30", label: "Últimos 30 dias" }, { id: "90", label: "Últimos 90 dias" }, { id: "365", label: "Último ano" }, { id: "custom", label: "Personalizado" }];
const isoDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(date);

export function PatientClinicalPhotos({ patientId, initialFilters }: { patientId: string; initialFilters?: Partial<PhotoFilters> }) {
  const key = base(patientId);
  const { data, loading, error, retry } = useCachedResource<PhotosResponse>(key);
  const [filters, setFilters] = useState<PhotoFilters>({ ...defaultPhotoFilters, ...initialFilters });
  const [period, setPeriod] = useState("");
  const [presetFrom, setPresetFrom] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [compare, setCompare] = useState<BeforeAfterPair | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [pageSize, setPageSize] = useState(photoPageSizes[0]);
  const [pageState, setPageState] = useState({ sig: "", page: 1 });

  const patch = (change: Partial<PhotoFilters>) => setFilters((current) => ({ ...current, ...change }));
  const pool = useMemo(() => visiblePhotos(data?.photos ?? [], showArchived), [data, showArchived]);
  const effective = useMemo(() => {
    const filtersWithPeriod = { ...filters };
    if (period && period !== "custom") { filtersWithPeriod.from = presetFrom; filtersWithPeriod.to = ""; }
    return filtersWithPeriod;
  }, [filters, period, presetFrom]);
  const filtered = useMemo(() => filterPhotos(pool, effective), [pool, effective]);
  const counts = useMemo(() => countByView(pool), [pool]);
  const procedures = useMemo(() => groupByProcedure(filtered), [filtered]);
  const canWrite = data?.access.canWrite ?? false;
  const ownRefreshAtRef = useRef(0);
  const refresh = useCallback(() => { ownRefreshAtRef.current = Date.now(); invalidateClientCache(key); }, [key]);
  // Fotos enviadas pelo app mobile não passam por este navegador. A cada ~5 s (aba visível, com backoff em falha) consulta só a assinatura da galeria
  // (4 agregados, sem fotos); o índice completo só é refeito quando ela muda. O spinner dura até a lista chegar (mínimo ~600 ms).
  const seenIdsRef = useRef<Set<string> | null>(null);
  const stampRef = useRef<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const receivingRef = useRef(false);
  const pendingRef = useRef(false);
  useEffect(() => { seenIdsRef.current = null; stampRef.current = null; receivingRef.current = false; }, [key]);
  usePhotoSyncPoll(true, async () => {
    const response = await fetch(`${key}?stamp=1`, { cache: "no-store" });
    const outcome = pollOutcomeForStatus(response.status);
    if (outcome !== "ok") return outcome;
    const stamp = (await response.json() as { stamp?: string }).stamp ?? null;
    // A base de comparação é a assinatura da lista carregada (data.stamp), não o primeiro poll: envio logo após o carregamento é detectado.
    // Enquanto a lista nova não chega (pendingRef) não refaz o pedido.
    if (stampRef.current === null || stamp === null || stamp === stampRef.current || pendingRef.current) return "ok";
    const own = Date.now() - ownRefreshAtRef.current < 10_000; // mudança causada por esta própria tela: atualiza sem anunciar
    pendingRef.current = true;
    window.setTimeout(() => { pendingRef.current = false; }, 10_000);
    invalidateClientCache(key);
    if (!own) { receivingRef.current = true; setReceiving(true); window.setTimeout(() => { receivingRef.current = false; setReceiving(false); }, 10_000); }
    return "ok";
  });
  // Id nunca visto que chegou na lista = foto nova: encerra o spinner e avisa uma vez (só se a mudança veio da checagem, não de upload daqui).
  useEffect(() => {
    if (!data) return;
    stampRef.current = data.stamp ?? null;
    pendingRef.current = false;
    const ids = data.photos.map((photo) => photo.id);
    const seen = seenIdsRef.current;
    seenIdsRef.current = new Set(ids);
    if (!seen) return;
    const fresh = ids.filter((id) => !seen.has(id));
    if (receivingRef.current) { receivingRef.current = false; setReceiving(false); }
    if (fresh.length && Date.now() - ownRefreshAtRef.current >= 10_000) toast.success(`${fresh.length} foto${fresh.length > 1 ? "s" : ""} recebida${fresh.length > 1 ? "s" : ""} do aplicativo.`);
  }, [data]);
  // Paginação dos cards (um por procedimento). Mudar filtros, busca ou o tamanho da página volta à página 1.
  const pageSignature = JSON.stringify([effective, showArchived, pageSize]);
  const pagedTotal = procedures.length;
  const pageCount = Math.max(1, Math.ceil(pagedTotal / pageSize));
  const page = Math.min(pageState.sig === pageSignature ? pageState.page : 1, pageCount);
  const setPage = (next: number) => setPageState({ sig: pageSignature, page: next });
  const pageStart = (page - 1) * pageSize;
  const pagedProcedures = procedures.slice(pageStart, pageStart + pageSize);
  const encounterOptions = useMemo(() => groupByEncounter(pool).filter((group) => !filters.journeyId || group.photos.some((photo) => photo.journeyId === filters.journeyId)), [pool, filters.journeyId]);

  const viewerPhoto = viewerId ? pool.find((photo) => photo.id === viewerId) ?? null : null;
  // Voltar/avançar percorre só as fotos do procedimento (card) da foto aberta.
  const viewerGroup = viewerPhoto ? procedures.find((group) => group.photos.some((photo) => photo.id === viewerPhoto.id)) ?? null : null;
  const viewerList = viewerGroup ? viewerGroup.photos : viewerPhoto ? [viewerPhoto] : [];


  function openFiles(files: FileList | File[] | null) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setUploadFiles(list); setUploadOpen(true);
  }

  return <div className="space-y-4" onDragOver={(event) => { if (canWrite && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (!canWrite) return; event.preventDefault(); openFiles(event.dataTransfer.files); }}>
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Images className="h-5 w-5" aria-hidden="true" /></span>
          <div><h3 className="text-base font-bold">Fotos clínicas</h3><p className="mt-0.5 text-xs text-muted-foreground">Registros fotográficos do paciente organizados por atendimento e procedimento.</p></div>
        </div>
        {canWrite ? <div className="flex items-center gap-1">
          <Button onClick={() => { setUploadFiles([]); setUploadOpen(true); }}><Upload className="h-4 w-4" />Adicionar fotos</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" aria-label="Mais formas de adicionar"><ChevronDown className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setUploadFiles([]); setUploadOpen(true); }}><Upload className="h-4 w-4" />Enviar do dispositivo</DropdownMenuItem><DropdownMenuItem onSelect={() => cameraInput.current?.click()}><Camera className="h-4 w-4" />Tirar foto com a câmera</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          <input ref={cameraInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => { openFiles(event.target.files); event.target.value = ""; }} />
        </div> : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Visões">
        {viewLabels.map((item) => <button key={item.id} type="button" aria-pressed={filters.view === item.id} onClick={() => patch({ view: item.id, encounterKey: "" })} className={cn("rounded-full border px-4 py-1.5 text-xs font-medium transition", filters.view === item.id ? "border-primary bg-primary/5 text-primary" : "border-border hover:border-primary/40")}>{item.label}<span className="ml-1.5 text-xs text-muted-foreground">{counts[item.id]}</span></button>)}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
        <label className="relative sm:col-span-2 lg:col-span-1"><span className="sr-only">Buscar fotos</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm" placeholder="Buscar fotos..." value={filters.q} onChange={(event) => patch({ q: event.target.value })} /></label>
        <Select label="Tratamento" value={filters.journeyId} onChange={(value) => patch({ journeyId: value, encounterKey: "" })}><option value="">Todos</option>{(data?.journeys ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <Select label="Atendimento" value={filters.encounterKey} onChange={(value) => patch({ encounterKey: value })}><option value="">Todos</option>{encounterOptions.map((group) => <option key={group.key} value={group.key}>{group.title} · {formatDate(group.date)}</option>)}</Select>
        <Select label="Período" value={period} onChange={(value) => { setPeriod(value); setPresetFrom(value && value !== "custom" ? isoDay(new Date(Date.now() - Number(value) * 86_400_000)) : ""); if (value !== "custom") patch({ from: "", to: "" }); }}>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select>
        <Button variant="outline" className="h-11" aria-expanded={moreFilters} aria-label="Mais filtros" onClick={() => setMoreFilters((value) => !value)}><Filter className="h-4 w-4" /></Button>
      </div>
      {period === "custom" ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><label className="flex items-center gap-2">De<input className="text-sm h-9 rounded-md border border-input px-2" type="date" value={filters.from} onChange={(event) => patch({ from: event.target.value })} /></label><label className="flex items-center gap-2">até<input className="text-sm h-9 rounded-md border border-input px-2" type="date" value={filters.to} onChange={(event) => patch({ to: event.target.value })} /></label></div> : null}
      {moreFilters ? <div className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <label className="flex items-center gap-2">Categoria<select className="text-sm h-9 rounded-md border border-input bg-background px-2" value={filters.category} onChange={(event) => patch({ category: event.target.value })}><option value="">Todas</option>{photoCategoryNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        {data?.access.canArchive ? <label className="flex items-center gap-2"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Mostrar arquivadas</label> : null}
        <Button size="sm" variant="ghost" onClick={() => { setFilters(defaultPhotoFilters); setPeriod(""); }}>Limpar filtros</Button>
      </div> : null}

      <div className="mt-4">
        <IncomingPhotoStatus active={receiving} />
        {loading && !data ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((item) => <LoadingSkeleton key={item} className="aspect-[4/3] w-full" />)}</div>
          : error && !data ? <EmptyState title="Não foi possível carregar as fotos" description="Verifique sua conexão e tente novamente." action={<Button size="sm" variant="outline" onClick={retry}>Tentar novamente</Button>} />
            : filtered.length === 0 ? <EmptyState title={pool.length ? "Nenhuma foto encontrada" : "Nenhuma foto registrada"} description={pool.length ? "Ajuste a busca ou os filtros." : "As fotos de avaliações, procedimentos e retornos aparecem aqui automaticamente. Você também pode adicionar fotos."} />
              : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{pagedProcedures.map((group) => <ProcedureCard key={group.key} patientId={patientId} group={group} onOpen={setViewerId} onCompare={setCompare} />)}</div>}
      </div>

      {data && pagedTotal > 0 ? <PaginationBar page={page} pageSize={pageSize} total={pagedTotal} sizes={photoPageSizes} noun={["procedimento", "procedimentos"]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPageState({ sig: "", page: 1 }); }} /> : null}
    </Card>

    {/* Com o comparador aberto, o visualizador some (sem perder a foto atual) e volta ao fechar o comparador. */}
    <PhotoViewer patientId={patientId} photo={compare ? null : viewerPhoto} title={viewerGroup?.title} list={viewerList} access={data?.access} pairs={beforeAfterPairs(pool)} onNavigate={setViewerId} onClose={() => setViewerId(null)} onCompare={setCompare}
      onEdit={async (photo, body, message) => { const result = await sendJson(`${base(patientId)}/${encodeURIComponent(photo.id)}`, "PATCH", body); if (!result.ok) { toast.error(result.message); return false; } refresh(); toast.success(message); return true; }}
      onDelete={async (photo, reason) => { const result = await sendJson(`${base(patientId)}/${encodeURIComponent(photo.id)}`, "DELETE", { confirm: true, reason }); if (!result.ok) { toast.error(result.message); return false; } refresh(); toast.success("Foto excluída definitivamente."); setViewerId(null); return true; }}
      journeys={data?.journeys ?? []} encounters={data?.encounters ?? []} />
    <CompareModal patientId={patientId} pair={compare} onClose={() => setCompare(null)} />
    <PhotoUploadSheet open={uploadOpen} onOpenChange={setUploadOpen} patientId={patientId} initialFiles={uploadFiles} journeys={data?.journeys ?? []} encounters={data?.encounters ?? []} onUploaded={refresh} />
  </div>;
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="block rounded-lg border border-input bg-background px-3 py-1.5"><span className="block text-xs text-muted-foreground">{label}</span><select className="w-full bg-transparent text-sm font-medium outline-none" value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function Thumb({ patientId, photo }: { patientId: string; photo: GalleryPhoto }) {
  // Miniatura sob demanda pela rota autenticada; nunca base64 em lista.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt={`${photo.name} · ${photo.category}`} loading="lazy" decoding="async" className="h-full w-full object-cover object-top" src={imageUrl(patientId, photo)} />;
}

// Um procedimento por card, com as fotos de antes, depois e evolução juntas.
const maxCardThumbs = 6;
function ProcedureCard({ patientId, group, onOpen, onCompare }: { patientId: string; group: ProcedureGroup; onOpen: (photoId: string) => void; onCompare: (pair: BeforeAfterPair) => void }) {
  const hidden = group.photos.length - maxCardThumbs;
  const shown = hidden > 0 ? group.photos.slice(0, maxCardThumbs - 1) : group.photos;
  const pair = group.hasPair ? beforeAfterPairs(group.photos)[0] : undefined;
  return <article className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-3">
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Images className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold max-lg:whitespace-normal max-lg:break-words">{group.title}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(group.date)}{formatTime(group.date) ? ` • ${formatTime(group.date)}` : ""}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><Badge variant="blue">{encounterKindLabels[group.kind]}</Badge>{group.journeyName ? <span className="truncate">{group.journeyName}</span> : null}</p></div>
    </div>
    <div className="mt-3 grid grid-cols-3 gap-1.5">
      {shown.map((photo) => <button key={photo.id} type="button" onClick={() => onOpen(photo.id)} className="group min-w-0 text-left" aria-label={`Abrir foto ${photoPhaseLabels[photo.phase]} · ${photo.name}`}>
        <span className={cn("relative block aspect-[3/4] overflow-hidden rounded-md bg-muted", photo.archived && "opacity-60")}><Thumb patientId={patientId} photo={photo} />
          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-xs font-semibold text-white">{photoPhaseLabels[photo.phase]}</span>
          {photo.hasAnnotations ? <span className="absolute bottom-1 right-1 rounded bg-primary px-1 py-0.5 text-xs font-semibold text-white">Marcações</span> : null}
          {photo.archived ? <span className="absolute inset-0 grid place-items-center bg-black/50 text-xs font-semibold text-white">Arquivada</span> : null}</span>
      </button>)}
      {hidden > 0 ? <button type="button" className="grid aspect-[3/4] place-items-center rounded-md bg-muted text-lg font-bold text-muted-foreground hover:bg-accent" onClick={() => onOpen(group.photos[maxCardThumbs - 1].id)} aria-label={`Ver mais ${hidden + 1} fotos`}>+{hidden + 1}</button> : null}
    </div>
    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{group.photos.length} {group.photos.length === 1 ? "foto" : "fotos"}</span>
      {pair ? <Button size="sm" variant="outline" onClick={() => onCompare(pair)}><Columns2 className="h-4 w-4" />Comparar</Button> : null}
    </div>
  </article>;
}

type Annotation = { id: string; type: string; color: string; strokeWidth: number; points?: number[]; x?: number; y?: number; width?: number; height?: number; text?: string; fontSize?: number; radius?: number };

function AnnotationLayer({ annotations, width, height }: { annotations: Annotation[]; width: number; height: number }) {
  return <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{annotations.map((item) => {
    const stroke = item.color; const strokeWidth = item.strokeWidth;
    if (["freehand", "line", "curve", "arrow"].includes(item.type) && item.points && item.points.length >= 4) {
      const pairs: string[] = []; for (let index = 0; index + 1 < item.points.length; index += 2) pairs.push(`${item.points[index]},${item.points[index + 1]}`);
      const last = item.points.length; const [x1, y1, x2, y2] = [item.points[last - 4], item.points[last - 3], item.points[last - 2], item.points[last - 1]];
      const angle = Math.atan2(y2 - y1, x2 - x1); const size = Math.max(10, strokeWidth * 4);
      return <g key={item.id}><polyline points={pairs.join(" ")} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />{item.type === "arrow" ? <polygon fill={stroke} points={`${x2},${y2} ${x2 - size * Math.cos(angle - 0.4)},${y2 - size * Math.sin(angle - 0.4)} ${x2 - size * Math.cos(angle + 0.4)},${y2 - size * Math.sin(angle + 0.4)}`} /> : null}</g>;
    }
    if (item.type === "ellipse") { const w = Math.abs(item.width ?? 0); const h = Math.abs(item.height ?? 0); const x = Math.min(item.x ?? 0, (item.x ?? 0) + (item.width ?? 0)); const y = Math.min(item.y ?? 0, (item.y ?? 0) + (item.height ?? 0)); return <ellipse key={item.id} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={strokeWidth} />; }
    if (item.type === "point") return <circle key={item.id} cx={item.x} cy={item.y} r={item.radius ?? 6} fill={stroke} />;
    if (item.type === "text") return <text key={item.id} x={item.x} y={(item.y ?? 0) + (item.fontSize ?? 16)} fill={stroke} fontSize={item.fontSize ?? 16} fontFamily="Inter, Arial, sans-serif">{item.text}</text>;
    return null;
  })}</svg>;
}

function PhotoViewer({ patientId, photo, title, list, access, pairs, onNavigate, onClose, onCompare, onEdit, onDelete, journeys, encounters }: {
  patientId: string; photo: GalleryPhoto | null; title?: string; list: GalleryPhoto[]; access?: PhotosResponse["access"]; pairs: BeforeAfterPair[]; onNavigate: (id: string) => void; onClose: () => void; onCompare: (pair: BeforeAfterPair) => void;
  onEdit: (photo: GalleryPhoto, body: Record<string, unknown>, message: string) => Promise<boolean>; onDelete: (photo: GalleryPhoto, reason: string) => Promise<boolean>;
  journeys: PhotosResponse["journeys"]; encounters: PhotosResponse["encounters"];
}) {
  const [marks, setMarks] = useState(true);
  const [annotations, setAnnotations] = useState<{ ref: string; items: Annotation[]; width: number; height: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nav = photo ? neighbors(list, photo.id) : null;
  const photoId = photo?.id ?? null;
  const hasAnnotations = photo?.hasAnnotations ?? false;
  const ref = photoId;

  useEffect(() => {
    if (!ref || !hasAnnotations) return;
    let active = true;
    getCachedJson<{ annotations: Annotation[]; width: number; height: number }>(`${base(patientId)}/${encodeURIComponent(ref)}`).then((value) => { if (active) setAnnotations({ ref, items: value.annotations, width: value.width, height: value.height }); }).catch(() => undefined);
    return () => { active = false; };
  }, [ref, hasAnnotations, patientId]);

  useEffect(() => {
    if (!photoId) return;
    const handler = (event: KeyboardEvent) => {
      if (editing || deleting) return;
      if (event.key === "ArrowLeft" && nav?.previous) onNavigate(nav.previous.id);
      if (event.key === "ArrowRight" && nav?.next) onNavigate(nav.next.id);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [photoId, nav, onNavigate, editing, deleting]);

  const pair = photo ? pairs.find((item) => item.before.id === photo.id || item.after.id === photo.id) : undefined;
  const layer = annotations && photo && annotations.ref === photo.id ? annotations : null;
  const editable = photo?.source === "gallery" && access?.canWrite;
  const heading = title ?? photo?.encounterTitle ?? "Foto";
  const caption = photo && nav ? `${nav.index + 1} / ${list.length} · ${photoPhaseLabels[photo.phase]} · ${formatDate(photo.takenAt)}` : undefined;
  return <Modal open={Boolean(photo)} onClose={onClose} title={heading} description={caption} panelClassName="max-w-5xl">
    {photo ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-3">
        <div className="relative flex min-h-[40dvh] items-center justify-center rounded-md bg-muted p-2">
          {nav?.previous ? <Button className="absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-white/90" size="sm" variant="outline" aria-label="Foto anterior" onClick={() => onNavigate(nav.previous!.id)}><ChevronLeft className="h-5 w-5" /></Button> : null}
          {nav?.next ? <Button className="absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-white/90" size="sm" variant="outline" aria-label="Próxima foto" onClick={() => onNavigate(nav.next!.id)}><ChevronRight className="h-5 w-5" /></Button> : null}
          <div className="relative max-h-full max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={photo.id} alt={`${photo.name} · ${photo.category}`} className="block max-h-[60dvh] max-w-full rounded-md object-contain" src={imageUrl(patientId, photo)} />
            {marks && layer?.items.length ? <AnnotationLayer annotations={layer.items} width={layer.width || photo.width} height={layer.height || photo.height} /> : null}
          </div>
        </div>
        <div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>
      </div>
      <aside className="text-xs">
        <dl className="space-y-2">{[["Atendimento", photo.encounterTitle], ["Tipo", encounterKindLabels[photo.encounterKind]], ["Tratamento", photo.journeyName || "Sem tratamento"], ["Categoria", photo.category], ["Fase", photoPhaseLabels[photo.phase]], ["Data", `${formatDate(photo.takenAt)} ${formatTime(photo.takenAt)}`], ["Profissional", photo.professional || "Não informado"]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
        <div className="mt-4 flex flex-wrap gap-2">
              {photo.hasAnnotations ? <Button size="sm" variant={marks ? "default" : "outline"} aria-pressed={marks} onClick={() => setMarks((value) => !value)}>{marks ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{marks ? "Com marcações" : "Original"}</Button> : null}
              {pair ? <Button size="sm" variant="outline" onClick={() => onCompare(pair)}><Columns2 className="h-4 w-4" />Antes e depois</Button> : null}
              <Button size="sm" variant="outline" asChild><a href={imageUrl(patientId, photo, "?download=1")}><Download className="h-4 w-4" />Baixar original</a></Button>
              {editable && !photo.archived ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PenLine className="h-4 w-4" />Editar</Button> : null}
              {photo.source === "gallery" && access?.canArchive ? <Button size="sm" variant="outline" onClick={() => void onEdit(photo, { archived: !photo.archived }, photo.archived ? "Foto restaurada." : "Foto arquivada.")}>{photo.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{photo.archived ? "Restaurar" : "Arquivar"}</Button> : null}
              {photo.source === "gallery" && access?.canDelete ? <Button size="sm" variant="destructive" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" />Excluir</Button> : null}
            </div>
        {photo.source !== "gallery" ? <p className="mt-4 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">Esta foto pertence a um registro de atendimento e é apenas consultada aqui, sem cópia.</p> : null}
      </aside>
      {editing ? <PhotoEditModal photo={photo} journeys={journeys} encounters={encounters} onClose={() => setEditing(false)} onSave={async (body) => { if (await onEdit(photo, body, "Foto atualizada.")) setEditing(false); }} /> : null}
      <Modal open={deleting} onClose={() => setDeleting(false)} title="Excluir foto definitivamente" description="Esta ação não pode ser desfeita.">
        <DeleteForm name={photo.name} onCancel={() => setDeleting(false)} onConfirm={async (reason) => { if (await onDelete(photo, reason)) setDeleting(false); }} />
      </Modal>
    </div> : null}
  </Modal>;
}

function DeleteForm({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(""); const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false);
  return <div className="space-y-3 text-xs">
    <p className="rounded-md bg-destructive/10 p-3 text-destructive">A foto <strong>{name}</strong> será apagada. Fica apenas um registro de auditoria (quem, quando, nome e categoria), sem o conteúdo. Para ocultar sem apagar, use Arquivar.</p>
    <label className="block font-semibold">Motivo (opcional)<input className="mt-1 h-10 w-full rounded-md border border-input px-3 text-sm" maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Entendo que a exclusão é definitiva.</label>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button variant="destructive" disabled={!confirmed || busy} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); }}>{busy ? "Excluindo..." : "Excluir definitivamente"}</Button></div>
  </div>;
}

function PhotoEditModal({ photo, journeys, encounters, onClose, onSave }: { photo: GalleryPhoto; journeys: PhotosResponse["journeys"]; encounters: PhotosResponse["encounters"]; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(photo.name);
  const [category, setCategory] = useState(photo.category);
  const [phase, setPhase] = useState<GalleryPhase>(photo.phase);
  const [journeyId, setJourneyId] = useState(photo.journeyId ?? "");
  const [encounter, setEncounter] = useState(photo.encounterKind === "evaluation" || photo.encounterKind === "session" ? photo.encounterKey.replace(/^(evaluation|session):/, "$1:") : "");
  const [saving, setSaving] = useState(false);
  const options = encounters.filter((entry) => !journeyId || entry.journeyId === journeyId);
  return <Modal open onClose={onClose} title="Editar foto" description="Nome, categoria, fase e vínculo. A imagem não é alterada.">
    <form className="space-y-3 text-xs" onSubmit={async (event) => { event.preventDefault(); setSaving(true); const [encounterType, encounterId] = encounter ? encounter.split(":") : [null, null]; await onSave({ name, category, phase, journeyId: journeyId || null, encounterType, encounterId }); setSaving(false); }}>
      <label className="block font-semibold">Nome<input className="mt-1 h-10 w-full rounded-md border border-input px-3 text-sm" value={name} maxLength={160} required onChange={(event) => setName(event.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block font-semibold">Categoria<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{photoCategoryNames.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="block font-semibold">Fase<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={phase} onChange={(event) => setPhase(event.target.value as GalleryPhase)}>{photoPhases.map((entry) => <option key={entry} value={entry}>{photoPhaseLabels[entry]}</option>)}</select></label></div>
      <label className="block font-semibold">Tratamento<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={journeyId} onChange={(event) => { setJourneyId(event.target.value); setEncounter(""); }}><option value="">Sem vínculo</option>{journeys.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label className="block font-semibold">Atendimento<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={encounter} onChange={(event) => setEncounter(event.target.value)}><option value="">Sem vínculo</option>{options.map((entry) => <option key={`${entry.type}:${entry.id}`} value={`${entry.type}:${entry.id}`}>{entry.title} · {formatDate(entry.date)}</option>)}</select></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? "Salvando..." : "Salvar"}</Button></div>
    </form>
  </Modal>;
}

// Comparador: duas imagens sobrepostas com divisor arrastável (original das fotos, sem cópia).
function CompareModal({ patientId, pair, onClose }: { patientId: string; pair: BeforeAfterPair | null; onClose: () => void }) {
  const [position, setPosition] = useState(50);
  return <Modal open={Boolean(pair)} onClose={onClose} title="Antes e depois" description={pair ? `${pair.after.encounterTitle} · ${pair.before.category}` : undefined}>
    {pair ? <div className="space-y-3">
      <div className="relative mx-auto aspect-[3/4] max-h-[60dvh] overflow-hidden rounded-md bg-muted" style={{ maxWidth: "min(100%, 28rem)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`Depois: ${pair.after.name}`} className="absolute inset-0 h-full w-full object-cover" src={imageUrl(patientId, pair.after)} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`Antes: ${pair.before.name}`} className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }} src={imageUrl(patientId, pair.before)} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${position}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">Antes · {formatDate(pair.before.takenAt)}</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{photoPhaseLabels[pair.after.phase]} · {formatDate(pair.after.takenAt)}</span>
      </div>
      <input type="range" min={0} max={100} value={position} onChange={(event) => setPosition(Number(event.target.value))} className="w-full accent-[var(--primary)]" aria-label="Posição do divisor entre antes e depois" />
      <div className="flex justify-end"><Button onClick={onClose}>Fechar</Button></div>
    </div> : null}
  </Modal>;
}

type Queued = UploadEntry & { file: File };

function PhotoUploadSheet({ open, onOpenChange, ...props }: {
  open: boolean; onOpenChange: (open: boolean) => void; patientId: string; initialFiles: File[]; journeys: PhotosResponse["journeys"]; encounters: PhotosResponse["encounters"]; onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return <Sheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }} title="Adicionar fotos" side="right" className="w-[min(26rem,100vw)]">{open ? <PhotoUploadPanel {...props} onBusyChange={setBusy} /> : null}</Sheet>;
}

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
function toQueued(files: File[], offset = 0): Queued[] {
  return files.map((file, index) => { const valid = imageTypes.includes(file.type); return { id: `${offset + index}-${file.name}-${file.size}`, file, name: file.name, status: valid ? "queued" : "error", progress: 0, error: valid ? undefined : "Use imagens JPG, PNG ou WEBP." } satisfies Queued; });
}

function PhotoUploadPanel({ patientId, initialFiles, journeys, encounters, onUploaded, onBusyChange }: {
  onBusyChange: (busy: boolean) => void; patientId: string; initialFiles: File[]; journeys: PhotosResponse["journeys"]; encounters: PhotosResponse["encounters"]; onUploaded: () => void;
}) {
  const [phase, setPhase] = useState<GalleryPhase>("OUTRA");
  const [category, setCategory] = useState("Outra");
  const [journeyId, setJourneyId] = useState("");
  const [encounter, setEncounter] = useState("");
  const [entries, setEntries] = useState<Queued[]>(() => toQueued(initialFiles));
  const [busy, setBusyState] = useState(false);
  const setBusy = (value: boolean) => { setBusyState(value); onBusyChange(value); };
  const input = useRef<HTMLInputElement>(null);
  const options = encounters.filter((entry) => !journeyId || entry.journeyId === journeyId);

  function addFiles(files: File[]) {
    setEntries((current) => [...current, ...toQueued(files, current.length)]);
  }
  const update = (id: string, change: Partial<Queued>) => setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...change } : entry));

  async function start() {
    setBusy(true); let sent = 0;
    for (const entry of entries.filter((item) => item.status === "queued" || (item.status === "error" && ["image/jpeg", "image/png", "image/webp"].includes(item.file.type)))) {
      update(entry.id, { status: "uploading", progress: 0, error: undefined });
      const prepared = await prepareImage(entry.file);
      if ("error" in prepared) { update(entry.id, { status: "error", error: prepared.error }); continue; }
      const form = new FormData();
      form.set("file", prepared.blob, prepared.name); form.set("width", String(prepared.width)); form.set("height", String(prepared.height));
      form.set("phase", phase); form.set("category", category); form.set("name", entry.file.name.replace(/\.[^.]+$/, ""));
      form.set("takenAt", new Date(entry.file.lastModified || Date.now()).toISOString());
      if (journeyId) form.set("journeyId", journeyId);
      if (encounter) { const [type, id] = encounter.split(":"); form.set("encounterType", type); form.set("encounterId", id); }
      const result = await postForm(base(patientId), form, (percent) => update(entry.id, { progress: percent }));
      if (result.ok) { sent += 1; update(entry.id, { status: "done", progress: 100 }); } else update(entry.id, { status: "error", error: result.body?.message ?? "Não foi possível enviar." });
    }
    setBusy(false);
    if (sent) { onUploaded(); toast.success(sent === 1 ? "Foto enviada." : `${sent} fotos enviadas.`); }
  }
  const pending = entries.filter((entry) => entry.status === "queued" || (entry.status === "error" && ["image/jpeg", "image/png", "image/webp"].includes(entry.file.type)));
  return <div className="space-y-4 p-4 text-xs">
      <div role="button" tabIndex={0} className="flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-8 text-center hover:bg-primary/10" onClick={() => input.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") input.current?.click(); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); addFiles(Array.from(event.dataTransfer.files)); }}>
        <Camera className="h-6 w-6 text-primary" aria-hidden="true" /><strong className="mt-2 text-sm">Arraste fotos ou clique para escolher</strong><span className="mt-1 text-xs text-muted-foreground">JPG, PNG ou WEBP · comprimidas automaticamente (até 4 MB)</span>
      </div>
      <input ref={input} className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      <div className="grid grid-cols-2 gap-3"><label className="block font-semibold">Categoria<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{photoCategoryNames.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="block font-semibold">Fase<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={phase} onChange={(event) => setPhase(event.target.value as GalleryPhase)}>{photoPhases.map((entry) => <option key={entry} value={entry}>{photoPhaseLabels[entry]}</option>)}</select></label></div>
      <label className="block font-semibold">Tratamento (opcional)<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={journeyId} onChange={(event) => { setJourneyId(event.target.value); setEncounter(""); }}><option value="">Sem vínculo</option>{journeys.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <label className="block font-semibold">Atendimento (opcional)<select className="mt-1 h-10 w-full rounded-md border border-input bg-background px-2 text-sm" value={encounter} onChange={(event) => setEncounter(event.target.value)}><option value="">Sem vínculo</option>{options.map((entry) => <option key={`${entry.type}:${entry.id}`} value={`${entry.type}:${entry.id}`}>{entry.title} · {formatDate(entry.date)}</option>)}</select></label>
      {entries.length ? <ul className="space-y-2" aria-label="Fotos para enviar">{entries.map((entry) => <li key={entry.id} className="rounded-md border border-border p-2">
        <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{entry.name}</span>{entry.status === "queued" || entry.status === "error" ? <button type="button" className="max-lg:grid max-lg:h-11 max-lg:min-w-11 max-lg:place-items-center" aria-label={`Remover ${entry.name}`} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><X className="h-4 w-4" /></button> : <span className="text-xs text-muted-foreground">{entry.status === "done" ? "Enviada" : `${entry.progress}%`}</span>}</div>
        {entry.status === "uploading" || entry.status === "done" ? <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full", entry.status === "done" ? "bg-success" : "bg-primary")} style={{ width: `${entry.progress}%` }} /></div> : null}
        {entry.error ? <p role="alert" className="mt-1 text-xs text-destructive">{entry.error}</p> : null}</li>)}</ul> : null}
      <Button className="w-full max-lg:sticky max-lg:bottom-2 max-lg:z-10 max-lg:shadow-lg" disabled={busy || !pending.length} onClick={() => void start()}>{busy ? "Enviando..." : pending.length > 1 ? `Enviar ${pending.length} fotos` : "Enviar foto"}</Button>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">As fotos ficam em armazenamento privado, só abrem com login e permissão clínica e cada visualização ampliada e download é registrado. Documentos (PDF, exames, termos) são enviados na aba Documentos clínicos.</p>
  </div>;
}
