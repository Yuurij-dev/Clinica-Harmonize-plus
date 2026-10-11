"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Check, ChevronDown, Download, FileText, Loader2, PenLine, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage, fetchForSave, httpErrorMessage } from "@/lib/client-errors";
import { getCachedJson, invalidateClientCache } from "@/lib/client-cache";

type DocumentsResponse = { documents?: PatientDocument[]; consentTemplate?: string | null };

type PatientDocument = {
  id: string;
  kind: string;
  name: string;
  category: string;
  mimeType: string;
  consentText?: string | null;
  signatureData?: string | null;
  signedAt?: string | null;
  createdAt: string;
};

const defaultConsent = `Eu, [nome do paciente], declaro que recebi explicações claras sobre o procedimento [procedimento], incluindo seus objetivos, etapas, benefícios, riscos, possíveis efeitos adversos e cuidados posteriores. Tive oportunidade de fazer perguntas e autorizo a realização do procedimento de forma livre e esclarecida. Estou ciente de que posso retirar esta autorização antes do procedimento.`;

export function PatientDocuments({ patientId, patientName }: { patientId: string; patientName: string }) {
  const [documents, setDocuments] = useState<PatientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [consentTitle, setConsentTitle] = useState("Termo de consentimento informado");
  const [procedure, setProcedure] = useState("");
  const [consentText, setConsentText] = useState(defaultConsent);
  const [category, setCategory] = useState("Documento clínico");
  const [fileName, setFileName] = useState("");
  const [fileData, setFileData] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<PatientDocument | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<PatientDocument | null>(null);
  const [documentToDownload, setDocumentToDownload] = useState<PatientDocument | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedDocumentSections, setExpandedDocumentSections] = useState({ terms: false, attachments: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const documentsKey = `/api/patients/${patientId}/documents`;
  const applyDocuments = useCallback((data: DocumentsResponse) => {
    setDocuments(data.documents ?? []);
    if (data.consentTemplate) setConsentText(data.consentTemplate);
  }, []);

  const refresh = useCallback(async () => {
    invalidateClientCache(documentsKey);
    try {
      applyDocuments(await getCachedJson<DocumentsResponse>(documentsKey));
    } catch {
      setError("Não foi possível carregar os documentos.");
    }
  }, [documentsKey, applyDocuments]);

  useEffect(() => {
    let active = true;
    getCachedJson<DocumentsResponse>(documentsKey)
      .then((data) => { if (active) applyDocuments(data); })
      .catch(() => { if (active) setError("Não foi possível carregar os documentos."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [documentsKey, applyDocuments]);

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  }

  function beginSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = canvasPoint(event);
    context.beginPath(); context.moveTo(point.x, point.y); context.lineWidth = 3; context.lineCap = "round"; context.strokeStyle = "#303144";
    drawing.current = true;
  }

  function drawSignature(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const point = canvasPoint(event);
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    context.lineTo(point.x, point.y); context.stroke();
  }

  function endSignature() { drawing.current = false; }

  function clearSignature() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function submitConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const signatureData = canvasRef.current?.toDataURL("image/png") ?? "";
    if (!canvasRef.current || !canvasHasInk(canvasRef.current)) { setError("Peça ao paciente para assinar no campo indicado."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetchForSave(`/api/patients/${patientId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "consent", name: consentTitle, category: "Consentimento", consentTemplate: consentText, consentText: consentText.replaceAll("[nome do paciente]", patientName).replaceAll("[procedimento]", procedure || "procedimento informado pela equipe"), signatureData }),
      }, "Não foi possível salvar o termo");
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? httpErrorMessage(response, "Não foi possível salvar o termo"));
      setShowConsent(false); setNotice("Termo assinado e salvo no prontuário."); clearSignature(); await refresh();
    } catch (cause) { setError(errorMessage(cause, "Não foi possível salvar o termo.")); }
    finally { setBusy(false); }
  }

  async function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileData || !fileName) { setError("Selecione um arquivo para enviar."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetchForSave(`/api/patients/${patientId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fileName, category, fileData }),
      }, "Não foi possível enviar o documento");
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? httpErrorMessage(response, "Não foi possível enviar o arquivo"));
      setShowUpload(false); setFileData(""); setFileName(""); setNotice("Documento salvo no prontuário."); await refresh();
    } catch (cause) { setError(errorMessage(cause, "Não foi possível enviar o arquivo.")); }
    finally { setBusy(false); }
  }

  async function removeDocument() {
    if (!documentToDelete || deleting) return;
    setError("");
    setDeleting(true);
    try {
      const response = await fetchForSave(`/api/patients/${patientId}/documents`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: documentToDelete.id }) }, "Não foi possível excluir o documento");
      const data = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) { setError(data?.message ?? httpErrorMessage(response, "Não foi possível excluir o documento")); return; }
      invalidateClientCache(documentsKey);
      setDocuments((current) => current.filter((item) => item.id !== documentToDelete.id)); setNotice("Documento excluído.");
      if (documents.length <= 1) setExpandedDocumentSections({ terms: false, attachments: false });
      if (selectedDocument?.id === documentToDelete.id) setSelectedDocument(null);
      setDocumentToDelete(null);
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível excluir o documento."));
    } finally {
      setDeleting(false);
    }
  }

  async function downloadDocument() {
    if (!documentToDownload || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch(`/api/patients/${patientId}/documents/${documentToDownload.id}`);
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(data?.message ?? httpErrorMessage(response, "Não foi possível baixar o anexo"));
      }
      const fileUrl = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = fileUrl;
      link.download = documentToDownload.name;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
      setDocumentToDownload(null);
    } catch (cause) {
      setError(errorMessage(cause, "Não foi possível baixar o anexo."));
    } finally {
      setDownloading(false);
    }
  }

  const terms = documents.filter((document) => document.kind === "consent").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const attachments = documents.filter((document) => document.kind !== "consent").sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return <div className="space-y-4">
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 className="text-sm font-bold text-[#303144]">Documentos e consentimentos</h3><p className="mt-1 text-xs text-[#858696]">Arquivos e termos assinados ficam vinculados ao prontuário de {patientName}.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => { setShowUpload((value) => !value); setShowConsent(false); clearSignature(); }}><Upload className="h-3.5 w-3.5" />Enviar documento</Button><Button onClick={() => { setShowConsent((value) => { if (!value) clearSignature(); return !value; }); setShowUpload(false); }}><PenLine className="h-3.5 w-3.5" />Novo termo</Button></div>
    </Card>

    {showUpload && <Card className="p-5"><form className="grid gap-4 sm:grid-cols-2" onSubmit={submitFile}><div className="sm:col-span-2"><h4 className="text-sm font-bold text-[#303144]">Adicionar documento</h4><p className="mt-1 text-xs text-[#858696]">PDF, JPG, PNG ou WEBP · até 5 MB.</p></div><div className="grid gap-1.5 text-xs font-semibold text-[#555668]"><span>Categoria</span><Select value={category} onValueChange={setCategory}><SelectTrigger aria-label="Categoria do documento" className="h-10 rounded-md border-[#dddfea] bg-white px-3 py-2 text-xs font-semibold text-[#303144] shadow-none focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10"><SelectValue /></SelectTrigger><SelectContent className="border-[#dddfea] bg-white text-xs text-[#303144]"><SelectItem value="Documento clínico" className="text-xs">Documento clínico</SelectItem><SelectItem value="Exame" className="text-xs">Exame</SelectItem><SelectItem value="Identificação" className="text-xs">Identificação</SelectItem><SelectItem value="Outro" className="text-xs">Outro</SelectItem></SelectContent></Select></div><label className="grid gap-1.5 text-xs font-semibold text-[#555668]">Arquivo<input className={`${inputClass} cursor-pointer file:cursor-pointer`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { setError("O arquivo deve ter até 5 MB."); setFileData(""); return; } setError(""); setFileName(file.name); const reader = new FileReader(); reader.onload = () => setFileData(String(reader.result)); reader.readAsDataURL(file); }} /></label><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setShowUpload(false)}>Cancelar</Button><Button type="submit" disabled={busy || !fileData}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Salvar arquivo</Button></div></form></Card>}

    {showConsent && <Card className="p-5"><form className="space-y-4" onSubmit={submitConsent}><div><h4 className="text-sm font-bold text-[#303144]">Termo de consentimento</h4><p className="mt-1 text-xs text-[#858696]">Revise o modelo, preencha os detalhes e colete a assinatura. Ao salvar, o texto revisado fica como modelo da clínica.</p></div><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-semibold text-[#555668]">Título<input className={inputClass} value={consentTitle} onChange={(event) => setConsentTitle(event.target.value)} required maxLength={160} /></label><label className="grid gap-1.5 text-xs font-semibold text-[#555668]">Procedimento<input className={inputClass} value={procedure} onChange={(event) => setProcedure(event.target.value)} placeholder="Ex.: preenchimento labial" /></label></div><label className="grid gap-1.5 text-xs font-semibold text-[#555668]">Texto do termo<textarea className={`${inputClass} min-h-36 leading-6`} value={consentText} onChange={(event) => setConsentText(event.target.value)} required minLength={20} maxLength={20000} /></label><div><div className="mb-1 flex items-center justify-between"><label className="text-xs font-semibold text-[#555668]">Assinatura do paciente</label><button className="text-[10px] font-bold text-[#5147dc]" type="button" onClick={clearSignature}>Limpar assinatura</button></div><canvas ref={canvasRef} width={900} height={200} className="h-32 w-full touch-none rounded-md border border-dashed border-[#cfd1de] bg-white" onPointerDown={beginSignature} onPointerMove={drawSignature} onPointerUp={endSignature} onPointerCancel={endSignature} /><p className="mt-1 text-[10px] text-[#858696]">Assinatura feita com mouse ou toque.</p></div><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => { setShowConsent(false); clearSignature(); }}>Cancelar</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Salvar termo assinado</Button></div></form></Card>}

    {error && <p role="alert" className="rounded-md bg-[#fff1f0] px-4 py-3 text-xs font-semibold text-[#b42318]">{error}</p>}{notice && <p role="status" className="rounded-md bg-[#ecfdf3] px-4 py-3 text-xs font-semibold text-[#027a48]">{notice}</p>}
    <Card className="overflow-hidden p-0">
      <div className="border-b border-[#ececf3] px-5 py-4"><h4 className="text-sm font-bold text-[#303144]">Arquivos do prontuário</h4></div>
      <div className="space-y-[5px] p-2">
        {(["terms", "attachments"] as const).map((section) => {
          const isTerms = section === "terms";
          const items = isTerms ? terms : attachments;
          const expanded = expandedDocumentSections[section];
          const label = isTerms ? "Termos" : "Anexos";
          return <section className="overflow-hidden rounded-lg border border-[#ececf3] bg-white" key={section}>
            <button type="button" aria-expanded={expanded} aria-controls={`patient-documents-${section}`} className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#faf9ff]" onClick={() => setExpandedDocumentSections((current) => ({ ...current, [section]: !current[section] }))}>
              <span className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f2f0ff] text-[#5147dc]">{isTerms ? <PenLine className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</span><span className="text-xs font-bold text-[#303144]">{label}<span className="ml-2 rounded-full bg-[#f0efff] px-2 py-0.5 text-[10px] font-semibold text-[#5147dc]">{items.length}</span></span></span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-[#77788a] transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
            </button>
            {expanded && <div id={`patient-documents-${section}`} className="border-t border-[#ececf3]">
              {loading ? <div className="flex items-center gap-2 px-5 py-8 text-xs text-[#858696]"><Loader2 className="h-4 w-4 animate-spin" />Carregando {label.toLowerCase()}...</div> : items.length ? <div className="space-y-[3px] p-2">{items.map((document) => <div className="flex flex-col gap-3 rounded-md border border-[#ececf3] bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between" key={document.id}><div className="flex min-w-0 items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f2f0ff] text-[#5147dc]">{isTerms ? <PenLine className="h-4 w-4" /> : <FileText className="h-4 w-4" />}</div><div className="min-w-0"><p className="truncate text-xs font-bold text-[#303144]">{document.name}</p><p className="mt-1 text-[10px] text-[#858696]">{document.category} · {isTerms && document.signedAt ? `Assinado em ${formatDocumentDateTime(document.signedAt)}` : `Criado em ${formatDocumentDateTime(document.createdAt)}`}</p></div></div><div className="flex items-center gap-2"><Badge variant={isTerms ? "green" : "purple"}>{isTerms ? "Assinado" : document.mimeType === "application/pdf" ? "PDF" : "Imagem"}</Badge>{isTerms ? <Button size="sm" variant="secondary" onClick={() => setSelectedDocument(document)}><FileText className="h-3 w-3" />Ver termo</Button> : <Button type="button" size="sm" variant="secondary" onClick={() => setDocumentToDownload(document)}><Download className="h-3 w-3" />Baixar</Button>}<button type="button" aria-label={`Excluir ${document.name}`} title="Excluir documento" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[#858696] hover:bg-[#fff1f0] hover:text-[#b42318]" onClick={() => setDocumentToDelete(document)}><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div> : <div className="px-5 py-8 text-center"><FileText className="mx-auto h-6 w-6 text-[#b9bbca]" /><p className="mt-2 text-xs font-semibold text-[#555668]">Nenhum {isTerms ? "termo" : "anexo"} cadastrado</p><p className="mt-1 text-[10px] text-[#858696]">{isTerms ? "Os termos assinados deste paciente aparecerão aqui." : "Os arquivos enviados para este paciente aparecerão aqui."}</p></div>}
            </div>}
          </section>;
        })}
      </div>
    </Card>

    <AlertDialog.Root open={Boolean(documentToDownload)} onOpenChange={(open) => { if (!open && !downloading) setDocumentToDownload(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1200] bg-transparent backdrop-blur-[3px] transition-opacity duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[1201] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#e7e7ef] bg-white p-6 text-[#303144] shadow-[0_24px_80px_rgba(23,24,43,0.28)] outline-none transition-all duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#f0efff] text-[#5147dc]"><Download className="h-5 w-5" /></div>
          <AlertDialog.Title className="text-center text-lg font-bold">Baixar este anexo?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-center text-sm leading-6 text-[#737487]">
            O arquivo <span className="font-semibold text-[#45465a]">“{documentToDownload?.name}”</span> será baixado para este dispositivo.
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <AlertDialog.Cancel asChild><Button variant="secondary" disabled={downloading} className="sm:min-w-32">Cancelar</Button></AlertDialog.Cancel>
            <Button className="sm:min-w-32" disabled={downloading} onClick={() => void downloadDocument()}>{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloading ? "Baixando..." : "Baixar anexo"}</Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>

    <AlertDialog.Root open={Boolean(documentToDelete)} onOpenChange={(open) => { if (!open && !deleting) setDocumentToDelete(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[1200] bg-transparent backdrop-blur-[3px] transition-opacity duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[1201] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#e7e7ef] bg-white p-6 text-[#303144] shadow-[0_24px_80px_rgba(23,24,43,0.28)] outline-none transition-all duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[#fff1f0] text-[#d92d20]"><AlertTriangle className="h-5 w-5" /></div>
          <AlertDialog.Title className="text-center text-lg font-bold">Excluir {documentToDelete?.kind === "consent" ? "este termo" : "este documento"}?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-center text-sm leading-6 text-[#737487]">
            {documentToDelete?.kind === "consent" ? "O termo" : "O documento"} <span className="font-semibold text-[#45465a]">“{documentToDelete?.name}”</span> será removido permanentemente do prontuário. Esta ação não pode ser desfeita.
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <AlertDialog.Cancel asChild><Button variant="secondary" disabled={deleting} className="sm:min-w-32">Manter {documentToDelete?.kind === "consent" ? "termo" : "documento"}</Button></AlertDialog.Cancel>
            <Button variant="destructive" disabled={deleting} className="sm:min-w-32" onClick={() => void removeDocument()}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? "Excluindo..." : "Sim, excluir"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>

    {selectedDocument && <div className="fixed inset-0 z-[80] grid place-items-center bg-transparent p-4 backdrop-blur-[8px]" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedDocument(null); }}><section className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-[#d9d9e5] bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="consent-view-title"><div className="flex items-start justify-between gap-4"><div><h3 id="consent-view-title" className="text-base font-bold text-[#303144]">{selectedDocument.name}</h3><p className="mt-1 text-xs text-[#858696]">{selectedDocument.category} · {selectedDocument.signedAt ? new Date(selectedDocument.signedAt).toLocaleString("pt-BR") : ""}</p></div><button aria-label="Fechar" className="grid h-8 w-8 place-items-center rounded-md text-[#77788a] hover:bg-[#f4f4f8]" onClick={() => setSelectedDocument(null)}><X className="h-4 w-4" /></button></div><p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-[#444557]">{selectedDocument.consentText}</p>{selectedDocument.signatureData && <div className="mt-5 border-t border-[#ececf3] pt-3"><p className="text-[10px] font-semibold text-[#858696]">Assinatura de {patientName}</p><img className="mt-2 h-20 max-w-full object-contain" src={selectedDocument.signatureData} alt={`Assinatura de ${patientName}`} /></div>}<div className="mt-5 flex justify-end"><Button variant="secondary" onClick={() => setSelectedDocument(null)}>Fechar</Button></div></section></div>}
  </div>;
}

function canvasHasInk(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) if (data[index] > 0) return true;
  return false;
}

function formatDocumentDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

const inputClass = "w-full rounded-md border border-[#dddfea] bg-white px-3 py-2 text-xs text-[#303144] outline-none focus:border-[#5147dc] focus:ring-2 focus:ring-[#5147dc]/10";
