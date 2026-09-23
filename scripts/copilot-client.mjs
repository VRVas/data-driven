import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { id: { type: "string" }, name: { type: "string" }, output: { type: "string" } } });
if (!values.id || !/^[A-Za-z0-9_-]{1,64}$/.test(values.id) || !values.output) throw new Error("Use --id CLIENT_ID --output PRIVATE_TOKEN_FILE [--name NAME].");
const token = `copilot.ext.${values.id}.${randomBytes(32).toString("base64url")}`;
writeFileSync(values.output, `${token}\n`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ id: values.id, name: values.name ?? values.id, enabled: true, tokenSha256: createHash("sha256").update(token).digest("hex"), scopes: ["copilot:read"],
  permissions: { "copilot:use": "all", "lead:read": "all", "scoring:read": "all" }, allowedTools: ["search_leads", "get_lead", "explain_score", "pipeline_summary"], requestsPerMinute: 30 }, null, 2));
console.error("Token written to the private file. Add the printed configuration object to the authorized clients array after reviewing its grants.");