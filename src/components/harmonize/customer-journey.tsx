"use client";

import { useState } from "react";
import {
  Ban,
  CalendarCheck2,
  Check,
  FileCheck2,
  HeartHandshake,
  MessageCircleMore,
  Stethoscope,
  Syringe,
} from "lucide-react";
import type {
  CustomerJourneyStage,
  JourneyStageId,
  JourneyStageStatus,
} from "@/types/clinic";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatJourneyDate } from "@/lib/customer-journey";

const stageIcons = {
  lead: MessageCircleMore,
  evaluation: Stethoscope,
  quote: FileCheck2,
  procedure: Syringe,
  return: CalendarCheck2,
  aftercare: HeartHandshake,
};

const statusLabels: Record<JourneyStageStatus, string> = {
  completed: "Concluído",
  current: "Etapa atual",
  in_progress: "Em procedimento",
  pending: "Pendente",
  cancelled: "Cancelado",
};

export function CustomerJourney({
  journey,
  onOpenStage,
  compact = false,
}: {
  journey: CustomerJourneyStage[];
  onOpenStage?: (stageId: JourneyStageId) => void;
  compact?: boolean;
}) {
  const initial = journey.find((stage) => stage.status === "current") ?? journey[0];
  const [selectedId, setSelectedId] = useState<JourneyStageId>(initial.id);
  const selected = journey.find((stage) => stage.id === selectedId) ?? initial;
  const SelectedIcon = stageIcons[selected.id];

  function selectStage(stageId: JourneyStageId) {
    if (["return", "aftercare"].includes(stageId) && journey.find((stage) => stage.id === stageId)?.status === "pending") return;
    setSelectedId(stageId);
    onOpenStage?.(stageId);
  }

  if (compact) {
    return (
      <section className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase text-[#9a9baa]">Jornada do cliente</p>
            <p className="mt-1 text-[10px] text-[#858696]">Selecione uma etapa para abrir o contexto relacionado</p>
          </div>
          <span className="hidden items-center gap-1.5 text-[9px] font-semibold text-[#818294] xl:flex"><span className="h-1.5 w-1.5 rounded-full bg-[#2f9b67]" />Atualização automática</span>
        </div>
        <div className="hidden grid-cols-6 md:grid">
          {journey.map((stage, index) => (
            <CompactJourneyStep
              key={stage.id}
              stage={stage}
              selected={stage.id === selectedId}
              first={index === 0}
              connectorComplete={index > 0 && journey[index - 1].status === "completed"}
              onSelect={() => selectStage(stage.id)}
            />
          ))}
        </div>
        <div className="md:hidden">
          {journey.map((stage, index) => (
            <MobileJourneyStep
              key={stage.id}
              stage={stage}
              selected={stage.id === selectedId}
              last={index === journey.length - 1}
              connectorComplete={stage.status === "completed"}
              onSelect={() => selectStage(stage.id)}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[7px] border border-[#e8e8ef] bg-white shadow-[0_7px_24px_rgba(38,39,58,0.035)]">
      <div className="flex flex-col gap-1 border-b border-[#eeeeF3] px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase text-[#9a9baa]">Acompanhamento automático</p>
            <h3 className="mt-1 text-sm font-bold text-[#27283b]">Jornada do cliente</h3>
          </div>
          <div className="hidden items-center gap-2 text-[10px] font-semibold text-[#8d8e9e] sm:flex">
            <span className="h-2 w-2 rounded-full bg-[#2f9b67]" />
            Atualizada pelos eventos do paciente
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="hidden grid-cols-6 md:grid">
          {journey.map((stage, index) => (
            <JourneyStep
              key={stage.id}
              stage={stage}
              selected={stage.id === selectedId}
              first={index === 0}
              connectorComplete={index > 0 && journey[index - 1].status === "completed"}
              onSelect={() => selectStage(stage.id)}
            />
          ))}
        </div>

        <div className="space-y-0 md:hidden">
          {journey.map((stage, index) => (
            <MobileJourneyStep
              key={stage.id}
              stage={stage}
              selected={stage.id === selectedId}
              last={index === journey.length - 1}
              connectorComplete={stage.status === "completed"}
              onSelect={() => selectStage(stage.id)}
            />
          ))}
        </div>
      </div>

      <div className="grid border-t border-[#ededf2] bg-[#fbfbfd] lg:grid-cols-[230px_1fr_auto]">
        <div className="border-b border-[#ededf2] p-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#eeecff] text-[#5147dc]">
              <SelectedIcon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-sm font-bold text-[#292a3d]">{selected.label}</p>
              <p className={cn("mt-0.5 text-[10px] font-bold uppercase", statusColor(selected.status))}>
                {statusLabels[selected.status]}
              </p>
            </div>
          </div>
          <p className="mt-4 text-[10px] font-semibold uppercase text-[#a0a1af]">Data da etapa</p>
          <p className="mt-1 text-xs font-bold text-[#555668]">{formatJourneyDate(selected.date)}</p>
        </div>

        <div className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {selected.details.length ? selected.details.map((detail) => (
            <div key={detail.label}>
              <p className="text-[9px] font-bold uppercase text-[#a0a1af]">{detail.label}</p>
              {Array.isArray(detail.value) ? (
                <div className="mt-1.5 space-y-1">
                  {detail.value.map((item) => (
                    <p className={cn("text-xs font-semibold", detailTone(detail.tone))} key={item}>{item}</p>
                  ))}
                </div>
              ) : (
                <p className={cn("mt-1.5 text-xs font-semibold", detailTone(detail.tone))}>{detail.value}</p>
              )}
            </div>
          )) : (
            <p className="text-xs text-[#8d8e9e]">Esta etapa ainda não possui informações registradas.</p>
          )}
        </div>

        <div className="flex items-end p-5 pt-0 lg:pt-5">
          <Button
            className="w-full whitespace-nowrap lg:w-auto"
            variant="secondary"
            size="sm"
            onClick={() => onOpenStage?.(selected.id)}
          >
            {selected.actionLabel}
          </Button>
        </div>
      </div>
    </section>
  );
}

function CompactJourneyStep({
  stage,
  selected,
  first,
  connectorComplete,
  onSelect,
}: {
  stage: CustomerJourneyStage;
  selected: boolean;
  first: boolean;
  connectorComplete: boolean;
  onSelect: () => void;
}) {
  const Icon = stageIcons[stage.id];

  return (
    <button className="relative flex min-w-0 flex-col items-center px-1 text-center" onClick={onSelect}>
      {!first ? <span className={cn("absolute right-1/2 top-4 h-px w-full", connectorComplete ? "bg-[#54ad7b]" : "bg-[#dcdce5]")} /> : null}
      <span className={cn("relative z-10 grid h-8 w-8 place-items-center rounded-full border bg-white transition", stageCircle(stage.status), selected && "ring-4 ring-[#5147dc]/10")}>
        {stage.status === "completed" ? <Check className="h-3.5 w-3.5" /> : stage.status === "cancelled" ? <Ban className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className={cn("mt-2 max-w-full truncate text-[9px] font-semibold", selected ? "text-[#5147dc]" : "text-[#666779]")}>{stage.label}</span>
    </button>
  );
}

function JourneyStep({
  stage,
  selected,
  first,
  connectorComplete,
  onSelect,
}: {
  stage: CustomerJourneyStage;
  selected: boolean;
  first: boolean;
  connectorComplete: boolean;
  onSelect: () => void;
}) {
  const Icon = stageIcons[stage.id];

  return (
    <button className="group relative flex min-w-0 flex-col items-center px-1 text-center" onClick={onSelect}>
      {!first ? (
        <span className={cn("absolute right-1/2 top-[19px] h-[2px] w-full", connectorComplete ? "bg-[#54ad7b]" : "bg-[#dedee7]")} />
      ) : null}
      <span className={cn("relative z-10 grid h-10 w-10 place-items-center rounded-full border-2 bg-white transition", stageCircle(stage.status), selected && "ring-4 ring-[#5147dc]/10")}>
        {stage.status === "completed" ? <Check className="h-4 w-4" /> : stage.status === "cancelled" ? <Ban className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className={cn("mt-2 text-[11px] font-bold transition", selected ? "text-[#5147dc]" : "text-[#555668]")}>{stage.label}</span>
      <span className={cn("mt-1 text-[8px] font-bold uppercase", statusColor(stage.status))}>{statusLabels[stage.status]}</span>
      <span className="mt-1 text-[9px] text-[#a0a1af]">{stage.date ? formatJourneyDate(stage.date) : "Sem data"}</span>
    </button>
  );
}

function MobileJourneyStep({
  stage,
  selected,
  last,
  connectorComplete,
  onSelect,
}: {
  stage: CustomerJourneyStage;
  selected: boolean;
  last: boolean;
  connectorComplete: boolean;
  onSelect: () => void;
}) {
  const Icon = stageIcons[stage.id];

  return (
    <button className={cn("relative flex w-full items-center gap-3 pb-5 text-left", last && "pb-0")} onClick={onSelect}>
      {!last ? <span className={cn("absolute bottom-0 left-[19px] top-10 w-[2px]", connectorComplete ? "bg-[#54ad7b]" : "bg-[#dedee7]")} /> : null}
      <span className={cn("relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 bg-white", stageCircle(stage.status), selected && "ring-4 ring-[#5147dc]/10")}>
        {stage.status === "completed" ? <Check className="h-4 w-4" /> : stage.status === "cancelled" ? <Ban className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-xs font-bold", selected ? "text-[#5147dc]" : "text-[#4f5062]")}>{stage.label}</span>
        <span className={cn("mt-0.5 block text-[9px] font-bold uppercase", statusColor(stage.status))}>{statusLabels[stage.status]}</span>
      </span>
      <span className="text-[10px] text-[#9a9baa]">{stage.date ? formatJourneyDate(stage.date) : "Sem data"}</span>
    </button>
  );
}

function stageCircle(status: JourneyStageStatus) {
  return {
    completed: "border-[#2f9b67] bg-[#2f9b67] text-white",
    current: "border-[#5147dc] text-[#5147dc] shadow-[0_0_0_5px_rgba(81,71,220,0.09)]",
    in_progress: "border-[#d99a28] text-[#b36c16] shadow-[0_0_0_5px_rgba(217,154,40,0.12)]",
    pending: "border-[#d6d6df] text-[#a4a5b2]",
    cancelled: "border-[#d95d4f] bg-[#fff3f1] text-[#d95d4f]",
  }[status];
}

function statusColor(status: JourneyStageStatus) {
  return {
    completed: "text-[#2f8f61]",
    current: "text-[#5147dc]",
    in_progress: "text-[#b36c16]",
    pending: "text-[#9a9baa]",
    cancelled: "text-[#cf5548]",
  }[status];
}

function detailTone(tone?: "default" | "positive" | "warning") {
  if (tone === "positive") return "text-[#258454]";
  if (tone === "warning") return "text-[#b36c16]";
  return "text-[#4e4f61]";
}
