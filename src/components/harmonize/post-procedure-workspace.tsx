"use client";

/* eslint-disable @next/next/no-img-element -- Preserve exact clinical image rendering from private data URLs. */

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Expand, ImagePlus, LoaderCircle, Save, ShieldCheck, Trash2, Upload, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { appointmentDay, appointmentSlotError, clinicToday, latestAppointmentStart } from "@/lib/clinic-time";
import { validateFollowUpDraft } from "@/lib/follow-up-rules";
import { cn } from "@/lib/utils";
import type { Patient } from "@/types/clinic";
import { LoadingSkeleton } from "./shared";
import { useCan } from "./current-user";
import { EncounterBreadcrumb, type EncounterBreadcrumbActions } from "./encounter-breadcrumb";
import { useDraftAutosave } from "./use-draft-autosave";
import { revealValidationTarget } from "./reveal-validation-target";
import { JourneyProgress } from "./journey-progress";
import { ClinicTimePicker } from "./clinic-time-picker";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import { PhotoPreviewModal } from "./photo-preview-modal";

type ClinicalPhoto = { id: string; name: string; category: string; phase: string; imageUrl: string; width: number; height: number; capturedAt: string; source: string; sessionId: string | null };
type Appointment = { id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string };
type AppointmentHours = { openingTime: string; closingTime: string; allowAppointmentsOutsideHours: boolean };
type FollowUp = { id: string; occurredAt: string; professional: string; complaints: string; guidanceText: string; guidanceSentAt: string | null; observations: string; complications: string; photos: Array<{ id: string; name: string; category: string; imageUrl: string; width: number; height: number }>; removedPhotoIds: string[]; appointment: Appointment | null; createdBy: string; updatedAt: string; auditLog: Array<{ at: string; actor: string; action: string; fields: string[] }> };
type WorkspaceData = { session: { id: string; journeyId: string; procedureName: string; professional: string; performedAt: string; status: string; technique: string; treatedAreas: string; anesthesia: string; complications: string; observations: string; startedAt: string | null; endedAt: string | null }; journey: { name: string; status: string; appointments: Appointment[] }; sessions: Array<{ id: string; procedureName: string; professional: string; performedAt: string }>; photos: ClinicalPhoto[]; followUps: FollowUp[]; draft: { complaints: string; guidanceText: string; guidanceConfirmed: boolean; observations: string; complications: string; photos: DraftPhoto[]; removedPhotoIds: string[]; appointmentId: string | null } | null };
type DraftPhoto = { id: string; name: string; category: string; imageUrl: string; width: number; height: number; phase?: "Antes" | "Depois" | "Evolução"; capturedAt?: string };
type PhotoRemoval = { id: string; name: string; phase?: string };
const categories = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"];
const labels = (photo: ClinicalPhoto) => `${photo.category} · ${photo.phase} · ${new Date(photo.capturedAt).toLocaleDateString("pt-BR")}`;

export function PostProcedureWorkspace({ patient, patientId, journeyId, sessionId, breadcrumb, onFinish, onReturnToProcedure, initialView = "post" }: { patient: Patient; patientId: string; journeyId: string; sessionId: string; breadcrumb?: EncounterBreadcrumbActions; onFinish: () => void; onReturnToQuote?: () => void; onReturnToProcedure?: () => void; initialView?: "post" | "return" }) {
  const canWrite = useCan("clinical:write");
  const cacheKey = `/api/patients/${encodeURIComponent(patientId)}/procedure-sessions/${encodeURIComponent(sessionId)}/follow-ups?journeyId=${encodeURIComponent(journeyId)}`;
  const cached = readClientCache<WorkspaceData>(cacheKey);
  const [data, setData] = useState<WorkspaceData | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [followUpError, setFollowUpError] = useState("");
  const [followUpValidation, setFollowUpValidation] = useState<{ content?: string; guidance?: string; photos?: string; appointment?: string }>({});
  const [followUpValidationAttempt, setFollowUpValidationAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [activeView, setActiveView] = useState<"post" | "return">(initialView);
  const [returnAppointmentId, setReturnAppointmentId] = useState("");
  const [appointmentLaunchReturn, setAppointmentLaunchReturn] = useState(false);
  const [startingReturn, setStartingReturn] = useState(false);
  const [startReturnError, setStartReturnError] = useState("");
  const [today, setToday] = useState(() => clinicToday());
  const [complaints, setComplaints] = useState("");
  const [complaintError, setComplaintError] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [observations, setObservations] = useState("");
  const [complications, setComplications] = useState("");
  const [guidanceText, setGuidanceText] = useState("");
  const [guidanceConfirmed, setGuidanceConfirmed] = useState(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [removedPhotoIds, setRemovedPhotoIds] = useState<string[]>([]);
  const [photoToRemove, setPhotoToRemove] = useState<PhotoRemoval | null>(null);
  const [photoRemovalError, setPhotoRemovalError] = useState<{ id: string; phase: "Antes" | "Depois"; message: string; animation: number } | null>(null);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [viewMode, setViewMode] = useState<"slider" | "side-by-side">("slider");
  const [reveal, setReveal] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<ClinicalPhoto | DraftPhoto | null>(null);
  const [appointmentOpen, setAppointmentOpen] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [appointmentHours, setAppointmentHours] = useState<AppointmentHours | null>(() => readClientCache<AppointmentHours>("/api/appointments/options") ?? null);
  const [appointmentHoursRetry, setAppointmentHoursRetry] = useState(0);
  const [appointmentFormError, setAppointmentFormError] = useState("");
  const [appointmentDateError, setAppointmentDateError] = useState("");
  const [appointmentTimeError, setAppointmentTimeError] = useState("");
  const [appointmentErrorAnimation, setAppointmentErrorAnimation] = useState(0);
  const [booking, setBooking] = useState(false);
  useEffect(() => {
    if (!appointmentOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !booking) setAppointmentOpen(false); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [appointmentOpen, booking]);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentNotice, setAppointmentNotice] = useState("");
  const [category, setCategory] = useState("Frontal");
  const [photoFilter, setPhotoFilter] = useState("Todos");
  const fileInput = useRef<HTMLInputElement>(null);
  const beforeFileInput = useRef<HTMLInputElement>(null);
  const afterFileInput = useRef<HTMLInputElement>(null);
  const initials = patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("");
  const autosave = useDraftAutosave({ scope: `${patientId}:${sessionId}`, revision: draftRevision, enabled: hydrated && canWrite, save: saveDraft });
  useBodyScrollLock(appointmentOpen || Boolean(preview) || Boolean(photoToRemove));

  function markDraftChanged() { setDraftRevision((current) => current + 1); }

  function removeDraftPhoto() {
    if (!photoToRemove) return;
    if (photos.some((photo) => photo.id === photoToRemove.id)) {
      setPhotos((current) => current.filter((photo) => photo.id !== photoToRemove.id));
    } else {
      setData((current) => current ? { ...current, photos: current.photos.filter((photo) => photo.id !== photoToRemove.id) } : current);
      setRemovedPhotoIds((current) => current.includes(photoToRemove.id) ? current : [...current, photoToRemove.id]);
    }
    setBeforeId((current) => current === photoToRemove.id ? "" : current);
    setAfterId((current) => current === photoToRemove.id ? "" : current);
    setPhotoError("");
    setPhotoRemovalError(null);
    markDraftChanged();
    setPhotoToRemove(null);
  }

  function requestPhotoRemoval(photo: PhotoRemoval) {
    if (photo.phase === "Antes" && beforePhotos.length <= 1) {
      setPhotoRemovalError((current) => ({ id: photo.id, phase: "Antes", message: "É necessário manter pelo menos uma foto de antes.", animation: (current?.animation ?? 0) + 1 }));
      return;
    }
    setPhotoRemovalError(null);
    setPhotoToRemove(photo);
  }

  async function saveDraft() {
    try {
      const response = await fetch(cacheKey, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ complaints, observations, complications, guidanceText, guidanceConfirmed, photos, removedPhotoIds, appointmentId: selectedAppointmentId }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível salvar o rascunho.");
      invalidateClientCache(cacheKey);
      setFollowUpError("");
      return true;
    } catch (reason) {
      setFollowUpError(reason instanceof Error ? reason.message : "Não foi possível salvar o rascunho.");
      return false;
    }
  }

  const reload = useCallback(async () => {
    const fresh = await getCachedJson<WorkspaceData>(cacheKey);
    setData(fresh);
    setError("");
    return fresh;
  }, [cacheKey]);

  useEffect(() => {
    let active = true;
    getCachedJson<WorkspaceData>(cacheKey).then((next) => { if (active) { setData(next); setComplaints(next.draft?.complaints ?? ""); setObservations(next.draft?.observations ?? ""); setComplications(next.draft?.complications ?? ""); setGuidanceText(next.draft?.guidanceText ?? ""); setGuidanceConfirmed(next.draft?.guidanceConfirmed ?? false); setPhotos(next.draft?.photos ?? []); setRemovedPhotoIds(next.draft?.removedPhotoIds ?? []); setSelectedAppointmentId(next.draft?.appointmentId ?? ""); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento."); }).finally(() => { if (active) { setLoading(false); setHydrated(true); } });
    return () => { active = false; };
  }, [cacheKey]);

  const beforePhotos = [
    ...(data?.photos ?? []).filter((photo) => photo.phase === "Antes"),
    ...photos.filter((photo) => photo.phase === "Antes").map((photo) => ({ ...photo, phase: "Antes", capturedAt: photo.capturedAt ?? data?.session.performedAt ?? "", source: "Rascunho", sessionId })),
  ];
  const afterPhotos = [
    ...(data?.photos ?? []).filter((photo) => photo.phase !== "Antes"),
    ...photos.filter((photo) => photo.phase !== "Antes").map((photo) => ({ ...photo, phase: photo.phase === "Depois" ? "Depois" : "Evolução", capturedAt: photo.capturedAt ?? data?.session.performedAt ?? "", source: "Rascunho", sessionId })),
  ];
  const selectedBefore = beforePhotos.find((photo) => photo.id === beforeId) ?? beforePhotos.find((photo) => photo.category === category) ?? beforePhotos[0];
  const selectedAfter = afterPhotos.find((photo) => photo.id === afterId) ?? afterPhotos.find((photo) => photo.category === selectedBefore?.category) ?? afterPhotos[0];
  const upcomingAppointments = (data?.journey.appointments ?? []).filter((appointment) => /retorno/i.test(appointment.procedure) && ["Agendado", "Em atendimento"].includes(appointment.status));
  const relevantReturns = (data?.journey.appointments ?? []).filter((appointment) => appointment.procedure === `Retorno - ${data?.session.procedureName}` && !["Cancelado", "Faltou"].includes(appointment.status));
  const pendingReturns = relevantReturns.filter((appointment) => !data?.followUps.some((record) => record.appointment?.id === appointment.id));
  const returnAppointment = relevantReturns.find((appointment) => appointment.id === returnAppointmentId) ?? pendingReturns.find((appointment) => appointment.status === "Em atendimento") ?? pendingReturns.find((appointment) => appointment.status === "Agendado" && appointmentDay(appointment.date) >= today) ?? pendingReturns.find((appointment) => appointment.status === "Agendado") ?? pendingReturns[0] ?? relevantReturns.at(-1);
  const returnRecord = data?.followUps.find((record) => record.appointment?.id === returnAppointment?.id);
  const returnIsOpen = Boolean(returnAppointment && appointmentDay(returnAppointment.date) <= today && ["Em atendimento", "Atendido", "Finalizado"].includes(returnAppointment.status));
  const allPhotos = [...beforePhotos, ...afterPhotos];
  const appointmentHoursLoading = appointmentOpen && !appointmentHours && !appointmentFormError;
  const appointmentLatestStart = appointmentHours ? latestAppointmentStart(appointmentHours.closingTime, 60) : null;
  const appointmentHasSlots = Boolean(appointmentHours && (appointmentHours.allowAppointmentsOutsideHours || (appointmentLatestStart && appointmentHours.openingTime <= appointmentLatestStart)));
  const photoRemovalDialog = <Modal
    open={Boolean(photoToRemove)}
    title="Remover foto?"
    description={photoToRemove ? `A foto “${photoToRemove.name}” será removida da comparação deste tratamento. O original do prontuário será preservado.` : undefined}
    onClose={() => setPhotoToRemove(null)}
    closeOnOverlayClick={false}
  >
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => setPhotoToRemove(null)}>Manter foto</Button>
      <Button type="button" variant="destructive" onClick={removeDraftPhoto}><Trash2 className="h-4 w-4" />Remover foto</Button>
    </div>
  </Modal>;

  useEffect(() => {
    if (!appointmentOpen) return;
    let active = true;
    getCachedJson<AppointmentHours>("/api/appointments/options")
      .then((hours) => { if (active) setAppointmentHours(hours); })
      .catch((reason) => { if (active) setAppointmentFormError(reason instanceof Error ? reason.message : "Não foi possível carregar o horário da clínica."); });
    return () => { active = false; };
  }, [appointmentOpen, appointmentHoursRetry]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(clinicToday()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function openReturn() {
    setStartReturnError("");
    if (returnAppointment) {
      setReturnAppointmentId(returnAppointment.id);
      if (returnAppointment.status === "Em atendimento") { setSelectedAppointmentId(returnAppointment.id); markDraftChanged(); }
      setActiveView("return");
      return;
    }
    setAppointmentLaunchReturn(true);
    setAppointmentFormError(""); setAppointmentDateError(""); setAppointmentTimeError("");
    setAppointmentOpen(true);
  }

  async function startReturn() {
    if (!returnAppointment || startingReturn) return;
    if (appointmentDay(returnAppointment.date) !== today) {
      setStartReturnError(`O retorno só pode ser iniciado no dia agendado (${new Date(returnAppointment.date).toLocaleDateString("pt-BR")}).`);
      revealValidationTarget("return-schedule-card", "return-start-error");
      return;
    }
    setStartingReturn(true); setStartReturnError("");
    try {
      const response = await fetch(cacheKey, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start-return", appointmentId: returnAppointment.id }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível iniciar o retorno.");
      invalidateClientCache(cacheKey, "/api/agenda", "/api/dashboard/bootstrap", `/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`);
      await reload();
      setSelectedAppointmentId(returnAppointment.id);
      markDraftChanged();
    } catch (reason) {
      setStartReturnError(reason instanceof Error ? reason.message : "Não foi possível iniciar o retorno.");
    } finally { setStartingReturn(false); }
  }

  async function finishAttendance() {
    if (!returnRecord) {
      setComplaintError("Registre o retorno antes de finalizar o atendimento.");
      setFollowUpValidationAttempt((current) => current + 1);
      revealValidationTarget("return-complaints-card", "return-complaints-field");
      return;
    }
    await autosave.leave(onFinish);
  }

  async function addFiles(files: FileList | null, phase: DraftPhoto["phase"] = "Evolução") {
    if (!files) return;
    setPhotoError("");
    if (photos.length + files.length > 12) { setPhotoError("Você pode incluir até 12 imagens por registro."); return; }
    const next: DraftPhoto[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 6 * 1024 * 1024) throw new Error("Envie imagens JPEG, PNG ou WebP de até 6 MB cada.");
        const imageUrl = await fileToDataUrl(file);
        const dimensions = await imageDimensions(imageUrl);
        if (dimensions.width * dimensions.height > 25_000_000 || dimensions.width > 8000 || dimensions.height > 8000) throw new Error("Uma imagem ultrapassa o limite de resolução permitido.");
        next.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180), category, imageUrl, ...dimensions, phase, capturedAt: new Date().toISOString() });
      }
      if (photos.reduce((sum, photo) => sum + photo.imageUrl.length, 0) + next.reduce((sum, photo) => sum + photo.imageUrl.length, 0) > 24_000_000) throw new Error("Salve este registro antes de incluir mais imagens.");
      setPhotos((current) => [...current, ...next]);
      setPhotoRemovalError(null);
      if (phase === "Antes" && next[0]) setBeforeId(next[0].id);
      if (phase === "Depois" && next[0]) setAfterId(next[0].id);
      markDraftChanged();
      setFollowUpValidation((current) => ({ ...current, photos: undefined, content: undefined }));
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : "Não foi possível ler as imagens.");
    } finally {
      const input = phase === "Antes" ? beforeFileInput.current : phase === "Depois" ? afterFileInput.current : fileInput.current;
      if (input) input.value = "";
    }
  }

  async function saveFollowUp() {
    if (!data || saving) return;
    const recordAppointmentId = activeView === "return" ? returnAppointment?.id ?? "" : selectedAppointmentId;
    if (activeView === "return" && !complaints.trim()) {
      setComplaintError("Descreva as queixas do cliente ou informe que não há queixas.");
      setFollowUpValidationAttempt((current) => current + 1);
      revealValidationTarget("return-complaints-card", "return-complaints-field");
      return;
    }
    const validation = validateFollowUpDraft({ complaints, guidanceText, guidanceSent: guidanceConfirmed, observations, complications, photoCount: photos.length, appointmentId: recordAppointmentId });
    if (Object.keys(validation).length) {
      setFollowUpValidation(validation);
      setFollowUpValidationAttempt((current) => current + 1);
      setFollowUpError("");
      revealValidationTarget(activeView === "return" ? "return-complaints-card" : validation.guidance ? "follow-up-guidance-card" : validation.photos ? "follow-up-comparison-card" : "follow-up-evolution-card");
      return;
    }
    if (!await autosave.flush()) { revealValidationTarget("follow-up-save-status"); return; }
    setSaving(true); setFollowUpError(""); setFollowUpValidation({}); setNotice("");
    try {
      const response = await fetch(cacheKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ professional: data.session.professional, complaints, observations, complications, guidanceText, guidanceSent: guidanceConfirmed, photos, removedPhotoIds, ...(recordAppointmentId ? { appointmentId: recordAppointmentId } : {}) }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Não foi possível salvar o acompanhamento.");
      invalidateClientCache(cacheKey, "/api/agenda", "/api/dashboard/bootstrap", `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`, `/api/patients/${encodeURIComponent(patientId)}/history`);
      await reload();
      setComplaints(""); setObservations(""); setComplications(""); setGuidanceText(""); setGuidanceConfirmed(false); setPhotos([]); setRemovedPhotoIds([]); setSelectedAppointmentId("");
      setNotice(activeView === "return" ? "Retorno registrado no histórico clínico." : "Acompanhamento registrado no histórico clínico.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível salvar o acompanhamento.";
      if (/orientações que foram enviadas/i.test(message)) setFollowUpValidation({ guidance: message });
      else if (/fotografias|imagens/i.test(message)) setFollowUpValidation({ photos: message });
      else if (/retorno/i.test(message)) setFollowUpValidation({ appointment: message });
      else if (/Adicione uma orientação/i.test(message)) setFollowUpValidation({ content: message });
      else setFollowUpError(message);
      setFollowUpValidationAttempt((current) => current + 1);
      if (activeView === "return") revealValidationTarget("return-complaints-card");
      else revealValidationTarget(/orientações que foram enviadas/i.test(message) ? "follow-up-guidance-card" : /fotografias|imagens/i.test(message) ? "follow-up-comparison-card" : "follow-up-evolution-card", /retorno/i.test(message) ? "follow-up-appointment-field" : !/orientações que foram enviadas|fotografias|imagens|Adicione uma orientação/i.test(message) ? "follow-up-server-error" : undefined);
    } finally { setSaving(false); }
  }

  async function scheduleReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || booking) return;
    if (!appointmentDate || !appointmentTime) {
      setAppointmentDateError(appointmentDate ? "" : "Informe a data do retorno.");
      setAppointmentTimeError(appointmentTime ? "" : "Informe o horário do retorno.");
      setAppointmentFormError("");
      setAppointmentErrorAnimation((value) => value + 1);
      revealValidationTarget(appointmentDate ? "return-time-field" : "return-date-field");
      return;
    }
    if (!appointmentHours) {
      setAppointmentFormError("Não foi possível carregar o horário de funcionamento da clínica. Tente novamente.");
      setAppointmentErrorAnimation((value) => value + 1);
      revealValidationTarget("return-form-error");
      return;
    }
    const slotError = appointmentSlotError(appointmentDate, appointmentTime, appointmentHours.openingTime, appointmentHours.closingTime, undefined, 60, appointmentHours.allowAppointmentsOutsideHours);
    if (slotError) {
      if (/data|passou/i.test(slotError)) setAppointmentDateError(slotError);
      else setAppointmentTimeError(slotError);
      setAppointmentFormError("");
      setAppointmentErrorAnimation((value) => value + 1);
      revealValidationTarget(/data|passou/i.test(slotError) ? "return-date-field" : "return-time-field");
      return;
    }
    setAppointmentDateError(""); setAppointmentTimeError("");
    setBooking(true); setError(""); setAppointmentNotice(""); setAppointmentFormError("");
    try {
      const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, journeyId: data.session.journeyId, procedure: `Retorno - ${data.session.procedureName}`, professional: data.session.professional, date: appointmentDate, time: appointmentTime, notes: appointmentNotes }) });
      const result = await response.json().catch(() => ({})) as { appointment?: Appointment; message?: string };
      if (!response.ok || !result.appointment) throw new Error(result.message ?? "Não foi possível agendar o retorno.");
      invalidateClientCache(cacheKey, "/api/agenda", "/api/dashboard/bootstrap", `/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`);
      setAppointmentNotice(`Retorno agendado para ${new Date(result.appointment.date).toLocaleDateString("pt-BR")} às ${result.appointment.time}.`);
      setAppointmentOpen(false); setAppointmentDate(""); setAppointmentTime(""); setAppointmentNotes(""); setAppointmentDateError(""); setAppointmentTimeError("");
      if (appointmentLaunchReturn) { setReturnAppointmentId(result.appointment.id); setActiveView("return"); setAppointmentLaunchReturn(false); }
      await reload();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível agendar o retorno.";
      if (/data|passou/i.test(message)) setAppointmentDateError(message);
      else if (/horário|funcionamento|disponível/i.test(message)) setAppointmentTimeError(message);
      else setAppointmentFormError(message);
      setAppointmentErrorAnimation((value) => value + 1);
      revealValidationTarget(/data|passou/i.test(message) ? "return-date-field" : /horário|funcionamento|disponível/i.test(message) ? "return-time-field" : "return-form-error");
    } finally { setBooking(false); }
  }

  // Etapas anteriores abrem somente para consulta (ver patient-detail); o rascunho do pós é gravado antes de sair.
  const stageBackButtons = <>
    {onReturnToProcedure ? <Button variant="outline" onClick={() => void autosave.leave(onReturnToProcedure)}><ArrowLeft className="h-4 w-4" />Voltar ao procedimento</Button> : null}
  </>;

  if (loading && !data) return <div className="mx-auto max-w-[1400px] space-y-4"><LoadingSkeleton className="h-24 w-full" /><div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.75fr)]"><LoadingSkeleton className="h-[28rem] w-full" /><LoadingSkeleton className="h-[28rem] w-full" /></div></div>;
  if (error && !data) return <Card className="mx-auto max-w-3xl p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button className="mt-4" onClick={() => { setLoading(true); void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento.")).finally(() => setLoading(false)); }}>Tentar novamente</Button></Card>;
  if (!data) return null;

  if (activeView === "return" && !returnIsOpen) return <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
    {breadcrumb ? <EncounterBreadcrumb patientName={patient.name} journeyName={data.journey.name} stage="Retorno" onClients={breadcrumb.onClients} onPatient={breadcrumb.onPatient} onJourney={breadcrumb.onJourney} /> : null}
    {breadcrumb ? <button type="button" onClick={breadcrumb.onJourney} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button> : null}
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="flex min-w-0 items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials}</span><div className="min-w-0"><h1 className="truncate text-base font-bold">Retorno de {patient.name}</h1><p className="mt-1 text-xs text-muted-foreground">{data.journey.name} · {data.session.procedureName}</p></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setActiveView("post")}><ArrowLeft className="h-4 w-4" />Voltar ao pós-procedimento</Button></div></Card>
    <JourneyProgress current={4} />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card id="return-schedule-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-4 p-5", startReturnError && "border-destructive animate-[hp-shake_0.42s_ease-in-out]")}><div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /><h2 className="text-sm font-bold">Retorno agendado</h2></div>{returnAppointment ? <><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Data do retorno</p><strong className="mt-1 block text-base">{new Date(returnAppointment.date).toLocaleDateString("pt-BR")}</strong></div><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Horário</p><strong className="mt-1 block text-base">{returnAppointment.time}</strong></div></div><p className="text-xs text-muted-foreground">O registro clínico ficará disponível no dia do retorno, após iniciar o atendimento.</p>{startReturnError ? <p id="return-start-error" tabIndex={-1} key={startReturnError} role="alert" className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{startReturnError}</p> : null}<div className="flex flex-wrap gap-2"><Button aria-describedby={startReturnError ? "return-start-error" : undefined} disabled={!canWrite || startingReturn} onClick={() => void startReturn()}>{startingReturn ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}Iniciar atendimento</Button>{appointmentDay(returnAppointment.date) < today ? <Button variant="outline" onClick={() => { setAppointmentLaunchReturn(true); setAppointmentOpen(true); setActiveView("post"); }}>Reagendar retorno</Button> : null}</div></> : <><p className="text-xs text-muted-foreground">Ainda não há retorno agendado para este procedimento.</p><Button onClick={() => { setAppointmentLaunchReturn(true); setAppointmentOpen(true); setActiveView("post"); }}>Agendar retorno</Button></>}</Card>
      <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Resumo do procedimento</h2><Summary label="Procedimento" value={data.session.procedureName} /><Summary label="Profissional" value={data.session.professional} /><Summary label="Data" value={new Date(data.session.performedAt).toLocaleDateString("pt-BR")} /><Summary label="Técnica" value={data.session.technique || "Não informada"} /><Summary label="Região tratada" value={data.session.treatedAreas || "Não informada"} /></Card>
    </div>
  </div>;

  if (activeView === "return") return <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
    {breadcrumb ? <EncounterBreadcrumb patientName={patient.name} journeyName={data.journey.name} stage="Retorno" onClients={() => void autosave.leave(breadcrumb.onClients)} onPatient={() => void autosave.leave(breadcrumb.onPatient)} onJourney={() => void autosave.leave(breadcrumb.onJourney)} /> : null}
    {breadcrumb ? <button type="button" onClick={() => void autosave.leave(breadcrumb.onJourney)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button> : null}
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials}</span><div className="min-w-0"><h1 className="truncate text-base font-bold">Retorno de {patient.name}</h1><p className="mt-1 text-xs text-muted-foreground">{data.journey.name} · {data.session.procedureName}</p><p className="mt-1 text-xs text-muted-foreground">Procedimento em {new Date(data.session.performedAt).toLocaleDateString("pt-BR")} · {data.session.professional}</p></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setActiveView("post")}><ArrowLeft className="h-4 w-4" />Voltar ao pós-procedimento</Button><Button variant="outline" aria-describedby={complaintError ? "return-complaints-error" : undefined} onClick={finishAttendance}>Finalizar atendimento</Button></div>
    </Card>
    <JourneyProgress current={4} />
    {returnAppointment ? <p className="rounded-md bg-primary/5 px-3 py-2 text-xs font-medium text-primary">Retorno de {new Date(returnAppointment.date).toLocaleDateString("pt-BR")} às {returnAppointment.time} · {returnAppointment.status}</p> : null}
    <div id="follow-up-save-status" tabIndex={-1} role="status" className={cn("flex scroll-mt-24 items-center gap-2 text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{autosave.state === "saving" ? "Salvando rascunho..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar o rascunho" : "Rascunho salvo"}{autosave.state === "error" ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}</div>
    {error ? <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
    {notice ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p> : null}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.78fr)]">
      <div className="space-y-4">
        <Card id="return-complaints-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-3 p-4 sm:p-5", (complaintError || followUpError) && "border-destructive animate-[hp-shake_0.42s_ease-in-out]")}>
          <h2 className="flex items-center gap-2 text-sm font-bold"><CircleAlert className="h-4 w-4 text-primary" />Queixas do cliente</h2>
          {returnRecord ? <div className="space-y-2"><p className="text-xs text-muted-foreground">Registrado em {new Date(returnRecord.occurredAt).toLocaleString("pt-BR")} por {returnRecord.professional}</p><p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">{returnRecord.complaints || "Sem queixas registradas."}</p></div> : <label id="return-complaints-field" tabIndex={-1} className="block scroll-mt-24 text-xs font-semibold text-muted-foreground">Queixas no retorno <span className="text-destructive">*</span><textarea value={complaints} onChange={(event) => { setComplaints(event.target.value); setComplaintError(""); markDraftChanged(); }} aria-invalid={Boolean(complaintError)} aria-describedby={complaintError ? "return-complaints-error" : undefined} maxLength={5000} rows={5} placeholder="Descreva o que o cliente relata após o procedimento..." className={cn("mt-1 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary", complaintError && "border-destructive animate-[hp-shake_0.42s_ease-in-out]")} /></label>}
          {complaintError ? <p id="return-complaints-error" key={followUpValidationAttempt} role="alert" className="text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{complaintError}</p> : null}
          {followUpValidation.appointment || followUpError ? <p role="alert" className="text-xs font-medium text-destructive">{followUpValidation.appointment || followUpError}</p> : null}
          {!returnRecord ? <div className="flex justify-end"><Button disabled={saving || !canWrite} onClick={() => void saveFollowUp()}><Save className="h-4 w-4" />{saving ? "Registrando..." : "Registrar retorno"}</Button></div> : null}
        </Card>
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-bold"><ImagePlus className="h-4 w-4 text-primary" />Fotos antes e depois</h2>{!returnRecord ? <div className="flex flex-wrap items-center gap-2"><label className="text-xs font-semibold text-muted-foreground">Categoria<select value={category} onChange={(event) => setCategory(event.target.value)} className="ml-2 h-9 rounded-md border border-border bg-background px-2 text-sm">{categories.map((item) => <option key={item}>{item}</option>)}</select></label><Button size="sm" variant="outline" disabled={!canWrite} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />Adicionar foto</Button><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => void addFiles(event.target.files)} /></div> : null}</div>
          {followUpValidation.photos || photoError ? <p role="alert" className="text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{followUpValidation.photos || photoError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2"><PhotoPicker label="Antes" photos={beforePhotos} value={selectedBefore?.id ?? ""} onChange={setBeforeId} empty="Nenhuma foto anterior disponível" /><PhotoPicker label="Depois / evolução" photos={afterPhotos} value={selectedAfter?.id ?? ""} onChange={setAfterId} empty="Nenhuma foto posterior disponível" /></div>
          <div className="grid gap-3 sm:grid-cols-2">{[{ photo: selectedBefore, label: "Antes" }, { photo: selectedAfter, label: "Depois" }].map(({ photo, label }) => <div key={label} className="overflow-hidden rounded-md border border-border bg-muted/20"><div className="aspect-[4/3]">{photo ? <button type="button" onClick={() => setPreview(photo)} className="h-full w-full"><img src={photo.imageUrl} alt={`${label}: ${photo.name}`} className="h-full w-full object-contain" /></button> : <div className="grid h-full place-items-center text-xs text-muted-foreground">Sem foto {label.toLocaleLowerCase("pt-BR")}</div>}</div><p className="truncate border-t border-border px-3 py-2 text-xs text-muted-foreground">{photo ? labels(photo) : label}</p></div>)}</div>
          {photos.length ? <div className="space-y-2"><h3 className="text-xs font-semibold">Fotos adicionadas neste retorno</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{photos.map((photo) => <div key={photo.id} className="relative overflow-hidden rounded-md border border-border"><button type="button" className="w-full" onClick={() => setPreview(photo)}><img src={photo.imageUrl} alt={photo.name} className="aspect-[4/3] w-full object-contain" /><span className="block truncate px-2 py-1 text-xs">{photo.category} · {photo.name}</span></button>{!returnRecord ? <Button type="button" variant="ghost" size="icon" disabled={!canWrite} aria-label={`Remover ${photo.name}`} onClick={() => requestPhotoRemoval(photo)} className="absolute right-1 top-1 h-7 w-7 bg-white/90 text-destructive shadow hover:bg-white"><X className="h-4 w-4" /></Button> : null}</div>)}</div></div> : null}
        </Card>
        {data.followUps.some((record) => record.complaints) ? <Card className="space-y-3 p-4 sm:p-5"><h2 className="text-sm font-bold">Retornos anteriores</h2>{[...data.followUps].filter((record) => record.complaints).reverse().map((record) => <div key={record.id} className="border-t border-border pt-3"><p className="text-xs text-muted-foreground">{new Date(record.occurredAt).toLocaleString("pt-BR")} · {record.professional}</p><p className="mt-1 whitespace-pre-wrap text-xs">{record.complaints}</p></div>)}</Card> : null}
      </div>
      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start"><Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Resumo do procedimento</h2><Summary label="Procedimento" value={data.session.procedureName} /><Summary label="Profissional" value={data.session.professional} /><Summary label="Data" value={new Date(data.session.performedAt).toLocaleDateString("pt-BR")} /><Summary label="Técnica" value={data.session.technique || "Não informada"} /><Summary label="Região tratada" value={data.session.treatedAreas || "Não informada"} /><Summary label="Anestesia" value={data.session.anesthesia || "Não informada"} />{data.session.startedAt && data.session.endedAt ? <Summary label="Duração" value={`${Math.max(0, Math.round((Date.parse(data.session.endedAt) - Date.parse(data.session.startedAt)) / 60000))} min`} /> : null}{data.session.complications ? <div className="border-t border-border pt-2"><p className="text-xs font-semibold text-muted-foreground">Intercorrências</p><p className="mt-1 whitespace-pre-wrap text-xs">{data.session.complications}</p></div> : null}{data.session.observations ? <div className="border-t border-border pt-2"><p className="text-xs font-semibold text-muted-foreground">Observações da sessão</p><p className="mt-1 whitespace-pre-wrap text-xs">{data.session.observations}</p></div> : null}</Card></aside>
    </div>
    <PhotoPreviewModal photo={preview} onClose={() => setPreview(null)} />
    {photoRemovalDialog}
  </div>;

  return <div className="mx-auto max-w-[1400px] space-y-4 pb-8">
    {breadcrumb ? <EncounterBreadcrumb patientName={patient.name} journeyName={data.journey.name} stage="Pós-procedimento" onClients={() => void autosave.leave(breadcrumb.onClients)} onPatient={() => void autosave.leave(breadcrumb.onPatient)} onJourney={() => void autosave.leave(breadcrumb.onJourney)} /> : null}
    <button type="button" onClick={() => void autosave.leave(breadcrumb?.onJourney ?? onFinish)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button>
    <Card className="flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary/10 font-bold text-primary">{initials}</div><div className="min-w-0"><h1 className="truncate text-base font-bold">{patient.name}</h1><p className="mt-1 text-xs text-muted-foreground">{data.journey.name} · {data.session.procedureName} · Sessão de {new Date(data.session.performedAt).toLocaleDateString("pt-BR")}</p><p className="mt-1 text-xs text-muted-foreground">Profissional: {data.session.professional} · Sessão concluída; tratamento permanece {data.journey.status.toLocaleLowerCase("pt-BR")}</p></div></div>
      <div className="flex flex-wrap gap-2">{stageBackButtons}<Button onClick={openReturn}><CalendarDays className="h-4 w-4" />Ir para retorno <ArrowRight className="h-4 w-4" /></Button></div>
    </Card>
    <JourneyProgress current={3} />
    <div id="follow-up-save-status" tabIndex={-1} role="status" className={cn("flex scroll-mt-24 items-center gap-2 text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{autosave.state === "saving" ? "Salvando rascunho..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar o rascunho" : "Rascunho salvo"}{autosave.state === "error" ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}</div>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive"><span>{error}</span><Button size="sm" variant="outline" onClick={() => void reload().catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar o acompanhamento."))}>Tentar novamente</Button></div> : null}
    {notice ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{notice}</p> : null}
    {appointmentNotice ? <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">{appointmentNotice}</p> : null}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.78fr)]">
      <div className="space-y-4">
        <Card id="follow-up-comparison-card" tabIndex={-1} className="scroll-mt-24 space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-bold"><ImagePlus className="h-4 w-4 text-primary" />Comparação antes e depois</h2><p className="mt-1 text-xs text-muted-foreground">Imagens clínicas originais, sem filtros ou ajustes de aparência.</p></div><div className="flex items-center gap-2"><div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Modo de comparação"><button type="button" aria-pressed={viewMode === "slider"} onClick={() => setViewMode("slider")} className={cn("rounded px-2.5 py-1.5 text-xs", viewMode === "slider" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Controle</button><button type="button" aria-pressed={viewMode === "side-by-side"} onClick={() => setViewMode("side-by-side")} className={cn("rounded px-2.5 py-1.5 text-xs", viewMode === "side-by-side" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>Lado a lado</button></div><label className="sr-only" htmlFor="photo-zoom">Zoom</label><select id="photo-zoom" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="h-8 rounded-md border border-border bg-background px-2 text-sm"><option value={1}>1×</option><option value={1.25}>1,25×</option><option value={1.5}>1,5×</option><option value={2}>2×</option></select></div></div>
          {followUpValidation.photos || photoError ? <p key={`comparison-photo-error-${followUpValidationAttempt}`} role="alert" className="text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{followUpValidation.photos ?? photoError}</p> : null}
          <div className="grid gap-3 sm:grid-cols-2"><PhotoPicker label="Antes" photos={beforePhotos} value={selectedBefore?.id ?? ""} onChange={setBeforeId} empty="Sem fotos anteriores nesta avaliação." /><PhotoPicker label="Depois / evolução" photos={afterPhotos} value={selectedAfter?.id ?? ""} onChange={setAfterId} empty="Ainda não há foto de resultado ou evolução." /></div>
          {selectedBefore && selectedAfter ? <div className="relative overflow-hidden rounded-md border border-border bg-black/5 p-2"><div className={cn("relative mx-auto overflow-hidden bg-white", viewMode === "slider" ? "aspect-[4/3] max-h-[65vh]" : "grid aspect-[4/3] max-h-[65vh] grid-cols-2 gap-2")}>
            {viewMode === "slider" ? <div className="absolute inset-0 grid place-items-center overflow-hidden"><div className="relative h-full w-full" style={{ transform: `scale(${zoom})` }}><img src={selectedAfter.imageUrl} alt={`${selectedAfter.category}, ${selectedAfter.phase}`} className="absolute inset-0 h-full w-full object-contain" /><div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - reveal}% 0 0)` }}><img src={selectedBefore.imageUrl} alt={`${selectedBefore.category}, antes`} className="absolute inset-0 h-full w-full object-contain" /></div><span className="pointer-events-none absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white">Antes</span><span className="pointer-events-none absolute right-2 top-2 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white">Depois</span><div aria-hidden="true" className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-white shadow" style={{ left: `${reveal}%` }}><span className="absolute left-1/2 top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-white shadow"><ChevronLeft className="h-4 w-4" /><ChevronRight className="-ml-2 h-4 w-4" /></span></div><input aria-label="Arraste horizontalmente para revelar antes e depois" title="Arraste para comparar" type="range" min="0" max="100" value={reveal} onChange={(event) => setReveal(Number(event.target.value))} className="absolute inset-0 z-10 h-full w-full cursor-col-resize touch-none opacity-0" /></div></div> : <><PhotoCanvas photo={selectedBefore} title="Antes" zoom={zoom} onPreview={() => setPreview(selectedBefore)} /><PhotoCanvas photo={selectedAfter} title={selectedAfter.phase === "Evolução" ? "Evolução" : "Resultado"} zoom={zoom} onPreview={() => setPreview(selectedAfter)} /></>}
          </div></div> : <div className="grid min-h-64 place-items-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center"><div><ImagePlus className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">Comparação indisponível</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">Para comparar, são necessárias fotos reais antes e depois da sessão.</p></div></div>}
          {selectedBefore && selectedAfter ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>Antes: {labels(selectedBefore)}</span><span aria-hidden="true">·</span><span>Depois: {labels(selectedAfter)}</span></div> : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar fotos por categoria">{["Todos", ...categories].map((item) => <button key={item} type="button" onClick={() => setPhotoFilter(item)} aria-pressed={photoFilter === item} className={cn("rounded-md border px-2.5 py-1.5 text-xs transition-colors", photoFilter === item ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50")}>{item}</button>)}</div>
          <div className="space-y-4">
            {[
              { title: "Fotos de antes", phase: "Antes" as const, photos: beforePhotos, selected: selectedBefore, input: beforeFileInput },
              { title: "Fotos de depois e evolução", phase: "Depois" as const, photos: afterPhotos, selected: selectedAfter, input: afterFileInput },
            ].map((group) => { const visiblePhotos = photoFilter === "Todos" ? group.photos : group.photos.filter((photo) => photo.category === photoFilter); return <section key={group.title} aria-label={group.title} className="space-y-2">
              <h3 className="text-xs font-semibold">{group.title} <span className="font-normal text-muted-foreground">({group.photos.length})</span></h3>
              {photoRemovalError?.phase === group.phase ? <p key={`photo-removal-error-${photoRemovalError.animation}`} role="alert" className="text-xs font-medium text-[#b42318]">{photoRemovalError.message}</p> : null}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {visiblePhotos.map((photo) => <div key={`${photo.source}-${photo.id}-${photoRemovalError?.id === photo.id ? photoRemovalError.animation : 0}`} className={cn("relative min-w-0", photoRemovalError?.id === photo.id && "animate-[hp-shake_0.42s_ease-in-out]")}><button type="button" onClick={() => (group.phase === "Antes" ? setBeforeId : setAfterId)(photo.id)} aria-label={`Selecionar ${photo.name}`} aria-pressed={photo.id === group.selected?.id} className={cn("w-full overflow-hidden rounded-md border text-left", photoRemovalError?.id === photo.id ? "border-[#d92d20] ring-1 ring-[#d92d20]" : photo.id === group.selected?.id ? "border-primary ring-1 ring-primary" : "border-border")}><img src={photo.imageUrl} alt={photo.name} className="aspect-square w-full bg-muted object-contain" /><span className="block truncate px-1.5 py-1 text-xs text-muted-foreground">{photo.category} · {photo.phase}</span></button>{canWrite ? <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${photo.name}`} onClick={() => requestPhotoRemoval(photo)} className="absolute right-1 top-1 h-7 w-7 bg-white/90 text-destructive shadow hover:bg-white"><X className="h-4 w-4" /></Button> : null}</div>)}
                {!visiblePhotos.length ? <p className="col-span-full py-3 text-xs text-muted-foreground">Nenhuma foto {photoFilter === "Todos" ? "disponível" : `na categoria ${photoFilter}`} nesta etapa.</p> : null}
                <button type="button" onClick={() => group.input.current?.click()} className="grid aspect-square place-items-center rounded-md border border-dashed border-primary/50 bg-primary/[0.03] p-3 text-center text-xs font-medium text-primary transition hover:bg-primary/[0.08]" aria-label={`Anexar foto ${group.phase.toLocaleLowerCase("pt-BR")}`}><span className="grid justify-items-center gap-2"><ImagePlus className="h-5 w-5" /><span>Anexar foto</span></span></button>
                <input ref={group.input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => void addFiles(event.target.files, group.phase)} />
              </div>
            </section>; })}
          </div>
        </Card>

        <Card id="follow-up-guidance-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-3 p-4 sm:p-5", followUpValidation.guidance && "border-[#d92d20]")}><h2 className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-primary" />Orientações pós-procedimento</h2><p className="text-xs text-muted-foreground">Registre o texto e confirme somente depois de enviar por um canal da clínica.</p><textarea key={`guidance-${followUpValidationAttempt}`} aria-invalid={Boolean(followUpValidation.guidance)} aria-describedby={followUpValidation.guidance ? "follow-up-guidance-error" : undefined} value={guidanceText} onChange={(event) => { setGuidanceText(event.target.value); markDraftChanged(); setFollowUpValidation((current) => ({ ...current, guidance: undefined, content: undefined })); }} maxLength={5000} rows={4} placeholder="Orientações repassadas ao paciente..." className={cn("w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary", followUpValidation.guidance && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} />{followUpValidation.guidance ? <p id="follow-up-guidance-error" role="alert" className="text-xs font-medium text-[#b42318]">{followUpValidation.guidance}</p> : null}<label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={guidanceConfirmed} onChange={(event) => { setGuidanceConfirmed(event.target.checked); markDraftChanged(); if (event.target.checked && guidanceText.trim()) setFollowUpValidation((current) => ({ ...current, guidance: undefined })); }} className="mt-0.5 accent-primary" />Confirmo que estas orientações foram efetivamente enviadas ao paciente.</label></Card>

        <Card id="follow-up-evolution-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-3 p-4 sm:p-5", (followUpValidation.content || followUpError) && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")}>
          <h2 className="flex items-center gap-2 text-sm font-bold"><CircleAlert className="h-4 w-4 text-primary" />Evolução e intercorrências</h2>
          {followUpValidation.content ? <p key={`content-error-${followUpValidationAttempt}`} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{followUpValidation.content}</p> : null}
          <label className="block text-xs font-semibold text-muted-foreground">Observações clínicas<textarea value={observations} onChange={(event) => { setObservations(event.target.value); markDraftChanged(); setFollowUpValidation((current) => ({ ...current, content: undefined })); }} maxLength={5000} rows={4} placeholder="Evolução observada, resposta ao tratamento e conduta..." className="mt-1 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary" /></label>
          <label className="block text-xs font-semibold text-muted-foreground">Intercorrências registradas<textarea value={complications} onChange={(event) => { setComplications(event.target.value); markDraftChanged(); setFollowUpValidation((current) => ({ ...current, content: undefined })); }} maxLength={5000} rows={3} placeholder="Registre intercorrências ou informe que não houve, quando aplicável..." className="mt-1 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:border-primary" /></label>
          {followUpError ? <p id="follow-up-server-error" tabIndex={-1} key={followUpValidationAttempt} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{followUpError}</p> : null}
        </Card>

        <Card className="space-y-3 p-4 sm:p-5"><h2 className="flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-primary" />Histórico da jornada</h2><ol className="space-y-2">{data.sessions.map((session) => <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"><span className="text-xs"><strong>{session.procedureName}</strong><span className="text-muted-foreground"> · {new Date(session.performedAt).toLocaleDateString("pt-BR")} · {session.professional}</span></span><span className="text-xs text-muted-foreground">Sessão concluída</span></li>)}{data.journey.appointments.filter((appointment) => /retorno/i.test(appointment.procedure)).map((appointment) => <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"><span className="text-xs"><strong>{new Date(appointment.date).toLocaleDateString("pt-BR")} · {appointment.time}</strong><span className="text-muted-foreground"> · {appointment.procedure}</span></span><span className="text-xs text-muted-foreground">{appointment.status}</span></li>)}</ol><h3 className="pt-2 text-xs font-bold">Registros clínicos</h3>{data.followUps.length ? <ol className="space-y-3">{[...data.followUps].reverse().map((record) => <li key={record.id} className="border-l-2 border-primary/30 pl-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-xs">{new Date(record.occurredAt).toLocaleString("pt-BR")} · {record.professional}</strong><span className="text-xs text-muted-foreground">Registrado por {record.createdBy}</span></div>{record.guidanceSentAt ? <p className="mt-1 text-xs text-emerald-800">Orientações registradas como enviadas em {new Date(record.guidanceSentAt).toLocaleString("pt-BR")}</p> : null}{record.guidanceText ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{record.guidanceText}</p> : null}{record.observations ? <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">{record.observations}</p> : null}{record.complications ? <p className="mt-1 whitespace-pre-wrap text-xs text-amber-800">Intercorrência: {record.complications}</p> : null}{record.appointment ? <p className="mt-1 text-xs text-muted-foreground">Retorno: {new Date(record.appointment.date).toLocaleDateString("pt-BR")} · {record.appointment.status}</p> : null}{record.photos.length ? <div className="mt-2 flex gap-2">{record.photos.map((photo) => <img key={photo.id} src={photo.imageUrl} alt={photo.name} className="h-16 w-16 rounded border border-border object-contain" />)}</div> : null}<p className="mt-1 text-xs text-muted-foreground">Atualizado {new Date(record.updatedAt).toLocaleString("pt-BR")}</p></li>)}</ol> : <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum registro adicional de acompanhamento.</p>}</Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Resumo do pós</h2><Summary label="Tratamento" value={data.journey.name} /><Summary label="Etapa" value={data.journey.status} /><Summary label="Sessão" value={new Date(data.session.performedAt).toLocaleDateString("pt-BR")} /><Summary label="Profissional" value={data.session.professional} /><Summary label="Fotos da jornada" value={String(allPhotos.length)} /><Summary label="Registros de acompanhamento" value={String(data.followUps.length)} /></Card>
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Próximos retornos</h2>{upcomingAppointments.length ? upcomingAppointments.map((appointment) => <div key={appointment.id} className="rounded-md bg-muted/50 px-3 py-2 text-xs"><strong>{new Date(appointment.date).toLocaleDateString("pt-BR")} · {appointment.time}</strong><p className="mt-0.5 text-muted-foreground">{appointment.procedure} · {appointment.professional}</p><span className="text-xs text-muted-foreground">{appointment.status}</span></div>) : <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Nenhum retorno agendado.</p>}<Button className="w-full" variant="outline" onClick={() => { setAppointmentLaunchReturn(false); setAppointmentNotice(""); setAppointmentFormError(""); setAppointmentDateError(""); setAppointmentTimeError(""); setAppointmentOpen(true); }}><CalendarDays className="h-4 w-4" />Agendar retorno</Button></Card>
        <Card className="space-y-2 p-4"><h2 className="text-sm font-bold">Checklist do pós-procedimento</h2>{[["Fotos iniciais disponíveis", beforePhotos.length > 0], ["Resultado da sessão disponível", afterPhotos.length > 0], ["Orientações registradas", data.followUps.some((item) => Boolean(item.guidanceSentAt))], ["Retorno agendado", upcomingAppointments.length > 0], ["Evolução clínica registrada", data.followUps.some((item) => Boolean(item.observations || item.complications))]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-2 text-xs"><span className={cn("grid h-4 w-4 place-items-center rounded border", done ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
        <Card className="space-y-2 border-emerald-200 bg-emerald-50/60 p-4"><h2 className="flex items-center gap-2 text-sm font-bold text-emerald-950"><ShieldCheck className="h-4 w-4" />Sessão concluída</h2><p className="text-xs text-emerald-900">A sessão foi concluída. O tratamento permanece em andamento até ser encerrado na jornada.</p></Card>
      </aside>
    </div>
    <Modal open={appointmentOpen} onClose={() => setAppointmentOpen(false)} closeOnOverlayClick={false} title="Agendar retorno" description="O agendamento será criado na agenda da clínica e vinculado a esta jornada." panelClassName="max-w-md" bodyClassName="p-5 [--modal-pad:1.25rem]">
        <form noValidate onSubmit={(event) => void scheduleReturn(event)} className="space-y-4">
          <label id="return-date-field" tabIndex={-1} className="block scroll-mt-24 text-xs font-medium">Data<input key={`appointment-date-${appointmentErrorAnimation}`} required aria-invalid={Boolean(appointmentDateError)} aria-describedby={appointmentDateError ? "appointment-date-error" : undefined} type="date" value={appointmentDate} onChange={(event) => { setAppointmentDate(event.target.value); setAppointmentDateError(""); setAppointmentFormError(""); }} min={today} className={cn("mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm", appointmentDateError && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} />{appointmentDateError ? <span id="appointment-date-error" role="alert" className="mt-1 block text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{appointmentDateError}</span> : null}</label>
          <label id="return-time-field" tabIndex={-1} className="block scroll-mt-24 text-xs font-medium">Horário{appointmentHours ? <ClinicTimePicker openingTime={appointmentHours.openingTime} closingTime={appointmentHours.closingTime} latestTime={appointmentHours.allowAppointmentsOutsideHours ? undefined : appointmentLatestStart} allowOutsideHours={appointmentHours.allowAppointmentsOutsideHours} value={appointmentTime} invalid={Boolean(appointmentTimeError)} disabled={appointmentHoursLoading || !appointmentHasSlots} onChange={(value) => { setAppointmentTime(value); setAppointmentTimeError(""); setAppointmentFormError(""); }} /> : <button type="button" disabled className="mt-1 flex h-10 w-full items-center rounded-md border border-border bg-background px-3 text-left text-xs text-muted-foreground opacity-60">Carregando horários...</button>}{appointmentTimeError ? <span id="appointment-time-error" role="alert" className="mt-1 block text-xs text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{appointmentTimeError}</span> : null}{appointmentHours ? <span className="mt-1 block text-xs text-muted-foreground">{appointmentHasSlots ? `Horários disponíveis: ${appointmentHours.openingTime} às ${appointmentLatestStart}.` : "Não há horários disponíveis para a duração deste retorno."}</span> : null}</label>
          <label className="block text-xs font-medium">Observação<textarea value={appointmentNotes} onChange={(event) => { setAppointmentNotes(event.target.value); setAppointmentFormError(""); }} maxLength={500} rows={3} className="text-sm mt-1 w-full rounded-md border border-border bg-background p-3" /></label>
          {appointmentFormError ? <div id="return-form-error" tabIndex={-1} key={appointmentErrorAnimation} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{appointmentFormError}<Button className="ml-2 h-auto p-0 text-xs" variant="link" type="button" onClick={() => { setAppointmentHours(null); setAppointmentFormError(""); setAppointmentHoursRetry((value) => value + 1); }}>Tentar novamente</Button></div> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAppointmentOpen(false)}>Cancelar</Button><Button type="submit" disabled={booking || appointmentHoursLoading || !appointmentHours || !appointmentHasSlots}>{booking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}Confirmar retorno</Button></div>
        </form>
    </Modal>
    <PhotoPreviewModal photo={preview} onClose={() => setPreview(null)} />
    {photoRemovalDialog}
  </div>;
}

function PhotoPicker({ label, photos, value, onChange, empty }: { label: string; photos: ClinicalPhoto[]; value: string; onChange: (value: string) => void; empty: string }) { return <label className="text-xs font-semibold text-muted-foreground">{label}<select value={value} onChange={(event) => onChange(event.target.value)} disabled={!photos.length} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"><option value="">{photos.length ? "Selecionar fotografia" : empty}</option>{photos.map((photo) => <option key={photo.id} value={photo.id}>{photo.category} · {photo.source} · {new Date(photo.capturedAt).toLocaleDateString("pt-BR")}</option>)}</select></label>; }
function PhotoCanvas({ photo, title, zoom, onPreview }: { photo: ClinicalPhoto; title: string; zoom: number; onPreview: () => void }) { return <div className="relative grid h-full min-w-0 place-items-center overflow-hidden bg-muted/30"><img src={photo.imageUrl} alt={title} className="h-full w-full object-contain" style={{ transform: `scale(${zoom})` }} /><span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-xs font-semibold text-white">{title}</span><button type="button" aria-label={`Ampliar foto ${title}`} onClick={onPreview} className="absolute bottom-2 right-2 rounded bg-black/65 p-1.5 text-white"><Expand className="h-4 w-4" /></button></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2 text-xs"><span className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{label}</span><strong className="max-w-[65%] break-words text-right">{value}</strong></div>; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Falha ao ler a foto.")); reader.onerror = () => reject(new Error("Falha ao ler a foto.")); reader.readAsDataURL(file); }); }
function imageDimensions(src: string) { return new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("Imagem inválida.")); image.src = src; }); }
