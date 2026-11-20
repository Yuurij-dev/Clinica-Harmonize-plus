// Modo de teste local do fluxo de código por e-mail (login E cadastro). E-mail @teste.com usa sempre o código
// fixo 000000 e não dispara e-mail de verdade, para testar sem depender do provedor nem de uma caixa real.
// Fail-closed: exige NODE_ENV explicitamente development/test (nunca basta "não ser production", que deixaria
// passar um ambiente mal configurado, ex. staging sem NODE_ENV) E a flag opt-in ENABLE_DEV_TEST_LOGIN=1.
export const DEV_TEST_CODE = "000000";
const DEV_TEST_EMAIL_SUFFIX = "@teste.com";
const DEV_TEST_ALLOWED_NODE_ENVS = new Set(["development", "test"]);

export function isDevTestEmail(email: string, env: { NODE_ENV?: string; ENABLE_DEV_TEST_LOGIN?: string } = process.env): boolean {
  return DEV_TEST_ALLOWED_NODE_ENVS.has(env.NODE_ENV ?? "") && env.ENABLE_DEV_TEST_LOGIN === "1" && email.trim().toLowerCase().endsWith(DEV_TEST_EMAIL_SUFFIX);
}
