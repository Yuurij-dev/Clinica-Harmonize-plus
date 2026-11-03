"use client";

// TEMPORÁRIO: três exemplos de como o mascote pode aparecer nos modais, para decidir qual adotar.
// Nada disso é usado em produção; apague este arquivo e o botão que o abre (topbar.tsx) depois da escolha.

import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { GuideMascot } from "./illustrations/guide-mascot";

const variants = [
  { id: 1, nome: "Sobreposto no topo", resumo: "Mascote centralizado saindo por cima da borda, em todo modal. O cabeçalho desce para abrir espaço." },
  { id: 2, nome: "Pequeno, ao lado do título", resumo: "Mascote menor dentro do cabeçalho, à esquerda do título. Não mexe na altura nem no layout." },
  { id: 3, nome: "Só nos modais pequenos", resumo: "Formulários ficam limpos, sem mascote. O mascote aparece só em confirmações, como no tour." },
] as const;

/** Cabeçalho igual ao do Modal real (modal.tsx), para a comparação ser honesta. */
function Header({ comMascote }: { comMascote?: boolean }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex min-w-0 items-start gap-3">
        {comMascote ? <span className="-my-1 shrink-0"><GuideMascot pose="wave" size={44} /></span> : null}
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground sm:text-lg">Novo procedimento</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Escolha um procedimento do catálogo ou crie um personalizado.</p>
        </div>
      </div>
      <Button variant="ghost" size="icon" aria-label="Fechar (exemplo)" tabIndex={-1}><X className="h-4 w-4" /></Button>
    </header>
  );
}

/** Miolo de mentira, só para dar volume de formulário ao exemplo. */
function Corpo() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground" htmlFor="demo-nome">Nome do procedimento</label>
        <Input id="demo-nome" defaultValue="Harmonização facial" readOnly />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground" htmlFor="demo-valor">Valor sugerido</label>
          <Input id="demo-valor" defaultValue="R$ 2.500,00" readOnly />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium text-foreground" htmlFor="demo-tempo">Tempo estimado</label>
          <Input id="demo-tempo" defaultValue="60 min" readOnly />
        </div>
      </div>
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">Ficha técnica: Toxina botulínica (1 frasco) · Agulha (4 un)</div>
    </div>
  );
}

export function ModalMascotDemo() {
  const [aberto, setAberto] = useState(false);
  const [indice, setIndice] = useState(0);
  const atual = variants[indice];
  const proximo = () => setIndice((i) => (i + 1) % variants.length);

  return (
    <>
      <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setIndice(0); setAberto(true); }}>Exemplos de mascote</Button>
      <Modal
        open={aberto}
        title={`Exemplo ${atual.id}: ${atual.nome}`}
        hideHeader
        panelClassName="max-w-xl border-0 bg-transparent shadow-none"
        bodyClassName="p-0 sm:p-0"
        onClose={() => setAberto(false)}
      >
        <div className="flex flex-col items-center">
          {/* Exemplo 1: mascote sobreposto, o cartão abre espaço com o padding de cima. */}
          {atual.id === 1 ? <div className="relative z-10 -mb-10"><GuideMascot pose="wave" size={100} /></div> : null}

          <div className={`w-full overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl ${atual.id === 1 ? "pt-10" : ""}`}>
            <Header comMascote={atual.id === 2} />
            <Corpo />
          </div>

          {/* Exemplo 3: nos modais pequenos o mascote continua, como no tour. Mostrado aqui embaixo para comparar. */}
          {atual.id === 3 ? (
            <div className="mt-6 flex w-full flex-col items-center">
              <p className="mb-2 text-xs font-semibold text-white/70">...e a confirmação pequena continua assim:</p>
              <div className="relative z-10 -mb-10"><GuideMascot pose="wave" size={100} /></div>
              <div className="w-full max-w-sm rounded-2xl border border-border bg-card px-5 pb-4 pt-[52px] text-center text-card-foreground shadow-2xl">
                <h3 className="text-lg font-black tracking-tight text-foreground">Excluir procedimento?</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">Ele sai do catálogo e das opções de novos orçamentos. Os registros já feitos não mudam.</p>
                <div className="mt-4 flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" tabIndex={-1}>Cancelar</Button>
                  <Button type="button" variant="primary" size="sm" className="ml-auto" tabIndex={-1}>Excluir</Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Barra da demonstração (não faz parte do desenho avaliado). */}
          <div className="mt-6 w-full rounded-xl border border-white/15 bg-black/35 px-4 py-3 text-white backdrop-blur-sm">
            <p className="text-xs font-bold">Exemplo {atual.id} de {variants.length}: {atual.nome}</p>
            <p className="mt-1 text-xs leading-5 text-white/75">{atual.resumo}</p>
            <div className="mt-3 flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="shrink-0 text-white hover:bg-white/10" onClick={() => setAberto(false)}>Fechar</Button>
              <Button type="button" variant="primary" size="sm" className="ml-auto" onClick={proximo}>
                Mostrar o próximo
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
