"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Rodapé de paginação compartilhado por Documentos clínicos e Fotos.
export function PaginationBar({ page, pageSize, total, sizes, noun, onPage, onPageSize }: {
  page: number; pageSize: number; total: number; sizes: number[]; noun: [singular: string, plural: string];
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
    <span>Mostrando {from} a {to} de {total} {total === 1 ? noun[0] : noun[1]}</span>
    <div className="flex items-center gap-1" role="navigation" aria-label="Paginação">
      <Button size="sm" variant="outline" disabled={page <= 1} aria-label="Página anterior" onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
      {pageNumbers(page, pages).map((number, index) => number === 0 ? <span key={`gap${index}`} className="px-1">…</span> : <Button key={number} size="sm" variant={number === page ? "default" : "outline"} aria-current={number === page ? "page" : undefined} onClick={() => onPage(number)}>{number}</Button>)}
      <Button size="sm" variant="outline" disabled={page >= pages} aria-label="Próxima página" onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
    </div>
    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" aria-label="Itens por página" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{sizes.map((size) => <option key={size} value={size}>{size} por página</option>)}</select>
  </div>;
}

function pageNumbers(page: number, pages: number) {
  const set = new Set([1, pages, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const result: number[] = [];
  sorted.forEach((value, index) => { if (index && value - sorted[index - 1] > 1) result.push(0); result.push(value); });
  return result;
}
