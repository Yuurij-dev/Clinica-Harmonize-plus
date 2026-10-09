import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import type { SectionId } from "@/types/clinic";

const sections = new Set<SectionId>([
  "dashboard",
  "procedimentos",
  "clientes",
  "orcamentos",
  "pagamentos",
  "financeiro",
  "relatorios",
  "calculadora",
  "configuracoes",
]);
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const section = (await params).section as SectionId;
  if (!sections.has(section)) notFound();
  return null;
}
