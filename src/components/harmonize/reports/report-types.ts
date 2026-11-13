// Formatos das respostas de /api/reports/*, derivados das funções do servidor (só tipos; nada de servidor vai ao bundle).
import type { clientsReport, financeReport, overviewReport, proceduresReport, professionalsReport, quotesReport, stockReport } from "@/lib/reports-server";

export type OverviewData = Awaited<ReturnType<typeof overviewReport>>;
export type ProceduresData = Awaited<ReturnType<typeof proceduresReport>>;
export type ProfessionalsData = Awaited<ReturnType<typeof professionalsReport>>;
export type ClientsData = Awaited<ReturnType<typeof clientsReport>>;
export type QuotesData = Awaited<ReturnType<typeof quotesReport>>;
export type FinanceData = Awaited<ReturnType<typeof financeReport>>;
export type StockData = Awaited<ReturnType<typeof stockReport>>;

export type ReportTabId = "procedures" | "professionals" | "appointments" | "clients" | "quotes" | "finance" | "stock";
