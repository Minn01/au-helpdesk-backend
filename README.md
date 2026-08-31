# AU HelpDesk backend

## Configuration and secrets

Configuration is loaded once before Prisma, authentication, or application services are initialized. Local development uses `.env`; production uses Azure Key Vault. Controllers and services receive initialized dependencies and never access the vault directly.

Copy `.env.example` to `.env` for local development. At minimum, local runtime requires `DATABASE_URL` and a `JWT_SECRET` of at least 32 characters. Microsoft authentication remains optional in development, but if any Microsoft setting is supplied, all Microsoft settings are required.

Production defaults to `SECRET_SOURCE=azure-key-vault`. This mode can also be selected explicitly in development for a smoke test. It requires `AZURE_KEY_VAULT_URL`. `DefaultAzureCredential` handles authentication; for the temporary development vault it can use `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET`. These are bootstrap credentials and must not be committed.

The vault mapping is:

| Azure Key Vault secret | Application value |
| --- | --- |
| `DATABASE-URL` | `DATABASE_URL` |
| `DIRECT-URL` | `DIRECT_URL` |
| `JWT-SECRET` | `JWT_SECRET` |
| `MICROSOFT-CLIENT-SECRET` | `MICROSOFT_CLIENT_SECRET` |
| `SUPABASE-SECRET-KEY` | `SUPABASE_SECRET_KEY` |
| `HELPDESK-PEER-API-KEY` | `HELPDESK_PEER_API_KEY` |
| `EDUCORE-API-KEY` | `EDUCORE_API_KEY` |

Non-secret values—including `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `MICROSOFT_REDIRECT_URI`, `FRONTEND_URL`, `SUPABASE_URL`, `PORT`, and `NODE_ENV`—remain ordinary environment variables. Production startup fails if Key Vault access or any required vault secret fails; it does not fall back to environment secrets.

Prisma runtime receives the loaded `DATABASE_URL` directly after configuration completes. Prisma CLI commands run as separate deployment-time processes, so migrations still require `DIRECT_URL` to be injected into that process (for example, by the future deployment pipeline). The Express application does not run migrations at startup.

## Private ticket attachments

Attachments are stored as private objects in the Supabase Storage bucket configured by `SUPABASE_STORAGE_BUCKET` (default `ticket-attachments`). PostgreSQL stores metadata only. Runtime requires the non-secret `SUPABASE_URL` and secret `SUPABASE_SECRET_KEY`; the latter comes from `.env` locally or `SUPABASE-SECRET-KEY` in Key Vault and is never returned to clients.

Uploads use `multipart/form-data`, field name `files`, with at most five files per request and 13 MB per file. Allowed MIME/content types are `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, and UTF-8 `text/plain`. Object paths contain the ticket UUID, a generated UUID, and a sanitized display filename. Multiple-file requests are all-or-nothing; uploaded objects are removed if a later storage operation or metadata transaction fails.

Ticket detail responses include safe attachment metadata without `storagePath`. Authorized users request a private URL through `GET /api/tickets/:ticketId/attachments/:attachmentId/url`; the returned URL expires after 10 minutes and is never persisted.

## EduCore peer API integration

HelpDesk and EduCore authenticate service-to-service calls exclusively with an `x-api-key` header. These keys are not HelpDesk user identities and are never sent to the frontend.

### HelpDesk API exposed to EduCore

```http
POST /api/peer/educore/tickets
x-api-key: <HelpDesk-issued key>
Content-Type: application/json
```

Payload:

```json
{
  "eventId": "registration-failure-abc123",
  "student": {
    "email": "student@au.edu",
    "name": "Student Name"
  },
  "course": {
    "courseCode": "ITX4181",
    "courseName": "Optional Course Name"
  },
  "registrationStatus": "FAILED",
  "failureReason": "System error while processing registration",
  "occurredAt": "2026-08-31T01:02:03.000Z"
}
```

`eventId` is required and uniquely identifies the EduCore event. A new event returns `201` with `created: true`; a retry returns the existing ticket with `200` and `created: false`:

```json
{
  "ticket": {
    "id": "uuid",
    "ticketNumber": "HD-000123",
    "status": "OPEN"
  },
  "created": true
}
```

The database unique constraint on `(sourceSystem, externalEventId)` protects against simultaneous retries. HelpDesk resolves an existing active Student/Faculty by email; it does not create users or accept roles/assignments from EduCore. Tickets use the active `Course Registration` category, deterministic `HIGH` priority, normal `OPEN` workflow, and a `PEER_TICKET_CREATED` activity. Missing students return `STUDENT_NOT_FOUND`; a missing/inactive category returns `PEER_CATEGORY_UNAVAILABLE`.

Generate the HelpDesk-issued key locally without committing or printing it into documentation:

```sh
openssl rand -hex 32
```

Store that value as `HELPDESK_PEER_API_KEY` locally and later as `HELPDESK-PEER-API-KEY` in Key Vault. Provide the matching value to the EduCore team through a secure channel.

### HelpDesk API consuming EduCore context

Authorized technicians and administrators can explicitly request context for an EduCore-created ticket:

```http
GET /api/tickets/:ticketId/educore-context
Cookie: helpdesk_session=...
```

Response:

```json
{
  "context": {
    "studentId": "S123",
    "courseCode": "ITX4181",
    "registrationStatus": "FAILED",
    "failureReason": "System error",
    "attemptedAt": "2026-08-31T01:02:03.000Z",
    "additionalContext": {}
  }
}
```

Technicians need the same assigned-ticket or available-queue access used elsewhere; admins may inspect any referenced ticket. Requesters are denied, and tickets without an EduCore reference cannot be used as an arbitrary proxy. Errors are normalized as `EDUCORE_UNAVAILABLE`, `EDUCORE_CONTEXT_NOT_FOUND`, `EDUCORE_AUTH_FAILED`, `EDUCORE_INVALID_RESPONSE`, or `EDUCORE_CONTEXT_NOT_AVAILABLE`.

The outgoing adapter sends `EDUCORE_API_KEY` as `x-api-key`, validates the response, and aborts after four seconds by default. Because EduCore has not supplied its final context endpoint contract, the path is configurable through `EDUCORE_CONTEXT_PATH_TEMPLATE`; the provisional default is `/api/peer/helpdesk/registration-context/{eventId}`. The EduCore team must confirm the final path, identifier semantics, response DTO, base URL, and issued outgoing API key before live testing.

Configuration:

| Setting | Source | Purpose |
| --- | --- | --- |
| `EDUCORE_BASE_URL` | Environment | Non-secret EduCore origin |
| `HELPDESK_PEER_API_KEY` | `.env` / Key Vault `HELPDESK-PEER-API-KEY` | Incoming EduCore → HelpDesk authentication |
| `EDUCORE_API_KEY` | `.env` / Key Vault `EDUCORE-API-KEY` | Outgoing HelpDesk → EduCore authentication |
| `EDUCORE_CONTEXT_PATH_TEMPLATE` | Environment | Configurable context path containing `{eventId}` |
| `EDUCORE_TIMEOUT_MS` | Environment | Outgoing timeout, default 4000 ms |

## Commands

```sh
pnpm dev
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm prisma:validate
pnpm prisma:generate
```
