"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ImageOff, Library, Loader2, Plus, RefreshCw, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MaskedInput } from "@/components/ui/masked-input";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldClassName, FormField, Modal } from "@/components/ui/modal";
import { getCachedJson, readClientCache } from "@/lib/client-cache";
import { formatCurrency, formatInteger, parseCurrency, parseInteger } from "@/lib/input-masks";
import { maxProcedureNameLength } from "@/lib/procedure-catalog-rules";
import {
  buildCatalogCreateBody,
  buildCustomCreateBody,
  buildPatchBody,
  findFieldProblem,
  searchCatalog,
  uploadErrorMessage,
  nameAlreadyUsed,
  validateImageFile,
  type ImageChoice,
} from "@/lib/procedure-form-rules";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/clinic";
import { sendJson } from "@/lib/send-json";
import { ProcedureImage } from "./procedure-image";
import { readTechnicalSheet, TechnicalSheetEditor, type TechnicalSheetItem } from "./technical-sheet-editor";

export const procedureCatalogCacheKey = "/api/procedure-catalog?limit=100";

type CatalogItem = { id: string; slug: string; name: string; imageUrl: string | null; imageAlt: string; enabled: boolean; procedureId: string | null };
type CatalogResponse = { total: number; items: CatalogItem[] };

export type EditableProcedure = {
  id: string;
  name: string;
  price: number;
  durationMinutes: number;
  marginPercent: number;
  technicalSheet: TechnicalSheetItem[];
  materialsNeedReview: boolean;
  catalogItemId: string | null;
  imageUrl: string | null;
};

type Props = {
  editing: EditableProcedure | null;
  procedures: ReadonlyArray<{ id?: string; name: string }>;
  materials: Array<Product & { id: string }>;
  onClose: () => void;
  onEdit: (procedureId: string) => void;
  /** Chamado só depois de salvar com sucesso (a tela invalida o cache e recarrega). */
  onSaved: (name: string, created: boolean) => void;
};

type Selection = { kind: "catalog"; item: CatalogItem } | { kind: "custom"; name: string };
type Pick = { kind: "keep" } | { kind: "none" } | { kind: "library"; item: CatalogItem } | { kind: "file"; file: File; previewUrl: string };
type ImageTab = "library" | "upload" | "none";

function useCatalog() {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: CatalogItem[] }>(() => {
    const cached = readClientCache<CatalogResponse>(procedureCatalogCacheKey);
    return cached ? { status: "ready", items: cached.items } : { status: "loading", items: [] };
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    getCachedJson<CatalogResponse>(procedureCatalogCacheKey)
      .then((data) => { if (active) setState({ status: "ready", items: data.items ?? [] }); })
      .catch(() => { if (active) setState((current) => current.items.length ? current : { status: "error", items: [] }); });
    return () => { active = false; };
  }, [attempt]);
  return { ...state, retry: () => { setState({ status: "loading", items: [] }); setAttempt((value) => value + 1); } };
}

function CatalogSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className="h-[132px] rounded-lg" />)}
    </div>
  );
}

function CatalogError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <p className="font-semibold">Não foi possível carregar o catálogo de procedimentos.</p>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" />Tentar novamente</Button>
    </div>
  );
}

export function ProcedureFormModal({ editing, procedures, materials, onClose, onEdit, onSaved }: Props) {
  const [selection, setSelection] = useState<Selection | null>(() => editing ? { kind: "custom", name: editing.name } : null);
  const [busy, setBusy] = useState(false);
  const step = selection ? "configure" : "choose";

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose(); }}
      closeOnOverlayClick={!busy}
      panelClassName="max-w-2xl"
      title={editing ? "Editar procedimento" : step === "choose" ? "Novo procedimento" : "Configurar procedimento"}
      description={step === "choose" ? "Escolha um procedimento do catálogo ou crie um personalizado." : "Defina valor, duração, margem e os materiais usados em cada atendimento."}
    >
      {selection ? (
        <ConfigureStep
          editing={editing}
          selection={selection}
          procedures={procedures}
          materials={materials}
          onBack={editing ? onClose : () => setSelection(null)}
          onSaved={onSaved}
          onBusy={setBusy}
        />
      ) : (
        <ChooseStep onSelect={setSelection} onEdit={onEdit} />
      )}
    </Modal>
  );
}

function ChooseStep({ onSelect, onEdit }: { onSelect: (selection: Selection) => void; onEdit: (procedureId: string) => void }) {
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchCatalog(catalog.items, query), [catalog.items, query]);
  const trimmed = query.trim();
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // O Radix foca o primeiro item do diálogo (botão fechar); leva o foco para a busca.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Etapa 1 de 2 · Escolha o procedimento</p>

      <button
        type="button"
        onClick={() => onSelect({ kind: "custom", name: "" })}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-primary/50 bg-primary/5 p-4 text-left transition hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Plus className="h-5 w-5" aria-hidden="true" /></span>
        <span className="min-w-0">
          <strong className="block text-sm text-foreground">Criar procedimento personalizado</strong>
          <span className="block text-xs text-muted-foreground">Não está no catálogo? Informe o nome e escolha ou envie uma imagem.</span>
        </span>
      </button>

      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            ref={searchRef}
            className={cn(fieldClassName, "pl-9")}
            placeholder="Pesquisar no catálogo (ex.: botox, preenchimento)"
            aria-label="Pesquisar procedimento no catálogo"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={100}
          />
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {catalog.status === "ready" ? (results.length === 1 ? "1 procedimento encontrado" : `${results.length} procedimentos encontrados`) : catalog.status === "loading" ? "Carregando catálogo..." : ""}
        </p>

        {catalog.status === "loading" ? <CatalogSkeleton /> : null}
        {catalog.status === "error" ? <CatalogError onRetry={catalog.retry} /> : null}
        {catalog.status === "ready" && !results.length ? (
          <div className="rounded-lg border border-border bg-muted/40 p-5 text-center">
            <p className="text-sm font-semibold text-foreground">Nenhum procedimento encontrado</p>
            <p className="mt-1 text-xs text-muted-foreground">Confira a grafia ou crie um procedimento personalizado.</p>
            <Button type="button" size="sm" className="mt-3" onClick={() => onSelect({ kind: "custom", name: trimmed })}>
              <Plus className="h-3.5 w-3.5" />{trimmed ? "Criar personalizado com este nome" : "Criar procedimento personalizado"}
            </Button>
          </div>
        ) : null}
        {catalog.status === "ready" && results.length ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Procedimentos do catálogo">
            {results.map((item) => (
              <li key={item.id} className={cn("flex flex-col overflow-hidden rounded-lg border bg-card", item.enabled ? "border-border opacity-90" : "border-border hover:border-primary/50")}>
                {item.enabled ? (
                  <div className="flex h-full flex-col">
                    <ProcedureImage name={item.name} imageUrl={item.imageUrl} decorative className="h-24 w-full rounded-none" />
                    <div className="flex flex-1 flex-col gap-2 p-2.5">
                      <strong className="text-sm leading-tight text-foreground">{item.name}</strong>
                      <Badge variant="green" className="w-fit"><Check className="mr-1 h-3 w-3" aria-hidden="true" />Já cadastrado</Badge>
                      {item.procedureId ? <Button type="button" size="sm" variant="secondary" className="mt-auto" onClick={() => onEdit(item.procedureId!)} aria-label={`${item.name} — já cadastrado. Editar`}>Editar</Button> : null}
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="flex h-full flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => onSelect({ kind: "catalog", item })}
                    aria-label={`Selecionar ${item.name}`}
                  >
                    <ProcedureImage name={item.name} imageUrl={item.imageUrl} decorative className="h-24 w-full rounded-none" />
                    <span className="p-2.5 text-sm font-semibold leading-tight text-foreground">{item.name}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function ConfigureStep({ editing, selection, procedures, materials, onBack, onSaved, onBusy }: {
  editing: EditableProcedure | null;
  selection: Selection;
  procedures: Props["procedures"];
  materials: Props["materials"];
  onBack: () => void;
  onSaved: Props["onSaved"];
  onBusy: (busy: boolean) => void;
}) {
  const isCatalogNew = selection.kind === "catalog" && !editing;
  const nameEditable = !isCatalogNew;
  const [name, setName] = useState(selection.kind === "catalog" ? selection.item.name : selection.name);
  const [pick, setPick] = useState<Pick>(editing ? { kind: "keep" } : { kind: "none" });
  const [tab, setTab] = useState<ImageTab>("library");
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const fail = (message: string, field: string | null = null) => { setError(message); setErrorField(field); };
  const uploaded = useRef<{ file: File; assetId: string } | null>(null);
  const previewRef = useRef<string | null>(null);
  const materialOptions = materials;

  // Libera a pré-visualização ao fechar.
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const headerImage = selection.kind === "catalog" && !editing ? selection.item.imageUrl
    : pick.kind === "keep" ? editing?.imageUrl ?? null
    : pick.kind === "library" ? pick.item.imageUrl
    : null;

  async function resolveImage(): Promise<ImageChoice | { error: string; field?: string }> {
    if (pick.kind === "keep") return { kind: "keep" };
    if (pick.kind === "none") return { kind: "none" };
    if (pick.kind === "library") return { kind: "library", catalogImageId: pick.item.id };
    if (uploaded.current?.file === pick.file) return { kind: "upload", assetId: uploaded.current.assetId };
    const body = new FormData();
    body.append("file", pick.file);
    try {
      const response = await fetch("/api/procedures/images", { method: "POST", body });
      const data = await response.json().catch(() => null) as { id?: string; message?: string } | null;
      if (!response.ok || !data?.id) return { error: uploadErrorMessage(response.status, data?.message), field: "file" };
      uploaded.current = { file: pick.file, assetId: data.id };
      return { kind: "upload", assetId: data.id };
    } catch {
      return { error: "Sem conexão com o servidor. Tente novamente." };
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sheet = readTechnicalSheet(form, materialOptions);
    if (sheet.error !== undefined) { fail(sheet.error); return; }
    const fields = {
      price: parseCurrency(form.get("price")),
      durationMinutes: parseInteger(form.get("duration")),
      margin: parseInteger(form.get("margin")),
      technicalSheet: sheet.items,
    };
    const problem = findFieldProblem({ name: nameEditable ? name : undefined, ...fields });
    if (problem) { fail(problem.message, problem.field); return; }
    if (nameEditable && nameAlreadyUsed(name, procedures, editing?.id)) { fail("Já existe um procedimento com este nome.", "name"); return; }

    setSaving(true);
    onBusy(true);
    fail("");
    const image = await resolveImage();
    if ("error" in image) { setSaving(false); onBusy(false); fail(image.error); return; }

    const response = editing
      ? await sendJson(`/api/procedures/${encodeURIComponent(editing.id)}`, "PATCH", buildPatchBody(name, image, fields))
      : await sendJson("/api/procedures", "POST", selection.kind === "catalog" ? buildCatalogCreateBody(selection.item.id, fields) : buildCustomCreateBody(name, image, fields));
    setSaving(false);
    onBusy(false);
    if (!response.ok) { fail(response.data?.message ?? "Não foi possível salvar o procedimento.", response.status === 409 && nameEditable ? "name" : null); return; }
    onSaved(isCatalogNew ? (selection as { item: CatalogItem }).item.name : name.trim().replace(/\s+/g, " "), !editing);
  }

  function choose(next: Pick) {
    if (next.kind !== "file" && previewRef.current) { URL.revokeObjectURL(previewRef.current); previewRef.current = null; }
    setPick(next);
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    const problem = validateImageFile(file);
    setFileError(problem ?? "");
    if (problem) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(file);
    setPick({ kind: "file", file, previewUrl: previewRef.current });
  }

  const invalidProps = (field: string) => errorField === field ? { "aria-invalid": true as const, "aria-describedby": "procedure-form-error" } : {};
  const percentFormatter = (value: string) => { const digits = formatInteger(value, 3); return digits ? `${digits}%` : ""; };

  const libraryNote = editing?.catalogItemId ? "Imagem padrão" : "Sem imagem";
  const tabs: Array<{ id: ImageTab; label: string; icon: typeof Library }> = [
    { id: "library", label: "Biblioteca", icon: Library },
    { id: "upload", label: "Enviar imagem", icon: Upload },
    { id: "none", label: libraryNote, icon: ImageOff },
  ];

  return (
    <form className="space-y-5" onSubmit={submit}>
      {!editing ? <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Etapa 2 de 2 · Configure</p> : null}

      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <ProcedureImage name={name || "Novo"} imageUrl={headerImage} localPreview={pick.kind === "file" && !(isCatalogNew) ? pick.previewUrl : null} decorative className="h-16 w-16 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-1">
          {selection.kind === "catalog" || editing?.catalogItemId ? <Badge variant="blue">Do catálogo</Badge> : <Badge variant="purple">Personalizado</Badge>}
          <p className="truncate text-sm font-semibold text-foreground">{name.trim() || "Procedimento sem nome"}</p>
        </div>
        {!editing ? <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={saving}><ArrowLeft className="h-3.5 w-3.5" />Trocar</Button> : null}
      </div>

      {nameEditable ? (
        <FormField label="Nome do procedimento" htmlFor="procedure-name">
          <input id="procedure-name" className={fieldClassName} value={name} onChange={(event) => setName(event.target.value)} maxLength={maxProcedureNameLength} required autoFocus={!name} {...invalidProps("name")} placeholder="Ex.: Skinbooster facial" />
        </FormField>
      ) : null}

      {nameEditable ? (
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium text-foreground">Imagem</legend>
          <div role="group" aria-label="Origem da imagem" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => { setTab(id); if (id === "none") choose({ kind: "none" }); }}
                className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{label}</span>
              </button>
            ))}
          </div>
          {tab === "library" ? <LibraryPicker selectedId={pick.kind === "library" ? pick.item.id : null} onPick={(item) => choose({ kind: "library", item })} /> : null}
          {tab === "upload" ? (
            <div className="space-y-2">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Enviar imagem do procedimento"
                aria-describedby="procedure-file-help"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary-foreground"
                onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }}
              />
              {pick.kind === "file" ? <ProcedureImage name={name || "Novo"} imageUrl={null} localPreview={pick.previewUrl} alt="Pré-visualização da imagem enviada" className="h-24 w-24 rounded-lg" /> : null}
              <p id="procedure-file-help" className="text-xs text-muted-foreground">JPEG, PNG ou WebP, até 4 MB.{pick.kind === "file" ? ` Selecionada: ${pick.file.name}` : ""}</p>
              {fileError ? <p role="alert" className="text-xs font-semibold text-destructive">{fileError}</p> : null}
            </div>
          ) : null}
          {tab === "none" ? <p className="text-xs text-muted-foreground">{editing?.catalogItemId ? "Volta a usar a imagem padrão do catálogo." : "O procedimento aparece com um marcador com a inicial do nome."}</p> : null}
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="Valor sugerido" htmlFor="procedure-price"><MaskedInput {...invalidProps("price")} id="procedure-price" className={fieldClassName} formatter={formatCurrency} name="price" inputMode="decimal" defaultValue={editing ? formatCurrency(String(Math.round(editing.price * 100))) : ""} placeholder="R$ 0,00" required autoFocus={isCatalogNew} /></FormField>
        <FormField label="Duração (minutos)" htmlFor="procedure-duration"><MaskedInput {...invalidProps("duration")} id="procedure-duration" className={fieldClassName} formatter={(value) => formatInteger(value, 3)} name="duration" inputMode="numeric" defaultValue={editing ? String(editing.durationMinutes) : ""} placeholder="60" required /></FormField>
        <FormField label="Margem estimada (%)" htmlFor="procedure-margin"><MaskedInput {...invalidProps("margin")} id="procedure-margin" className={fieldClassName} formatter={percentFormatter} name="margin" inputMode="numeric" defaultValue={editing ? `${editing.marginPercent}%` : ""} placeholder="40%" required /></FormField>
      </div>

      <FormField label="Ficha técnica" description="Materiais e produtos, com as quantidades usadas, em cada atendimento deste procedimento.">
        {editing?.materialsNeedReview ? <p className="mb-2 rounded-[7px] bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning">Ficha convertida automaticamente do texto antigo com quantidade 1. Confira e salve para concluir a revisão.</p> : null}
        <TechnicalSheetEditor materials={materialOptions} defaultValue={editing?.technicalSheet ?? []} />
      </FormField>

      {error ? <p id="procedure-form-error" role="alert" className="rounded-[7px] bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p> : null}
      <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
        <Button type="button" variant="secondary" disabled={saving} onClick={onBack}>{editing ? "Cancelar" : "Voltar"}</Button>
        <Button type="submit" disabled={saving}>{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Salvando..." : editing ? "Salvar alterações" : "Salvar procedimento"}</Button>
      </div>
    </form>
  );
}

function LibraryPicker({ selectedId, onPick }: { selectedId: string | null; onPick: (item: CatalogItem) => void }) {
  const catalog = useCatalog();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchCatalog(catalog.items, query), [catalog.items, query]);
  if (catalog.status === "loading") return <CatalogSkeleton count={4} />;
  if (catalog.status === "error") return <CatalogError onRetry={catalog.retry} />;
  return (
    <div className="space-y-2">
      <input type="search" className={fieldClassName} aria-label="Pesquisar imagem na biblioteca" placeholder="Pesquisar imagem" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} />
      {results.length ? (
        <ul className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4" aria-label="Imagens da biblioteca">
          {results.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selectedId === item.id}
                aria-label={item.name}
                title={item.name}
                onClick={() => onPick(item)}
                className={cn("relative block w-full overflow-hidden rounded-lg border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selectedId === item.id ? "border-primary" : "border-transparent hover:border-primary/40")}
              >
                <ProcedureImage name={item.name} imageUrl={item.imageUrl} decorative className="h-16 w-full rounded-none" />
                {selectedId === item.id ? <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" aria-hidden="true" /></span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground" role="status">Nenhuma imagem encontrada.</p>}
    </div>
  );
}
