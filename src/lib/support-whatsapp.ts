// Link de "Precisa de ajuda?" da tela de login: WhatsApp de suporte configurado por variável de ambiente
// (SUPPORT_WHATSAPP_NUMBER + SUPPORT_WHATSAPP_MESSAGE). Sem as duas, a tela mantém o comportamento atual.
// Formato wa.me: único que funciona em WhatsApp Web/Desktop e nos apps Android/iOS sem diferenciar dispositivo.
import { onlyDigits } from "./input-masks.ts";

// Mantém só dígitos e garante o código do país (55) na frente, sem inserir/remover o 9 do número local
// (isso depende do número real cadastrado, não é algo que o link deva "corrigir").
// SUPPORT_WHATSAPP_NUMBER deve incluir sempre o código do país (ex. "+55 61 8141-7913"): "55" também é um
// DDD válido (Santa Maria/RS), então um número local começando por esse DDD seria lido errado sem o "+55".
function toInternationalPhone(phone: string, defaultCountryCode = "55"): string {
  const digits = onlyDigits(phone);
  if (!digits) return "";
  return digits.startsWith(defaultCountryCode) ? digits : `${defaultCountryCode}${digits}`;
}

export function getSupportWhatsappLink(env: NodeJS.ProcessEnv = process.env): string | null {
  const rawNumber = env.SUPPORT_WHATSAPP_NUMBER?.trim();
  const rawMessage = env.SUPPORT_WHATSAPP_MESSAGE;
  if (!rawNumber || !rawMessage) return null;
  const phone = toInternationalPhone(rawNumber);
  if (!phone) return null;
  // Env var é uma única linha: "\n" literal (dois caracteres) representa quebra de linha na mensagem.
  const message = rawMessage.replace(/\\n/g, "\n");
  if (!message.trim()) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
