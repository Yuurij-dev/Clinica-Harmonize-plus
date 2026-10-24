"use client";

import { useRef, useState } from "react";
import { Download, Eye, FileText, Loader2, Paperclip, Printer, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { invalidateClientCache } from "@/lib/client-cache";
import { formatBytes, maxUploadBytes, signatureLabels, signatureStatusesFor, summarizeConsent, type SignatureStatus } from "@/lib/clinical-files-rules";
import { buildDefaultTcleHtml, tcleReviewNotice } from "@/lib/consent-default-tcle";
import { openQuoteProposal } from "@/lib/quote-proposal";
import { cn } from "@/lib/utils";
import { isImageFile, postForm, prepareImage } from "./clinical-upload";
import { useCan, useCurrentRole } from "./current-user";
import { useCachedResource } from "./patient-clinical-data";

type TermItem = { id: string; system: boolean; name: string; category: string; date: string; professional: string; sizeBytes?: number; signatureStatus?: SignatureStatus; journeyId?: string | null; encounterType?: string | null; encounterId?: string | null };
type TermsResponse = { items: TermItem[]; total: number };

const base = (patientId: string) => `/api/patients/${encodeURIComponent(patientId)}/documents`;
const signatureTone: Record<SignatureStatus, string> = { ASSINADO: "bg-[#eef8f2] text-[#287a50]", PENDENTE: "bg-[#fff8e9] text-[#845700]", NAO_APLICAVEL: "bg-[#f1f1f6] text-[#68697b]" };

// Termos da jornada (categoria TERMOS) em modo leitura + anexo de novo termo pelo mesmo upload de Documentos clínicos.
export type TermsConsent = { signed: boolean; message: string };
export type TermsPrintData = { clinicName?: string; patientName?: string; patientCpf?: string; professionalName?: string; procedureName?: string };

// Ordem de exibição: Assinado primeiro (caso comum ao anexar um termo já assinado).
const signatureOrder: SignatureStatus[] = ["ASSINADO", "PENDENTE", "NAO_APLICAVEL"];

export function ProcedureTermsPanel({ patientId, journeyId, sessionId, canWrite, readOnlyReason, consent: gate, startPending, printData, onChanged }: { patientId: string; journeyId: string; sessionId: string; canWrite: boolean; readOnlyReason: string; consent?: TermsConsent; startPending?: boolean; printData?: TermsPrintData; onChanged?: () => void }) {
  const canClinical = useCan("clinical:read");
  const role = useCurrentRole();
  const allowed = signatureOrder.filter((status) => signatureStatusesFor(role).includes(status));
  const key = `${base(patientId)}?category=TERMOS&journeyId=${encodeURIComponent(journeyId)}&sort=recent&page=1&pageSize=36`;
  const { data, loading, error } = useCachedResource<TermsResponse>(key);
  const terms = (data?.items ?? []).filter((item) => !item.system && item.category === "TERMOS");
  const consent = summarizeConsent(terms);
  // O termo anexado é o documento já assinado; perfil sem permissão para marcar "Assinado" envia como pendente.
  const signature: SignatureStatus = allowed.includes("ASSINADO") ? "ASSINADO" : "PENDENTE";
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const canRemove = useCan("clinical:archive") && canWrite;
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const confirmingTerm = terms.find((item) => item.id === confirming) ?? null;

  async function send(file: File) {
    setFailure("");
    if (!isImageFile(file) && file.type !== "application/pdf") { setFailure("Formato não permitido. Use PDF, JPG, PNG ou WEBP."); return; }
    if (!isImageFile(file) && file.size > maxUploadBytes) { setFailure("O arquivo excede 4 MB."); return; }
    setProgress(0);
    let blob: Blob = file;
    let fileName = file.name;
    if (isImageFile(file)) {
      const prepared = await prepareImage(file);
      if ("error" in prepared) { setFailure(prepared.error); setProgress(null); return; }
      blob = prepared.blob; fileName = prepared.name;
    }
    const form = new FormData();
    form.set("file", blob, fileName);
    form.set("category", "TERMOS");
    form.set("signatureStatus", signature);
    form.set("journeyId", journeyId);
    if (canClinical) { form.set("encounterType", "session"); form.set("encounterId", sessionId); }
    const result = await postForm(base(patientId), form, setProgress);
    setProgress(null);
    if (result.ok) { invalidateClientCache(base(patientId)); toast.success("Termo anexado."); onChanged?.(); }
    else setFailure(result.body?.message ?? "Não foi possível enviar.");
  }

  // "Remover" arquiva o termo (reversível em Documentos clínicos, com trilha de auditoria) e ele deixa de liberar o início.
  async function remove(term: TermItem) {
    setFailure("");
    setRemoving(term.id);
    const response = await fetch(`${base(patientId)}/${encodeURIComponent(term.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true, reason: "Removido na tela do procedimento" }) }).catch(() => null);
    setRemoving(null);
    setConfirming(null);
    if (response?.ok) { invalidateClientCache(base(patientId)); toast.success("Termo removido."); onChanged?.(); return; }
    const body = await response?.json().catch(() => null) as { message?: string } | null;
    setFailure(body?.message ?? "Não foi possível remover o termo.");
  }

  function generate() {
    setFailure("");
    const html = buildDefaultTcleHtml({ ...printData, date: new Date().toLocaleDateString("pt-BR") });
    if (!openQuoteProposal(html)) setFailure("O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.");
  }

  const consentTone = consent.signed > 0 && consent.signed === consent.total ? "text-[#287a50]" : "text-[#77788a]";
  return <div className="space-y-3 text-xs">
    <div className="rounded-[5px] border border-[#ececf2] p-3"><strong>Consentimento</strong><p className={cn("mt-1", loading ? "text-[#a0a1b0]" : consentTone)}>{loading ? "Carregando termos..." : error ? "Termos indisponíveis para consulta" : consent.label}</p>{startPending && gate ? <p id="procedure-consent-status" role="status" className={cn("mt-1 font-semibold", gate.signed ? "text-[#287a50]" : "text-[#b42318]")}>{gate.signed ? "Termo assinado: procedimento liberado para iniciar." : gate.message}</p> : null}</div>
    {!loading && !error ? <ul aria-label="Termos anexados" className="space-y-2">{terms.map((term) => <li key={term.id} className="rounded-[5px] border border-[#ececf2] p-2.5">
      <div className="flex items-start gap-2"><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5147dc]" aria-hidden="true" /><div className="min-w-0 flex-1"><strong className="block break-words">{term.name}</strong><span className="block text-xs text-[#77788a]">{new Date(term.date).toLocaleDateString("pt-BR")} · {term.professional || "Responsável não informado"}{term.sizeBytes ? ` · ${formatBytes(term.sizeBytes)}` : ""}</span></div></div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", signatureTone[term.signatureStatus ?? "NAO_APLICAVEL"])}>{signatureLabels[term.signatureStatus ?? "NAO_APLICAVEL"]}</span>{term.encounterType === "session" && term.encounterId === sessionId ? <span className="rounded-full bg-[#ece9ff] px-2 py-0.5 text-xs font-semibold text-[#5147dc]">Esta sessão</span> : null}
        <span className="ml-auto flex flex-wrap gap-1"><Button asChild size="sm" variant="outline"><a href={`${base(patientId)}/${encodeURIComponent(term.id)}/file`} target="_blank" rel="noreferrer" aria-label={`Visualizar ${term.name}`}><Eye className="h-3.5 w-3.5" />Ver</a></Button><Button asChild size="sm" variant="outline"><a href={`${base(patientId)}/${encodeURIComponent(term.id)}/file?download=1`} aria-label={`Baixar ${term.name}`}><Download className="h-3.5 w-3.5" />Baixar</a></Button>{canRemove ? <Button type="button" size="sm" variant="outline" className="text-[#b42318]" disabled={removing !== null} onClick={() => setConfirming(term.id)} aria-label={`Remover ${term.name}`}><Trash2 className="h-3.5 w-3.5" />Remover</Button> : null}</span></div>
    </li>)}</ul> : null}
    <Modal open={Boolean(confirmingTerm)} title="Remover termo" description="O termo fica arquivado em Documentos clínicos e pode ser restaurado por lá." onClose={() => { if (removing === null) setConfirming(null); }} panelClassName="max-w-md">
      {confirmingTerm ? <div className="space-y-4 text-sm"><p className="break-words"><strong>{confirmingTerm.name}</strong></p><p className="text-[#b42318]">{confirmingTerm.signatureStatus === "ASSINADO" ? "Este termo está assinado: ao removê-lo, ele deixa de liberar o início do procedimento." : "Este termo será removido da lista do procedimento."}</p><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={removing !== null} onClick={() => setConfirming(null)}>Cancelar</Button><Button type="button" className="bg-[#b42318] text-white hover:bg-[#912018]" disabled={removing !== null} onClick={() => void remove(confirmingTerm)}>{removing !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Remover termo</Button></div></div> : null}
    </Modal>
    {!loading && !error && data && data.total > terms.length ? <p className="text-xs text-[#77788a]">Exibindo os termos mais recentes. Veja todos em Documentos clínicos.</p> : null}
    <div className="space-y-2 rounded-[5px] bg-[#f7f7fb] p-3">
      <input ref={input} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void send(file); }} />
      <Button type="button" size="sm" variant="outline" className="w-full" disabled={!canWrite || uploading} onClick={() => input.current?.click()}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}{uploading ? `Enviando... ${progress}%` : "Anexar termo"}</Button>
      <Button type="button" size="sm" variant="outline" className="w-full" onClick={generate}><Printer className="h-4 w-4" />Gerar termo</Button>
      {uploading ? <div className="h-1.5 overflow-hidden rounded-full bg-[#e5e5ee]"><div className="h-full bg-[#5147dc]" style={{ width: `${progress}%` }} /></div> : null}
      {!canWrite ? <p className="text-xs text-[#77788a]">{readOnlyReason}</p> : <p className="text-xs text-[#77788a]">PDF, JPG, PNG ou WEBP · até 4 MB. Anexe o termo de consentimento já assinado; ele libera o início do procedimento e fica salvo em Documentos clínicos{allowed.includes("ASSINADO") ? "" : " (a marcação como assinado é feita por profissional ou administrador)"}.</p>}
      <p className="text-xs text-[#77788a]">&ldquo;Gerar termo&rdquo; imprime o modelo padrão para assinatura em papel; depois anexe o termo assinado. {tcleReviewNotice}</p>
      {failure ? <p role="alert" className="text-xs font-medium text-[#b42318]">{failure}</p> : null}
    </div>
  </div>;
}
