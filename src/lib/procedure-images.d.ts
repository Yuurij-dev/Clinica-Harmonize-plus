export type ResolvedProcedureImage = {
  src: string | null;
  alt: string;
  slug?: string;
  custom: boolean;
};

export function resolveProcedureImage(name: string, customImageUrl?: string | null): ResolvedProcedureImage;
