"use client";

/* eslint-disable @next/next/no-img-element -- Preserve exact clinical image rendering from private data URLs. */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Expand, ImagePlus, LoaderCircle, Maximize2, Save, ShieldCheck, Upload, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { cn } from "@/lib/utils";
import type { Patient } from "@/types/clinic";
import { LoadingSkeleton } from "./shared";
import { useCan } from "./current-user";

type ClinicalPhoto = { id: string; name: string; category: string; phase: string; imageUrl: string; width: number; height: number; capturedAt: string; source: string; sessionId: string | null };
type Appointment = { id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string };
type FollowUp = { id: string; occurredAt: string; professional: string; guidanceText: string; guidanceSentAt: string | null; observations: string; complications: string; photos: Array<{ id: string; name: string; category: string; imageUrl: string; width: number; height: number }>; appointment: Appointment | null; createdBy: string; updatedAt: string; auditLog: Array<{ at: string; actor: string; action: string; fields: string[] }> };
type WorkspaceData = { session: { id: string; journeyId: string; procedureName: string; professional: string; performedAt: string; status: string }; journey: { name: string; status: string; appointments: Appointment[] }; sessions: Array<{ id: string; procedureName: string; professional: string; performedAt: string }>; photos: ClinicalPhoto[]; followUps: FollowUp[] };
type DraftPhoto = { id: string; name: string; category: string; imageUrl: string; width: number; height: number };
const categories = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"];
const labels = (photo: ClinicalPhoto) => `${photo.category} · ${photo.phase} · ${new Date(photo.capturedAt).toLocaleDateString("pt-BR")}`;

export function PostProcedureWorkspace({ patient, patientId, journeyId, sessionId, onFinish }: { patient: Patient; patientId: string; journeyId: string; sessionId: string; onFinish: () => void }) {
  const canWrite = useCan("clinical:write");
  const cacheKey = `/api/patients/${encodeURIComponent(patientId)}/procedure-sessions/${encodeURIComponent(sessionId)}/follow-ups?journeyId=${encodeURIComponent(journeyId)}`;
  const cached = readClientCache<WorkspaceData>(cacheKey);
  const [data, setData] = useState<WorkspaceData | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [observations, setObservations] = useState("");
  const [complications, setComplications] = useState("");
  const [guidanceText, setGuidanceText] = useState("");
  const [guidanceConfirmed, setGuidanceConfirmed] = useState(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [viewMode, setViewMode] = useState<"slider" | "side-by-side">("slider");
  const [reveal, setReveal] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<ClinicalPhoto | DraftPhoto | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentNotice, setAppointmentNotice] = useState("");
  const [category, setCategory] = useState("Frontal");
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  const initials = patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");

  const reload = useCallback(async () => {
    const fresh = await getCachedJson<WorkspaceData>(cacheKey);
    setData(fresh);
    setError("");
    return fresh;
  }, [cacheKey]);

  useEffect(() => {
    let active = true;
    getCachedJson<WorkspaceData>(cacheKey).then((next) => { if (active) setData(next); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cacheKey]);

  const beforePhotos = useMemo(() => (data?.photos ?? []).filter((photo) => photo.phase === "Antes"), [data]);
  const afterPhotos = useMemo(() => (data?.photos ?? []).filter((photo) => photo.phase !== "Antes"), [data]);
  const selectedBefore = beforePhotos.find((photo) => photo.id === beforeId) ?? beforePhotos.find((photo) => photo.category === category) ?? beforePhotos[0];
  const selectedAfter = afterPhotos.find((photo) => photo.id === afterId) ?? afterPhotos.find((photo) => photo.category === selectedBefore?.category) ?? afterPhotos[0];
  const attendedAppointments = (data?.journey.appointments ?? []).filter((appointment) => /retorno/i.test(appointment.procedure) && ["Atendido", "Finalizado"].includes(appointment.status));
  const upcomingAppointments = (data?.journey.appointments ?? []).filter((appointment) => /retorno/i.test(appointment.procedure) && ["Agendado", "Em atendimento"].includes(appointment.status));
  const allPhotos = data?.photos ?? [];
  const hasUnsavedChanges = Boolean(observations.trim() || complications.trim() || guidanceText.trim() || photos.length || selectedAppointmentId);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
  }, [cameraOpen]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function openCamera() {
    setError("");
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      setCameraOpen(true);
    } catch {
      setError("Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie uma foto.");
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function finishAttendance() {
    if (hasUnsavedChanges && !window.confirm("Há dados de acompanhamento ainda não salvos. Deseja sair sem registrá-los?")) return;
    onFinish();
  }

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const imageUrl = canvas.toDataURL("image/jpeg", 0.96);
    setPhotos((current) => [...current, { id: crypto.randomUUID(), name: `Evolução ${category.toLocaleLowerCase("pt-BR")}`, category, imageUrl, width: canvas.width, height: canvas.height }]);
    closeCamera();
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setError("");
    if (photos.length + files.length > 12) { setError("Você pode incluir até 12 imagens por registro."); return; }
    const next: DraftPhoto[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 6 * 1024 * 1024) throw new Error("Envie imagens JPEG, PNG ou WebP de até 6 MB cada.");
        const imageUrl = await fileToDataUrl(file);
        const dimensions = await imageDimensions(imageUrl);
        if (dimensions.width * dimensions.height > 25_000_000 || dimensions.width > 8000 || dimensions.height > 8000) throw new Error("Uma imagem ultrapassa o limite de resolução permitido.");
        next.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180), category, imageUrl, ...dimensions });
      }
      if (photos.reduce((sum, photo) => sum + photo.imageUrl.length, 0) + next.reduce((sum, photo) => sum + photo.imageUrl.length, 0) > 24_000_000) throw new Error("Salve este registro antes de incluir mais imagens.");
      setPhotos((current) => [...current, ...next]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível ler as imagens.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveFollowUp() {
    if (!data || saving) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(cacheKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ professional: data.session.professional, observations, complications, guidanceText, guidanceSent: guidanceConfirmed, photos, ...(selectedAppointmentId ? { appointmentId: selectedAppointmentId } : {}) }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível salvar o acompanhamento.");
      invalidateClientCache(cacheKey, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`, `/api/patients/${encodeURIComponent(patientId)}/history`);
      await reload();
      setObservations(""); setComplications(""); setGuidanceText(""); setGuidanceConfirmed(false); setPhotos([]); setSelectedAppointmentId("");
      setNotice("Acompanhamento registrado no histórico clínico.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o acompanhamento.");
    } finally { setSaving(false); }
  }

  async function scheduleReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || booking) return;
    setBooking(true); setError(""); setAppointmentNotice("");
    try {
      const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, journeyId: data.session.journeyId, procedure: `Retorno - ${data.session.procedureName}`, professional: data.session.professional, date: appointmentDate, time: appointmentTime, notes: appointmentNotes }) });
      const result = await response.json().catch(() => ({})) as { appointment?: Appointment; message?: string };
      if (!response.ok || !result.appointment) throw new Error(result.message ?? "Não foi possível agendar o retorno.");
      invalidateClientCache("/api/agenda/bootstrap", "/api/dashboard/bootstrap", `/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`);
      setAppointmentNotice(`Retorno agendado para ${new Date(result.appointment.date).toLocaleDateString("pt-BR")} às ${result.appointment.time}.`);
      setAppointmentOpen(false); setAppointmentDate(""); setAppointmentTime(""); setAppointmentNotes("");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível agendar o retorno.");
    } finally { setBooking(false); }
  }

  async function toggleFullscreen() {
    const element = compareRef.current;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element.requestFullscreen();
  }

  if (loading && !data) return <div className="mx-auto max-w-[1400px] space-y-4"><LoadingSkeleton className="h-24 w-full" /><div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.75fr)]"><LoadingSkeleton className="h-[28rem] w-full" /><LoadingSkeleton className="h-[28rem] w-full" /></div></div>;
  if (error && !data) return <Card className="mx-auto max-w-3xl p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento.")).finally(() => setLoading(false)); }}>Tentar novamente</Button></Card>;
  if (!data) return null;

  return <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
    <button type="button" onClick={onFinish} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar ao prontuário</button>
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials}</div><div className="min-w-0"><h1 className="truncate text-base font-bold">{patient.name}</h1><p className="mt-1 text-xs text-muted-foreground">{data.journey.name} · {data.session.procedureName} · Sessão de {new Date(data.session.performedAt).toLocaleDateString("pt-BR")}</p><p className="mt-1 text-[11px] text-muted-foreground">Profissional: {data.session.professional} · Sessão concluída; tratamento permanece {data.journey.status.toLocaleLowerCase("pt-BR")}</p></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={finishAttendance}><ArrowLeft className="h-4 w-4" />Finalizar atendimento</Button></div>
    </Card>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento."))}>Tentar novamente</Button></div> : null}
    {notice ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p> : null}
    {appointmentNotice ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{appointmentNotice}</p> : null}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.78fr)]">
      <div className="space-y-4">
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold"><ImagePlus className="h-4 w-4 text-primary" />Comparação antes e depois</h2><p className="mt-1 text-xs text-muted-foreground">Imagens clínicas originais, sem filtros ou ajustes de aparência.</p></div><div className="flex items-center gap-2"><div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Modo de comparação"><button type="button" aria-pressed={viewMode === "slider"} onClick={() => setViewMode("slider")} className={cn("rounded px-2.5 py-1.5 text-[11px]", viewMode === "slider" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Controle</button><button type="button" aria-pressed={viewMode === "side-by-side"} onClick={() => setViewMode("side-by-side")} className={cn("rounded px-2.5 py-1.5 text-[11px]", viewMode === "side-by-side" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Lado a lado</button></div><label className="sr-only" htmlFor="photo-zoom">Zoom</label><select id="photo-zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="h-8 rounded-md border border-border bg-background px-2 text-xs"><option value={1}>1×</option><option value={1.25}>1,25×</option><option value={1.5}>1,5×</option><option value={2}>2×</option></select><Button variant="outline" size="icon" aria-label="Abrir comparação em tela cheia" title="Tela cheia" onClick={() => void toggleFullscreen()}><Maximize2 className="h-4 w-4" /></Button></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><PhotoPicker label="Antes" photos={beforePhotos} value={selectedBefore?.id ?? ""} onChange={setBeforeId} empty="Sem fotos anteriores nesta avaliação." /><PhotoPicker label="Depois / evolução" photos={afterPhotos} value={selectedAfter?.id ?? ""} onChange={setAfterId} empty="Ainda não há foto de resultado ou evolução." /></div>
          {selectedBefore && selectedAfter ? <div ref={compareRef} className="relative overflow-hidden rounded-md border border-border bg-black/5 p-2 focus:outline-none fullscreen:flex fullscreen:h-screen fullscreen:w-screen fullscreen:items-center fullscreen:justify-center fullscreen:rounded-none fullscreen:border-0 fullscreen:bg-black fullscreen:p-0"><div className={cn("relative mx-auto overflow-hidden bg-white fullscreen:aspect-auto fullscreen:h-full fullscreen:max-h-full fullscreen:w-full", viewMode === "slider" ? "aspect-[4/3] max-h-[65vh]" : "grid aspect-[4/3] max-h-[65vh] grid-cols-2 gap-2")}>
            {viewMode === "slider" ? <div className="absolute inset-0 grid place-items-center overflow-hidden"><div className="relative h-full w-full" style={{ transform: `scale(${zoom})` }}><img src={selectedAfter.imageUrl} alt={`${selectedAfter.category}, ${selectedAfter.phase}`} className="absolute inset-0 h-full w-full object-contain" /><div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}><img src={selectedBefore.imageUrl} alt={`${selectedBefore.category}, antes`} className="absolute inset-0 h-full w-full object-contain" /></div><span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">Antes</span><span className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">Depois</span><div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow" style={{ left: `${reveal}%` }}><span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-white shadow"><ChevronLeft className="h-4 w-4" /><ChevronRight className="-ml-2 h-4 w-4" /></span></div><input aria-label="Arraste horizontalmente para revelar antes e depois" title="Arraste para comparar" type="range" min="0" max="100" value={reveal} onChange={(event) => setReveal(Number(event.target.value))} className="absolute inset-0 z-10 h-full w-full cursor-col-resize touch-none opacity-0" /></div></div> : <><PhotoCanvas photo={selectedBefore} title="Antes" zoom={zoom} onPreview={() => setPreview(selectedBefore)} /><PhotoCanvas photo={selectedAfter} title={selectedAfter.phase === "Evolução" ? "Evolução" : "Resultado"} zoom={zoom} onPreview={() => setPreview(selectedAfter)} /></>}
          </div></div> : <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center"><div><ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">Comparação indisponível</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">Para comparar, são necessárias fotos reais antes e depois da sessão.</p></div></div>}
          {selectedBefore && selectedAfter ? <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground"><span>Antes: {labels(selectedBefore)}</span><span aria-hidden="true">·</span><span>Depois: {labels(selectedAfter)}</span></div> : null}
          <div className="flex flex-wrap gap-2">{categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className={cn("rounded-md border px-2.5 py-1.5 text-[10px]", category === item ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground")}>{item}</button>)}</div>
          {allPhotos.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{allPhotos.map((photo) => <button key={`${photo.source}-${photo.id}`} type="button" onClick={() => photo.phase === "Antes" ? setBeforeId(photo.id) : setAfterId(photo.id)} onDoubleClick={() => setPreview(photo)} aria-label={`Selecionar e ampliar ${photo.name}`} className={cn("overflow-hidden rounded-md border text-left", photo.id === selectedBefore?.id || photo.id === selectedAfter?.id ? "border-primary ring-1 ring-primary" : "border-border")}><img src={photo.imageUrl} alt={photo.name} className="aspect-square w-full bg-muted object-contain" /><span className="block truncate px-1.5 py-1 text-[9px] text-muted-foreground">{photo.category} · {photo.phase}</span></button>)}</div> : null}
        </Card>

      <Card className="space-y-3 p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-primary" />Orientações pós-procedimento</h2><p className="text-xs text-muted-foreground">Registre o texto e confirme somente depois de enviar por um canal da clínica.</p><textarea value={guidanceText} onChange={(event) => setGuidanceText(event.target.value)} maxLength={5000} rows={4} placeholder="Orientações repassadas ao paciente..." className="w-full rounded-md border border-border bg-background p-3 text-xs outline-none focus:border-primary" /><label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={guidanceConfirmed} onChange={(event) => setGuidanceConfirmed(event.target.checked)} className="mt-0.5 accent-primary" />Confirmo que estas orientações foram efetivamente enviadas ao paciente.</label></Card>

        <Card className="space-y-4 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold"><Camera className="h-4 w-4 text-primary" />Fotografias de evolução</h2><p className="mt-1 text-xs text-muted-foreground">Novos arquivos serão vinculados a esta sessão e preservados sem retoques.</p></div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void openCamera()}><Camera className="h-4 w-4" />Capturar</Button><Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />Enviar fotos</Button><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => void addFiles(event.target.files)} /></div></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(160px,0.45fr)_1fr]"><label className="text-[10px] font-semibold text-muted-foreground">Categoria<select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-xs">{categories.map((item) => <option key={item}>{item}</option>)}</select></label><div className="flex items-end text-[10px] text-muted-foreground">{photos.length ? `${photos.length} foto(s) aguardando salvamento neste registro` : `${allPhotos.length} fotografia(s) disponíveis no histórico desta jornada`}</div></div>
          {photos.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{photos.map((photo) => <div key={photo.id} className="relative overflow-hidden rounded-md border border-border"><button type="button" onClick={() => setPreview(photo)} className="block w-full"><img src={photo.imageUrl} alt={photo.name} className="aspect-[4/3] w-full bg-muted object-contain" /><span className="block truncate px-2 py-1 text-[10px]">{photo.category} · {photo.name}</span></button><button type="button" aria-label={`Remover ${photo.name}`} onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))} className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white"><X className="h-3.5 w-3.5" /></button></div>)}</div> : null}
          {cameraOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Capturar fotografia"><div className="w-full max-w-2xl rounded-md bg-background p-4"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Capturar fotografia de evolução</h3><Button variant="ghost" size="icon" aria-label="Fechar câmera" onClick={closeCamera}><X className="h-4 w-4" /></Button></div><video ref={videoRef} autoPlay playsInline className="max-h-[65vh] w-full rounded-md bg-black object-contain" /><div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={closeCamera}>Cancelar</Button><Button onClick={() => void capturePhoto()}><Camera className="h-4 w-4" />Capturar</Button></div></div></div> : null}
        </Card>

        <Card className="space-y-3 p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-bold"><CircleAlert className="h-4 w-4 text-primary" />Evolução e intercorrências</h2><label className="block text-[10px] font-semibold text-muted-foreground">Observações clínicas<textarea value={observations} onChange={(event) => setObservations(event.target.value)} maxLength={5000} rows={4} placeholder="Evolução observada, resposta ao tratamento e conduta..." className="mt-1 w-full rounded-md border border-border bg-background p-3 text-xs outline-none focus:border-primary" /></label><label className="block text-[10px] font-semibold text-muted-foreground">Intercorrências registradas<textarea value={complications} onChange={(event) => setComplications(event.target.value)} maxLength={5000} rows={3} placeholder="Registre intercorrências ou informe que não houve, quando aplicável..." className="mt-1 w-full rounded-md border border-border bg-background p-3 text-xs outline-none focus:border-primary" /></label><label className="block text-[10px] font-semibold text-muted-foreground">Vincular retorno atendido<select value={selectedAppointmentId} onChange={(event) => setSelectedAppointmentId(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-xs"><option value="">Sem retorno associado</option>{attendedAppointments.map((appointment) => <option key={appointment.id} value={appointment.id}>{new Date(appointment.date).toLocaleDateString("pt-BR")} · {appointment.procedure}</option>)}</select></label><Button disabled={saving || !canWrite} onClick={() => void saveFollowUp()}><Save className="h-4 w-4" />{saving ? "Salvando..." : "Salvar evolução"}</Button></Card>

        <Card className="space-y-3 p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-primary" />Histórico da jornada</h2><ol className="space-y-2">{data.sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"><span className="text-xs"><strong>{session.procedureName}</strong><span className="text-muted-foreground"> · {new Date(session.performedAt).toLocaleDateString("pt-BR")} · {session.professional}</span></span><span className="text-[10px] text-muted-foreground">Sessão concluída</span></li>)}{data.journey.appointments.filter((appointment) => /retorno/i.test(appointment.procedure)).map((appointment) => <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"><span className="text-xs"><strong>{new Date(appointment.date).toLocaleDateString("pt-BR")} · {appointment.time}</strong><span className="text-muted-foreground"> · {appointment.procedure}</span></span><span className="text-[10px] text-muted-foreground">{appointment.status}</span></li>)}</ol><h3 className="pt-2 text-xs font-bold">Registros clínicos</h3>{data.followUps.length ? <ol className="space-y-3">{[...data.followUps].reverse().map((record) => <li key={record.id} className="border-l-2 border-primary/30 pl-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-xs">{new Date(record.occurredAt).toLocaleString("pt-BR")} · {record.professional}</strong><span className="text-[10px] text-muted-foreground">Registrado por {record.createdBy}</span></div>{record.guidanceSentAt ? <p className="mt-1 text-xs text-emerald-800">Orientações registradas como enviadas em {new Date(record.guidanceSentAt).toLocaleString("pt-BR")}</p> : null}{record.guidanceText ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{record.guidanceText}</p> : null}{record.observations ? <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{record.observations}</p> : null}{record.complications ? <p className="mt-1 whitespace-pre-wrap text-xs text-amber-800">Intercorrência: {record.complications}</p> : null}{record.appointment ? <p className="mt-1 text-xs text-muted-foreground">Retorno: {new Date(record.appointment.date).toLocaleDateString("pt-BR")} · {record.appointment.status}</p> : null}{record.photos.length ? <div className="mt-2 flex gap-2">{record.photos.map((photo) => <img key={photo.id} src={photo.imageUrl} alt={photo.name} className="h-16 w-16 rounded border border-border object-contain" />)}</div> : null}<p className="mt-1 text-[9px] text-muted-foreground">Atualizado {new Date(record.updatedAt).toLocaleString("pt-BR")}</p></li>)}</ol> : <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum registro adicional de acompanhamento.</p>}</Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Resumo do pós</h2><Summary label="Tratamento" value={data.journey.name} /><Summary label="Etapa" value={data.journey.status} /><Summary label="Sessão" value={new Date(data.session.performedAt).toLocaleDateString("pt-BR")} /><Summary label="Profissional" value={data.session.professional} /><Summary label="Fotos da jornada" value={String(allPhotos.length)} /><Summary label="Registros de acompanhamento" value={String(data.followUps.length)} /></Card>
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Próximos retornos</h2>{upcomingAppointments.length ? upcomingAppointments.map((appointment) => <div key={appointment.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs"><strong>{new Date(appointment.date).toLocaleDateString("pt-BR")} · {appointment.time}</strong><p className="mt-0.5 text-muted-foreground">{appointment.procedure} · {appointment.professional}</p><span className="text-[10px] text-muted-foreground">{appointment.status}</span></div>) : <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum retorno agendado.</p>}<Button className="w-full" variant="outline" onClick={() => { setAppointmentNotice(""); setAppointmentOpen(true); }}><CalendarDays className="h-4 w-4" />Agendar retorno</Button></Card>
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Checklist do pós-procedimento</h2>{[["Fotos iniciais disponíveis", beforePhotos.length > 0], ["Resultado da sessão disponível", afterPhotos.length > 0], ["Orientações registradas", data.followUps.some((item) => Boolean(item.guidanceSentAt))], ["Retorno agendado", upcomingAppointments.length > 0], ["Evolução clínica registrada", data.followUps.some((item) => Boolean(item.observations || item.complications))]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-[11px]"><span className={cn("grid h-4 w-4 place-items-center rounded border", done ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
        <Card className="space-y-2 border-emerald-200 bg-emerald-50/60 p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-emerald-950"><ShieldCheck className="h-4 w-4" />Sessão concluída</h2><p className="text-xs text-emerald-900">Finalizar este atendimento não conclui o tratamento. A jornada permanece consultável e só é encerrada por ação explícita de usuário autorizado.</p><Button className="w-full" variant="outline" onClick={finishAttendance}><ArrowLeft className="h-4 w-4" />Finalizar atendimento</Button></Card>
      </aside>
    </div>
    {appointmentOpen ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="return-title"><form onSubmit={(event) => void scheduleReturn(event)} className="w-full max-w-md space-y-4 rounded-md border border-border bg-background p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 id="return-title" className="text-base font-bold">Agendar retorno</h2><p className="mt-1 text-xs text-muted-foreground">O agendamento será criado na agenda da clínica e vinculado a esta jornada.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={() => setAppointmentOpen(false)}><X className="h-4 w-4" /></Button></div><label className="block text-xs font-medium">Data<input required type="date" value={appointmentDate} onChange={(event) => setAppointmentDate(event.target.value)} min={localDateToday()} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3" /></label><label className="block text-xs font-medium">Horário<input required type="time" value={appointmentTime} onChange={(event) => setAppointmentTime(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3" /></label><label className="block text-xs font-medium">Observação<textarea value={appointmentNotes} onChange={(event) => setAppointmentNotes(event.target.value)} maxLength={500} rows={3} className="mt-1 w-full rounded-md border border-border bg-background p-3" /></label><div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAppointmentOpen(false)}>Cancelar</Button><Button type="submit" disabled={booking}>{booking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}Confirmar retorno</Button></div></form></div> : null}
    {preview ? <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Visualização da fotografia" onClick={() => setPreview(null)}><div className="relative max-h-[92vh] max-w-[92vw]" onClick={(event) => event.stopPropagation()}><img src={preview.imageUrl} alt={preview.name} className="max-h-[88vh] max-w-[90vw] object-contain" /><button type="button" aria-label="Fechar visualização" onClick={() => setPreview(null)} className="absolute -right-3 -top-3 rounded-full bg-white p-2 text-[#27283b]"><X className="h-4 w-4" /></button></div></div> : null}
  </div>;
}

function PhotoPicker({ label, photos, value, onChange, empty }: { label: string; photos: ClinicalPhoto[]; value: string; onChange: (value: string) => void; empty: string }) { return <label className="text-[10px] font-semibold text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={!photos.length} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-xs"><option value="">{photos.length ? "Selecionar fotografia" : empty}</option>{photos.map((photo) => <option key={photo.id} value={photo.id}>{photo.category} · {photo.source} · {new Date(photo.capturedAt).toLocaleDateString("pt-BR")}</option>)}</select></label>; }
function PhotoCanvas({ photo, title, zoom, onPreview }: { photo: ClinicalPhoto; title: string; zoom: number; onPreview: () => void }) { return <div className="relative grid h-full min-w-0 place-items-center overflow-hidden bg-muted/30"><img src={photo.imageUrl} alt={title} className="h-full w-full object-contain" style={{ transform: `scale(${zoom})` }} /><span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">{title}</span><button type="button" aria-label={`Ampliar foto ${title}`} onClick={onPreview} className="absolute bottom-2 right-2 rounded bg-black/65 p-1.5 text-white"><Expand className="h-4 w-4" /></button></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2 text-xs"><span className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{label}</span><strong className="max-w-[65%] truncate text-right">{value}</strong></div>; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Falha ao ler a foto.")); reader.onerror = () => reject(new Error("Falha ao ler a foto.")); reader.readAsDataURL(file); }); }
function imageDimensions(src: string) { return new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("Imagem inválida.")); image.src = src; }); }
function localDateToday() { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 10); }
