import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { validateIntegrationEnvironment } from "./validate-integrations.mjs";

function execute(command, args, { capture = false, environment = process.env } = {}) {
  const result = spawnSync(command, args, { env: environment, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} did not complete successfully. Check authentication, prerequisites, and the preceding output.`);
  return result.stdout ?? "";
}

export async function deploy(options = {}, run = execute, environment = process.env, verify = verifyDeployment) {
  const unattended = options.noPrompt || environment.CI === "true";
  if (environment.CI === "true") {
    for (const name of ["AUTH_SECRET", "DATA_RECOVERY_KEY"]) {
      if ((environment[name]?.length ?? 0) < 32) throw new Error(`CI requires a stable ${name} secret with at least 32 characters.`);
    }
  }
  run("azd", ["version"], { capture: true, environment });
  run("bash", ["--version"], { capture: true, environment });
  run("python3", ["--version"], { capture: true, environment });
  run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true, environment });
  const account = JSON.parse(run("az", ["account", "show", "--output", "json"], { capture: true, environment }));
  const environments = JSON.parse(run("azd", ["env", "list", "--output", "json"], { capture: true, environment }));
  const name = options.environment ?? environment.AZURE_ENV_NAME ?? environments.find((entry) => entry.IsDefault)?.Name;
  if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error("Choose an environment with --environment NAME.");
  run("azd", ["config", "set", "auth.useAzCliAuth", "true"], { capture: true, environment });
  if (!environments.some((entry) => entry.Name === name)) {
    run("azd", ["env", "new", name, "--subscription", options.subscription ?? environment.AZURE_SUBSCRIPTION_ID ?? account.id,
      "--location", options.location ?? environment.AZURE_LOCATION ?? "northeurope", "--no-prompt"], { environment });
  }
  const selected = ["--environment", name];
  const stored = parseEnv(run("azd", ["env", "get-values", ...selected], { capture: true, environment }));
  for (const [setting, requested] of [
    ["AZURE_SUBSCRIPTION_ID", options.subscription ?? environment.AZURE_SUBSCRIPTION_ID],
    ["AZURE_LOCATION", options.location ?? environment.AZURE_LOCATION],
    ["AI_LOCATION", environment.AI_LOCATION],
  ]) {
    if (requested && stored[setting] && requested !== stored[setting]) throw new Error(`The existing environment has a different ${setting}. Create a new environment instead.`);
  }
  const subscription = stored.AZURE_SUBSCRIPTION_ID ?? options.subscription ?? environment.AZURE_SUBSCRIPTION_ID ?? account.id;
  run("az", ["account", "set", "--subscription", subscription], { capture: true, environment });
  const group = `rg-${name}`;
  if (run("az", ["group", "exists", "--name", group], { capture: true, environment }).trim() === "true") {
    const location = run("az", ["group", "show", "--name", group, "--query", "location", "--output", "tsv"], { capture: true, environment }).trim();
    if (stored.AZURE_LOCATION && location !== stored.AZURE_LOCATION) throw new Error("The resource group belongs to a different location. Reuse its original deployment settings.");
    const apps = JSON.parse(run("az", ["resource", "list", "--resource-group", group, "--resource-type", "Microsoft.App/containerApps", "--query", "[?tags.\"azd-service-name\"=='web'].name", "--output", "json"], { capture: true, environment }));
    if (apps.length > 1) throw new Error("Multiple web services exist in this resource group; reconcile the deployment target first.");
    if (apps.length === 1) {
      const image = run("az", ["containerapp", "show", "--name", apps[0], "--resource-group", group, "--query", "properties.template.containers[0].image", "--output", "tsv"], { capture: true, environment }).trim();
      if (!image) throw new Error("Cannot determine the deployed image; refusing to replace it with a placeholder.");
      run("azd", ["env", "set", "SERVICE_WEB_IMAGE_NAME", image, ...selected], { capture: true, environment });
    }
  }
  const parameters = JSON.parse(readFileSync(new URL("../infra/main.parameters.json", import.meta.url), "utf8")).parameters;
  const reserved = new Set(["AZURE_ENV_NAME", "AZURE_LOCATION", "AZURE_PRINCIPAL_ID", "SERVICE_WEB_IMAGE_NAME"]);
  for (const parameter of Object.values(parameters)) {
    const match = /^\$\{([A-Z0-9_]+)(?:=[^}]*)?\}$/.exec(parameter.value);
    if (match && !reserved.has(match[1]) && environment[match[1]]) run("azd", ["env", "set", match[1], environment[match[1]], ...selected], { capture: true, environment });
  }
  const values = parseEnv(run("azd", ["env", "get-values", ...selected], { capture: true, environment }));
  const errors = validateIntegrationEnvironment(values);
  if (errors.length) throw new Error(errors.join("\n"));
  run("azd", ["hooks", "run", "preprovision", ...selected], { environment });
  run("azd", ["up", ...selected, ...(unattended ? ["--no-prompt"] : [])], { environment });
  run("azd", ["hooks", "run", "postprovision", ...selected], { environment });
  const deployed = parseEnv(run("azd", ["env", "get-values", ...selected], { capture: true, environment }));
  await verify(deployed.WEB_URI);
  return { environment: name, url: deployed.WEB_URI };
}

export async function verifyDeployment(origin, fetchImpl = fetch, { attempts = 12, pause = delay } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("The deployed endpoint must be an HTTPS origin.");
  for (const route of ["/api/health", "/recovery"]) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const response = await fetchImpl(new URL(route, url.origin), { redirect: "error", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`Deployment verification failed for ${route} (HTTP ${response.status}).`);
        if (route === "/api/health") {
          if ((await response.json()).status !== "ok") throw new Error("The deployment readiness check failed.");
        } else await response.arrayBuffer();
        break;
      } catch (error) {
        if (attempt + 1 === attempts) throw error;
        await pause(5000);
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { environment: { type: "string" }, subscription: { type: "string" }, location: { type: "string" }, "no-prompt": { type: "boolean", default: false } } });
    const result = await deploy({ ...values, noPrompt: values["no-prompt"] });
    console.log(`Deployment verified: ${result.url}/recovery (${result.environment}).`);
  } catch (error) { console.error(error instanceof Error ? error.message : "Deployment failed."); process.exitCode = 1; }
}