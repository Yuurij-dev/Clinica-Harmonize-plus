"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowLeft, ArrowRight, Camera, ChevronDown, ChevronUp, Eye, Images, MessageSquareText, MoreHorizontal, Palette, Plus, Replace, Trash2, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ColorWheel } from "./color-wheel";
import { annotationDescription, markingsCountLabel } from "@/lib/facial-editor-rules";
import { maxAnnotationLabelLength } from "@/lib/photo-annotation-rules";
import { cn } from "@/lib/utils";
import { editorColors } from "./editor-toolbar-data";
import type { EvaluationPhoto, PhotoAnnotation } from "./types";

const categories: EvaluationPhoto["category"][] = ["Frontal", "Perfil esquerdo", "Perfil direito", "Sorriso", "Outra"];
const sectionClass = "border-b border-border px-4 py-2.5 last:border-b-0";
const iconButton = "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 max-lg:h-11 max-lg:w-11";

function SectionTitle({ icon: Icon, id, children }: { icon: typeof Images; id: string; children: React.ReactNode }) {
  return <h3 className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm font-semibold text-foreground" id={id}><Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" /><span className="min-w-0 truncate">{children}</span></h3>;
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-7 cursor-pointer items-center justify-between gap-3 text-sm text-foreground max-lg:min-h-11">
      <span>{label}</span>
      <button aria-checked={checked} className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors max-lg:before:absolute max-lg:before:-inset-x-2 max-lg:before:-inset-y-[10px] max-lg:before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background", checked ? "bg-primary" : "bg-muted-foreground/35")} role="switch" type="button" onClick={() => onChange(!checked)}>
        <span aria-hidden="true" className={cn("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked && "translate-x-5")} />
      </button>
    </label>
  );
}

/** Campo de legenda da marcação selecionada. Cada letra já vai para a marcação (o editor junta a digitação num só passo do histórico); o campo guarda o texto como foi digitado. */
function LabelField({ annotation, disabled, autoFocus, onChange, onFocused }: { annotation: PhotoAnnotation; disabled: boolean; autoFocus: boolean; onChange: (value: string) => void; onFocused: () => void }) {
  const [draft, setDraft] = useState(annotation.label ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    // O foco vai depois do fim do toque que criou o ponto: o foco padrão do mouse/dedo o tiraria do campo se fosse imediato.
    const timer = window.setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); onFocused(); }, 80);
    return () => window.clearTimeout(timer);
  }, [autoFocus, onFocused]);
  return (
    <div className="mt-2">
      <label className="text-xs font-medium text-muted-foreground" htmlFor="annotation-label">Legenda da marcação</label>
      <div className="relative mt-1">
        <input
          className="h-9 w-full rounded-lg border border-input bg-card px-3 pr-12 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50 max-lg:h-11"
          disabled={disabled}
          id="annotation-label"
          maxLength={maxAnnotationLabelLength}
          placeholder="Ex.: Glabela"
          ref={inputRef}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); onChange(event.target.value); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{draft.length}/{maxAnnotationLabelLength}</span>
      </div>
    </div>
  );
}

export type FacialSidePanelProps = {
  /** Só consulta: trocar de foto e a visibilidade seguem livres; o resto (fotos, marcações, observações, traço) fica inerte. */
  readOnly?: boolean;
  photos: EvaluationPhoto[];
  activePhotoId: string | null;
  onSelectPhoto: (photoId: string) => void;
  onAddPhotos: () => void;
  onCapture: () => void;
  onCategoryChange: (photoId: string, category: EvaluationPhoto["category"]) => void;
  onMovePhoto: (photoId: string, direction: -1 | 1) => void;
  onReplacePhoto: (photoId: string, file: File | undefined) => void;
  onRemovePhoto: (photoId: string) => void;
  annotations: PhotoAnnotation[];
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onDeleteAnnotation: (id: string) => void;
  onClearAllAnnotations: () => void;
  onLabelChange: (id: string, label: string) => void;
  labelFocusId: string | null;
  onLabelFocused: () => void;
  notes: string;
  notesMax: number;
  onNotesChange: (value: string) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  showMarks: boolean;
  onShowMarks: (value: boolean) => void;
  showLabels: boolean;
  onShowLabels: (value: boolean) => void;
};

/** Painel direito da avaliação facial (fotos, marcações, observações, traço e visibilidade). */
export function FacialSidePanel(props: FacialSidePanelProps) {
  const { photos, activePhotoId, annotations, selectedId, showMarks } = props;
  const readOnly = Boolean(props.readOnly);
  const [marksOpen, setMarksOpen] = useState(true);
  const [colorOpen, setColorOpen] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);
  const active = photos.find((photo) => photo.id === activePhotoId) ?? null;
  const activeIndex = active ? photos.indexOf(active) : -1;
  const selected = selectedId ? annotations.find((annotation) => annotation.id === selectedId) : undefined;
  const colorLabel = editorColors.find((item) => item.value.toLowerCase() === props.color.toLowerCase())?.label;
  return (
    <div className="flex flex-col overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-card shadow-sm xl:h-full">
      <section aria-labelledby="facial-photos-title" className={sectionClass}>
        <div className="flex min-w-0 items-center justify-between gap-1">
          <SectionTitle icon={Images} id="facial-photos-title">Fotos da avaliação</SectionTitle>
          <div className="flex shrink-0 items-center gap-0.5">
            <button className="hp-accent-text flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:h-11" disabled={readOnly} type="button" onClick={props.onAddPhotos}><Plus aria-hidden="true" className="h-3.5 w-3.5" /><span className="whitespace-nowrap text-xs font-semibold">Adicionar fotos</span></button>
            {active ? (
              <DropdownMenu>
                <DropdownMenuTrigger aria-label={`Mais ações da foto ${active.name}`} className={iconButton} disabled={readOnly} title="Mais ações da foto"><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem className="gap-2 max-lg:min-h-11" onSelect={props.onCapture}><Camera aria-hidden="true" className="h-4 w-4" />Capturar foto com a câmera</DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 max-lg:min-h-11" disabled={activeIndex <= 0} onSelect={() => props.onMovePhoto(active.id, -1)}><ArrowLeft aria-hidden="true" className="h-4 w-4" />Mover para antes</DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 max-lg:min-h-11" disabled={activeIndex >= photos.length - 1} onSelect={() => props.onMovePhoto(active.id, 1)}><ArrowRight aria-hidden="true" className="h-4 w-4" />Mover para depois</DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 max-lg:min-h-11" onSelect={() => replaceRef.current?.click()}><Replace aria-hidden="true" className="h-4 w-4" />Substituir foto (apaga as marcações)</DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive max-lg:min-h-11" onSelect={() => props.onRemovePhoto(active.id)}><Trash2 aria-hidden="true" className="h-4 w-4" />Excluir imagem</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {active ? <input accept="image/jpeg,image/png,image/webp" aria-hidden="true" className="sr-only" ref={replaceRef} tabIndex={-1} type="file" onChange={(event) => { props.onReplacePhoto(active.id, event.target.files?.[0]); event.target.value = ""; }} /> : null}
          </div>
        </div>
        {photos.length ? (
          <>
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {photos.map((photo) => (
                <li className="group relative min-w-0" key={photo.id}>
                  <button aria-label={`Abrir foto ${photo.category}: ${photo.name}`} aria-pressed={photo.id === activePhotoId} className={cn("relative block aspect-[2/1] w-full overflow-hidden rounded-lg border bg-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:aspect-[3/2]", photo.id === activePhotoId ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50")} type="button" onClick={() => props.onSelectPhoto(photo.id)}>
                    <Image alt="" className="object-cover object-top" fill sizes="(max-width: 1023px) 33vw, 100px" src={photo.imageUrl} unoptimized />
                    {photo.id === activePhotoId ? <span aria-hidden="true" className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary" /> : null}
                  </button>
                  <button aria-label={`Excluir imagem ${photo.category}: ${photo.name}`} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-0 transition hover:bg-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 disabled:hidden max-lg:h-11 max-lg:w-11 max-lg:opacity-100" disabled={readOnly} title="Excluir imagem" type="button" onClick={() => props.onRemovePhoto(photo.id)}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button>
                  <select disabled={readOnly} aria-label={`Categoria de ${photo.name}`} title="Alterar a categoria da foto" className="mt-0.5 w-full cursor-pointer appearance-none truncate rounded bg-transparent text-center text-xs text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11" value={photo.category} onChange={(event) => props.onCategoryChange(photo.id, event.target.value as EvaluationPhoto["category"])}>
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="mt-3 text-xs text-muted-foreground">Nenhuma foto adicionada ainda.</p>}
      </section>

      <section aria-labelledby="facial-style-title" className={sectionClass} inert={readOnly}>
        <SectionTitle icon={Palette} id="facial-style-title">Configurações de marcação</SectionTitle>
        <div className="mt-2 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="text-muted-foreground" id="facial-color-label">Cor do traço</span>
          <button aria-controls="facial-color-wheel" aria-expanded={colorOpen} aria-labelledby="facial-color-label facial-color-value" className="flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-left outline-none transition hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring max-lg:h-11" type="button" onClick={() => setColorOpen((value) => !value)}>
            <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ backgroundColor: props.color }} />
            <span className="min-w-0 flex-1 truncate text-sm font-medium uppercase" id="facial-color-value" title={colorLabel}>{props.color}</span>
            {colorOpen ? <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>
          {colorOpen ? <div className="col-span-2" id="facial-color-wheel"><ColorWheel color={props.color} onChange={props.onColorChange} /></div> : null}
          <label className="text-muted-foreground" htmlFor="facial-stroke">Espessura do traço</label>
          <div className="flex items-center gap-3">
            <input aria-valuetext={`${props.strokeWidth} px`} className="h-5 min-w-0 flex-1 accent-primary max-lg:h-11" id="facial-stroke" max={12} min={1} type="range" value={props.strokeWidth} onChange={(event) => props.onStrokeWidthChange(Number(event.target.value))} />
            <span className="w-10 shrink-0 text-right text-sm font-medium tabular-nums text-foreground">{props.strokeWidth} px</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="facial-marks-title" className={cn(sectionClass, "flex min-h-0 flex-col xl:min-h-[17rem]")} inert={readOnly}>
        <div className="flex items-center justify-between gap-2">
          <button aria-controls="facial-marks-list" aria-expanded={marksOpen} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-lg:min-h-11" type="button" onClick={() => setMarksOpen((value) => !value)}>
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: selected?.color ?? props.color }} />
            <h3 className="text-sm font-semibold text-foreground" id="facial-marks-title">Marcações selecionadas</h3>
            {marksOpen ? <ChevronUp aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" /> : <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 text-muted-foreground" />}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{markingsCountLabel(annotations.length)}</span>
          <span className="flex items-center gap-2">
          {annotations.length ? <button aria-label="Limpar todas as marcações" className={cn(iconButton, "h-6 w-6 hover:bg-destructive/10 hover:text-destructive")} disabled={!showMarks} title="Limpar todas as marcações" type="button" onClick={props.onClearAllAnnotations}><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}
          <button className="flex items-center gap-1.5 rounded-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 max-lg:min-h-11" disabled={!selectedId} type="button" onClick={() => props.onSelectAnnotation(null)}><X aria-hidden="true" className="h-3.5 w-3.5" /><span className="font-medium">Limpar seleção</span></button>
          </span>
        </div>
        {selected ? <LabelField annotation={selected} autoFocus={props.labelFocusId === selected.id} disabled={!showMarks} key={selected.id} onChange={(value) => props.onLabelChange(selected.id, value)} onFocused={props.onLabelFocused} /> : null}
        {marksOpen ? (
          <div className="flex min-h-0 flex-1 flex-col" id="facial-marks-list">
            {annotations.length ? (
              <ul aria-label="Marcações desta foto" className={cn("mt-1 max-h-[13rem] min-h-0 divide-y divide-border overflow-y-auto xl:max-h-[18rem]", !showMarks && "opacity-50")}>
                {annotations.map((annotation, index) => {
                  const description = annotationDescription(annotations, index);
                  return (
                    <li className="flex items-center gap-1" key={annotation.id}>
                      <button aria-current={annotation.id === selectedId} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed max-lg:min-h-11", annotation.id === selectedId ? "hp-accent-text text-primary" : "text-foreground hover:text-primary")} disabled={!showMarks} type="button" onClick={() => props.onSelectAnnotation(annotation.id)}>
                        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: annotation.color }} />
                        <span className={cn("truncate text-sm", annotation.id === selectedId && "font-semibold")}>{description}</span>
                      </button>
                      <button aria-label={`Excluir marcação ${description}`} className={iconButton} disabled={!showMarks} title="Excluir marcação" type="button" onClick={() => props.onDeleteAnnotation(annotation.id)}><X aria-hidden="true" className="h-3.5 w-3.5" /></button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="mt-2 text-xs text-muted-foreground">{active ? "Nenhuma marcação nesta foto. Escolha uma ferramenta e desenhe sobre a imagem." : "Adicione uma foto para marcar."}</p>}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="facial-visibility-title" className={sectionClass}>
        <SectionTitle icon={Eye} id="facial-visibility-title">Visibilidade</SectionTitle>
        <div className="mt-1">
          <Switch checked={props.showMarks} label="Mostrar marcações" onChange={props.onShowMarks} />
          <Switch checked={props.showLabels} label="Mostrar legendas" onChange={props.onShowLabels} />
        </div>
      </section>

      <section aria-labelledby="facial-notes-title" className={sectionClass}>
        <SectionTitle icon={MessageSquareText} id="facial-notes-title">Observações</SectionTitle>
        <div className="relative mt-2">
          <textarea readOnly={readOnly} aria-labelledby="facial-notes-title" className="block h-[3.25rem] w-full resize-none rounded-lg border border-input bg-card px-3 py-2 pb-5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" id="facial-notes" maxLength={props.notesMax} placeholder="Adicione observações sobre esta avaliação..." value={props.notes} onChange={(event) => props.onNotesChange(event.target.value)} />
          <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-3 text-xs text-muted-foreground">{props.notes.length}/{props.notesMax}</span>
        </div>
      </section>
    </div>
  );
}
