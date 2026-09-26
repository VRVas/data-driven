# Data & Recovery

The administrator workflow is available at `/recovery`, linked from Team when the current account has `data:backup`. It works independently of the normal dashboard session so it can initialize an empty environment or recover one whose imported accounts differ from the previous accounts.

The short workflow is: unlock, upload a package, review the validation report, type the displayed confirmation, then wait for verified activation. A failed import never deletes the previous active dataset.

## What Is Implemented

| Operation | Result |
| --- | --- |
| Initialize from backup | Validates a package, stages a new dataset, and activates it in an empty environment |
| Full dataset replacement | Replaces accounts, profiles, business data, and retained history, subject to the safety transformations below |
| CRM-only import | Replaces business records while preserving the current accounts, profiles, and audit history |
| Built-in dataset | Seeds the bundled lead/agent dataset; an empty environment also requires an initial administrator account |
| Encrypted backup | Briefly fences normal data operations, reads and verifies the active dataset, then offers a password-encrypted download |
| Rollback | Reads the retained previous dataset and imports it through the same validation/staging workflow |
| Pre-operation download | Exports the recovery copy created before a backup or replacement, encrypted with a newly supplied download password |
| Delivery activation | Explicitly enables or pauses outbound delivery and external copilot processing |

This is an application-level logical backup and restore system for one NoSQL database. It is not Azure's native periodic or point-in-time restore service, an account clone, or a complete backup of every Azure resource.

## New Environment

Provision using the repository's Bicep and normal azd procedure. Recovery is enabled by default in the deployment parameters. The preprovision script generates `DATA_RECOVERY_KEY` and `AUTH_SECRET` once when absent, then preserves them on subsequent deployments.

When the baseline database has no records, the recovery state is `setup`. Normal login, signup, automatic lead/agent seeding, and background data operations do not initialize it implicitly. Open `/recovery` and authenticate with the environment recovery key provided by the deployment owner.

Choose either:

1. Upload a valid backup, select Full dataset, and review the imported accounts and record counts.
2. Select Built-in dataset and provide the initial administrator name, email, and password.

Type `INITIALIZE` to confirm. The server writes to a new staging database, reads it back, compares the expected contents and policies, and switches the active-dataset pointer only after verification. Sign in with an account present in the imported dataset. Password hashes are preserved, so the account's existing password remains valid unless the operator deliberately resets it later.

Delivery remains paused after initialization. Review the new environment's mail, Telegram, model, and external-client configuration before enabling delivery. Keep source and destination environment credentials separate.

The first upload does not require a user to exist inside the empty application database. It requires the independent environment recovery key. No public first-user claim can bypass this initialization flow while recovery is enabled.

## Existing Environment

Enabling recovery on a populated database adopts the current database as the active dataset without reseeding or replacing its records. Existing delivery remains enabled until explicitly paused or until a replacement completes.

An administrator opens Team, selects Data & Recovery, and reauthenticates using their email/password. A normal logged-in session is insufficient. The environment owner can instead use the recovery key.

Upload a package and choose Full dataset or CRM-only. Validation does not change the active dataset. The report shows the destination, container counts, safety transformations, and relationship warnings. Type the exact `REPLACE <active-database>` phrase to confirm.

During the operation the app fences normal dataset access and waits for admitted operations to finish. It creates an encrypted pre-operation package and retains the previous database. The replacement is written into a fresh database, not over the live one. Successful activation advances the dataset generation and invalidates existing dashboard sessions.

Administrator recovery sessions also require reauthentication after a dataset switch. Recovery-key sessions remain valid until their normal expiry or key rotation, so the environment owner can inspect an operation even if the old account is absent from the imported database.

CRM-only imports preserve users, profiles, and audit as they exist when execution begins after maintenance, not a stale preview copy. Notes, leads, agents, industries, and the CRM overlay come from the uploaded package. Personal views, conversations, document links, reminders, notifications, outreach, and integration queues are cleared in this mode.

## Safety Transformations

A backup download preserves the active database's documents. Import is deliberately more selective. The report must be reviewed before activation:

| Data | Import behavior |
| --- | --- |
| Document `id` and partition-key values | Preserved |
| Cosmos `_rid`, `_self`, `_etag`, `_attachments`, `_ts` | Removed from write payloads; Cosmos regenerates them |
| Users and password hashes | Preserved in full mode; current users retained in CRM-only mode |
| Profiles | Validated against assigned profile IDs; at least one active administrator must remain |
| Lead-linked notes, comments, and CRM records | Rejected if their referenced lead is absent |
| Other historical user references | Reported as warnings when the referenced user is absent |
| `authChallenges` | Cleared; old reset links and OTPs cannot be reactivated |
| `copilotIntegrations` | Cleared; tasks, callbacks, Telegram links and delivery work must not replay |
| `documents` | Cleared; Foundry file/vector-store references do not migrate the external files |
| Scheduled/sending/failed reminders | Changed to cancelled for review |
| Unsent outreach | Changed to cancelled; sent history remains history |
| Positive TTL | Expired records omitted; remaining lifetime calculated from the source timestamp |
| Stored procedures, triggers, UDFs | Downloaded for preservation, but packages containing executable scripts require an operator-reviewed migration and are refused by the UI importer |

A tarball containing arbitrary JSON is not accepted. It must use the supported manifest and container format. A backup checksum establishes integrity, not the trustworthiness of its author. Only upload packages from a trusted source with the authority to replace the resulting users and permissions.

No script from an uploaded archive is executed. No file is extracted using an archive-provided path. Links, path traversal, duplicate files, missing files, invalid JSON, altered checksums, incompatible partition keys, duplicate document identities, and invalid account relationships are rejected before activation.

## Permissions and Recovery Access

`data:backup` grants access to database exports containing all users, password hashes, private conversations, and CRM records. It is substantially broader than CSV export permission.

`data:restore` grants replacement, initialization, rollback, and delivery-control authority. Standard administrator profiles include both permissions. Other profiles must be deliberately granted the required capabilities; ordinary members are denied.

Recovery sessions are random 256-bit capabilities stored as hashes in the independent control database. Cookies are HttpOnly, SameSite Strict, and Secure with the `__Host-` prefix in production. Sessions expire after 30 minutes. Mutations require the exact configured application origin. Authentication attempts and session requests are rate-limited through conditional durable counters.

Administrator sessions are bound to the dataset generation and password hash. While the app is active, the server rechecks the user's active state and current permissions. During maintenance, admitted recovery capability remains available because ordinary permission edits are fenced. Recovery-key sessions are bound to the configured key hash and stop working when the key changes.

Protect `DATA_RECOVERY_KEY` as a high-privilege recovery credential. It is never displayed by the application, stored in browser local storage, sent to a model, or included in a backup download. Obtain it through the deployment owner's approved secret-management procedure. Do not paste it into an AI conversation or a shared terminal log.

## Durable State and Activation

The control database defaults to `<COSMOS_DATABASE>-recovery`, usually `bd-recovery`. Its `operations` container uses `/partitionKey` and has per-item TTL enabled. The dataset being replaced never contains the active-dataset pointer or the recovery operation records.

The state record includes the active and previous dataset IDs, dataset generation, setup/ready/maintenance mode, delivery gate, current operation, worker lease, and admitted data activities. Cosmos ETag conditional replacement serializes state transitions.

Each replacement uses a `restore-<UUID>` database. The existing store API is routed to the selected dataset underneath the normal application stores. Replicas consult shared recovery state and do not need a process restart to select the new database.

Workers poll approximately every 1.5 seconds. An operation lease lasts 90 seconds and is refreshed every 15 seconds. A worker that loses its lease cannot activate. A restarted attempt uses a fresh staging database so a previous worker cannot continue copying into the dataset the replacement worker will publish.

Normal dataset operations are registered with a bounded activity lifetime and cancellation signal. Maintenance denies new operations and waits for admitted work to drain. Cancellation and activation compete against the same control state: cancellation that wins leaves the active dataset unchanged; activation that wins must be undone through a reviewed rollback.

The pre-operation package is verified before staging begins. After staging, read-back verification compares document counts/content, partition paths, and relevant container policies. The state-pointer change is the application cutover. Cross-container imports themselves are not a Cosmos transaction.

Only writes through the current application participate in the maintenance fence. An external script, older app revision, or other direct database writer can still modify a database. Quiesce those writers before backup or replacement. Azure automatic TTL deletion also runs independently. Do not describe the package as an account-wide atomic point-in-time snapshot.

## Encryption and Retention

Downloads use authenticated AES-256-GCM encryption, with a random salt and nonce and a scrypt-derived key from the download password. The file begins with the `OOVIEBK1` envelope and otherwise contains the compressed tarball. Use at least 12 characters for the backup password. There is no password-recovery mechanism for an encrypted download.

The importer also accepts the original unencrypted operator `.tar.gz` archive. Such a file remains sensitive and is not made safe by compression alone.

Uploaded packages, prepared plans, backup outputs, and pre-operation packages are encrypted before storage in the recovery control container and split into bounded chunks. Their storage key is derived from the environment's stable `AUTH_SECRET`. Rotating that secret makes existing stored artifacts unreadable, although already-downloaded password-encrypted archives remain usable with their download password.

Stored package artifacts expire after seven days. Operation metadata and retained databases are not automatically deleted. The UI retains the previous dataset pointer, and each operation records its own destination. Keep encrypted downloaded packages outside the app for long-term retention. Administrative cleanup of older staged databases requires a separate operator procedure; the app's management identity has no delete permission.

## Deployment Configuration

| Setting | Purpose |
| --- | --- |
| `ENABLE_DATA_RECOVERY` | azd/Bicep flag, default true |
| `DATA_RECOVERY_KEY` | Secure deployment parameter generated once by preprovision |
| `DATA_RECOVERY_ENABLED` | Runtime flag emitted by Bicep |
| `COSMOS_CONTROL_DATABASE` | Independent control database name |
| `COSMOS_RESOURCE_ID` | Allowlisted destination account resource ID, derived by Bicep |
| `RECOVERY_MANAGED_IDENTITY_CLIENT_ID` | Dedicated identity used for management-plane staging database/container operations |
| `COSMOS_ENDPOINT`, `COSMOS_DATABASE` | Existing account and baseline database |
| `AUTH_SECRET` | Existing application session secret, also used to derive stored-artifact encryption |
| `APP_DATA_DIR` | Development-only alternate directory for isolated test data; not needed in Azure |

The existing app identity continues to handle Cosmos data-plane reads and writes. A separate attached user-assigned identity receives a custom management role scoped to this Cosmos account. That role permits account/database/container reads and database/container creation or updates. It does not permit account-key access, database deletion, role assignment, or network reconfiguration.

Cosmos remains private and local account-key authentication stays disabled. The server performs import inside its existing private network. The browser only talks to the application's authenticated HTTPS endpoints.

The preprovision script generates missing environment secrets without printing their values. Because this repository has observed azd versions that do not automatically execute hooks, run the preprovision hook explicitly when preparing a new environment:

```bash
azd hooks run preprovision
az bicep build --file infra/main.bicep --outfile /tmp/data-driven-recovery-template.json
azd up
azd hooks run postprovision
```

The existing postprovision hook configures Foundry resources; it does not seed or restore Cosmos data. CI deployments must supply stable `AUTH_SECRET` and `DATA_RECOVERY_KEY` secrets. Do not generate a different value on every CI deployment.

Deploy a recovery-aware image and control database before using the page. Do not disable `DATA_RECOVERY_ENABLED` after a dataset switch as an emergency rollback: a disabled router would use the baseline database instead of the selected replacement. Use the recovery workflow or an explicit reviewed configuration migration.

## API and Source Map

| Endpoint | Use |
| --- | --- |
| `POST /api/admin/recovery/session` | Fresh administrator or environment-key authentication |
| `DELETE /api/admin/recovery/session` | Revoke the current recovery session |
| `GET /api/admin/recovery` | Authorized environment status and recent operations |
| `POST /api/admin/recovery/upload` | Bounded multipart package upload and validation preview |
| `POST /api/admin/recovery/backup` | Queue a password-encrypted backup |
| `POST /api/admin/recovery` | Confirm, cancel, review built-in seeding/rollback, or change delivery state |
| `GET /api/admin/recovery/jobs/{id}/download` | Completed encrypted backup |
| `POST /api/admin/recovery/jobs/{id}/download` | Encrypt and download the pre-operation package with a supplied password |

The implementation is in [../src/lib/recovery/package.ts](../src/lib/recovery/package.ts), [../src/lib/recovery/control.ts](../src/lib/recovery/control.ts), [../src/lib/recovery/datasets.ts](../src/lib/recovery/datasets.ts), [../src/lib/recovery/policy.ts](../src/lib/recovery/policy.ts), [../src/lib/recovery/jobs.ts](../src/lib/recovery/jobs.ts), and [../src/lib/recovery/auth.ts](../src/lib/recovery/auth.ts). Routing is in [../src/lib/recovery/routing.ts](../src/lib/recovery/routing.ts); UI is [../src/components/recovery/RecoveryConsole.tsx](../src/components/recovery/RecoveryConsole.tsx).

Do not expose these operations as copilot tools or allow a model to approve recovery. Uploading a package and confirming its replacement are separate human-authorized operations.

## Limits and Verification

The isolated recovery browser suite uses Turbopack and warms its API routes before
polling starts. This avoids a reproduced Next.js development-manifest read race;
the normal production build is validated separately.

Current limits: one database per package, up to 100 containers and 200,000 documents, 32 MiB compressed upload, 128 MiB expanded archive, and at most 2,500 tar entries. This is a bounded administrative workflow, not a bulk-migration service for multi-gigabyte databases. Large deployments need a streaming artifact store and a dedicated worker design before raising these limits.

Run the focused unit tests:

```bash
npx vitest run test/recovery-package.test.ts test/recovery-control.test.ts test/recovery-datasets.test.ts test/recovery-jobs.test.ts test/recovery-auth.test.ts
npm run typecheck
npm run test:recovery
```

The recovery browser suite uses a separate development server and an isolated `.data/recovery-e2e` directory. It initializes from a tarball, checks member denial, downloads/decrypts a backup, replaces existing data, tests stale-session rejection, and performs rollback. It does not use real customer data. Do not run another Next.js server/build or edit source while it is executing.

An optional fixture check validates an existing archive without importing it:

```bash
RECOVERY_PACKAGE_FIXTURE=/absolute/path/to/backup.tar.gz npx vitest run test/recovery-package.test.ts
```

The opt-in Cosmos emulator test exercises real ETags, encrypted control records, item writes, query routing, and staged activation. Its management SDK calls are adapted to the emulator's local database/container provisioning; it does not prove Azure management-plane RBAC:

```bash
docker run --rm --name oovie-recovery-cosmos-test --publish 127.0.0.1:8081:8081 --publish 127.0.0.1:8080:8080 --env ENABLE_EXPLORER=false --env ENABLE_TELEMETRY=false mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-latest
```

In another terminal, once the emulator is ready:

```bash
curl --fail http://127.0.0.1:8080/ready
RECOVERY_COSMOS_EMULATOR_ENDPOINT=http://127.0.0.1:8081 npx vitest run test/recovery-cosmos.test.ts
docker stop oovie-recovery-cosmos-test
```

Before a production rollout, validate the actual managed identities, private network, custom management role, multi-replica fencing, source package compatibility, and rollback on the target Azure environment. An emulator pass does not replace those checks.

### Verified Test Deployment

On 2026-09-23, the recovery-aware app was provisioned and deployed to the existing Azure test environment. The deployed browser workflow authenticated with the independent recovery key and completed:

- An encrypted backup of 17 containers and 297 documents through the private Cosmos connection. The downloaded archive was decrypted and verified locally against its manifest.
- Upload, validation, typed confirmation, managed-identity staging, read-back verification, and activation of that package.
- Review and execution of rollback from the retained prior dataset, through the same staging and verification path.
- Anonymous recovery API denial and desktop/mobile rendering checks.

Both replacements retained the source databases. The resulting application data includes the original users, business records, notes, and conversations. Two `documents` registry records were omitted by the documented import policy because external Foundry file references are not portable. The original database and encrypted pre-operation package retain those references for operator review. Outbound delivery remains paused after the live checks.

Empty-environment initialization, member denial, stale-session invalidation and reauthentication, malformed uploads, cancellation, worker lease loss, and CRM-only account preservation were also exercised in the isolated browser/unit suites. The Cosmos emulator exercised the recovery engine against real conditional writes and item storage. Concurrent worker contention was tested, but a deliberate failover between multiple live Container App replicas was not performed.

The original broad regression was interrupted by a Codespace/browser crash. Its remaining functional tests and affected audit views were resumed in bounded batches with recovery enabled. Save verification output in an ignored workspace directory, not only `/tmp`, so a Codespace restart does not lose the checkpoint.

### Encrypted Restore Follow-up

The diagnostics build at commit `b1c7694` was deployed to the segregated
`datadriven` Azure test environment. The encrypted September 25 archive was
uploaded through `/recovery`, decrypted with its separate backup password,
reviewed and confirmed using the environment recovery key. Operation
`30494ea8-4067-4d7c-af64-68904c0d8127` completed on September 25 at 15:15:31 UTC.
The September 26 continuation checked that completed operation instead of
repeating the import.

- Source archive SHA-256: `5c1993777be0e9f0bf89bec73fe22f77007168a368c7a3fbb754cf0b53296efc`.
- Activated dataset: `restore-78e8e685-4d7c-4ce4-aa8b-8a507995dfc1`, epoch 3.
- Previous dataset retained: `restore-a2c123e2-aaec-4b17-86ff-c07d3a0d3dba`.
- A fresh post-restore export contained 17 containers and 296 documents. Every
	container's portable document hash, partition paths and retained policies
	matched the uploaded archive. Only Cosmos-generated document fields were
	excluded from the content comparison.
- The pre-operation backup remained available. A restored account signed in with
	its existing password and received a session at epoch 3. Pipeline and agents
	pages displayed 69 leads and 13 agents without browser exceptions.
- The recovery page passed desktop/mobile overflow checks, and both deployed
	health and recovery endpoints passed verification. Mode remained `ready` and
	outbound delivery remained paused.

No restore-worker failure occurred in this run, including the agents document
and script-metadata reads. This establishes that this archive restores on the
updated test deployment; it does not identify the discarded exception from the
earlier reported failure or prove another deployment has the same configuration.
The pre-operation backup was checked for availability, but rollback and forced
multi-replica failover were not repeated in this run. Private screenshots, the
comparison report and the post-restore export remain Git-ignored.

## Troubleshooting

### Failed Background Operations

An initial `GET /api/admin/recovery` returning 401 is expected before recovery is
unlocked. After unlocking, that endpoint returns 200 while polling operation
status. A 200 means the status request succeeded, not that the background import
succeeded. Inspect `jobs` in the response for `status: "failed"`.

In the recovery page, select the failed entry under Recent operations. Record its
operation ID, timestamp, progress, source and staging dataset. New failures also
include diagnostic fields for the error type, service code, HTTP status, Cosmos
substatus, Azure request/activity IDs and nested cause codes when the SDK provides
them. Filtered code locations identify application files and line/column positions
without including the exception message or remote URLs. Request bodies, headers,
raw exception messages, credentials and document contents are not logged.

Read application logs in Azure Portal: Container App > Monitoring > Log stream >
Console. Select the relevant revision, replica and `web` container. A worker can
run on a different replica from the one serving browser requests, so inspect all
active replicas or use the collected Log Analytics console logs. From the CLI:

```bash
az containerapp logs show \
	--name YOUR_CONTAINER_APP --resource-group YOUR_RESOURCE_GROUP \
	--type console --tail 100 --follow
```

For multiple replicas, specify `--revision`, `--replica` and `--container web`.
Future failures emit a single `[recovery] operation failed` JSON log entry with
the operation ID and the same diagnostic fields shown in the recovery page.
This entry is emitted before reading or updating the control store, so a second
storage failure cannot erase the original diagnostic. A failed control-store
update may still leave the durable job status running until a worker retries.
System logs are useful for container restarts and platform problems; they do not
replace application console logs.

For database/container creation failures, also check the resource group's Azure
Activity Log at the operation time. The equivalent read-only query is:

```bash
az monitor activity-log list \
	--resource-group YOUR_RESOURCE_GROUP --status Failed --offset 2h \
	--query "[].{time:eventTimestamp,operation:operationName.localizedValue,correlationId:correlationId,error:properties.statusMessage}" \
	--output json
```

Use the last progress step to choose the next check:

| Progress | Next check |
| --- | --- |
| Creating staged database | Recovery managed identity, its account-scoped database creation role, account limits and Azure Policy |
| Creating container NAME | Recovery management role and the container definition rejected by Azure |
| Importing NAME | App identity's Cosmos data-plane role, item constraints, private networking and throttling |
| Reading container definitions | Cosmos container inventory access and private connectivity |
| Reading documents from NAME | Source/read-back document access, Cosmos data-plane permissions and private connectivity |
| Reading stored procedures, triggers or user-defined functions from NAME | The particular Cosmos script-metadata read, its data-plane authorization and SDK response |
| Verifying documents and policies for NAME | The read-back contents, partition key and policy comparison |
| Reading NAME on an older build | A combined document/script-metadata step; the label cannot identify which underlying call failed |
| Import plan saved on an older build | Staging database creation follows this step; check management-plane errors first |

Successful database and container writes in Activity Log do not prove that
document/script read-back or verification succeeded. An import is complete only
after verification and activation. The 503 message "The environment is being
initialized or restored" is the expected gate on normal app data access while
maintenance is active; by itself it is not the restore worker's underlying error.

The recovery identity creates databases/containers through Azure Resource Manager.
The normal app identity reads and writes documents through Cosmos. Successful
authentication or status polling does not prove both identities have all required
permissions. A 403 alone does not distinguish RBAC, networking and policy failures.
Activity Log covers management operations, not every Cosmos data-plane request.

The reader also handles result-less Cosmos feed pages. Previously, passing an
undefined resource array into the size calculation caused a JavaScript TypeError
during read-back. A regression test reproduces that edge case, but its presence
does not prove that it caused a particular live failure. Integrity verification
and the activation fence still run; a successful write alone never activates a
dataset.

Older worker versions discarded unexpected exception details and have no stored
diagnostic metadata. The status response cannot reconstruct those details; an
Azure management failure may still be available in Activity Log. Deploy the
diagnostic-enabled build to the affected environment, preserve its existing
secrets, and review a new retry only after inspecting the failed step. Do not
delete the active/control database, rotate keys or grant broad subscription access
as a troubleshooting shortcut.

### Other Symptoms

- Recovery storage unavailable: check the independent control database/container, app data-plane RBAC, and private DNS. Do not delete the control database to clear an error.
- Preprovision reports a missing recovery key: the hook must check the exit status of `azd env get-value`, not only stdout. Some azd versions print missing-key errors to stdout. The hook generates a missing key once and rejects an existing value shorter than 32 characters.
- Initialization screen on a new environment: expected; use the environment recovery key and upload a package or create the built-in dataset.
- Incorrect package password: decrypt with the original download password. Changing the environment recovery key does not change the archive password.
- Import failed before activation: the previous dataset is still selected. Read the operation error, correct the package/configuration, and review a new upload.
- Worker interrupted: retain the operation ID. A later worker can reclaim an expired lease; cancellation preserves the active dataset.
- App returned to login after activation: expected session-generation invalidation. Use an account in the new dataset.
- Recovery session expired during work: the job is durable and continues. Reauthenticate; during maintenance use the recovery key if a new administrator login is unavailable.
- Delivery is silent after an import: expected. Recheck environment-specific credentials, then explicitly enable delivery. Canceled historical messages are not automatically rescheduled.
- Wrong dataset activated: use Review rollback. A rollback goes through validation and stages another dataset, so it does not revive authentication challenges or queued sends.
- Old datasets consume storage: retained deliberately. Review the active/previous pointers and operation inventory before an operator removes any retired database.

## Official References

- Container Apps console/system logs: <https://learn.microsoft.com/en-us/azure/container-apps/log-streaming>
- Azure Activity Log CLI: <https://learn.microsoft.com/en-us/cli/azure/monitor/activity-log#az-monitor-activity-log-list>
- Cosmos control-plane versus data-plane permissions: <https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control>
- Cosmos transaction and ETag boundaries: <https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/database-transactions-optimistic-concurrency>
- Cosmos TTL semantics: <https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-time-to-live>
- Azure custom roles: <https://learn.microsoft.com/en-us/azure/role-based-access-control/custom-roles>
- Bicep role definitions: <https://learn.microsoft.com/en-us/azure/templates/microsoft.authorization/2022-04-01/roledefinitions>
- Container Apps identities: <https://learn.microsoft.com/en-us/azure/container-apps/managed-identity>
- Container Apps secrets: <https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets>
- Cosmos emulator limitations: <https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux>