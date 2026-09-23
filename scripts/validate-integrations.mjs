import { pathToFileURL } from "node:url";

export function validateIntegrationEnvironment(environment) {
  const enabled = environment.ENABLE_COPILOT_INTEGRATIONS === "true";
  const telegram = environment.ENABLE_TELEGRAM === "true";
  const errors = [];
  for (const name of ["DEPLOY_EMAIL", "ENABLE_OTP_LOGIN", "ENABLE_DATA_RECOVERY", "ENABLE_COPILOT_INTEGRATIONS", "ENABLE_TELEGRAM"]) {
    if (environment[name] && !["true", "false"].includes(environment[name])) errors.push(`${name} must be true or false.`);
  }
  for (const name of ["CHAT_MODEL_CAPACITY", "EMBEDDING_MODEL_CAPACITY", "BUDGET_AMOUNT", "LOG_ANALYTICS_DAILY_QUOTA_GB"]) {
    if (environment[name] && (!/^[1-9][0-9]*$/.test(environment[name]) || !Number.isSafeInteger(Number(environment[name])))) errors.push(`${name} must be a positive integer.`);
  }
  if (environment.REASONING_EFFORT && !["low", "medium", "high", "xhigh", "max"].includes(environment.REASONING_EFFORT)) errors.push("REASONING_EFFORT must be low, medium, high, xhigh, or max.");
  if (environment.ENABLE_OTP_LOGIN === "true" && environment.DEPLOY_EMAIL !== "true") errors.push("ENABLE_OTP_LOGIN requires DEPLOY_EMAIL=true.");
  if (telegram && !enabled) errors.push("ENABLE_TELEGRAM requires ENABLE_COPILOT_INTEGRATIONS=true.");
  const secretUri = (name) => {
    try {
      const url = new URL(environment[name]);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !/^[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(url.hostname) || !/^\/secrets\/[A-Za-z0-9-]+(?:\/[A-Za-z0-9]+)?\/?$/.test(url.pathname)) throw new Error();
    } catch { errors.push(`${name} must be an Azure Key Vault secret URI.`); }
  };
  if (enabled && !telegram && !environment.COPILOT_CLIENTS_KEY_VAULT_URL) errors.push("Provide COPILOT_CLIENTS_KEY_VAULT_URL for external clients.");
  if (environment.COPILOT_CLIENTS_KEY_VAULT_URL) secretUri("COPILOT_CLIENTS_KEY_VAULT_URL");
  if (!!environment.COPILOT_ENTRA_TENANT_ID !== !!environment.COPILOT_ENTRA_AUDIENCE) errors.push("Set both COPILOT_ENTRA_TENANT_ID and COPILOT_ENTRA_AUDIENCE.");
  if (environment.COPILOT_ENTRA_TENANT_ID && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(environment.COPILOT_ENTRA_TENANT_ID)) errors.push("COPILOT_ENTRA_TENANT_ID must be a tenant UUID, not common or organizations.");
  if (telegram) {
    secretUri("TELEGRAM_BOT_TOKEN_KEY_VAULT_URL");
    secretUri("TELEGRAM_WEBHOOK_SECRET_KEY_VAULT_URL");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(environment.TELEGRAM_BOT_USERNAME ?? "")) errors.push("Set TELEGRAM_BOT_USERNAME without @.");
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = validateIntegrationEnvironment(process.env);
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log("Deployment settings validated.");
}