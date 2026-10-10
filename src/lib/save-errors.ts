import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export function saveErrorReason(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const column = typeof error.meta?.column === "string" ? error.meta.column : "";
    switch (error.code) {
      case "P2022":
        return column
          ? `o banco de dados está desatualizado e não contém a coluna ${column}. Aplique as atualizações pendentes do banco.`
          : "o banco de dados está desatualizado e não contém uma coluna necessária. Aplique as atualizações pendentes do banco.";
      case "P2002":
        return "já existe um registro com esses dados.";
      case "P2003":
        return "um registro relacionado não existe ou foi removido.";
      case "P2025":
        return "o registro que você tentou alterar não foi encontrado. Atualize a página e tente novamente.";
      default:
        return `erro do banco ${error.code}: ${error.message}`;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "ocorreu um erro inesperado.";
}

export function withSaveErrors<Args extends unknown[]>(operation: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`Failed to ${operation}`, error);
      return NextResponse.json({ message: `Não foi possível ${operation}. Motivo: ${saveErrorReason(error)}` }, { status: 500 });
    }
  };
}
