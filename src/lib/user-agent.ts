// Parsing simples de user-agent (navegador + SO) para rotulos; sem dependencia. Nao e prova de identidade.

export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  const s = String(ua ?? "");
  let browser = "Navegador desconhecido";
  if (/Edg(e|A|iOS)?\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser\//.test(s)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";

  let os = "Sistema desconhecido";
  if (/Windows NT/.test(s)) os = "Windows";
  else if (/Android/.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux|X11/.test(s)) os = "Linux";
  return { browser, os };
}

export function deviceLabel(ua: string | null | undefined): string {
  const { browser, os } = parseUserAgent(ua);
  return `${browser} em ${os}`;
}
