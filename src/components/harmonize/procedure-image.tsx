"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { catalogImagePrefix, localPreviewSrc, safeProcedureImageSrc } from "@/lib/procedure-image-rules";
import { useProcedureImageByName } from "./procedure-image-lookup";

type ProcedureImageProps = {
  name: string;
  /** URL por referência (image.url do procedimento). null = sem imagem. Omitido = busca pelo nome entre os procedimentos da clínica. */
  imageUrl?: string | null;
  /** Pré-visualização local (blob: criado pelo formulário a partir de um arquivo já validado). Ignorada se não for blob:. */
  localPreview?: string | null;
  size?: "compact" | "card";
  className?: string;
  alt?: string;
  decorative?: boolean;
};

const dimensions = {
  compact: { sizes: "48px", className: "h-12 w-12 rounded-md text-base" },
  card: { sizes: "(max-width: 640px) 42vw, 160px", className: "h-[120px] w-40 rounded-lg text-2xl" },
} as const;

export function ProcedureImage({ name, imageUrl, localPreview, size = "compact", className, alt, decorative = false }: ProcedureImageProps) {
  const byName = useProcedureImageByName(name, imageUrl === undefined);
  const preview = localPreviewSrc(localPreview);
  const src = preview ?? safeProcedureImageSrc(imageUrl === undefined ? byName : imageUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const shown = src && src !== failedSrc ? src : null;
  const frame = dimensions[size];
  const initial = name.trim().charAt(0).toLocaleUpperCase("pt-BR");

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden bg-accent font-bold text-accent-foreground", frame.className, className)}
      role={!shown && !decorative ? "img" : undefined}
      aria-label={!shown && !decorative ? `Sem imagem para ${name}` : undefined}
      aria-hidden={decorative || undefined}
    >
      {shown ? (
        <Image
          src={shown}
          alt={decorative ? "" : alt ?? `Imagem ilustrativa de ${name}`}
          fill
          sizes={frame.sizes}
          loading="lazy"
          // Imagens da clínica vêm de rota autenticada (o otimizador do Next não envia o cookie de sessão).
          // As do catálogo já são webp pequenos; no Next 16.3.5 um pedido ao otimizador cancelado no início
          // (ex.: fechar o modal de procedimento) pode deixar a imagem presa no servidor até reiniciar.
          unoptimized={shown.startsWith("/api/") || shown.startsWith("blob:") || shown.startsWith(catalogImagePrefix)}
          className="object-cover"
          onError={() => setFailedSrc(shown)}
        />
      ) : (
        <span aria-hidden="true" className="select-none leading-none">{initial || "?"}</span>
      )}
    </span>
  );
}
