import {
  ArrowRight,
  CalendarPlus,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  FileText,
  ListFilter,
  Plus,
  Printer,
  Search,
  Sparkles,
} from "lucide-react";
import {
  appointments,
  financialByProcedure,
  patients,
  payments,
  procedures,
  products,
  quotes,
  reportItems,
} from "@/data/mock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DetailCard,
  EmptyState,
  MiniTable,
  ProgressBar,
  SearchFilterBar,
  SectionIntro,
  StatusBadge,
} from "./shared";
import { CostCalculator } from "./cost-calculator";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function ClientsSection() {
  return (
    <div>
      <SectionIntro
        title="Clientes"
        description="Consulta rápida dos pacientes, próximos retornos e status de relacionamento clínico."
        action="Novo cliente"
      />
      <SearchFilterBar placeholder="Buscar por nome, telefone ou status" />
      <MiniTable
        columns={["Nome", "Telefone", "Status", "Último atendimento", "Próximo retorno", "Valor recente"]}
        rows={patients.map((patient) => [
          <strong className="text-[#121733]" key={patient.name}>{patient.name}</strong>,
          patient.phone,
          <StatusBadge key={patient.status} status={patient.status} />,
          patient.lastVisit,
          patient.nextReturn,
          <span className="font-black text-[#1438ff]" key={patient.value}>{patient.value}</span>,
        ])}
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Perfil completo do paciente</CardTitle>
            <Badge variant="blue">Maria Silva</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "Dados",
                "Histórico",
                "Procedimentos",
                "Orçamentos",
                "Pagamentos",
                "Agendamentos",
                "Fotos/evolução",
                "Observações",
              ].map((tab) => (
                <button
                  className="rounded-[8px] border border-[#dfe4f2] bg-[#f7f9fd] px-4 py-3 text-left text-sm font-bold text-[#121733] transition hover:border-[#1438ff] hover:bg-[#eef3ff]"
                  key={tab}
                >
                  {tab}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <DetailCard title="Linha do tempo">
          <div className="space-y-4">
            {[
              ["Hoje", "Pagamento Pix registrado no valor de R$ 1.500."],
              ["18 set.", "Harmonização facial com custo de materiais de R$ 431."],
              ["12 set.", "Fotos de evolução adicionadas ao prontuário."],
            ].map(([date, event]) => (
              <div className="flex gap-3" key={event}>
                <div className="mt-1 h-3 w-3 rounded-full bg-[#1438ff]" />
                <div>
                  <p className="text-xs font-black uppercase text-[#7c86a2]">{date}</p>
                  <p className="text-sm leading-6 text-[#3f485f]">{event}</p>
                </div>
              </div>
            ))}
          </div>
        </DetailCard>
      </div>
    </div>
  );
}

export function ScheduleSection() {
  const rowColors = ["#5147dc", "#6d5ce7", "#2f9c88", "#d86655", "#ddb63f"];

  return (
    <div className="mx-auto max-w-[1260px]">
      <div className="mb-5 flex flex-col gap-4 border-b border-[#ececf2] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase text-[#9a9bab]">Agenda clínica</p>
          <h2 className="mt-1 text-lg font-bold text-[#25263a]">Atendimentos de hoje</h2>
        </div>
        <div className="flex items-center gap-1">
          {["Lista", "Dia", "Semana"].map((view, index) => (
            <button
              className={index === 0
                ? "border-b-2 border-[#5147dc] px-5 py-2 text-xs font-bold text-[#5147dc]"
                : "border-b-2 border-transparent px-5 py-2 text-xs font-semibold text-[#8a8b9c] hover:text-[#5147dc]"}
              key={view}
            >
              {view}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Buscar"><Search className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="Imprimir"><Printer className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-3 text-xs">
        <span className="flex items-center gap-2 font-bold text-[#5f6072]"><ListFilter className="h-3.5 w-3.5" /> Filtrar por</span>
        {["Agenda", "Atendimentos", "Status", "Paciente"].map((filter) => (
          <button className="flex min-w-[130px] items-center justify-between gap-4 border-b border-[#dedee7] px-1 py-2 font-semibold text-[#757688]" key={filter}>
            {filter}<ChevronDown className="h-3 w-3" />
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[7px] bg-white px-3 shadow-[0_8px_28px_rgba(38,39,58,0.035)] sm:px-5">
        <div className="grid min-w-[920px] grid-cols-[84px_1.15fr_1.05fr_1.1fr_1.25fr_106px] border-b border-[#eeeef3] px-3 py-3 text-[9px] font-bold uppercase text-[#adaeba]">
          <span>Horário</span><span>Atendimento</span><span>Status</span><span>Profissional</span><span>Paciente</span><span></span>
        </div>
        {appointments.map((appointment, index) => (
          <div className="relative grid min-w-[920px] grid-cols-[84px_1.15fr_1.05fr_1.1fr_1.25fr_106px] items-center border-b border-[#f0f0f4] px-3 py-4 text-[11px] last:border-0 hover:bg-[#fbfbfe]" key={`${appointment.time}-${appointment.patient}`}>
            <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full" style={{ backgroundColor: rowColors[index % rowColors.length] }} />
            <strong className="text-[#5147dc]">{appointment.time}</strong>
            <div><strong className="block text-[#3d3e51]">{appointment.procedure}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Consulta clínica</span></div>
            <StatusBadge status={appointment.status} />
            <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#f0efff] text-[8px] font-black text-[#5147dc]">{appointment.professional.replace("Dra. ", "").replace("Dr. ", "").slice(0, 2).toUpperCase()}</span><strong className="text-[#5a5b6e]">{appointment.professional}</strong></div>
            <div><strong className="block uppercase text-[#444557]">{appointment.patient}</strong><span className="mt-1 block text-[9px] text-[#aaaab7]">Paciente</span></div>
            <Button className="border-[#5147dc] text-[#5147dc]" key="action" size="sm" variant="secondary">Atender <ArrowRight className="h-3 w-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProceduresSection() {
  return (
    <div className="space-y-8">
      <div>
        <SectionIntro
          title="Procedimentos"
          description="Cadastro de serviços com valor sugerido, tempo estimado e materiais usados para cálculo de custo."
          action="Novo procedimento"
        />
        <MiniTable
          columns={["Nome", "Categoria", "Valor sugerido", "Tempo", "Materiais", "Margem"]}
          rows={procedures.map((procedure) => [
            <strong className="text-[#121733]" key={procedure.name}>{procedure.name}</strong>,
            procedure.category,
            currency.format(procedure.price),
            procedure.duration,
            procedure.materials,
            <Badge key={procedure.margin} variant="green">{procedure.margin}</Badge>,
          ])}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Materiais e custos</CardTitle>
              <p className="mt-1 text-sm text-[#65708b]">
                Cadastro usado somente para cálculo. Sem quantidade disponível,
                entrada, baixa ou estoque neste MVP.
              </p>
            </div>
            <Button variant="secondary" size="sm">
              <Plus className="h-4 w-4" />
              Material
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {products.map((product) => (
              <div
                className="rounded-[8px] border border-[#e5e9f4] p-4"
                key={product.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-[#121733]">{product.name}</p>
                    <p className="text-sm text-[#65708b]">
                      {product.category} · {product.supplier}
                    </p>
                  </div>
                  <Badge variant="purple">{product.unit}</Badge>
                </div>
                <p className="mt-3 text-lg font-black text-[#1438ff]">
                  {currency.format(product.cost)} / {product.unit}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
        <CostCalculator />
      </div>
    </div>
  );
}

export function QuotesSection() {
  return (
    <div>
      <SectionIntro
        title="Orçamentos"
        description="Propostas associadas ao paciente com status comercial e total calculado por procedimento."
        action="Novo orçamento"
      />
      <MiniTable
        columns={["Paciente", "Itens", "Total", "Status", "Validade", "Ação"]}
        rows={quotes.map((quote) => [
          <strong className="text-[#121733]" key={quote.patient}>{quote.patient}</strong>,
          quote.items,
          <span className="font-black text-[#1438ff]" key={quote.total}>{quote.total}</span>,
          <StatusBadge key={quote.status} status={quote.status} />,
          quote.expires,
          <Button key="send" size="sm" variant="secondary">Enviar</Button>,
        ])}
      />
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Exemplo de composição</CardTitle>
          <FileText className="h-5 w-5 text-[#1438ff]" />
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-3 rounded-[8px] bg-[#f7f9fd] p-5 text-sm">
            {[
              ["Preenchimento labial", "R$ 1.200"],
              ["Botox", "R$ 900"],
              ["Bioestimulador", "R$ 2.500"],
            ].map(([item, value]) => (
              <div className="flex justify-between gap-4" key={item}>
                <span className="text-[#3f485f]">{item}</span>
                <strong className="text-[#121733]">{value}</strong>
              </div>
            ))}
            <div className="border-t border-[#dfe4f2] pt-3">
              <div className="flex justify-between gap-4 text-lg">
                <strong>Total</strong>
                <strong className="text-[#1438ff]">R$ 4.600</strong>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function PaymentsSection() {
  return (
    <div>
      <SectionIntro
        title="Pagamentos"
        description="Registro de valores, forma de pagamento, parcelamento, observações e status financeiro."
        action="Registrar pagamento"
      />
      <MiniTable
        columns={["Paciente", "Valor", "Forma", "Data", "Status", "Parcelamento"]}
        rows={payments.map((payment) => [
          <strong className="text-[#121733]" key={payment.patient}>{payment.patient}</strong>,
          <span className="font-black text-[#1438ff]" key={payment.value}>{payment.value}</span>,
          payment.method,
          payment.date,
          <StatusBadge key={payment.status} status={payment.status} />,
          payment.installments,
        ])}
      />
      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro"].map((method) => (
          <Card className="p-5" key={method}>
            <CircleDollarSign className="mb-4 h-5 w-5 text-[#1438ff]" />
            <p className="font-black text-[#121733]">{method}</p>
            <p className="mt-1 text-sm text-[#65708b]">Disponível no lançamento</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function FinanceSection() {
  return (
    <div>
      <SectionIntro
        title="Financeiro"
        description="Dashboard de receita, despesas, resultado, pendências e performance por procedimento."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {["Hoje", "Semana", "Mês", "Período personalizado"].map((period, index) => (
          <Button key={period} variant={index === 2 ? "dark" : "secondary"}>
            {period}
          </Button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ["Receita", "R$ 18.450"],
          ["Despesas", "R$ 5.200"],
          ["Resultado", "R$ 13.250"],
          ["Valores pendentes", "R$ 8.740"],
          ["Recebidos", "R$ 49.800"],
        ].map(([label, value]) => (
          <Card className="p-5" key={label}>
            <p className="text-sm font-semibold text-[#65708b]">{label}</p>
            <p className="mt-3 text-2xl font-black text-[#121733]">{value}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Resultado por procedimento</CardTitle>
          <Badge variant="green">Margem real</Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {financialByProcedure.map((item, index) => (
            <div key={item.name}>
              <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="font-black text-[#121733]">{item.name}</p>
                <p className="text-sm text-[#65708b]">
                  Receita: <strong>{item.revenue}</strong> · Custos:{" "}
                  <strong>{item.cost}</strong> · Resultado:{" "}
                  <strong>{item.result}</strong>
                </p>
              </div>
              <ProgressBar value={[82, 76, 68][index]} tone={index === 2 ? "purple" : "green"} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function ReportsSection() {
  return (
    <div>
      <SectionIntro
        title="Relatórios"
        description="Primeiros indicadores para receita, resultado, custos, margem por procedimento e pendências."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reportItems.map((item) => (
          <Card className="p-5" key={item.label}>
            <p className="text-sm font-semibold text-[#65708b]">{item.label}</p>
            <p className="mt-3 text-xl font-black text-[#121733]">{item.value}</p>
          </Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DetailCard title="Relatórios iniciais">
          <div className="space-y-3">
            {[
              "Procedimentos realizados",
              "Procedimentos mais realizados",
              "Receita por procedimento",
              "Custo por procedimento",
              "Margem por procedimento",
              "Pagamentos pendentes",
            ].map((item) => (
              <div className="flex items-center gap-3" key={item}>
                <CheckCircle2 className="h-4 w-4 text-[#16a34a]" />
                <span className="text-sm font-semibold text-[#3f485f]">{item}</span>
              </div>
            ))}
          </div>
        </DetailCard>
        <DetailCard title="Pós-atendimento">
          <div className="space-y-4">
            <div className="rounded-[8px] bg-[#f2edff] p-4">
              <p className="font-black text-[#6d36d4]">
                8 pacientes possuem retorno nos próximos 7 dias.
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm text-[#3f485f]">
              <CalendarPlus className="h-4 w-4 text-[#1438ff]" />
              Data do retorno e evolução clínica
            </div>
            <div className="flex items-center gap-3 text-sm text-[#3f485f]">
              <Camera className="h-4 w-4 text-[#1438ff]" />
              Fotos e evidências conforme o fluxo da clínica
            </div>
          </div>
        </DetailCard>
      </div>
    </div>
  );
}

export function SettingsSection() {
  return (
    <div>
      <SectionIntro
        title="Configurações"
        description="Fundação para dados da clínica, profissionais, preferências de agenda, formas de pagamento e permissões."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {[
          ["Clínica", "Nome, CNPJ, endereço e dados comerciais."],
          ["Profissionais", "Perfis, agenda, permissões e assinatura visual."],
          ["Cálculo de custos", "Unidades, arredondamentos e regras de margem."],
        ].map(([title, description]) => (
          <Card className="p-5" key={title}>
            <Sparkles className="mb-4 h-5 w-5 text-[#1438ff]" />
            <p className="font-black text-[#121733]">{title}</p>
            <p className="mt-2 text-sm leading-6 text-[#65708b]">{description}</p>
          </Card>
        ))}
      </div>
      <div className="mt-6">
        <EmptyState
          title="Integrações ficam para uma próxima etapa"
          description="Este MVP prioriza a interface, o fluxo clínico e a lógica de custo real antes de conectar banco de dados e automações."
        />
      </div>
    </div>
  );
}
