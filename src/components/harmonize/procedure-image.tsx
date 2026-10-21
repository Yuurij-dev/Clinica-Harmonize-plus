"use client";

import Image from "next/image";
import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { resolveProcedureImage } from "@/lib/procedure-images";

type ProcedureImageProps = {
  name: string;
  imageUrl?: string | null;
  size?: "compact" | "card";
  className?: string;
  alt?: string;
  decorative?: boolean;
};

const dimensions = {
  compact: { width: 48, height: 48, sizes: "48px", className: "h-12 w-12 rounded-md" },
  card: { width: 160, height: 120, sizes: "(max-width: 640px) 42vw, 160px", className: "h-[120px] w-40 rounded-lg" },
} as const;

export function ProcedureImage({ name, imageUrl, size = "compact", className, alt, decorative = false }: ProcedureImageProps) {
  const image = resolveProcedureImage(name, imageUrl);
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const fallbackImage = image.custom ? resolveProcedureImage(name) : null;
  const sourceFailed = Boolean(image.src && failedSources.has(image.src));
  const displayedImage = sourceFailed
    ? fallbackImage?.src && !failedSources.has(fallbackImage.src)
      ? fallbackImage
      : { ...image, src: null }
    : image;
  const frame = dimensions[size];
  const accessibleAlt = decorative ? "" : alt ?? displayedImage.alt;

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden bg-muted/60 text-muted-foreground", frame.className, className)}
      role={!displayedImage.src && !decorative ? "img" : undefined}
      aria-label={!displayedImage.src && !decorative ? `Imagem ilustrativa indisponível para ${name}` : undefined}
      aria-hidden={decorative || undefined}
    >
      {displayedImage.src ? (
        <Image
          src={displayedImage.src}
          alt={accessibleAlt}
          fill
          sizes={frame.sizes}
          loading="lazy"
          unoptimized={displayedImage.custom && /^https:\/\//i.test(displayedImage.src)}
          className="object-cover"
          onError={() => setFailedSources((current) => new Set(current).add(displayedImage.src!))}
        />
      ) : (
        <ImageIcon aria-hidden="true" className={cn("text-primary/50", size === "compact" ? "h-5 w-5" : "h-8 w-8")} />
      )}
    </span>
  );
}
