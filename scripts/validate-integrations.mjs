import { pathToFileURL } from "node:url";

export function validateIntegrationEnvironment(environment) {
  const enabled = environment.ENABLE_COPILOT_INTEGRATIONS === "true";
  const telegram = environment.ENABLE_TELEGRAM === "true";
  const errors = [];
  if (telegram && !enabled) errors.push("ENABLE_TELEGRAM requires ENABLE_COPILOT_INTEGRATIONS=true.");
  const secretUri = (name) => {
    try {
      const url = new URL(environment[name]);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".vault.azure.net") || !/^\/secrets\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname)) throw new Error();
    } catch { errors.push(`${name} must be an Azure Key Vault secret URI.`); }
  };
  if (enabled && !telegram && !environment.COPILOT_CLIENTS_KEY_VAULT_URL) errors.push("Provide COPILOT_CLIENTS_KEY_VAULT_URL for external clients.");
  if (environment.COPILOT_CLIENTS_KEY_VAULT_URL) secretUri("COPILOT_CLIENTS_KEY_VAULT_URL");
  if (!!environment.COPILOT_ENTRA_TENANT_ID !== !!environment.COPILOT_ENTRA_AUDIENCE) errors.push("Set both COPILOT_ENTRA_TENANT_ID and COPILOT_ENTRA_AUDIENCE.");
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
  else console.log("Integration deployment settings validated.");
}