import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { getUserStore } from "@/lib/store/users";
import { getProfileStore } from "@/lib/store/profiles";
import { SYSTEM_PROFILES } from "@/lib/auth/profiles";
import { assignmentForLegacyRole, type AuthzContext } from "@/lib/auth/resolve";
import { can, resolvePermissions, scopeFor } from "@/lib/auth/effective";
import { isPermissionKey, PERMISSION_KEYS, type PermissionKey, type PermissionMap, type Scope } from "@/lib/auth/catalogue";
import { IntegrationError, type IdentityRef, type IntegrationDocument, type IntegrationScope } from "./contracts";
import { integrationStore } from "./store";

const scopes = ["copilot:read", "copilot:propose", "copilot:approve"] as const;
const ClientSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  tokenSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  entraAppId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
  scopes: z.array(z.enum(scopes)).default(["copilot:read"]),
  permissions: z.record(z.enum(["none", "own", "team", "all"])).default({ "copilot:use": "all" }),
  allowedTools: z.array(z.string().min(1)).optional(),
  delegatedUsers: z.record(z.string().min(1)).default({}),
  requestsPerMinute: z.number().int().min(1).max(300).default(30),
}).strict();
export type IntegrationClient = z.infer<typeof ClientSchema>;

export interface ExternalCaller {
  identity: IdentityRef;
  principal: AuthzContext;
  owner: string;
  scopes: IntegrationScope[];
  allowedTools?: string[];
  requestsPerMinute: number;
}

export interface TelegramLink extends IntegrationDocument {
  kind: "telegram-link";
  userId: string;
  telegramUserId: string;
  name: string;
  state: "active" | "revoked";
}

export const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
export const ownerKey = (identity: IdentityRef): string => digest(JSON.stringify([identity.channel, identity.clientId, identity.userId ?? null, identity.subject ?? null])).slice(0, 40);

export function configuredClients(): IntegrationClient[] {
  let parsed: unknown;
  try { parsed = JSON.parse(process.env.COPILOT_CLIENTS_JSON ?? "[]"); }
  catch { throw new IntegrationError(503, "configuration_error", "Integration clients are not configured correctly."); }
  const validated = z.array(ClientSchema).max(100).safeParse(parsed);
  if (!validated.success || new Set(validated.success ? validated.data.map((client) => client.id) : []).size !== (validated.success ? validated.data.length : -1)) {
    throw new IntegrationError(503, "configuration_error", "Integration clients are not configured correctly.");
  }
  for (const client of validated.data) {
    if (Object.keys(client.permissions).some((key) => !isPermissionKey(key))) {
      throw new IntegrationError(503, "configuration_error", "An integration uses an unknown permission.");
    }
  }
  const applications = validated.data.flatMap((client) => client.entraAppId ? [client.entraAppId] : []);
  if (new Set(applications).size !== applications.length) throw new IntegrationError(503, "configuration_error", "Each Entra application must identify exactly one integration client.");
  return validated.data;
}

export async function storedUserPrincipal(userId: string): Promise<AuthzContext> {
  const user = await getUserStore().findById(userId);
  if (!user || user.active === false) throw new IntegrationError(403, "account_unavailable", "The linked account is not active.");
  const assignment = user.assignment ?? assignmentForLegacyRole(user.role);
  const profiles = new Map(SYSTEM_PROFILES.map((profile) => [profile.id, profile]));
  for (const profile of await getProfileStore().list()) profiles.set(profile.id, profile);
  const assigned = assignment.profileIds.map((id) => profiles.get(id));
  if (assigned.some((profile) => !profile)) throw new IntegrationError(403, "profile_unavailable", "A linked permission profile is not available.");
  const effective = resolvePermissions(assigned.filter((profile) => profile !== undefined), assignment);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    effective, superuser: effective.superuser, profileIds: assignment.profileIds, teamIds: [],
  };
}

function clientById(id: string): IntegrationClient {
  const client = configuredClients().find((entry) => entry.id === id);
  if (!client || !client.enabled || (client.expiresAt && Date.parse(client.expiresAt) <= Date.now())) {
    throw new IntegrationError(401, "unauthorized", "The integration is not authorized.");
  }
  return client;
}

function restrictUser(principal: AuthzContext, permissions: PermissionMap): AuthzContext {
  const order: Scope[] = ["none", "own", "team", "all"];
  const narrowed: PermissionMap = {};
  for (const key of PERMISSION_KEYS) {
    const scope = order[Math.min(order.indexOf(scopeFor(principal.effective, key)), order.indexOf(permissions[key] ?? "none"))];
    if (scope !== "none") narrowed[key] = scope;
  }
  return { ...principal, superuser: false, effective: { superuser: false, permissions: narrowed } };
}

export function telegramPartition(): string {
  const botId = process.env.TELEGRAM_BOT_TOKEN?.split(":")[0];
  if (!botId || !/^\d+$/.test(botId)) throw new IntegrationError(503, "telegram_unavailable", "Telegram is not configured.");
  return `telegram:${botId}`;
}

export async function resolveIdentity(identity: IdentityRef): Promise<ExternalCaller> {
  if (process.env.COPILOT_EXTERNAL_ENABLED !== "true") throw new IntegrationError(503, "integration_disabled", "The external copilot is disabled.");
  if (identity.kind === "telegram") {
    if (process.env.TELEGRAM_ENABLED !== "true" || identity.clientId !== telegramPartition()) {
      throw new IntegrationError(403, "telegram_unavailable", "Telegram access is disabled.");
    }
    const link = await integrationStore().get<TelegramLink>(identity.clientId, `user:${identity.subject}`);
    const settings = identity.userId ? await integrationStore().get<IntegrationDocument & { telegramUserId?: string }>(identity.clientId, `settings:${identity.userId}`) : null;
    if (!link || link.state !== "active" || link.userId !== identity.userId || settings?.telegramUserId !== identity.subject) {
      throw new IntegrationError(403, "account_unlinked", "Link Telegram to your app account before using the copilot.");
    }
    const principal = await storedUserPrincipal(link.userId);
    return { identity, principal, owner: ownerKey(identity), scopes: [...scopes], requestsPerMinute: 20 };
  }
  const client = clientById(identity.clientId);
  let principal: AuthzContext;
  if (identity.userId) {
    if (!identity.subject || client.delegatedUsers[identity.subject] !== identity.userId) {
      throw new IntegrationError(403, "delegation_revoked", "This integration cannot act for that user.");
    }
    principal = restrictUser(await storedUserPrincipal(identity.userId), client.permissions as PermissionMap);
  } else {
    principal = {
      user: { id: `integration:${client.id}`, name: client.name, email: "", role: "member" },
      effective: { permissions: client.permissions as PermissionMap, superuser: false },
      superuser: false, profileIds: [], teamIds: [],
    };
  }
  return { identity, principal, owner: ownerKey(identity), scopes: client.scopes, allowedTools: client.allowedTools, requestsPerMinute: client.requestsPerMinute };
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function externalPermission(permission: PermissionKey, request: Request, channel: "api" | "a2a"): Promise<ExternalCaller> {
  if (process.env.COPILOT_EXTERNAL_ENABLED !== "true") throw new IntegrationError(503, "integration_disabled", "The external copilot is disabled.");
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]{20,16384})$/.exec(authorization);
  if (!match) throw new IntegrationError(401, "unauthorized", "A bearer access token is required.");
  const token = match[1];
  let identity: IdentityRef;
  if (token.startsWith("copilot.ext.")) {
    const parts = token.split(".");
    const client = clientById(parts[2] ?? "");
    const expected = client.tokenSha256;
    if (parts.length !== 4 || !expected || !timingSafeEqual(Buffer.from(digest(token), "hex"), Buffer.from(expected, "hex"))) {
      throw new IntegrationError(401, "unauthorized", "The integration is not authorized.");
    }
    identity = { kind: "client", clientId: client.id, channel };
  } else {
    const tenant = process.env.COPILOT_ENTRA_TENANT_ID;
    const audience = process.env.COPILOT_ENTRA_AUDIENCE;
    if (!tenant || !z.string().uuid().safeParse(tenant).success || !audience) throw new IntegrationError(401, "unauthorized", "Entra authentication is not configured.");
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    let keys = keySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
      keySets.set(issuer, keys);
    }
    try {
      const { payload } = await jwtVerify(token, keys, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "tid"] });
      if (payload.tid !== tenant) throw new Error("Tenant mismatch");
      const client = configuredClients().find((entry) => entry.entraAppId === payload.azp);
      if (!client) throw new Error("Unknown client");
      const required = process.env.COPILOT_ENTRA_ROLE ?? "Copilot.Invoke";
      if (typeof payload.scp === "string") {
        if (!payload.scp.split(" ").includes(required) || typeof payload.oid !== "string" || !client.delegatedUsers[payload.oid]) throw new Error("Missing delegation");
        identity = { kind: "client", clientId: client.id, channel, subject: payload.oid, userId: client.delegatedUsers[payload.oid] };
      } else {
        if (!Array.isArray(payload.roles) || !payload.roles.includes(required)) throw new Error("Missing application role");
        identity = { kind: "client", clientId: client.id, channel };
      }
    } catch {
      throw new IntegrationError(401, "unauthorized", "The access token could not be verified for this integration.");
    }
  }
  const caller = await resolveIdentity(identity);
  requireExternalScope(caller, "copilot:read");
  if (!can(caller.principal.effective, permission)) throw new IntegrationError(403, "forbidden", "The integration lacks the required permission.");
  return caller;
}

export function requireExternalScope(caller: ExternalCaller, scope: IntegrationScope): void {
  if (!caller.scopes.includes(scope)) throw new IntegrationError(403, "insufficient_scope", `The ${scope} scope is required.`);
}