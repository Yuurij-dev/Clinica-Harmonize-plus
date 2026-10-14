"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, Clock3, FileText, ImagePlus, Loader2, Plus, Save, ShieldAlert, Syringe, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import type { Patient } from "@/types/clinic";
import { LoadingSkeleton } from "./shared";

type SessionPhoto = { id: string; name: string; phase: "Antes" | "Imediatamente após"; category: string; imageUrl: string; sourceEvaluationPhotoId?: string; width: number; height: number };
type Allocation = { lotId: string; quantity: number; code?: string; expiresOn?: string };
type UsedMaterial = { productId: string; name?: string; unit?: string; quantity: number; allocations: Allocation[] };
type Session = { id: string; procedureName: string; professional: string; performedAt: string; startedAt: string | null; endedAt: string | null; estimatedMinutes: number | null; durationMinutes: number | null; technique: string; treatedAreas: string; anesthesia: string; complications: string; observations: string; materials: UsedMaterial[]; photos: SessionPhoto[]; auditLog: Array<{ at: string; actor: string; action: string; fields: string[] }>; status: string; updatedBy: string; updatedAt: string; completedBy?: string | null; completedAt?: string | null };
type Procedure = { id: string; name: string; durationMinutes: number; suggestedMaterials: Array<{ productId: string; quantity: number }> };
type Product = { id: string; name: string; unit: string; lots: Array<{ id: string; code: string; expiresOn: string; balance: number }> };
type InitialPhoto = { id: string; name: string; imageUrl: string; width: number; height: number; category: string };
type Payload = { journey: { id: string; name: string; status: string }; quote: { id: string; status: string; items: Array<{ procedureId: string; name: string; quantity: number }> }; evaluation: { id: string; chiefComplaint: string; patientGoal: string; allergies: string; contraindications: string; photos: InitialPhoto[] }; procedures: Procedure[]; materials: Product[]; sessions: Session[]; consent: { status: string; signed: boolean } };

const cacheKey = (patientId: string, journeyId: string, quoteId: string) => `/api/patients/${patientId}/procedure-sessions?journeyId=${encodeURIComponent(journeyId)}&quoteId=${encodeURIComponent(quoteId)}`;

export function ProcedureSessionWorkspace({ patient, patientId, journeyId, quoteId, onBack, onCompleted }: { patient: Patient; patientId: string; journeyId?: string; quoteId: string; onBack: () => void; onCompleted: (sessionId: string) => void }) {
  const key = journeyId ? cacheKey(patientId, journeyId, quoteId) : "";
  const cached = key ? readClientCache<Payload>(key) : undefined;
  const [data, setData] = useState<Payload | null>(cached ?? null);
  const [loading, setLoading] = useState(Boolean(key && !cached));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedProcedureId, setSelectedProcedureId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [draft, setDraft] = useState<Omit<Session, "id" | "updatedAt"> & { id?: string; updatedAt?: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "start" | "finish" | "new" | "" >("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [photoPhase, setPhotoPhase] = useState<SessionPhoto["phase"]>("Antes");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preview, setPreview] = useState<SessionPhoto | InitialPhoto | null>(null);
  const [materialProductId, setMaterialProductId] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!key) return;
    let active = true;
    getCachedJson<Payload>(key).then((result) => {
      if (!active) return;
      setData(result);
      setError("");
      const initialId = result.quote.items[0]?.procedureId ?? "";
      setSelectedProcedureId((current) => current || initialId);
      const latest = result.sessions[0];
      if (latest) { setSessionId(latest.id); setDraft(toDraft(latest)); }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar a sessão."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, retry]);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!cameraOpen) { stopCamera(); return; }
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then((stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(() => { if (active) { setCameraOpen(false); setNotice({ error: true, text: "Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie uma foto." }); } });
    return () => { active = false; stopCamera(); };
  }, [cameraOpen]);

  const procedure = data?.procedures.find((item) => item.id === selectedProcedureId) ?? data?.procedures[0];
  const initialPhotos = data?.evaluation.photos ?? [];
  const photos = draft?.photos ?? [];
  const materials = draft?.materials ?? [];
  const doneChecklist = [Boolean(draft?.technique.trim() && draft?.treatedAreas.trim()), materials.every((item) => item.allocations.length > 0), photos.some((photo) => photo.phase === "Antes") && photos.some((photo) => photo.phase === "Imediatamente após"), draft?.status === "Concluída"];
  const canWrite = Boolean(draft && draft.status !== "Concluída");
  const changedMaterials = useMemo(() => materials.map((item) => ({ productId: item.productId, quantity: item.quantity, allocations: item.allocations.map((allocation) => ({ lotId: allocation.lotId, quantity: allocation.quantity })) })), [materials]);

  function patchDraft(changes: Partial<Session>) {
    setDraft((current) => current ? { ...current, ...changes } : current);
    setNotice(null);
  }

  async function createSession(procedureIdInput = procedure?.id) {
    const sessionProcedure = data?.procedures.find((item) => item.id === procedureIdInput);
    if (!data || !journeyId || !sessionProcedure) return;
    setBusy("new"); setNotice(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/procedure-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ journeyId, quoteId, procedureId: sessionProcedure.id, performedAt: new Date().toISOString() }) });
      const result = await response.json().catch(() => ({})) as { session?: Session; message?: string };
      if (!response.ok || !result.session) throw new Error(result.message ?? "Não foi possível abrir uma nova sessão.");
      setSessionId(result.session.id); setDraft(toDraft(result.session));
      setData((current) => current ? { ...current, sessions: [result.session!, ...current.sessions] } : current);
      invalidateClientCache(key);
    } catch (reason) { setNotice({ error: true, text: reason instanceof Error ? reason.message : "Não foi possível abrir a sessão." }); }
    finally { setBusy(""); }
  }

  async function save(status: "Rascunho" | "Em execução" | "Concluída" = draft?.status === "Em execução" ? "Em execução" : "Rascunho") {
    if (!draft || !sessionId || !journeyId) return false;
    const mode = status === "Concluída" ? "finish" : status === "Em execução" ? "start" : "save";
    setBusy(mode); setNotice(null);
    const savedPhotos = draft.photos.map((photo) => photo.sourceEvaluationPhotoId ? { id: photo.id, name: photo.name, phase: photo.phase, category: photo.category, sourceEvaluationPhotoId: photo.sourceEvaluationPhotoId } : photo);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/procedure-sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, status, materials: changedMaterials, photos: savedPhotos, ...(status === "Em execução" && !draft.startedAt ? { startedAt: new Date().toISOString() } : {}) }) });
      const result = await response.json().catch(() => ({})) as { session?: Session; pending?: unknown[]; message?: string };
      if (!response.ok || !result.session) throw new Error(result.message ?? "Não foi possível salvar a sessão.");
      const updated = { ...result.session, materials: result.session.materials ?? materials, photos: result.session.photos ?? savedPhotos };
      setDraft(toDraft(updated));
      setData((current) => current ? { ...current, sessions: [updated, ...current.sessions.filter((item) => item.id !== updated.id)] } : current);
      invalidateClientCache(key, `/api/patients/${patientId}/history`, `/api/patients/${patientId}/journeys`, `/api/patients/${patientId}/profile`, "/api/dashboard/bootstrap");
      setNotice({ text: status === "Concluída" ? `Sessão concluída.${result.pending?.length ? " Há materiais sem saldo que ficaram como saída pendente." : ""}` : status === "Em execução" ? "Início da sessão registrado." : "Rascunho salvo." });
      if (status === "Concluída") onCompleted(updated.id);
      return true;
    } catch (reason) { setNotice({ error: true, text: reason instanceof Error ? reason.message : "Não foi possível salvar a sessão." }); return false; }
    finally { setBusy(""); }
  }

  async function finish() {
    if (!window.confirm("Finalizar esta sessão? A ação registra os materiais utilizados no estoque e não encerra o tratamento.")) return;
    await save("Concluída");
  }

  function addSuggestedMaterials() {
    if (!procedure || !data) return;
    const next = procedure.suggestedMaterials.flatMap((suggestion) => {
      const product = data.materials.find((item) => item.id === suggestion.productId);
      if (!product || materials.some((item) => item.productId === product.id)) return [];
      return [{ productId: product.id, name: product.name, unit: product.unit, quantity: suggestion.quantity, allocations: allocateSessionLots(product, suggestion.quantity) }];
    });
    if (next.length) patchDraft({ materials: [...materials, ...next] });
    else setNotice({ error: true, text: "A ficha técnica não tem materiais novos cadastrados para este procedimento." });
  }

  function addMaterial(productId: string) {
    const product = data?.materials.find((item) => item.id === productId);
    if (!product || materials.some((item) => item.productId === product.id)) return;
    patchDraft({ materials: [...materials, { productId, name: product.name, unit: product.unit, quantity: 1, allocations: allocateSessionLots(product, 1) }] });
    setMaterialProductId("");
  }

  function setMaterialQuantity(index: number, quantity: number) {
    patchDraft({ materials: materials.map((item, itemIndex) => itemIndex === index ? {
      ...item,
      quantity,
      allocations: resizeSessionLots(item.allocations, quantity),
    } : item) });
  }

  function setMaterial(index: number, update: Partial<UsedMaterial>) {
    patchDraft({ materials: materials.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item) });
  }

  async function uploadFiles(files: FileList | null, phase: SessionPhoto["phase"]) {
    if (!files?.length) return;
    const chosen = Array.from(files);
    if (photos.length + chosen.length > 20) { setNotice({ error: true, text: "Cada sessão aceita até 20 fotografias." }); return; }
    const converted: SessionPhoto[] = [];
    for (const file of chosen) {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 6_000_000) { setNotice({ error: true, text: "Use imagens JPG, PNG ou WebP de até 6 MB cada." }); return; }
      const imageUrl = await fileToDataUrl(file);
      const size = await imageDimensions(imageUrl);
      if (size.width > 8000 || size.height > 8000 || size.width * size.height > 25_000_000 || imageUrl.length > 8_500_000) { setNotice({ error: true, text: "A resolução desta imagem excede o limite seguro de 25 megapixels." }); return; }
      converted.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180), phase, category: inferCategory(file.name), imageUrl, width: size.width, height: size.height });
    }
    patchDraft({ photos: [...photos, ...converted] });
  }

  function selectInitialPhoto(photo: InitialPhoto, phase: SessionPhoto["phase"]) {
    if (photos.some((item) => item.sourceEvaluationPhotoId === photo.id && item.phase === phase)) return;
    patchDraft({ photos: [...photos, { id: crypto.randomUUID(), name: photo.name, phase, category: photo.category, imageUrl: photo.imageUrl, sourceEvaluationPhotoId: photo.id, width: photo.width, height: photo.height }] });
  }

  function captureCamera() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    if (photos.length >= 20) { setNotice({ error: true, text: "Cada sessão aceita até 20 fotografias." }); return; }
    if (video.videoWidth > 8000 || video.videoHeight > 8000 || video.videoWidth * video.videoHeight > 25_000_000) { setNotice({ error: true, text: "A resolução da câmera excede o limite seguro de 25 megapixels." }); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const imageUrl = canvas.toDataURL("image/jpeg", 0.9);
    patchDraft({ photos: [...photos, { id: crypto.randomUUID(), name: `captura-${new Date().toISOString()}.jpg`, phase: photoPhase, category: "Outra", imageUrl, width: canvas.width, height: canvas.height }] });
    setCameraOpen(false);
  }

  function requestCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice({ error: true, text: "Este dispositivo ou navegador não disponibiliza câmera. Envie uma fotografia para continuar." });
      return;
    }
    setCameraOpen(true);
  }

  if (!journeyId) return <Card className="p-6 text-center text-sm text-[#b42318]">Esta execução não está vinculada a um tratamento.</Card>;
  if (loading) return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="space-y-4 p-5"><LoadingSkeleton className="h-10 w-1/2" /><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="h-40 w-full" /></Card><Card className="space-y-4 p-5"><LoadingSkeleton className="h-8 w-1/2" /><LoadingSkeleton className="h-20 w-full" /></Card></div>;
  if (error || !data) return <Card className="space-y-3 p-6 text-center"><p className="text-sm font-semibold text-[#b42318]">{error || "Dados da execução indisponíveis."}</p><Button variant="outline" onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>Tentar novamente</Button></Card>;
  if (!draft) return <Card className="space-y-4 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold">Execução do procedimento</h2><p className="mt-1 text-xs text-[#767789]">Orçamento aprovado · {data.journey.name}</p></div><Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" />Voltar ao orçamento</Button></div><div className="divide-y divide-[#ececf2]">{data.quote.items.map((item) => <div key={item.procedureId} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><strong className="text-sm">{item.name}</strong><p className="text-xs text-[#767789]">{item.quantity} unidade(s) prevista(s) no orçamento</p></div><Button disabled={busy === "new"} onClick={() => { setSelectedProcedureId(item.procedureId); void createSession(item.procedureId); }}><Plus className="h-4 w-4" />Iniciar sessão</Button></div>)}</div></Card>;

  const selectedSession = data.sessions.find((item) => item.id === sessionId);
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ece9ff] text-sm font-black text-[#5147dc]">{patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div className="min-w-0"><h2 className="truncate text-base font-bold">{patient.name}</h2><p className="text-[10px] text-[#747587]">{procedure?.name ?? draft.procedureName} · Sessão clínica · {data.journey.name}</p><p className="text-[9px] text-[#858696]">{patient.age ? `${patient.age} anos · ` : ""}{patient.phone} · {draft.status}</p></div></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(busy) || !canWrite} onClick={() => void save()}><Save className="h-4 w-4" />{busy === "save" ? "Salvando..." : "Salvar rascunho"}</Button><Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" />Voltar ao orçamento</Button>{draft.status === "Concluída" ? <Button onClick={() => onCompleted(sessionId)}>Acompanhamento <ArrowRight className="h-4 w-4" /></Button> : draft.status === "Rascunho" ? <Button disabled={Boolean(busy)} onClick={() => void save("Em execução")}>{busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}Iniciar procedimento</Button> : <Button disabled={Boolean(busy)} onClick={() => void finish()}>{busy === "finish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Finalizar sessão</Button>}</div>
      </Card>
      <div className="flex items-center gap-2 overflow-x-auto px-2 py-1 text-[10px] font-semibold text-[#747587]" aria-label="Progresso do atendimento">{["Avaliação", "Orçamento", "Procedimento", "Pós-procedimento"].map((step, index) => <div key={step} className="flex min-w-0 flex-1 items-center gap-2"><span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", index < 2 ? "bg-[#5147dc] text-white" : index === 2 ? "bg-[#5147dc] text-white" : "bg-[#e6e7ef]")}>{index < 2 ? <Check className="h-4 w-4" /> : index + 1}</span><span className={index === 2 ? "whitespace-nowrap text-[#3f35d6]" : "whitespace-nowrap"}>{step}</span>{index < 3 ? <span className={cn("h-px min-w-3 flex-1", index < 2 ? "bg-[#5147dc]" : "bg-[#dfe0e8]")} /> : null}</div>)}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {data.sessions.length ? <Card className="flex flex-wrap items-center gap-2 p-3">{data.sessions.length > 1 ? <label className="text-xs font-semibold">Sessões desta jornada<select className="ml-2 h-9 max-w-full rounded-[5px] border border-[#dddde6] bg-white px-2 text-xs" value={sessionId} onChange={(event) => { const next = data.sessions.find((item) => item.id === event.target.value); if (next) { setSessionId(next.id); setDraft(toDraft(next)); setSelectedProcedureId(data.procedures.find((procedureItem) => procedureItem.name === next.procedureName)?.id ?? ""); } }}>{data.sessions.map((item, index) => <option key={item.id} value={item.id}>Sessão {data.sessions.length - index} · {new Date(item.performedAt).toLocaleDateString("pt-BR")} · {item.status}</option>)}</select></label> : <span className="text-xs font-semibold">Sessão · {new Date(draft.performedAt).toLocaleDateString("pt-BR")} · {draft.status}</span>}<Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || draft.status !== "Concluída"} onClick={() => void createSession()}><Plus className="h-4 w-4" />Nova sessão</Button></Card> : null}
          <Card className="p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><Syringe className="h-4 w-4 text-[#5147dc]" />Registro do procedimento</h3><div className="mt-3 grid gap-3 rounded-[5px] bg-[#f7f7fb] p-3 sm:grid-cols-2 xl:grid-cols-4"><Summary label="Procedimento" value={procedure?.name ?? draft.procedureName} /><Summary label="Profissional" value={draft.professional || "Não informado"} /><Summary label="Data" value={new Date(draft.performedAt).toLocaleDateString("pt-BR")} /><Summary label="Status" value={draft.status} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Field label="Procedimento" required><select className={inputClass} disabled={!canWrite} value={selectedProcedureId} onChange={(event) => { setSelectedProcedureId(event.target.value); const selected = data.procedures.find((item) => item.id === event.target.value); if (selected) patchDraft({ procedureName: selected.name, estimatedMinutes: selected.durationMinutes }); }}><option value="">Selecione</option>{data.quote.items.map((item) => <option key={item.procedureId} value={item.procedureId}>{item.name}</option>)}</select></Field><Field label="Técnica utilizada" required><input className={inputClass} disabled={!canWrite} value={draft.technique} onChange={(event) => patchDraft({ technique: event.target.value })} placeholder="Descreva a técnica" /></Field><Field label="Região tratada" required><input className={inputClass} disabled={!canWrite} value={draft.treatedAreas} onChange={(event) => patchDraft({ treatedAreas: event.target.value })} placeholder="Ex.: lábios" /></Field><Field label="Profissional responsável" required><input className={inputClass} disabled={!canWrite} value={draft.professional} onChange={(event) => patchDraft({ professional: event.target.value })} placeholder="Profissional" /></Field><Field label="Data"><input className={inputClass} type="date" disabled={!canWrite} value={draft.performedAt.slice(0, 10)} onChange={(event) => patchDraft({ performedAt: new Date(`${event.target.value}T12:00:00`).toISOString() })} /></Field><Field label="Horário de início"><input className={inputClass} type="time" disabled={!canWrite} value={draft.startedAt ? new Date(draft.startedAt).toTimeString().slice(0, 5) : ""} onChange={(event) => patchDraft({ startedAt: event.target.value ? combineLocalTime(draft.performedAt, event.target.value) : null })} /></Field><Field label="Tempo estimado (min)"><input className={inputClass} type="number" min={0} max={1440} disabled={!canWrite} value={draft.estimatedMinutes ?? procedure?.durationMinutes ?? ""} onChange={(event) => patchDraft({ estimatedMinutes: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Duração real (min)"><input className={inputClass} type="number" min={0} max={1440} disabled={!canWrite} value={draft.durationMinutes ?? ""} onChange={(event) => patchDraft({ durationMinutes: event.target.value ? Number(event.target.value) : null })} /></Field><Field label="Anestesia"><input className={inputClass} disabled={!canWrite} value={draft.anesthesia} onChange={(event) => patchDraft({ anesthesia: event.target.value })} placeholder="Não informado" /></Field><Field label="Intercorrências"><input className={inputClass} disabled={!canWrite} value={draft.complications} onChange={(event) => patchDraft({ complications: event.target.value })} placeholder="Não informado" /></Field><Field className="sm:col-span-2 xl:col-span-2" label="Observações da sessão"><textarea className={cn(inputClass, "min-h-10 resize-y py-2")} disabled={!canWrite} maxLength={5000} value={draft.observations} onChange={(event) => patchDraft({ observations: event.target.value })} placeholder="Observações clínicas" /></Field></div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-[5px] border border-[#ececf2] p-3 text-[10px]"><strong>Queixa principal</strong><p className="mt-1 text-[#6f7082]">{data.evaluation.chiefComplaint || "Não informado na avaliação"}</p></div><div className="rounded-[5px] border border-[#ececf2] p-3 text-[10px]"><strong>Alergias e contraindicações</strong><p className="mt-1 text-[#6f7082]">{[data.evaluation.allergies, data.evaluation.contraindications].filter(Boolean).join(" · ") || "Não informado na avaliação"}</p></div></div></Card>

          <Card className="overflow-hidden p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-bold"><Syringe className="h-4 w-4 text-[#5147dc]" />Produtos e materiais utilizados</h3><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={!canWrite} onClick={addSuggestedMaterials}><Plus className="h-4 w-4" />Sugestões da ficha técnica</Button><label className="relative"><select className="h-9 min-w-48 appearance-none rounded-[5px] border border-[#dddde6] bg-white px-3 pr-7 text-[10px]" disabled={!canWrite} value={materialProductId} onChange={(event) => addMaterial(event.target.value)}><option value="">Adicionar produto</option>{data.materials.filter((item) => !materials.some((used) => used.productId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-[10px]"><thead><tr className="bg-[#f7f7fb] text-[#737486]"><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Quantidade</th><th className="px-3 py-2">Lote e validade</th><th className="px-3 py-2">Saldo</th><th className="w-10" /></tr></thead><tbody>{materials.map((item, index) => { const productData = data.materials.find((product) => product.id === item.productId); const allocation = item.allocations[0]; const lot = productData?.lots.find((candidate) => candidate.id === allocation?.lotId); return <tr key={item.productId} className="border-b border-[#ececf2]"><td className="px-3 py-2.5 font-semibold">{productData?.name ?? item.name ?? "Produto indisponível"}<span className="block text-[9px] font-normal text-[#898a9a]">{productData?.unit ?? item.unit ?? "unidade"}</span></td><td className="px-3 py-2.5"><input className="h-8 w-24 rounded-[5px] border border-[#dddde6] px-2" type="number" min="0.001" step="0.001" disabled={!canWrite} value={item.quantity} onChange={(event) => setMaterialQuantity(index, Number(event.target.value))} /></td><td className="px-3 py-2.5"><select className="h-8 min-w-40 rounded-[5px] border border-[#dddde6] bg-white px-2" disabled={!canWrite} value={allocation?.lotId ?? ""} onChange={(event) => { const selectedLot = productData?.lots.find((candidate) => candidate.id === event.target.value); setMaterial(index, { allocations: selectedLot ? [{ lotId: selectedLot.id, quantity: Math.min(item.quantity, selectedLot.balance), code: selectedLot.code, expiresOn: selectedLot.expiresOn }] : [] }); }}><option value="">Selecionar lote</option>{productData?.lots.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.code} · vence {candidate.expiresOn.split("-").reverse().join("/")}</option>)}</select>{allocation && lot ? <span className="ml-2 text-[9px] text-[#6f7082]">Válido até {lot.expiresOn.split("-").reverse().join("/")}</span> : allocation ? <span className="ml-2 text-[9px] text-[#6f7082]">{allocation.code} · validade {allocation.expiresOn?.split("-").reverse().join("/")}</span> : null}</td><td className="px-3 py-2.5">{lot ? `${lot.balance} ${productData?.unit ?? "un"}` : allocation ? "Saldo indisponível" : "Sem lote selecionado"}</td><td className="px-3 py-2.5"><button type="button" className="rounded p-1 text-[#b42318]" disabled={!canWrite} aria-label={`Remover ${item.name ?? "produto"}`} onClick={() => patchDraft({ materials: materials.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></button></td></tr>; })}{materials.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[#858696]">Nenhum material registrado para esta sessão.</td></tr> : null}</tbody></table></div><p className="mt-2 text-[9px] text-[#77788a]">O estoque é movimentado somente ao finalizar a sessão. O uso sem saldo disponível gera uma saída pendente conforme as regras do estoque.</p></Card>

          <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="flex items-center gap-2 text-sm font-bold"><Camera className="h-4 w-4 text-[#5147dc]" />Fotografias da sessão</h3><p className="mt-1 text-[10px] text-[#77788a]">As imagens originais da avaliação permanecem preservadas.</p></div><div className="flex flex-wrap gap-2"><select className="h-9 rounded-[5px] border border-[#dddde6] bg-white px-2 text-[10px]" value={photoPhase} onChange={(event) => setPhotoPhase(event.target.value as SessionPhoto["phase"])} aria-label="Categoria da nova fotografia"><option>Antes</option><option>Imediatamente após</option></select><Button size="sm" type="button" variant="outline" disabled={!canWrite} onClick={requestCamera}><Camera className="h-4 w-4" />Capturar foto</Button><Button size="sm" type="button" variant="outline" disabled={!canWrite} onClick={() => (photoPhase === "Antes" ? beforeInputRef : afterInputRef).current?.click()}><ImagePlus className="h-4 w-4" />Upload</Button><input ref={beforeInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadFiles(event.target.files, "Antes"); event.target.value = ""; }} /><input ref={afterInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadFiles(event.target.files, "Imediatamente após"); event.target.value = ""; }} /></div></div>
            {cameraOpen ? <div className="mt-3 space-y-2 rounded-[5px] bg-[#15151d] p-3"><video ref={videoRef} autoPlay playsInline className="mx-auto max-h-[360px] w-full rounded object-contain" /><div className="flex justify-center gap-2"><Button onClick={captureCamera}><Camera className="h-4 w-4" />Capturar</Button><Button variant="outline" onClick={() => setCameraOpen(false)}><X className="h-4 w-4" />Cancelar</Button></div></div> : null}
            <div className="mt-4 grid gap-4 lg:grid-cols-2">{(["Antes", "Imediatamente após"] as const).map((phase) => { const phasePhotos = photos.filter((photo) => photo.phase === phase); return <div key={phase}><h4 className="mb-2 text-[10px] font-bold text-[#555668]">{phase} · {phasePhotos.length}</h4><div className="grid grid-cols-2 gap-2">{phasePhotos.map((photo) => <div key={photo.id} className="group relative overflow-hidden rounded-[5px] border border-[#e5e5ee]"><button type="button" className="block aspect-[4/3] w-full bg-[#f7f7fb]" onClick={() => setPreview(photo)}><img alt={`${phase}: ${photo.name}`} src={photo.imageUrl} className="h-full w-full object-cover" /></button><span className="block truncate px-2 py-1 text-[9px]">{photo.category} · {photo.name}</span>{canWrite ? <button type="button" aria-label="Remover foto da sessão" className="absolute right-1 top-1 rounded bg-white/90 p-1 text-[#b42318] shadow" onClick={() => patchDraft({ photos: photos.filter((item) => item.id !== photo.id) })}><X className="h-3.5 w-3.5" /></button> : null}</div>)}{phase === "Antes" ? initialPhotos.filter((photo) => !photos.some((item) => item.sourceEvaluationPhotoId === photo.id && item.phase === "Antes")).slice(0, 4).map((photo) => <div key={`initial-${photo.id}`} className="overflow-hidden rounded-[5px] border border-dashed border-[#cfcfe0]"><button type="button" className="block aspect-[4/3] w-full bg-[#f7f7fb]" onClick={() => setPreview(photo)}><img alt={`Foto inicial: ${photo.name}`} src={photo.imageUrl} className="h-full w-full object-cover" /></button><Button className="w-full" size="sm" variant="outline" disabled={!canWrite} onClick={() => selectInitialPhoto(photo, "Antes")}><Plus className="h-3 w-3" />Usar como foto antes</Button></div>) : null}{!phasePhotos.length && (phase === "Imediatamente após" || !initialPhotos.length) ? <button type="button" disabled={!canWrite} onClick={() => { setPhotoPhase(phase); (phase === "Antes" ? beforeInputRef : afterInputRef).current?.click(); }} className="grid aspect-[4/3] place-items-center rounded-[5px] border border-dashed border-[#d3d4e0] text-[10px] text-[#808193]">Adicionar foto</button> : null}</div></div>; })}</div>
          </Card>

          <Card className="p-4"><h3 className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-[#5147dc]" />Termos e confirmações</h3><div className="mt-3 grid gap-2 sm:grid-cols-3"><div className="rounded-[5px] border border-[#ececf2] p-3 text-[10px]"><strong>Consentimento</strong><p className="mt-1 text-[#77788a]">{data.consent.status}</p></div><div className="rounded-[5px] border border-[#ececf2] p-3 text-[10px]"><strong>Responsável</strong><p className="mt-1 text-[#77788a]">{draft.professional || "Não informado"}</p></div><div className="rounded-[5px] border border-[#ececf2] p-3 text-[10px]"><strong>Registro da sessão</strong><p className="mt-1 text-[#77788a]">{draft.status === "Concluída" ? `Concluída por ${draft.completedBy ?? draft.updatedBy}` : "Rascunho · não finalizada"}</p></div></div><div className="mt-3 flex items-start gap-2 rounded-[5px] bg-[#fff8e9] p-3 text-[10px] text-[#845700]"><ShieldAlert className="h-4 w-4 shrink-0" /><p>O prontuário não possui um registro consultável de assinatura para esta sessão. Nenhum termo será apresentado como assinado.</p></div>{draft.auditLog?.length ? <div className="mt-4 border-t border-[#ececf2] pt-3"><h4 className="text-[10px] font-bold">Histórico de alterações</h4><ol className="mt-2 space-y-2">{[...draft.auditLog].reverse().slice(0, 5).map((entry, index) => <li key={`${entry.at}-${index}`} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[9px]"><span><strong>{entry.action}</strong><span className="block text-[#77788a]">{entry.actor}{entry.fields.length ? ` · ${entry.fields.map(auditFieldLabel).join(", ")}` : ""}</span></span><time className="text-[#858696]">{new Date(entry.at).toLocaleString("pt-BR")}</time></li>)}</ol></div> : null}</Card>
          {notice ? <p role="status" className={cn("rounded-[5px] px-3 py-2 text-xs font-semibold", notice.error ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eef8f2] text-[#287a50]")}>{notice.text}</p> : null}
        </div>
        <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start"><Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Resumo da sessão</h3><Summary label="Etapa atual" value="Procedimento" /><Summary label="Profissional" value={draft.professional || "Não informado"} /><Summary label="Início" value={draft.startedAt ? new Date(draft.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Ainda não iniciado"} /><Summary label="Término" value={draft.endedAt ? new Date(draft.endedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Em aberto"} /><Summary label="Fotos anexadas" value={String(photos.length)} />{selectedSession ? <p className="border-t border-[#ececf2] pt-2 text-[9px] text-[#77788a]">Última alteração em {new Date(selectedSession.updatedAt).toLocaleString("pt-BR")} por {selectedSession.updatedBy || "responsável não informado"}</p> : null}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Checklist do procedimento</h3>{[["Técnica e região informadas", doneChecklist[0]], ["Produtos e lotes registrados", doneChecklist[1] && materials.length > 0], ["Fotos antes e depois anexadas", doneChecklist[2]], ["Sessão concluída", doneChecklist[3]]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-[10px]"><span className={cn("grid h-4 w-4 place-items-center rounded-[3px] border", done ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c9cad6]")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Próximas ações</h3><Button className="w-full justify-between" variant="outline" disabled={Boolean(busy) || !canWrite} onClick={() => void save()}><span className="flex items-center gap-2"><Save className="h-4 w-4" />Salvar sessão</span><ArrowRight className="h-4 w-4" /></Button>{draft.status === "Concluída" ? <Button className="w-full justify-between" variant="outline" onClick={() => onCompleted(sessionId)}><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />Abrir acompanhamento</span><ArrowRight className="h-4 w-4" /></Button> : draft.status === "Rascunho" ? <Button className="w-full justify-between" disabled={Boolean(busy)} onClick={() => void save("Em execução")}><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />Iniciar procedimento</span><ArrowRight className="h-4 w-4" /></Button> : <Button className="w-full justify-between" disabled={Boolean(busy)} onClick={() => void finish()}><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Finalizar sessão</span><ArrowRight className="h-4 w-4" /></Button>}</Card></aside>
      </div>
      {preview ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Visualização da fotografia" onClick={() => setPreview(null)}><div className="relative max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}><img src={preview.imageUrl} alt={preview.name} className="max-h-[85vh] max-w-[88vw] object-contain" /><button type="button" aria-label="Fechar visualização" onClick={() => setPreview(null)} className="absolute -right-3 -top-3 rounded-full bg-white p-2 text-[#27283b]"><X className="h-4 w-4" /></button></div></div> : null}
    </div>
  );
}

const inputClass = "h-9 w-full rounded-[5px] border border-[#dfe0e8] bg-white px-2.5 text-[10px] text-[#38394d] outline-none focus:border-[#5147dc] disabled:bg-[#f5f5f9]";
function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) { return <label className={cn("block text-[10px] font-semibold text-[#696a7b]", className)}>{label}{required ? <span className="text-[#b42318]"> *</span> : null}<span className="mt-1 block">{children}</span></label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-[10px]"><span className="flex items-center gap-1.5 text-[#717285]"><UserRound className="h-3 w-3" />{label}</span><strong className="text-right text-[#3e3f52]">{value}</strong></div>; }
function toDraft(session: Session): Session { return { ...session, materials: Array.isArray(session.materials) ? session.materials : [], photos: Array.isArray(session.photos) ? session.photos : [], auditLog: Array.isArray(session.auditLog) ? session.auditLog : [] }; }
function allocateSessionLots(product: Product, quantity: number): Allocation[] {
  const lot = product.lots.find((candidate) => candidate.balance >= quantity) ?? product.lots.find((candidate) => candidate.balance > 0);
  return lot ? [{ lotId: lot.id, quantity: Math.min(quantity, lot.balance), code: lot.code, expiresOn: lot.expiresOn }] : [];
}
function resizeSessionLots(allocations: Allocation[], quantity: number): Allocation[] {
  let remaining = Math.max(0, quantity);
  return allocations.flatMap((allocation) => {
    const allocated = Math.min(remaining, allocation.quantity);
    remaining -= allocated;
    return allocated > 0 ? [{ ...allocation, quantity: allocated }] : [];
  });
}
function auditFieldLabel(field: string) { return ({ technique: "técnica", treatedAreas: "região", professional: "profissional", performedAt: "data", startedAt: "horário", estimatedMinutes: "tempo estimado", durationMinutes: "duração", anesthesia: "anestesia", complications: "intercorrências", observations: "observações", materials: "materiais", photos: "fotografias" } as Record<string, string>)[field] ?? field; }
function combineLocalTime(date: string, time: string) { const day = new Date(date); const [hours, minutes] = time.split(":").map(Number); day.setHours(hours, minutes, 0, 0); return day.toISOString(); }
function inferCategory(name: string) { if (/frontal/i.test(name)) return "Frontal"; if (/perfil.?d|direito/i.test(name)) return "Perfil direito"; if (/perfil.?e|esquerdo/i.test(name)) return "Perfil esquerdo"; if (/sorriso/i.test(name)) return "Sorriso"; return "Outra"; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Falha ao ler a foto.")); reader.onerror = () => reject(new Error("Falha ao ler a foto.")); reader.readAsDataURL(file); }); }
function imageDimensions(src: string) { return new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("Imagem inválida.")); image.src = src; }); }
