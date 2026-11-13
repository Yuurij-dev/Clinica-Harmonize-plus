import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_CONTACT_EMAIL, legalEntityFields, pendingLegalFields } from "./legal-config";

// Layout das páginas públicas (Termos e Privacidade): mesma identidade da tela de login, sem o shell do app.
export function LegalPage({ title, updatedAt, current, children }: { title: string; updatedAt: string; current: "termos" | "privacidade"; children: ReactNode }) {
  const link = (href: string, label: string, active: boolean) => (
    <Link aria-current={active ? "page" : undefined} className={active ? "font-bold text-[#5147dc]" : "font-semibold text-[#5b6788] hover:text-[#5147dc]"} href={href}>{label}</Link>
  );
  return (
    <div className="min-h-screen bg-white text-[#17134d]">
      <header className="border-b border-[#e6ebf5]">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link aria-label="Harmonize+ — página inicial" href="/login"><Image alt="Harmonize+" className="h-8 w-auto" height={300} priority src="/brand/logo-horizontal.svg" unoptimized width={1200} /></Link>
          <nav aria-label="Documentos legais" className="flex gap-4 text-sm">{link("/termos", "Termos de Uso", current === "termos")}{link("/privacidade", "Privacidade", current === "privacidade")}</nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-2xl font-black text-[#17134d] sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-[#5b6788]">Última atualização: {updatedAt}</p>
        <div className="mt-8 space-y-8 text-[15px] leading-7 text-[#2d3654]">{children}</div>
      </main>
      <footer className="border-t border-[#e6ebf5]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-[#5b6788] sm:px-6">
          <span>© Harmonize+</span>
          <Link className="font-semibold text-[#5147dc] hover:underline" href="/login">Voltar ao acesso</Link>
        </div>
      </footer>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-lg font-black text-[#17134d]" id={id}>{title}</h2>
      {children}
    </section>
  );
}

// Identificação do responsável: mostra só o que já foi formalizado; enquanto houver pendência, avisa com transparência.
export function LegalEntity() {
  const fields = legalEntityFields();
  const filled = fields.filter((field) => field.value);
  const pending = pendingLegalFields();
  return (
    <div className="space-y-3">
      {filled.length ? <dl className="space-y-1">{filled.map((field) => <div key={field.key}><dt className="inline font-bold">{field.label}: </dt><dd className="inline">{field.value}</dd></div>)}</dl> : null}
      {pending.length ? <p className="rounded-md border border-[#e6ebf5] bg-[#f8faff] px-3 py-2 text-sm text-[#2d3654]">O Harmonize+ está em fase de formalização empresarial. Razão social, CNPJ, endereço e encarregado pelo tratamento de dados serão informados nesta página assim que a formalização for concluída. Até lá, use o e-mail de contato abaixo.</p> : null}
      <p>Contato: <a className="font-semibold text-[#5147dc] underline underline-offset-2" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a></p>
    </div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-[#5147dc]">{children}</ul>;
}
