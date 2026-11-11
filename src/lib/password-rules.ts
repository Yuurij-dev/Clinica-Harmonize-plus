// Regra de senha do cadastro com senha (tela e servidor). Pura, sem Next/Prisma.
// Nao vale para login nem para contas existentes.

export type PasswordChecks = { length: boolean; letters: boolean; number: boolean; special: boolean };

export const PASSWORD_RULE_LABELS: Array<{ key: keyof PasswordChecks; label: string }> = [
  { key: "length", label: "Pelo menos 8 caracteres" },
  { key: "letters", label: "Letras maiúsculas e minúsculas" },
  { key: "number", label: "Pelo menos 1 número" },
  { key: "special", label: "Pelo menos 1 caractere especial" },
];

export const PASSWORD_RULE_MESSAGE = "A senha deve ter pelo menos 8 caracteres, com letras maiúsculas e minúsculas, um número e um caractere especial.";

export function passwordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 8,
    letters: /\p{Ll}/u.test(password) && /\p{Lu}/u.test(password),
    number: /\d/.test(password),
    special: /[^\p{L}\p{N}\p{M}\s]/u.test(password),
  };
}

export const isStrongPassword = (password: string) => Object.values(passwordChecks(password)).every(Boolean);

export const PASSWORD_STRENGTH_LABELS = ["fraca", "fraca", "média", "boa", "forte"] as const;

// 0 (vazia) a 4 (todas as regras). O rotulo e "fraca" ate 1 regra cumprida.
export function passwordStrength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: (typeof PASSWORD_STRENGTH_LABELS)[number] } {
  const score = password ? (Object.values(passwordChecks(password)).filter(Boolean).length as 0 | 1 | 2 | 3 | 4) : 0;
  return { score, label: PASSWORD_STRENGTH_LABELS[score] };
}
