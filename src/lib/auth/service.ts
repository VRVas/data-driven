import "server-only";
import { resolvePermissions } from "./effective";
import { EMPTY_ASSIGNMENT, type Profile } from "./profiles";
import { apiKeyMatches } from "./api";
import { getAuthzContext } from "./resolve";
import type { PermissionKey, PermissionMap } from "./catalogue";
import type { SessionUser } from "./guards";
import type { AuthzContext } from "./resolve";

/**
 * The identity behind the shared COPILOT_API_KEY — the Foundry agent asking
 * questions about the pipeline over the OpenAPI channel.
 *
 * It is a fixed, code-defined principal rather than a row in the user store:
 * nobody can widen it by editing a profile in the admin UI, and it cannot be
 * assigned to a person by mistake.
 */
export const COPILOT_SERVICE_USER: SessionUser = {
  id: "copilot-service",
  name: "Copilot Service",
  email: "",
  role: "member",
};

/**
 * Read-only, and narrower than any human profile.
 *
 * Everything omitted is omitted on purpose: no writes, because a shared key
 * carries no accountability and the audit trail would name a robot; no
 * export:*, because bulk extraction is the thing a leaked key would be used
 * for; no websearch or documents, because those spend money and reach outside
 * the building; no audit/user/profile reads, because a pipeline question never
 * needs to know who works here.
 */
const SERVICE_KEYS: readonly PermissionKey[] = [
  "lead:read",
  "proposal:read",
  "outreach:read",
  "reminder:read",
  "scoring:read",
  "industry:read",
  "tam:read",
  "quality:read",
  "copilot:use",
];

const SERVICE_PROFILE: Profile = {
  id: "copilot-service",
  name: "Copilot service",
  description: "Read-only pipeline access for the API-key channel.",
  // Org-wide: the integration answers for the whole pipeline, and there is no
  // person whose "own" records it could otherwise mean.
  permissions: Object.fromEntries(SERVICE_KEYS.map((k) => [k, "all"])) as PermissionMap,
  system: true,
};

const SERVICE_CONTEXT: AuthzContext = {
  user: COPILOT_SERVICE_USER,
  effective: resolvePermissions([SERVICE_PROFILE], EMPTY_ASSIGNMENT),
  superuser: false,
  profileIds: [SERVICE_PROFILE.id],
  teamIds: [],
};

/** The authorization context for a caller that presented a valid API key. */
export function copilotServicePrincipal(): AuthzContext {
  return SERVICE_CONTEXT;
}

/**
 * Who is calling the copilot API, or null if nobody proved anything.
 *
 * The session is tried first so a signed-in caller is judged as themselves
 * even if they also send the shared key — otherwise anyone holding it could
 * launder their own actions through the service identity.
 */
export async function copilotCaller(apiKeyHeader: string | null): Promise<AuthzContext | null> {
  const session = await getAuthzContext();
  if (session) return session;
  return apiKeyMatches(apiKeyHeader, process.env.COPILOT_API_KEY) ? SERVICE_CONTEXT : null;
}
