type VerificationEmail = {
  recipient: string;
  name: string;
  verificationUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export async function sendVerificationEmail({ recipient, name, verificationUrl }: VerificationEmail) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const safeName = escapeHtml(name);
  const shouldSendInDevelopment = process.env.SEND_EMAILS_IN_DEVELOPMENT === "true";

  if (process.env.NODE_ENV !== "production" && !shouldSendInDevelopment) {
    console.warn(`[email-verification] Link de verificação para ${recipient}: ${verificationUrl}`);
    return verificationUrl;
  }

  if (!apiKey || !from) {
    throw new Error("Configure RESEND_API_KEY e EMAIL_FROM para enviar e-mails de verificação.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: "Confirme seu e-mail no Harmonize+",
      html: `<div style="font-family:Arial,sans-serif;color:#202136;line-height:1.6"><h2>Olá, ${safeName}!</h2><p>Confirme seu e-mail para ativar sua conta no Harmonize+.</p><p><a href="${verificationUrl}" style="display:inline-block;background:#5947ee;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Confirmar meu e-mail</a></p><p>Este link expira em 30 minutos e pode ser usado uma única vez.</p></div>`,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao enviar e-mail de verificação: ${details}`);
  }
  return undefined;
}
