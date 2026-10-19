import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const stages = ["Avaliação", "Orçamento", "Procedimento", "Pós-procedimento", "Retorno", "Concluído"];

export function JourneyProgress({ current }: { current: 0 | 1 | 2 | 3 | 4 | 5 }) {
  return <nav aria-label="Progresso do atendimento" className="overflow-x-auto px-2 py-1">
    <ol className="flex min-w-[720px] items-center gap-2 text-[10px] font-semibold text-[#747587]">
      {stages.map((stage, index) => <li key={stage} className="flex min-w-0 flex-1 items-center gap-2" aria-current={index === current ? "step" : undefined}>
        <span title={stage} aria-label={stage} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", index <= current ? "bg-[#5147dc] text-white" : "bg-[#e6e7ef] text-[#747587]")}>{index < current ? <Check className="h-4 w-4" /> : index + 1}</span>
        <span className={cn("whitespace-nowrap", index === current && "text-[#3f35d6]")}>{stage}</span>
        {index < stages.length - 1 ? <span className={cn("h-px min-w-3 flex-1", index < current ? "bg-[#5147dc]" : "bg-[#dfe0e8]")} /> : null}
      </li>)}
    </ol>
  </nav>;
}
