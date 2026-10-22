"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, CheckCircle2, Clock3, LoaderCircle, FileText, ImagePlus, Loader2, Plus, Search, Syringe, Trash2, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { getCachedJson, invalidateClientCache, readClientCache } from "@/lib/client-cache";
import { appointmentSlotError, clinicToday, latestAppointmentStart } from "@/lib/clinic-time";
import { combinedProcedureName, procedureAppointmentName, shouldRefreshDraftName } from "@/lib/procedure-session-rules";
import { cn } from "@/lib/utils";
import type { Patient } from "@/types/clinic";
import { LoadingSkeleton } from "./shared";
import { EncounterBreadcrumb, type EncounterBreadcrumbActions } from "./encounter-breadcrumb";
import { useDraftAutosave } from "./use-draft-autosave";
import { ReadOnlyStageNotice } from "./readonly-stage-notice";
import { revealValidationTarget } from "./reveal-validation-target";
import { JourneyProgress } from "./journey-progress";
import { useBodyScrollLock } from "./use-body-scroll-lock";
import { ProcedureTermsPanel } from "./procedure-terms-panel";
import { ClinicTimePicker } from "./clinic-time-picker";

type SessionPhoto = { id: string; name: string; phase: "Antes" | "Imediatamente após"; category: string; imageUrl: string; sourceEvaluationPhotoId?: string; width: number; height: number };
type Allocation = { lotId: string; quantity: number; code?: string; expiresOn?: string };
type UsedMaterial = { productId: string; name?: string; unit?: string; quantity: number; allocations: Allocation[] };
type Session = { id: string; procedureName: string; professional: string; performedAt: string; startedAt: string | null; endedAt: string | null; estimatedMinutes: number | null; durationMinutes: number | null; technique: string; treatedAreas: string; anesthesia: string; complications: string; observations: string; materials: UsedMaterial[]; photos: SessionPhoto[]; auditLog: Array<{ at: string; actor: string; action: string; fields: string[] }>; status: string; updatedBy: string; updatedAt: string; completedBy?: string | null; completedAt?: string | null };
type Procedure = { id: string; name: string; durationMinutes: number };
type Product = { id: string; name: string; unit: string; lots: Array<{ id: string; code: string; expiresOn: string; balance: number }> };
type InitialPhoto = { id: string; name: string; imageUrl: string; width: number; height: number; category: string };
type Payload = { journey: { id: string; name: string; status: string }; quote: { id: string; status: string; items: Array<{ procedureId: string; name: string; quantity: number }> }; evaluation: { id: string; chiefComplaint: string; patientGoal: string; allergies: string; contraindications: string; photos: InitialPhoto[] }; procedures: Procedure[]; materials: Product[]; sessions: Session[]; consent: { signed: boolean; signedCount: number; pendingCount: number; message: string }; clinicName?: string; scheduledProcedure?: ScheduledProcedure | null };
type ScheduledProcedure = { id: string; date: string; time: string; procedure: string; professional: string; status: string };
type AppointmentHours = { openingTime: string; closingTime: string };

const photoCategories = ["Frontal", "Perfil direito", "Perfil esquerdo", "Sorriso", "Outra"];
const cacheKey = (patientId: string, journeyId: string, quoteId: string) => `/api/patients/${patientId}/procedure-sessions?journeyId=${encodeURIComponent(journeyId)}&quoteId=${encodeURIComponent(quoteId)}`;

export function ProcedureSessionWorkspace({ patient, patientId, journeyId, quoteId, breadcrumb, readOnly = false, onBack, onCompleted }: { patient: Patient; patientId: string; journeyId?: string; quoteId: string; breadcrumb?: EncounterBreadcrumbActions; readOnly?: boolean; onBack: () => void; onCompleted: (sessionId: string) => void }) {
  const key = journeyId ? cacheKey(patientId, journeyId, quoteId) : "";
  const cached = key ? readClientCache<Payload>(key) : undefined;
  const [data, setData] = useState<Payload | null>(cached ?? null);
  const [loading, setLoading] = useState(Boolean(key && !cached));
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [draft, setDraft] = useState<Omit<Session, "id" | "updatedAt"> & { id?: string; updatedAt?: string } | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [editRevision, setEditRevision] = useState(0);
  const editRevisionRef = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState<"save" | "start" | "finish" | "new" | "" >("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [startChoiceOpen, setStartChoiceOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [scheduleHours, setScheduleHours] = useState<AppointmentHours | null>(() => readClientCache<AppointmentHours>("/api/appointments/options") ?? null);
  const [scheduleHoursRetry, setScheduleHoursRetry] = useState(0);
  const [scheduleFormError, setScheduleFormError] = useState("");
  const [scheduleDateError, setScheduleDateError] = useState("");
  const [scheduleTimeError, setScheduleTimeError] = useState("");
  const [scheduleErrorAnimation, setScheduleErrorAnimation] = useState(0);
  const [scheduling, setScheduling] = useState(false);
  const schedulingRef = useRef(false);
  const [noticeAnimation, setNoticeAnimation] = useState(0);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [invalidFields, setInvalidFields] = useState<Set<string>>(() => new Set());
  const [cameraPhase, setCameraPhase] = useState<SessionPhoto["phase"]>("Antes");
  const [photoCategory, setPhotoCategory] = useState("Frontal");
  const [photoAction, setPhotoAction] = useState<{ phase: SessionPhoto["phase"]; action: "upload" | "capture" } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [preview, setPreview] = useState<SessionPhoto | InitialPhoto | null>(null);
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false);
  const [materialSearch, setMaterialSearch] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);
  const photoCategoryRef = useRef("Frontal");
  const creatingRef = useRef(false);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!key) return;
    let active = true;
    getCachedJson<Payload>(key).then(async (result) => {
      if (!active) return;
      let payload = result;
      // Sem sessão ainda: abre (ou reaproveita) a sessão única do orçamento, sem tela intermediária.
      // A criação é idempotente no servidor (rascunho da jornada+orçamento é reaproveitado), então remontagens não duplicam.
      const combined = combinedProcedureName(result.quote.items.map((item) => item.name));
      const staleDraft = result.sessions.find((item) => shouldRefreshDraftName(item, combined));
      if ((!result.sessions.length || staleDraft) && !readOnly) {
        const created = await requestSession();
        if (!active) return;
        payload = { ...result, sessions: [created, ...result.sessions.filter((item) => item.id !== created.id)] };
        invalidateClientCache(key);
      }
      if (!active) return;
      setData(payload);
      setError("");
      const latest = payload.sessions[0];
      if (latest) { setSessionId(latest.id); setDraft(toDraft(latest)); }
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Não foi possível carregar a sessão."); }).finally(() => { if (active) { setLoading(false); setHydrated(true); } });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- requestSession/readOnly dependem só de props já cobertas por key
  }, [key, retry]);

  useEffect(() => {
    if (draft?.status !== "Em execução" || !draft.startedAt || draft.endedAt) return;
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [draft?.status, draft?.startedAt, draft?.endedAt]);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (!cameraOpen) { stopCamera(); return; }
    let active = true;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then((stream) => {
      if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    }).catch(() => { if (active) { setCameraOpen(false); showNotice("Não foi possível acessar a câmera. Verifique a permissão do navegador ou envie uma foto.", true); } });
    return () => { active = false; stopCamera(); };
  }, [cameraOpen]);

  const initialPhotos = data?.evaluation.photos ?? [];
  const photos = draft?.photos ?? [];
  const materials = draft?.materials ?? [];
  const availableMaterials = (data?.materials ?? []).filter((product) => !materials.some((used) => used.productId === product.id) && product.name.toLocaleLowerCase("pt-BR").includes(materialSearch.trim().toLocaleLowerCase("pt-BR")));
  const noticeIsMaterial = Boolean(notice && /material|ficha técnica|estoque|lote|saldo/i.test(notice.text));
  const doneChecklist = [Boolean(draft?.technique.trim() && draft?.treatedAreas.trim()), materials.every((item) => item.allocations.length > 0), photos.some((photo) => photo.phase === "Antes") && photos.some((photo) => photo.phase === "Imediatamente após"), draft?.status === "Concluída"];
  const canWrite = Boolean(!readOnly && draft && draft.status !== "Concluída" && busy !== "finish");
  const consentOk = Boolean(data?.consent?.signed);
  const consentReason = data?.consent?.message || "Para iniciar o procedimento, anexe o termo de consentimento assinado.";
  const afterLocked = draft?.status === "Rascunho";
  const startBlocked = draft?.status === "Rascunho" && !consentOk;
  const startedAtMs = draft?.startedAt ? Date.parse(draft.startedAt) : null;
  const elapsedEndMs = draft?.endedAt ? Date.parse(draft.endedAt) : draft?.status === "Em execução" ? timerNow : startedAtMs;
  const elapsedSeconds = startedAtMs !== null && elapsedEndMs !== null ? Math.max(0, Math.floor((elapsedEndMs - startedAtMs) / 1000)) : 0;
  const changedMaterials = materials.map((item) => ({ productId: item.productId, quantity: item.quantity, allocations: item.allocations.map((allocation) => ({ lotId: allocation.lotId, quantity: allocation.quantity })) }));
  const autosave = useDraftAutosave({ scope: `${patientId}:${sessionId}`, revision: editRevision, enabled: hydrated && Boolean(sessionId && canWrite), save: async () => save(undefined, true) });
  useBodyScrollLock(Boolean(preview) || scheduleOpen);
  const scheduleHoursLoading = scheduleOpen && !scheduleHours && !scheduleFormError;
  const scheduleLatestStart = scheduleHours ? latestAppointmentStart(scheduleHours.closingTime, 60) : null;
  const scheduleHasSlots = Boolean(scheduleHours && scheduleLatestStart && scheduleHours.openingTime <= scheduleLatestStart);
  const scheduledProcedure = data?.scheduledProcedure ?? null;
  // Agendamento ainda em "Agendado": é o único que o início da sessão move para agora.
  const activeSchedule = scheduledProcedure && scheduledProcedure.status === "Agendado" ? scheduledProcedure : null;

  useEffect(() => {
    if (!scheduleOpen) return;
    let active = true;
    getCachedJson<AppointmentHours>("/api/appointments/options")
      .then((hours) => { if (active) setScheduleHours(hours); })
      .catch((reason) => { if (active) setScheduleFormError(reason instanceof Error ? reason.message : "Não foi possível carregar o horário da clínica."); });
    return () => { active = false; };
  }, [scheduleOpen, scheduleHoursRetry]);

  function openStartChoice() {
    if (readOnly || draft?.status !== "Rascunho") return;
    setStartChoiceOpen(true);
  }

  function chooseSchedule() {
    setStartChoiceOpen(false);
    setScheduleFormError(""); setScheduleDateError(""); setScheduleTimeError("");
    setScheduleOpen(true);
  }

  function failSchedule(message: string, field: "date" | "time" | "form") {
    if (field === "date") setScheduleDateError(message);
    else if (field === "time") setScheduleTimeError(message);
    else setScheduleFormError(message);
    setScheduleErrorAnimation((value) => value + 1);
    revealValidationTarget(field === "date" ? "procedure-schedule-date-field" : field === "time" ? "procedure-schedule-time-field" : "procedure-schedule-form-error");
  }

  // Cria o agendamento real na Agenda, vinculado à jornada; a sessão continua em Rascunho.
  async function scheduleProcedure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !journeyId || schedulingRef.current || readOnly) return;
    if (!scheduleDate || !scheduleTime) {
      setScheduleDateError(scheduleDate ? "" : "Informe a data do procedimento.");
      setScheduleTimeError(scheduleTime ? "" : "Informe o horário do procedimento.");
      setScheduleFormError("");
      setScheduleErrorAnimation((value) => value + 1);
      revealValidationTarget(scheduleDate ? "procedure-schedule-time-field" : "procedure-schedule-date-field");
      return;
    }
    if (!scheduleHours) { failSchedule("Não foi possível carregar o horário de funcionamento da clínica. Tente novamente.", "form"); return; }
    const slotError = appointmentSlotError(scheduleDate, scheduleTime, scheduleHours.openingTime, scheduleHours.closingTime);
    if (slotError) { failSchedule(slotError, /data|passou/i.test(slotError) ? "date" : "time"); return; }
    setScheduleDateError(""); setScheduleTimeError(""); setScheduleFormError("");
    schedulingRef.current = true;
    setScheduling(true);
    try {
      const response = await fetch("/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patientId, journeyId, procedure: procedureAppointmentName(draft.procedureName), professional: draft.professional, date: scheduleDate, time: scheduleTime, notes: scheduleNotes }) });
      const result = await response.json().catch(() => ({})) as { appointment?: { id: string; date: string; time: string; procedure: string; professional: string; status: string; notes: string }; message?: string };
      if (!response.ok || !result.appointment) throw new Error(result.message ?? "Não foi possível agendar o procedimento.");
      invalidateClientCache(key, "/api/agenda", "/api/dashboard/bootstrap", `/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`);
      const created = result.appointment;
      setData((current) => current ? { ...current, scheduledProcedure: { id: created.id, date: scheduleDate, time: created.time, procedure: created.procedure, professional: created.professional, status: created.status } } : current);
      showNotice(`Procedimento agendado para ${formatDay(scheduleDate)} às ${created.time}.`);
      setScheduleOpen(false); setScheduleDate(""); setScheduleTime(""); setScheduleNotes("");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Não foi possível agendar o procedimento.";
      failSchedule(message, /data|passou/i.test(message) ? "date" : /horário|funcionamento|disponível/i.test(message) ? "time" : "form");
      if (/já está agendado/i.test(message)) void refreshScheduled();
    } finally { schedulingRef.current = false; setScheduling(false); }
  }

  async function refreshScheduled() {
    if (!key) return;
    invalidateClientCache(key);
    try {
      const result = await getCachedJson<Payload>(key);
      setData((current) => current ? { ...current, scheduledProcedure: result.scheduledProcedure ?? null } : current);
    } catch { /* o aviso de duplicidade já foi exibido */ }
  }

  function patchDraft(changes: Partial<Session>) {
    setDraft((current) => current ? { ...current, ...changes } : current);
    editRevisionRef.current += 1;
    setEditRevision(editRevisionRef.current);
    setInvalidFields((current) => {
      const next = new Set(current);
      if (typeof changes.technique === "string" && changes.technique.trim()) next.delete("technique");
      if (typeof changes.treatedAreas === "string" && changes.treatedAreas.trim()) next.delete("treatedAreas");
      if (typeof changes.professional === "string" && changes.professional.trim()) next.delete("professional");
      if (changes.photos) {
        if (changes.photos.some((photo) => photo.phase === "Antes")) next.delete("beforePhoto");
        if (changes.photos.some((photo) => photo.phase === "Imediatamente após")) next.delete("afterPhoto");
      }
      return next;
    });
    setNotice(null);
  }

  function showNotice(text: string, error = false) {
    setNotice({ text, error });
    if (error) setNoticeAnimation((current) => current + 1);
  }

  // Cria a sessão única do orçamento; o servidor reaproveita o rascunho aberto (idempotente). Em reuso, relê a sessão completa.
  async function requestSession(): Promise<Session> {
    const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/procedure-sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ journeyId, quoteId, performedAt: new Date().toISOString() }) });
    const result = await response.json().catch(() => ({})) as { session?: Session; reused?: boolean; message?: string };
    if (!response.ok || !result.session) throw new Error(result.message ?? "Não foi possível abrir a sessão do procedimento.");
    if (result.reused && key) {
      invalidateClientCache(key);
      const fresh = await getCachedJson<Payload>(key);
      const existing = fresh.sessions.find((item) => item.id === result.session!.id);
      if (existing) return existing;
    }
    return result.session;
  }

  async function createSession() {
    if (readOnly || !data || !journeyId || creatingRef.current) return;
    creatingRef.current = true;
    setBusy("new"); setNotice(null);
    try {
      const created = await requestSession();
      setSessionId(created.id); setDraft(toDraft(created));
      setData((current) => current ? { ...current, sessions: [created, ...current.sessions.filter((item) => item.id !== created.id)] } : current);
      invalidateClientCache(key);
    } catch (reason) { showNotice(reason instanceof Error ? reason.message : "Não foi possível abrir a sessão.", true); }
    finally { creatingRef.current = false; setBusy(""); }
  }

  async function save(status: "Rascunho" | "Em execução" | "Concluída" = draft?.status === "Em execução" ? "Em execução" : "Rascunho", automatic = false) {
    if (readOnly || !draft || !sessionId || !journeyId) return false;
    if (status === "Em execução" && !automatic && draft.status === "Rascunho") {
      const missing = new Set<string>();
      if (!draft.technique.trim()) missing.add("technique");
      if (!draft.treatedAreas.trim()) missing.add("treatedAreas");
      if (!draft.professional.trim()) missing.add("professional");
      if (!draft.photos.some((photo) => photo.phase === "Antes")) missing.add("beforePhoto");
      if (missing.size) {
        setInvalidFields(missing);
        setValidationAttempt((current) => current + 1);
        revealValidationTarget(missing.has("technique") || missing.has("treatedAreas") ? "procedure-record-card" : "procedure-photos-card");
        return false;
      }
    }
    if (status === "Concluída") {
      const missing = new Set<string>();
      if (!draft.technique.trim()) missing.add("technique");
      if (!draft.treatedAreas.trim()) missing.add("treatedAreas");
      if (!draft.professional.trim()) missing.add("professional");
      if (!draft.photos.some((photo) => photo.phase === "Antes")) missing.add("beforePhoto");
      if (!draft.photos.some((photo) => photo.phase === "Imediatamente após")) missing.add("afterPhoto");
      if (missing.size) {
        setInvalidFields(missing);
        setValidationAttempt((current) => current + 1);
        revealValidationTarget(missing.has("technique") || missing.has("treatedAreas") ? "procedure-record-card" : missing.has("beforePhoto") || missing.has("afterPhoto") ? "procedure-photos-card" : "procedure-confirmations-card");
        return false;
      }
    }
    // Início exige termo assinado na jornada (o servidor confere de novo); sessão já em execução não é bloqueada.
    if (status === "Em execução" && !automatic && draft.status === "Rascunho" && !consentOk) {
      showConsentRequired(consentReason);
      return false;
    }
    const mode = status === "Concluída" ? "finish" : status === "Em execução" && !automatic ? "start" : "save";
    setBusy(mode); setNotice(null);
    const startedRevision = editRevisionRef.current;
    const savedPhotos = draft.photos.map((photo) => photo.sourceEvaluationPhotoId ? { id: photo.id, name: photo.name, phase: photo.phase, category: photo.category, sourceEvaluationPhotoId: photo.sourceEvaluationPhotoId } : photo);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/procedure-sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, ...(status === "Concluída" ? { durationMinutes: undefined } : {}), status, materials: changedMaterials, photos: savedPhotos, ...(status === "Em execução" && !automatic && activeSchedule ? { scheduledAppointmentId: activeSchedule.id } : {}), ...(status === "Em execução" && !draft.startedAt ? { startedAt: new Date().toISOString() } : {}) }) });
      const result = await response.json().catch(() => ({})) as { session?: Session; pending?: unknown[]; appointment?: { id: string; date: string; time: string } | null; message?: string; code?: string };
      if (response.status === 409 && result.code === "CONSENT_REQUIRED") {
        // Estado defasado: o servidor não encontrou termo assinado. Atualiza o resumo e leva ao card de termos.
        setData((current) => current ? { ...current, consent: { ...current.consent, signed: false, message: result.message ?? current.consent.message } } : current);
        showConsentRequired(result.message ?? consentReason);
        void refreshConsent();
        return false;
      }
      if (!response.ok || !result.session) throw new Error(result.message ?? "Não foi possível salvar a sessão.");
      const updated = { ...result.session, materials: result.session.materials ?? materials, photos: result.session.photos ?? savedPhotos };
      if (startedRevision === editRevisionRef.current) setDraft(toDraft(updated));
      setData((current) => current ? { ...current, sessions: [updated, ...current.sessions.filter((item) => item.id !== updated.id)] } : current);
      invalidateClientCache(key, `/api/patients/${encodeURIComponent(patientId)}/history`, `/api/patients/${encodeURIComponent(patientId)}/journeys`, `/api/patients/${encodeURIComponent(patientId)}/profile`, "/api/dashboard/bootstrap");
      if (status === "Em execução" && !result.appointment) setData((current) => current ? { ...current, scheduledProcedure: null } : current);
      if (status === "Em execução" && result.appointment) {
        // O servidor moveu o agendamento para o início real: reflete aqui e invalida as agendas.
        const moved = result.appointment;
        setData((current) => current?.scheduledProcedure?.id === moved.id ? { ...current, scheduledProcedure: { ...current.scheduledProcedure, date: moved.date, time: moved.time } } : current);
        invalidateClientCache("/api/agenda", "/api/dashboard/bootstrap");
      }
      if (!automatic) showNotice(status === "Concluída" ? `Sessão concluída.${result.pending?.length ? " Há materiais sem saldo que ficaram como saída pendente." : ""}` : status === "Em execução" ? "Início da sessão registrado." : "Rascunho salvo.");
      if (status === "Concluída") onCompleted(updated.id);
      return true;
    } catch (reason) {
      if (!automatic) {
        showNotice(reason instanceof Error ? reason.message : "Não foi possível salvar a sessão.", true);
        revealValidationTarget("procedure-error-notice");
      }
      return false;
    }
    finally { setBusy(""); }
  }

  function showConsentRequired(text: string) {
    setInvalidFields(new Set(["consent"]));
    setValidationAttempt((current) => current + 1);
    showNotice(text, true);
    revealValidationTarget("procedure-confirmations-card");
  }

  // Recarrega só o resumo do consentimento (após anexar termo ou 409 do servidor), sem skeleton.
  async function refreshConsent() {
    if (!key) return;
    invalidateClientCache(key);
    try {
      const result = await getCachedJson<Payload>(key);
      setData((current) => current ? { ...current, consent: result.consent } : current);
      if (result.consent.signed) {
        setInvalidFields((current) => { const next = new Set(current); next.delete("consent"); return next; });
        // O aviso vermelho de "anexe o termo" some assim que o termo assinado é anexado.
        setNotice((current) => current?.error && /termo de consentimento/i.test(current.text) ? null : current);
      }
    } catch { /* o servidor decide no início; o aviso atual permanece */ }
  }

  // "Iniciar agora": fluxo original (termo assinado, confirmação e validações do servidor).
  function requestStart() {
    setStartChoiceOpen(false);
    if (!consentOk) { showConsentRequired(consentReason); return; }
    setConfirmStart(true);
  }

  async function finish() {
    if (!await autosave.flush()) { revealValidationTarget("procedure-header-card"); return; }
    await save("Concluída");
  }

  async function start() {
    if (await autosave.flush()) await save("Em execução");
    else revealValidationTarget("procedure-header-card");
  }

  function addMaterial(productId: string) {
    const product = data?.materials.find((item) => item.id === productId);
    if (!product || materials.some((item) => item.productId === product.id)) return;
    patchDraft({ materials: [...materials, { productId, name: product.name, unit: product.unit, quantity: 1, allocations: allocateSessionLots(product, 1) }] });
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

  async function uploadFiles(files: FileList | null, phase: SessionPhoto["phase"], category: string) { if (phase === "Imediatamente após" && afterLocked) return;
    if (!files?.length) return;
    const chosen = Array.from(files);
    if (photos.length + chosen.length > 20) { showNotice("Cada sessão aceita até 20 fotografias.", true); return; }
    const converted: SessionPhoto[] = [];
    for (const file of chosen) {
      if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 6_000_000) { showNotice("Use imagens JPG, PNG ou WebP de até 6 MB cada.", true); return; }
      const imageUrl = await fileToDataUrl(file);
      const size = await imageDimensions(imageUrl);
      if (size.width > 8000 || size.height > 8000 || size.width * size.height > 25_000_000 || imageUrl.length > 8_500_000) { showNotice("A resolução desta imagem excede o limite seguro de 25 megapixels.", true); return; }
      converted.push({ id: crypto.randomUUID(), name: file.name.slice(0, 180), phase, category, imageUrl, width: size.width, height: size.height });
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
    if (photos.length >= 20) { showNotice("Cada sessão aceita até 20 fotografias.", true); return; }
    if (video.videoWidth > 8000 || video.videoHeight > 8000 || video.videoWidth * video.videoHeight > 25_000_000) { showNotice("A resolução da câmera excede o limite seguro de 25 megapixels.", true); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const imageUrl = canvas.toDataURL("image/jpeg", 0.9);
    patchDraft({ photos: [...photos, { id: crypto.randomUUID(), name: `captura-${new Date().toISOString()}.jpg`, phase: cameraPhase, category: photoCategoryRef.current, imageUrl, width: canvas.width, height: canvas.height }] });
    setCameraOpen(false);
  }

  function startCamera(phase: SessionPhoto["phase"]) {
    if (!navigator.mediaDevices?.getUserMedia) {
      showNotice("Este dispositivo ou navegador não disponibiliza câmera. Envie uma fotografia para continuar.", true);
      return;
    }
    setCameraPhase(phase);
    setCameraOpen(true);
  }

  function requestPhotoAction(phase: SessionPhoto["phase"], action: "upload" | "capture") { if (phase === "Imediatamente após" && afterLocked) return;
    if (action === "capture" && !navigator.mediaDevices?.getUserMedia) {
      showNotice("Este dispositivo ou navegador não disponibiliza câmera. Envie uma fotografia para continuar.", true);
      return;
    }
    setPhotoAction({ phase, action });
  }

  function confirmPhotoCategory(category: string) {
    if (!photoAction) return;
    photoCategoryRef.current = category;
    setPhotoCategory(category);
    const { phase, action } = photoAction;
    setPhotoAction(null);
    if (action === "capture") {
      startCamera(phase);
      return;
    }
    (phase === "Antes" ? beforeInputRef : afterInputRef).current?.click();
  }

  if (!journeyId) return <Card className="p-6 text-center text-sm text-[#b42318]">Esta execução não está vinculada a um tratamento.</Card>;
  if (loading) return <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="space-y-4 p-5"><LoadingSkeleton className="h-10 w-1/2" /><LoadingSkeleton className="h-56 w-full" /><LoadingSkeleton className="h-40 w-full" /></Card><Card className="space-y-4 p-5"><LoadingSkeleton className="h-8 w-1/2" /><LoadingSkeleton className="h-20 w-full" /></Card></div>;
  if (error || !data) return <Card className="space-y-3 p-6 text-center"><p className="text-sm font-semibold text-[#b42318]">{error || "Dados da execução indisponíveis."}</p><Button variant="outline" onClick={() => { setError(""); setLoading(true); setRetry((value) => value + 1); }}>Tentar novamente</Button></Card>;
  if (!draft) return <div className="space-y-4">{breadcrumb ? <><EncounterBreadcrumb patientName={patient.name} journeyName={data.journey.name} stage="Procedimento" {...breadcrumb} /><button type="button" onClick={breadcrumb.onJourney} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button></> : null}<Card className="space-y-4 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold">Sessão do procedimento</h2><p className="mt-1 text-xs text-[#767789]">{readOnly ? "Nenhuma sessão foi registrada para este orçamento." : "Não foi possível abrir a sessão deste orçamento."} · {data.journey.name}</p></div><Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4" />Voltar ao orçamento</Button></div>{readOnly ? <ReadOnlyStageNotice /> : <Button disabled={busy === "new"} onClick={() => void createSession()}><Plus className="h-4 w-4" />Tentar abrir a sessão</Button>}</Card></div>;

  const selectedSession = data.sessions.find((item) => item.id === sessionId);
  // Procedimentos incluídos vêm sempre dos itens selecionados no orçamento, não do nome gravado na sessão.
  const includedList = data.quote.items.length ? data.quote.items : [{ procedureId: "legacy", name: draft.procedureName, quantity: 1 }];
  const includedLabel = combinedProcedureName(includedList.map((item) => item.name));
  const forwardSessionId = draft.status === "Concluída" ? sessionId : data.sessions.find((item) => item.status === "Concluída")?.id;
  return (
    <div className="space-y-4">
      {breadcrumb ? <><EncounterBreadcrumb patientName={patient.name} journeyName={data.journey.name} stage="Procedimento" onClients={() => void autosave.leave(breadcrumb.onClients)} onPatient={() => void autosave.leave(breadcrumb.onPatient)} onJourney={() => void autosave.leave(breadcrumb.onJourney)} /><button type="button" onClick={() => void autosave.leave(breadcrumb.onJourney)} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"><ArrowLeft className="h-4 w-4" />Voltar aos tratamentos</button></> : null}
      <Card id="procedure-header-card" tabIndex={-1} className="scroll-mt-24 flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ece9ff] text-sm font-black text-[#5147dc]">{patient.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div className="min-w-0"><h2 className="truncate text-base font-bold">{patient.name}</h2><p className="text-xs text-[#747587]">{draft.procedureName} · Sessão clínica · {data.journey.name}</p><p className="mt-0.5 flex flex-wrap gap-1" aria-label="Procedimentos incluídos">{includedList.map((item) => <span key={item.procedureId} className="rounded-full bg-[#ece9ff] px-2 py-0.5 text-xs font-semibold text-[#5147dc]">{item.name}{item.quantity > 1 ? ` (${item.quantity}x)` : ""}</span>)}</p><p className="text-xs text-[#858696]">{patient.age ? `${patient.age} anos · ` : ""}{patient.phone} · {draft.status}</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><span role="status" className={cn("text-xs", autosave.state === "error" ? "text-destructive" : "text-muted-foreground")}>{readOnly ? "Somente leitura" : autosave.state === "saving" ? "Salvando..." : autosave.state === "pending" ? "Alterações pendentes" : autosave.state === "error" ? "Não foi possível salvar" : "Rascunho salvo"}</span>{autosave.state === "error" && !readOnly ? <Button size="sm" variant="outline" onClick={() => void autosave.flush()}>Tentar novamente</Button> : null}<Button variant="outline" onClick={() => void autosave.leave(onBack)}><ArrowLeft className="h-4 w-4" />Voltar ao orçamento</Button>{readOnly || draft.status === "Concluída" ? (forwardSessionId ? <Button onClick={() => onCompleted(forwardSessionId)}>Acompanhamento <ArrowRight className="h-4 w-4" /></Button> : null) : draft.status === "Rascunho" ? <>{activeSchedule ? <Button type="button" variant="outline" aria-disabled="true" tabIndex={-1} title="Para remarcar ou cancelar, use a Agenda" className="max-w-full cursor-not-allowed whitespace-normal opacity-60 hover:bg-transparent"><CalendarDays className="h-4 w-4 shrink-0" />Agendado: {formatDay(activeSchedule.date)} às {activeSchedule.time}</Button> : null}<Button disabled={Boolean(busy)} aria-describedby={consentOk ? undefined : "procedure-consent-hint"} onClick={openStartChoice}>{busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}{busy === "start" ? "Iniciando..." : "Iniciar procedimento"}</Button></> : <Button disabled={Boolean(busy)} onClick={() => setConfirmFinish(true)}>{busy === "finish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{busy === "finish" ? "Finalizando..." : "Finalizar procedimento"}</Button>}</div>
      </Card>
      {startBlocked ? <div id="procedure-consent-hint" role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[5px] border border-[#f1dfad] bg-[#fff9e8] px-3 py-2 text-xs text-[#765400]"><span><strong>Início bloqueado.</strong> {consentReason}</span><Button type="button" size="sm" variant="outline" onClick={() => revealValidationTarget("procedure-confirmations-card")}><FileText className="h-3.5 w-3.5" />Ir para o termo de consentimento</Button></div> : null}
      <JourneyProgress current={2} />
      {readOnly || draft.status === "Concluída" ? <ReadOnlyStageNotice /> : null}
      <div role="timer" className={cn("flex items-center justify-between gap-3 rounded-[5px] border px-3 py-2.5", draft.status === "Em execução" ? "border-[#f1dfad] bg-[#fff9e8] text-[#765400]" : draft.status === "Concluída" ? "border-[#b9e8d8] bg-[#eef8f2] text-[#287a50]" : "border-[#e5e5ee] bg-[#fafafd] text-[#68697b]")}>
        <span className="flex min-w-0 items-center gap-2"><Clock3 className="h-4 w-4 shrink-0" /><span><strong className="block text-xs">{draft.status === "Em execução" ? "Tempo do procedimento" : draft.status === "Concluída" ? "Duração do procedimento" : "Timer do procedimento"}</strong><span className="block text-xs">{draft.status === "Em execução" ? "Contagem em andamento" : draft.status === "Concluída" ? "Sessão finalizada" : "Começará ao iniciar o procedimento"}</span></span></span>
        <strong className="shrink-0 font-mono text-lg tabular-nums">{formatElapsedTime(elapsedSeconds)}</strong>
      </div>
      {notice && !noticeIsMaterial ? <p id={notice.error ? "procedure-error-notice" : undefined} tabIndex={notice.error ? -1 : undefined} key={noticeAnimation} role={notice.error ? "alert" : "status"} className={cn("scroll-mt-24 rounded-[5px] px-3 py-2 text-xs font-semibold", notice.error ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eef8f2] text-[#287a50]")}>{notice.text}</p> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {data.sessions.length ? <Card className="flex flex-wrap items-center gap-2 p-3">{data.sessions.length > 1 ? <label className="text-xs font-semibold">Sessões desta jornada<select className="ml-2 h-9 max-w-full rounded-[5px] border border-[#dddde6] bg-white px-2 text-sm" value={sessionId} onChange={(event) => { const next = data.sessions.find((item) => item.id === event.target.value); if (next) void autosave.leave(() => { setSessionId(next.id); setDraft(toDraft(next)); }); }}>{data.sessions.map((item, index) => <option key={item.id} value={item.id}>Sessão {data.sessions.length - index} · {new Date(item.performedAt).toLocaleDateString("pt-BR")} · {item.status}</option>)}</select></label> : <span className="text-xs font-semibold">Sessão · {new Date(draft.performedAt).toLocaleDateString("pt-BR")} · {draft.status}</span>}<Button type="button" variant="outline" size="sm" disabled={readOnly || Boolean(busy) || draft.status !== "Concluída"} onClick={() => void createSession()}><Plus className="h-4 w-4" />Nova sessão</Button></Card> : null}
          <Card id="procedure-record-card" tabIndex={-1} className={cn("scroll-mt-24 p-4", (invalidFields.has("technique") || invalidFields.has("treatedAreas")) && "border-[#d92d20]")}>
            <h3 className="flex items-center gap-2 text-sm font-bold"><Syringe className="h-4 w-4 text-[#5147dc]" />Registro do procedimento</h3>
            <div className="mt-3 grid gap-3 rounded-[5px] bg-[#f7f7fb] p-3 sm:grid-cols-2 xl:grid-cols-4">
              <Summary label="Procedimentos" value={includedLabel} />
              <Summary label="Profissional" value={draft.professional || "Não informado"} />
              <Summary label="Data" value={new Date(draft.performedAt).toLocaleDateString("pt-BR")} />
              <Summary label="Status" value={draft.status} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Procedimentos incluídos" className="xl:col-span-3"><span className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-[5px] border border-[#dfe0e8] bg-[#f5f5f9] px-2.5 py-1.5 text-xs text-[#38394d]">{includedList.map((item) => <span key={item.procedureId} className="rounded-full bg-white px-2 py-0.5 font-semibold">{item.name}{item.quantity > 1 ? ` (${item.quantity}x)` : ""}</span>)}</span></Field>
              <Field label="Técnica utilizada" required error={invalidFields.has("technique") ? "Informe a técnica executada." : undefined} errorKey={`technique-${validationAttempt}`} errorId="technique-error"><input key={`technique-${validationAttempt}`} className={cn(inputClass, invalidFields.has("technique") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} aria-invalid={invalidFields.has("technique")} aria-describedby={invalidFields.has("technique") ? "technique-error" : undefined} disabled={!canWrite} value={draft.technique} onChange={(event) => patchDraft({ technique: event.target.value })} placeholder="Descreva a técnica" /></Field>
              <Field label="Região tratada" required error={invalidFields.has("treatedAreas") ? "Informe a região tratada." : undefined} errorKey={`areas-${validationAttempt}`} errorId="treatedAreas-error"><input key={`treatedAreas-${validationAttempt}`} className={cn(inputClass, invalidFields.has("treatedAreas") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} aria-invalid={invalidFields.has("treatedAreas")} aria-describedby={invalidFields.has("treatedAreas") ? "treatedAreas-error" : undefined} disabled={!canWrite} value={draft.treatedAreas} onChange={(event) => patchDraft({ treatedAreas: event.target.value })} placeholder="Ex.: lábios" /></Field>
              <Field label="Tempo estimado (min)"><input className={inputClass} type="number" min={0} max={1440} disabled={!canWrite} value={draft.estimatedMinutes ?? ""} onChange={(event) => patchDraft({ estimatedMinutes: event.target.value ? Number(event.target.value) : null })} /></Field>
              <Field label="Anestesia"><input className={inputClass} disabled={!canWrite} value={draft.anesthesia} onChange={(event) => patchDraft({ anesthesia: event.target.value })} placeholder="Não informado" /></Field>
              <Field label="Intercorrências"><input className={inputClass} disabled={!canWrite} value={draft.complications} onChange={(event) => patchDraft({ complications: event.target.value })} placeholder="Não informado" /></Field>
              <Field label="Observações da sessão" className="xl:col-span-3"><textarea className={cn(inputClass, "min-h-10 resize-y py-2")} disabled={!canWrite} maxLength={5000} value={draft.observations} onChange={(event) => patchDraft({ observations: event.target.value })} placeholder="Observações clínicas" /></Field>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-[5px] border border-[#ececf2] p-3 text-xs"><strong>Queixa principal</strong><p className="mt-1 text-[#6f7082]">{data.evaluation.chiefComplaint || "Não informado na avaliação"}</p></div><div className="rounded-[5px] border border-[#ececf2] p-3 text-xs"><strong>Alergias e contraindicações</strong><p className="mt-1 text-[#6f7082]">{[data.evaluation.allergies, data.evaluation.contraindications].filter(Boolean).join(" · ") || "Não informado na avaliação"}</p></div></div>
          </Card>

          <Card className="overflow-hidden p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-sm font-bold"><Syringe className="h-4 w-4 text-[#5147dc]" />Produtos e materiais utilizados</h3><Button type="button" size="sm" variant="outline" disabled={!canWrite || !data.materials.length} onClick={() => { setMaterialSearch(""); setMaterialPickerOpen(true); }}><Plus className="h-4 w-4" />Adicionar produto</Button></div>{notice && noticeIsMaterial ? <p id={notice.error ? "procedure-error-notice" : undefined} tabIndex={notice.error ? -1 : undefined} key={noticeAnimation} role={notice.error ? "alert" : "status"} className={cn("mt-3 scroll-mt-24 rounded-[5px] px-3 py-2 text-xs font-semibold", notice.error ? "bg-[#fff1f0] text-[#b42318]" : "bg-[#eef8f2] text-[#287a50]")}>{notice.text}</p> : null}<div className="mt-3 overflow-x-auto"><table className="w-full min-w-[680px] border-collapse text-left text-xs"><thead><tr className="bg-[#f7f7fb] text-[#737486]"><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Quantidade</th><th className="px-3 py-2">Lote e validade</th><th className="px-3 py-2">Saldo</th><th className="w-10" /></tr></thead><tbody>{materials.map((item, index) => { const productData = data.materials.find((product) => product.id === item.productId); const allocation = item.allocations[0]; const lot = productData?.lots.find((candidate) => candidate.id === allocation?.lotId); return <tr key={item.productId} className="border-b border-[#ececf2]"><td className="px-3 py-2.5 font-semibold">{productData?.name ?? item.name ?? "Produto indisponível"}<span className="block text-xs font-normal text-[#898a9a]">{productData?.unit ?? item.unit ?? "unidade"}</span></td><td className="px-3 py-2.5"><input className="text-sm h-8 w-24 rounded-[5px] border border-[#dddde6] px-2" type="number" min="0.001" step="0.001" disabled={!canWrite} value={item.quantity} onChange={(event) => setMaterialQuantity(index, Number(event.target.value))} /></td><td className="px-3 py-2.5"><select className="text-sm h-8 min-w-40 rounded-[5px] border border-[#dddde6] bg-white px-2" disabled={!canWrite} value={allocation?.lotId ?? ""} onChange={(event) => { const selectedLot = productData?.lots.find((candidate) => candidate.id === event.target.value); setMaterial(index, { allocations: selectedLot ? [{ lotId: selectedLot.id, quantity: Math.min(item.quantity, selectedLot.balance), code: selectedLot.code, expiresOn: selectedLot.expiresOn }] : [] }); }}><option value="">Selecionar lote</option>{productData?.lots.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.code} · vence {candidate.expiresOn.split("-").reverse().join("/")}</option>)}</select>{allocation && lot ? <span className="ml-2 text-xs text-[#6f7082]">Válido até {lot.expiresOn.split("-").reverse().join("/")}</span> : allocation ? <span className="ml-2 text-xs text-[#6f7082]">{allocation.code} · validade {allocation.expiresOn?.split("-").reverse().join("/")}</span> : null}</td><td className="px-3 py-2.5">{lot ? `${lot.balance} ${productData?.unit ?? "un"}` : allocation ? "Saldo indisponível" : "Sem lote selecionado"}</td><td className="px-3 py-2.5"><button type="button" className="rounded p-1 text-[#b42318]" disabled={!canWrite} aria-label={`Remover ${item.name ?? "produto"}`} onClick={() => patchDraft({ materials: materials.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></button></td></tr>; })}{materials.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-[#858696]">Nenhum material registrado para esta sessão.</td></tr> : null}</tbody></table></div><p className="mt-2 text-xs text-[#77788a]">O estoque é movimentado somente ao finalizar a sessão. O uso sem saldo disponível gera uma saída pendente conforme as regras do estoque.</p></Card>

          <Card id="procedure-photos-card" tabIndex={-1} className={cn("scroll-mt-24 p-4", (invalidFields.has("beforePhoto") || invalidFields.has("afterPhoto")) && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")}>
            <div><h3 className="flex items-center gap-2 text-sm font-bold"><Camera className="h-4 w-4 text-[#5147dc]" />Fotografias da sessão</h3><p className="mt-1 text-xs text-[#77788a]">As imagens originais da avaliação permanecem preservadas.</p></div>
            {invalidFields.has("beforePhoto") || invalidFields.has("afterPhoto") ? <p key={`session-photos-${validationAttempt}`} role="alert" className="mt-2 text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{invalidFields.has("beforePhoto") && invalidFields.has("afterPhoto") ? "Adicione uma foto de antes e outra imediatamente após a sessão." : invalidFields.has("beforePhoto") ? "Adicione ou selecione uma foto de antes." : "Adicione uma foto do resultado imediatamente após a sessão."}</p> : null}
            {cameraOpen ? <div className="mt-3 space-y-2 rounded-[5px] bg-[#15151d] p-3"><video ref={videoRef} autoPlay playsInline className="mx-auto max-h-[360px] w-full rounded object-contain" /><div className="flex justify-center gap-2"><Button onClick={captureCamera}><Camera className="h-4 w-4" />Capturar</Button><Button variant="outline" onClick={() => setCameraOpen(false)}><X className="h-4 w-4" />Cancelar</Button></div></div> : null}
            <div className="mt-4 space-y-5">{(["Antes", "Imediatamente após"] as const).map((phase) => { const isBefore = phase === "Antes"; const phasePhotos = photos.filter((photo) => photo.phase === phase); const inputRef = isBefore ? beforeInputRef : afterInputRef; return <section key={phase} aria-label={isBefore ? "Fotos de antes" : "Fotos de depois"}><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-bold text-[#202033]">{isBefore ? "Fotos de antes" : "Fotos de depois"} ({phasePhotos.length + (isBefore ? initialPhotos.filter((photo) => !photos.some((item) => item.sourceEvaluationPhotoId === photo.id && item.phase === "Antes")).length : 0)})</h4><Button size="sm" type="button" variant="outline" disabled={!canWrite || afterLocked && !isBefore} title={afterLocked && !isBefore ? "Disponível depois de iniciar o procedimento" : undefined} onClick={() => requestPhotoAction(phase, "capture")}><Camera className="h-4 w-4" />Capturar</Button></div>{afterLocked && !isBefore ? <p className="mb-2 rounded-[5px] bg-[#f7f7fb] px-3 py-2 text-xs text-[#68697b]">As fotos de depois só podem ser adicionadas depois de iniciar o procedimento.</p> : null}<input ref={inputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadFiles(event.target.files, phase, photoCategoryRef.current); event.target.value = ""; }} /><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{phasePhotos.map((photo) => <div key={photo.id} className="group relative overflow-hidden rounded-[5px] border border-[#e5e5ee]"><button type="button" className="block aspect-square w-full bg-[#f7f7fb]" onClick={() => setPreview(photo)}><img alt={`${isBefore ? "Foto antes" : "Foto depois"}: ${photo.name}`} src={photo.imageUrl} className="h-full w-full object-contain" /></button><span className="block truncate px-2 py-1 text-xs">{photo.category} · {photo.name}</span>{canWrite ? <button type="button" aria-label="Remover foto da sessão" className="absolute right-1 top-1 rounded bg-white/90 p-1 text-[#b42318] shadow" onClick={() => patchDraft({ photos: photos.filter((item) => item.id !== photo.id) })}><X className="h-3.5 w-3.5" /></button> : null}</div>)}{isBefore ? initialPhotos.filter((photo) => !photos.some((item) => item.sourceEvaluationPhotoId === photo.id && item.phase === "Antes")).slice(0, 4).map((photo) => <div key={`initial-${photo.id}`} className="overflow-hidden rounded-[5px] border border-dashed border-[#cfcfe0]"><button type="button" className="block aspect-square w-full bg-[#f7f7fb]" onClick={() => setPreview(photo)}><img alt={`Foto inicial: ${photo.name}`} src={photo.imageUrl} className="h-full w-full object-contain" /></button><Button className="h-auto min-h-8 w-full whitespace-normal py-1.5 text-xs leading-tight" size="sm" variant="outline" disabled={!canWrite} onClick={() => selectInitialPhoto(photo, "Antes")}><Plus className="h-3 w-3" />Usar como foto antes</Button></div>) : null}<button type="button" disabled={!canWrite || afterLocked && !isBefore} onClick={() => requestPhotoAction(phase, "upload")} className="grid aspect-square place-items-center gap-2 rounded-[5px] border border-dashed border-[#bdbbff] bg-[#f8f8fc] p-3 text-center text-xs font-medium text-[#5147dc] transition-colors hover:bg-[#f0efff] disabled:cursor-not-allowed disabled:opacity-50"><ImagePlus className="h-5 w-5" /><span>Anexar foto</span></button></div></section>; })}</div>
          </Card>

        </div>
        <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start"><Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Resumo da sessão</h3><Summary label="Etapa atual" value="Procedimento" /><Summary label="Profissional" value={draft.professional || "Não informado"} /><Summary label="Início" value={draft.startedAt ? new Date(draft.startedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Ainda não iniciado"} /><Summary label="Término" value={draft.endedAt ? new Date(draft.endedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "Em aberto"} /><Summary label="Fotos anexadas" value={String(photos.length)} />{selectedSession ? <p className="border-t border-[#ececf2] pt-2 text-xs text-[#77788a]">Última alteração em {new Date(selectedSession.updatedAt).toLocaleString("pt-BR")} por {selectedSession.updatedBy || "responsável não informado"}</p> : null}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Checklist do procedimento</h3>{[["Técnica e região informadas", doneChecklist[0]], ["Produtos e lotes registrados", doneChecklist[1] && materials.length > 0], ["Fotos antes e depois anexadas", doneChecklist[2]], ["Sessão concluída", doneChecklist[3]]].map(([label, done]) => <div key={String(label)} className="flex items-center gap-2 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-xs"><span className={cn("grid h-4 w-4 place-items-center rounded-[3px] border", done ? "border-[#5147dc] bg-[#5147dc] text-white" : "border-[#c9cad6]")}>{done ? <Check className="h-3 w-3" /> : null}</span>{label}</div>)}</Card>
          <Card id="procedure-confirmations-card" tabIndex={-1} className={cn("scroll-mt-24 space-y-3 p-4", (invalidFields.has("professional") || invalidFields.has("consent")) && "border-[#d92d20]")}><h3 className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-[#5147dc]" />Termo de consentimento</h3><ProcedureTermsPanel patientId={patientId} journeyId={journeyId} sessionId={sessionId} canWrite={canWrite} consent={data.consent} startPending={draft.status === "Rascunho"} onChanged={() => void refreshConsent()} printData={{ clinicName: data.clinicName, patientName: patient.name, patientCpf: patient.cpf, professionalName: draft.professional, procedureName: draft.procedureName }} readOnlyReason={draft.status === "Concluída" ? "Sessão concluída: novos termos não podem ser anexados aqui. Use Documentos clínicos." : "Aguarde a finalização para anexar termos."} />{invalidFields.has("consent") && !consentOk ? <p key={`consent-${validationAttempt}`} id="procedure-consent-error" role="alert" className="rounded-[5px] bg-[#fff1f0] px-3 py-2 text-xs font-semibold text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{consentReason}</p> : null}<div className="grid gap-2"><div className={cn("rounded-[5px] border border-[#ececf2] p-3 text-xs", invalidFields.has("professional") && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")}><strong>Responsável</strong><p className="mt-1 text-[#77788a]">{draft.professional || "Não informado"}</p>{invalidFields.has("professional") ? <p key={`professional-${validationAttempt}`} role="alert" className="mt-1 text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">Não foi possível identificar o profissional responsável. Atualize a sessão ou contate o administrador.</p> : null}</div><div className="rounded-[5px] border border-[#ececf2] p-3 text-xs"><strong>Registro da sessão</strong><p className="mt-1 text-[#77788a]">{draft.status === "Concluída" ? `Concluída por ${draft.completedBy ?? draft.updatedBy}` : "Rascunho · não finalizada"}</p></div></div>{draft.auditLog?.length ? <details className="border-t border-[#ececf2] pt-3"><summary className="cursor-pointer text-xs font-bold">Histórico de alterações</summary><ol className="mt-2 space-y-2">{[...draft.auditLog].reverse().slice(0, 5).map((entry, index) => <li key={`${entry.at}-${index}`} className="flex flex-col gap-0.5 text-xs"><span><strong>{entry.action}</strong><span className="block text-[#77788a]">{entry.actor}{entry.fields.length ? ` · ${entry.fields.map(auditFieldLabel).join(", ")}` : ""}</span></span><time className="text-[#858696]">{new Date(entry.at).toLocaleString("pt-BR")}</time></li>)}</ol></details> : null}</Card>
          <Card className="space-y-2 p-4"><h3 className="text-sm font-bold">Próximas ações</h3>{readOnly || draft.status === "Concluída" ? (forwardSessionId ? <Button className="w-full justify-between" variant="outline" onClick={() => onCompleted(forwardSessionId)}><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />Abrir acompanhamento</span><ArrowRight className="h-4 w-4" /></Button> : null) : draft.status === "Rascunho" ? <Button className="w-full justify-between" disabled={Boolean(busy)} aria-describedby={consentOk ? undefined : "procedure-consent-hint"} onClick={openStartChoice}><span className="flex items-center gap-2">{busy === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}{busy === "start" ? "Iniciando..." : "Iniciar procedimento"}</span><ArrowRight className="h-4 w-4" /></Button> : <Button className="w-full justify-between" disabled={Boolean(busy)} onClick={() => setConfirmFinish(true)}><span className="flex items-center gap-2">{busy === "finish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{busy === "finish" ? "Finalizando..." : "Finalizar procedimento"}</span><ArrowRight className="h-4 w-4" /></Button>}</Card></aside>
      </div>
      <Modal open={startChoiceOpen} onClose={() => setStartChoiceOpen(false)} title={activeSchedule ? "Deseja iniciar o procedimento agora?" : "Deseja iniciar o procedimento agora ou agendar?"} description={activeSchedule ? "Se iniciar agora, o horário do agendamento será alterado para agora." : "Iniciar agora registra o começo do atendimento. Agendar cria um compromisso na Agenda e mantém a sessão em rascunho."}>
        {activeSchedule ? <div role="status" className="mb-4 flex items-center gap-3 rounded-[8px] border border-[#5147dc]/30 bg-[#f1f0ff] px-4 py-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#5147dc] text-white"><CalendarDays className="h-5 w-5" aria-hidden="true" /></span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-[#5147dc]">Procedimento agendado</p><p className="text-lg font-bold leading-tight text-[#202033] sm:text-xl">{formatDay(activeSchedule.date)} às {activeSchedule.time}</p></div></div> : null}
        {scheduledProcedure && !activeSchedule ? <p role="status" className="mb-3 rounded-[5px] bg-[#eef3ff] px-3 py-2 text-xs text-[#2f5fb3]"><strong>Já agendado:</strong> {formatDay(scheduledProcedure.date)} às {scheduledProcedure.time} · {scheduledProcedure.professional}. Para remarcar ou cancelar, use a Agenda.</p> : null}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setStartChoiceOpen(false)}>Cancelar</Button>{activeSchedule ? null : <Button type="button" variant="outline" disabled={Boolean(scheduledProcedure)} title={scheduledProcedure ? "Este procedimento já está agendado." : undefined} onClick={chooseSchedule}><CalendarDays className="h-4 w-4" />Agendar</Button>}<Button type="button" onClick={requestStart}><Clock3 className="h-4 w-4" />{activeSchedule ? "Iniciar agora e alterar agendamento" : "Iniciar agora"}</Button></div>
      </Modal>
      {scheduleOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="procedure-schedule-title">
          <form noValidate onSubmit={(event) => void scheduleProcedure(event)} className="max-h-[calc(100vh-2rem)] w-full max-w-md space-y-4 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-md border border-border bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between"><div><h2 id="procedure-schedule-title" className="text-base font-bold">Agendar procedimento</h2><p className="mt-1 text-xs text-muted-foreground">O agendamento será criado na agenda da clínica e vinculado a esta jornada. A sessão continua em rascunho.</p></div><Button type="button" variant="ghost" size="icon" aria-label="Fechar" onClick={() => setScheduleOpen(false)}><X className="h-4 w-4" /></Button></div>
            <label id="procedure-schedule-date-field" tabIndex={-1} className="block scroll-mt-24 text-xs font-medium">Data<input key={`schedule-date-${scheduleErrorAnimation}`} required aria-invalid={Boolean(scheduleDateError)} aria-describedby={scheduleDateError ? "procedure-schedule-date-error" : undefined} type="date" value={scheduleDate} onChange={(event) => { setScheduleDate(event.target.value); setScheduleDateError(""); setScheduleFormError(""); }} min={clinicToday()} className={cn("mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm", scheduleDateError && "border-[#d92d20] animate-[hp-shake_0.42s_ease-in-out]")} />{scheduleDateError ? <span id="procedure-schedule-date-error" role="alert" className="mt-1 block text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{scheduleDateError}</span> : null}</label>
            <label id="procedure-schedule-time-field" tabIndex={-1} className="block scroll-mt-24 text-xs font-medium">Horário{scheduleHours ? <ClinicTimePicker openingTime={scheduleHours.openingTime} closingTime={scheduleHours.closingTime} latestTime={scheduleLatestStart} value={scheduleTime} invalid={Boolean(scheduleTimeError)} disabled={scheduleHoursLoading || !scheduleHasSlots} onChange={(value) => { setScheduleTime(value); setScheduleTimeError(""); setScheduleFormError(""); }} /> : <button type="button" disabled className="mt-1 flex h-10 w-full items-center rounded-md border border-border bg-background px-3 text-left text-xs text-muted-foreground opacity-60">Carregando horários...</button>}{scheduleTimeError ? <span id="procedure-schedule-time-error" role="alert" className="mt-1 block text-xs text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{scheduleTimeError}</span> : null}{scheduleHours ? <span className="mt-1 block text-xs text-muted-foreground">{scheduleHasSlots ? `Horários disponíveis: ${scheduleHours.openingTime} às ${scheduleLatestStart}.` : "Não há horários disponíveis para a duração deste procedimento."}</span> : null}</label>
            <label className="block text-xs font-medium">Observação<textarea value={scheduleNotes} onChange={(event) => { setScheduleNotes(event.target.value); setScheduleFormError(""); }} maxLength={500} rows={3} className="text-sm mt-1 w-full rounded-md border border-border bg-background p-3" /></label>
            {scheduleFormError ? <div id="procedure-schedule-form-error" tabIndex={-1} key={scheduleErrorAnimation} role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive animate-[hp-shake_0.42s_ease-in-out]">{scheduleFormError}<Button className="ml-2 h-auto p-0 text-xs" variant="link" type="button" onClick={() => { setScheduleHours(null); setScheduleFormError(""); setScheduleHoursRetry((value) => value + 1); }}>Tentar novamente</Button></div> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setScheduleOpen(false)}>Cancelar</Button><Button type="submit" disabled={scheduling || scheduleHoursLoading || !scheduleHours || !scheduleHasSlots}>{scheduling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}Confirmar agendamento</Button></div>
          </form>
        </div>
      ) : null}
      <Modal open={confirmStart}onClose={() => { if (!busy) setConfirmStart(false); }} title="Iniciar procedimento?" description="Tem certeza que deseja iniciar o procedimento? A contagem do tempo começará assim que o início for registrado.">
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirmStart(false)}>Cancelar</Button><Button type="button" disabled={Boolean(busy) || !consentOk} onClick={() => { setConfirmStart(false); void start(); }}><Clock3 className="h-4 w-4" />Confirmar início</Button></div>
      </Modal>
      <Modal open={confirmFinish} onClose={() => { if (!busy) setConfirmFinish(false); }} closeOnOverlayClick={!busy} title="Finalizar procedimento?" description="Tem certeza que deseja finalizar o procedimento? Os materiais utilizados serão registrados no estoque. Esta ação não encerra o tratamento.">
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setConfirmFinish(false)}>Cancelar</Button><Button type="button" disabled={Boolean(busy)} onClick={() => { setConfirmFinish(false); void finish(); }}><CheckCircle2 className="h-4 w-4" />Confirmar finalização</Button></div>
      </Modal>
      <Modal open={Boolean(photoAction)} onClose={() => setPhotoAction(null)} title="Qual é o tipo da foto?" description={`Escolha a categoria da foto ${photoAction?.phase === "Antes" ? "de antes" : "depois"} antes de ${photoAction?.action === "capture" ? "abrir a câmera" : "anexar o arquivo"}.`}>
        <div className="flex flex-wrap gap-2">{photoCategories.map((category) => <Button key={category} type="button" variant={photoCategory === category ? "default" : "outline"} onClick={() => confirmPhotoCategory(category)}>{category}</Button>)}</div>
      </Modal>
      <Modal open={materialPickerOpen} onClose={() => setMaterialPickerOpen(false)} title="Adicionar produtos do estoque" description="Escolha os materiais usados nesta sessão. A baixa do estoque acontece ao finalizar o procedimento.">
        <div className="space-y-3">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#858696]" /><input autoFocus value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="Buscar material no estoque" className="h-9 w-full rounded-[5px] border border-[#dddde6] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#5147dc]" /></label>
          <div className="max-h-[55dvh] overflow-y-auto rounded-[6px] border border-[#e9e9ef]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 bg-[#fafafd] px-3 py-2.5 text-xs font-bold text-[#77798d]"><span>Produto / material</span><span>Saldo no estoque</span><span className="sr-only">Ação</span></div>
            {availableMaterials.map((product) => {
              const stockBalance = product.lots.reduce((total, lot) => total + lot.balance, 0);
              return <div key={product.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-[#eeeeF3] px-3 py-2 text-xs">
                <div className="min-w-0"><strong className="block truncate text-[#3f4053]">{product.name}</strong><span className="text-xs text-[#999aaa]">{product.unit}</span></div>
                <span className={cn("text-xs font-medium", stockBalance > 0 ? "text-[#555668]" : "text-[#a36a00]")}>{stockBalance > 0 ? `${formatStockBalance(stockBalance)} ${product.unit}` : "Sem saldo"}</span>
                <Button type="button" size="sm" variant="secondary" disabled={!canWrite} onClick={() => addMaterial(product.id)}><Plus className="h-3.5 w-3.5" />Adicionar</Button>
              </div>;
            })}
            {!availableMaterials.length ? <p className="px-3 py-8 text-center text-xs text-[#858696]">{data.materials.length && materials.length === data.materials.length ? "Todos os materiais disponíveis já foram adicionados." : materialSearch ? "Nenhum material corresponde à pesquisa." : "Nenhum material cadastrado no estoque."}</p> : null}
          </div>
        </div>
      </Modal>
      {preview ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Visualização da fotografia" onClick={() => setPreview(null)}><div className="relative max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}><img src={preview.imageUrl} alt={preview.name} className="max-h-[85vh] max-w-[88vw] object-contain" /><button type="button" aria-label="Fechar visualização" onClick={() => setPreview(null)} className="absolute -right-3 -top-3 rounded-full bg-white p-2 text-[#27283b]"><X className="h-4 w-4" /></button></div></div> : null}
    </div>
  );
}

const inputClass = "h-10 w-full rounded-[5px] border border-[#dfe0e8] bg-white px-2.5 text-sm text-[#38394d] outline-none focus:border-[#5147dc] disabled:bg-[#f5f5f9]";
function Field({ label, required, className, error, errorKey, errorId, children }: { label: string; required?: boolean; className?: string; error?: string; errorKey?: string; errorId?: string; children: React.ReactNode }) { return <label className={cn("block text-xs font-semibold text-[#696a7b]", className)}>{label}{required ? <span className="text-[#b42318]"> *</span> : null}<span className="mt-1 block">{children}</span>{error ? <span key={errorKey} id={errorId} role="alert" className="mt-1 block text-xs font-medium text-[#b42318] animate-[hp-shake_0.42s_ease-in-out]">{error}</span> : null}</label>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 rounded-[5px] bg-[#f7f7fb] px-2.5 py-2 text-xs"><span className="flex items-center gap-1.5 text-[#717285]"><UserRound className="h-3 w-3" />{label}</span><strong className="text-right text-[#3e3f52]">{value}</strong></div>; }
function toDraft(session: Session): Session { return { ...session, materials: Array.isArray(session.materials) ? session.materials : [], photos: Array.isArray(session.photos) ? session.photos : [], auditLog: Array.isArray(session.auditLog) ? session.auditLog : [] }; }
function formatDay(day: string) { const [, month, date] = day.split("-"); return month && date ? `${date}/${month}` : day; }
function formatElapsedTime(totalSeconds: number) { const hours = Math.floor(totalSeconds / 3600); const minutes = Math.floor((totalSeconds % 3600) / 60); const seconds = totalSeconds % 60; return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":"); }
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
function formatStockBalance(quantity: number) { return Number(quantity.toFixed(3)).toLocaleString("pt-BR"); }
function auditFieldLabel(field: string) { return ({ technique: "técnica", treatedAreas: "região", professional: "profissional", performedAt: "data", startedAt: "horário", estimatedMinutes: "tempo estimado", durationMinutes: "duração", anesthesia: "anestesia", complications: "intercorrências", observations: "observações", materials: "materiais", photos: "fotografias" } as Record<string, string>)[field] ?? field; }
function fileToDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Falha ao ler a foto.")); reader.onerror = () => reject(new Error("Falha ao ler a foto.")); reader.readAsDataURL(file); }); }
function imageDimensions(src: string) { return new Promise<{ width: number; height: number }>((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("Imagem inválida.")); image.src = src; }); }
