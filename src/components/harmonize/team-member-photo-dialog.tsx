"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FolderOpen, ImagePlus, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { prepareImage } from "./clinical-upload";

export function TeamMemberPhotoDialog({ avatarUrl, onSaved, onClose }: { avatarUrl: string; onSaved: () => void; onClose: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cameraRequesting, setCameraRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !streamRef.current || !videoRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  async function requestCameraAccess() {
    setError("");
    if (!window.isSecureContext) {
      setError("O navegador só libera a câmera em uma conexão segura (HTTPS) ou em localhost. Abra o sistema em uma conexão segura ou escolha uma imagem dos arquivos.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Este dispositivo ou navegador não disponibiliza câmera. Você ainda pode escolher uma imagem dos arquivos.");
      return;
    }
    setCameraRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      if (mountedRef.current) setCameraOpen(true);
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      if (mountedRef.current) {
        if (name === "NotAllowedError" || name === "PermissionDeniedError") setError("O acesso à câmera foi bloqueado ou negado pelo navegador. Libere a câmera nas permissões deste site e tente novamente, ou escolha uma imagem dos arquivos.");
        else if (name === "NotFoundError" || name === "DevicesNotFoundError") setError("Nenhuma câmera foi encontrada neste dispositivo. Você ainda pode escolher uma imagem dos arquivos.");
        else setError("Não foi possível acessar a câmera. Verifique as permissões do navegador ou escolha uma imagem dos arquivos.");
      }
    } finally {
      if (mountedRef.current) setCameraRequesting(false);
    }
  }

  async function saveFile(file: File) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const prepared = await prepareImage(file);
      if ("error" in prepared) { if (mountedRef.current) setError(prepared.error); return; }
      const form = new FormData();
      form.append("file", prepared.blob, prepared.name);
      const response = await fetch(avatarUrl, { method: "PUT", body: form });
      const result = await response.json().catch(() => null) as { message?: string } | null;
      if (!response.ok) throw new Error(result?.message ?? "Não foi possível enviar a foto.");
      onSaved();
      toast.success("Foto do perfil atualizada.");
      stopCamera();
      if (mountedRef.current) onClose();
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Não foi possível salvar a foto.");
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) { setError("A câmera ainda está iniciando. Tente novamente em instantes."); return; }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) { setError("Não foi possível capturar a imagem."); return; }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { setError("Não foi possível capturar a imagem."); return; }
      void saveFile(new File([blob], `foto-perfil-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  }

  return <Modal open title="Foto do colaborador" description="Arraste uma imagem, escolha um arquivo ou tire uma foto agora." onClose={() => { if (!busy) { stopCamera(); onClose(); } }} closeOnOverlayClick={!busy}>
    <div className="space-y-4">
      {cameraOpen ? <div className="space-y-3">
        <video ref={videoRef} autoPlay playsInline muted className="max-h-[55dvh] w-full rounded-lg bg-black object-contain" aria-label="Prévia da câmera" />
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" disabled={busy} onClick={capturePhoto}><Camera className="h-4 w-4" />{busy ? "Salvando..." : "Tirar foto"}</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={stopCamera}>Voltar às opções</Button>
        </div>
      </div> : <>
        <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void saveFile(file); }} className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? "border-[#5147dc] bg-[#f3f1ff]" : "border-[#d9d8e5] bg-[#fafaff]"}`}>
          {busy ? <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#5147dc]" /> : <ImagePlus className="mx-auto h-8 w-8 text-[#5147dc]" />}
          <p className="mt-3 text-sm font-semibold">Arraste a imagem até aqui</p>
          <p className="mt-1 text-xs text-muted-foreground">JPG, PNG ou WEBP · até 4 MB</p>
          <Button type="button" variant="outline" className="mt-4" disabled={busy} onClick={() => fileInput.current?.click()}><FolderOpen className="h-4 w-4" />Escolher dos arquivos</Button>
          <input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void saveFile(file); event.target.value = ""; }} />
        </div>
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={busy || cameraRequesting} onClick={() => void requestCameraAccess()}>{cameraRequesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}{cameraRequesting ? "Aguardando permissão..." : "Tirar foto na hora"}</Button>
        </div>
      </>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">A imagem escolhida será usada como foto de perfil deste colaborador.</p>
    </div>
  </Modal>;
}
