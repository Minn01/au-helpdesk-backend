# HelpDesk Project Agent Guide

Read this durable project context before changing code, then verify it against the repository because implementation state evolves. Keep this file current when architecture, commands, or requirements materially change.

## Product and central workflow

HelpDesk is a university Internal Campus IT Ticketing System replacing scattered support by email/messages with a structured workflow for Wi-Fi, hardware, printers, Microsoft accounts, software, classroom equipment, and course-registration technical issues.

The ticket is the central domain object. Comments, attachments, assignments, status changes, AI suggestions, and activity history belong to it.

```text
University user signs in → creates ticket → system/AI assists classification
→ ticket enters technician queue → technician claims or is assigned
→ technician investigates and communicates → ticket is resolved and closed
```

## Complete planned system

This university systems-integration project must eventually demonstrate:

- React + TypeScript + Vite + Tailwind frontend.
- Node.js + Express + TypeScript REST API.
- PostgreSQL with Prisma migrations; Supabase-hosted PostgreSQL is currently planned.
- Microsoft university Azure Active Directory identity, HelpDesk JWT/session handling, and backend-enforced RBAC.
- OpenAI classification, Supabase Storage attachments, and Azure Key Vault production secrets.
- Bidirectional EduCore peer REST integration protected by `x-api-key`.
- Linux Azure VPS, Docker Compose or automated deployment, Nginx, Let's Encrypt HTTPS, and GitHub source control.

The public application belongs under `/helpdesk`; public APIs conceptually use `/helpdesk/api/...`. Microsoft entry and callback URLs are `/helpdesk/api/auth/microsoft` and `/helpdesk/api/auth/microsoft/callback`. Nginx may strip the prefix before proxying, so do not force internal Express routes to hard-code `/helpdesk` everywhere.

Final topology:

```text
Browser → HTTPS/Nginx → frontend and Express API under /helpdesk
→ Prisma → PostgreSQL

Express → Microsoft AD, OpenAI, Supabase Storage, Azure Key Vault
Express ↔ EduCore peer API
```

## What exists now

- This repository contains the Phase 1 Node.js, Express, and TypeScript backend foundation; the frontend is maintained separately.
- PostgreSQL is modeled with Prisma ORM 7, an initial SQL migration, and a development-only idempotent seed.
- `GET /api/health` verifies the HTTP service. HttpOnly-cookie JWT sessions are exposed through `GET /api/auth/me` and `POST /api/auth/logout`; there is no seeded-user development login endpoint.
- Phase 3 provides authenticated Student/Faculty category listing plus owner-scoped ticket, comment, and activity REST APIs. Requesters can create/list/view their tickets, edit or cancel only while `OPEN`, and comment on owned tickets; requester queries exclude internal comments.
- Phase 5 provides Technician queue, assigned-ticket, shared detail/comment, atomic self-claim, classification override, and `CLAIMED → IN_PROGRESS → RESOLVED` REST workflows. Technicians may read comments while viewing an eligible unassigned `OPEN` queue ticket, but must claim/be assigned before adding comments. Admin assignment and management remain deferred.
- Phase 6 provides Admin dashboard statistics, all-ticket search/filter/detail, concurrency-safe assignment/reassignment with preserved history, category create/edit/disable/re-enable, and internal HelpDesk user role/status management. The separate frontend still needs to connect these Admin screens to the real APIs.
- Phase 7 provides Microsoft Entra ID authorization-code authentication at internal `/api/auth/microsoft` and `/api/auth/microsoft/callback` routes, intended to be exposed as `/helpdesk/api/...`. It validates signed state and nonce, links immutable tenant/object identity to the internal user, and then issues the existing HelpDesk session cookie. The separate frontend still needs to connect its production sign-in button.
- Microsoft authentication provisions a previously unknown valid tenant user as an active `STUDENT`. Elevated roles are assigned later through HelpDesk Admin user management; the first Admin currently requires a manual database role update after Microsoft login.
- The schema contains users, relational categories, tickets, comments, assignment history, attachment metadata, and structured activity history.
- Ticket numbers use a PostgreSQL sequence-backed default rather than row counting.
- Authentication reloads the internal user on each request and centrally enforces active status and reusable role checks. Microsoft login is the only user-login path; development seed identities and seeded-user login are not provided.
- Ticket mutation and corresponding activity writes are transactional. My Tickets supports validated search/status/priority/category/sort filters and offset pagination.
- Ticket creation uses a backend-only OpenAI Responses API classification service with schema-constrained category, priority, and short-summary output. It loads active categories dynamically and retains a deterministic `Other`/`MEDIUM` fallback; `AUTO_DETECT` is never persisted as a category.
- Technician claims use an atomic conditional update inside the same transaction as assignment history and activity creation. A partial unique assignment-history index adds a second database-level guard against multiple active assignments.
- Admin assignment/reassignment uses a conditional current-state update, ends exactly one previous active assignment, and creates the new assignment plus activity in one transaction. Category names have database-enforced case-insensitive uniqueness; user management protects Admin self-lockout and technicians with active assigned work.
- Azure Key Vault production secret loading is implemented through one asynchronous startup configuration layer and a small Azure SDK adapter. Private Supabase attachment upload, signed retrieval, and removal are implemented behind a centralized storage service with server-side RBAC and validation. Bidirectional EduCore peer integration is implemented with API-key authentication, database-enforced event idempotency, and an explicit technician/admin context endpoint. OpenAI ticket classification is implemented; deployment integration remains unimplemented.

## Do not implement yet

Unless the user explicitly starts a future phase, do not add Express, Prisma, PostgreSQL, Supabase uploads, OpenAI calls, Key Vault, real Microsoft OAuth, real technician claim concurrency, admin CRUD, deployment machinery, or persistent fake storage. Never call OpenAI from React or expose database, service-role, peer, or other secret credentials to the browser.

Keep dependencies minimal. Preserve pnpm, strict TypeScript/linting conventions, and unrelated user work. Avoid over-abstraction and large component libraries.

## Authentication and authorization

Microsoft proves identity through the production authorization-code flow. HelpDesk then finds/creates its internal `User`, determines the HelpDesk role, and issues/maintains its own JWT/session. Identity and authorization remain separate. Microsoft users are linked by immutable tenant/object IDs; email is used only for the initial link to an existing HelpDesk user.

Roles are `STUDENT`, `FACULTY`, `TECHNICIAN`, and `ADMIN`. The backend must eventually enforce RBAC. Frontend guards only control presentation and are never security boundaries. Current `AuthContext` exposes `user`, `isAuthenticated`, `isLoading`, `login()`, and `logout()`; unauthenticated protected routes redirect to `/login`.

## Roles and ownership

- Student/Faculty: create tickets; view only their tickets/details/history; comment; attach files; edit or cancel their own `OPEN` tickets; track progress.
- Technician: filter the available queue; claim unassigned tickets; see assigned tickets; communicate; adjust category/priority; progress and resolve tickets.
- Admin: see all tickets; assign/reassign technicians; manage users/technicians and categories; inspect queues, workload, and basic statistics.

Technician self-claiming is normal; admin assignment is secondary. A successful claim changes an unassigned `OPEN` ticket to assigned/`CLAIMED` and adds it to My Assigned Tickets. Backend claims must be concurrency-safe so two technicians cannot claim one ticket.

Role-aware navigation:

- Student/Faculty: Dashboard, My Tickets, Create Ticket.
- Technician: Dashboard, Ticket Queue, My Assigned Tickets.
- Admin: Dashboard, Tickets, Categories, Users / Technicians.

## Ticket lifecycle and domain

Statuses: `OPEN`, `CLAIMED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED`.

```text
OPEN → CLAIMED → IN_PROGRESS → RESOLVED → CLOSED
OPEN → CANCELLED (owning Student/Faculty only)
```

Keep frontend edit/cancel rules at own `OPEN` tickets unless requirements change. Do not invent transitions.

Planned entities are `User`, `Category`, `Ticket`, `Comment`, `TicketAssignment`, `Attachment`, and `TicketActivity`. Do not freeze the final Prisma schema before backend requirements are reviewed.

- `Category` is relational database data, not an enum; admins will manage it.
- A ticket has a human-readable number, creator, title/description, category, priority, status, location, current assignee where appropriate, timestamps, and optional AI fields.
- `TicketAssignment` may be required for claim/assignment history; do not assume a single `assignedTechnicianId` is sufficient.
- Comments are ticket-scoped REST communication, not a separate real-time chat system.
- `TicketActivity` is the audit timeline for creation, classification, claims, assignments/reassignments, status/priority/category changes, resolution, cancellation, and similar events.

## AI classification and category origin

OpenAI ticket classification is a backend integration. It inspects the ticket title, description, optional location, and active category names, then advises category, priority, and a short summary through `aiSuggestedCategory`, `aiSuggestedPriority`, and `aiSummary`.

AI is advisory, never final authority. Technicians/admins can override category and priority. Student/Faculty users never select priority.

Category creation UX must offer:

- `Not sure — detect automatically` (submission intent, not a database Category)
- Current categories fetched from the category service

If a user selects a category, preserve it unless later business rules explicitly change. If they choose auto-detect, the backend will classify it. Preserve classification origin where useful—for example `USER_SELECTED`, `AI_SUGGESTED`, or `TECHNICIAN_OVERRIDE`—without treating origin as the Category itself. Frontend mocks may simulate this behavior, but all real OpenAI calls belong in a backend AI/classification service.

Priorities are `LOW`, `MEDIUM`, `HIGH`, and `URGENT`; the backend assigns/recommends them automatically for requesters. User-selected categories remain actual with `USER_SELECTED`; auto-detect adopts a valid active suggestion with `AI_SUGGESTED`. OpenAI/provider/output failures fall back to active `Other` and `MEDIUM` without losing the ticket. Technician overrides remain authoritative and preserve original AI suggestion fields.

## Attachments and secrets

Future attachment path:

```text
Frontend → Express → private Supabase Storage bucket
                   → PostgreSQL/Prisma attachment metadata
```

Use a private `ticket-attachments` bucket and paths like `tickets/<ticket-id>/<generated-name>-screenshot.png`. PostgreSQL stores metadata such as ticket ID, filename, storage path, type, size, and upload timestamp—not file binaries. Never expose `SUPABASE_SERVICE_ROLE_KEY` to React.

Attachment APIs accept up to five multipart files per request under the `files` field, with a 13 MB per-file limit. Allowed types are JPEG, PNG, WebP, PDF, and UTF-8 plain text, verified against file content. Private objects use generated `tickets/<ticket-id>/<uuid>-<safe-name>` paths; clients receive metadata and short-lived signed URLs, never storage credentials, permanent public URLs, or raw paths. Uploads are all-or-nothing with storage cleanup after partial upload or database failure. Requesters may upload while `OPEN`, `CLAIMED`, or `IN_PROGRESS`, but may remove only their own uploads while `OPEN`; assigned technicians may upload/remove their own files on active assigned tickets; admins may view all tickets and manage attachments.

Local backend development may use `.env`. Production secrets (`DATABASE_URL`, `JWT_SECRET`, OpenAI/Supabase/peer/Microsoft credentials) come from Azure Key Vault through a centralized configuration layer, not scattered direct access. Key Vault does not belong in this frontend repository.

Runtime startup now loads and validates configuration before constructing Prisma, sessions, Microsoft OAuth, or other services. Development defaults to environment secrets. Production defaults to and requires Azure Key Vault; `SECRET_SOURCE=azure-key-vault` can explicitly exercise that path outside production. The current vault mapping is `DATABASE-URL`, `DIRECT-URL`, `JWT-SECRET`, `MICROSOFT-CLIENT-SECRET`, `SUPABASE-SECRET-KEY`, `HELPDESK-PEER-API-KEY`, `EDUCORE-API-KEY`, and `OPENAI-API-KEY`. `DefaultAzureCredential` uses ordinary Azure bootstrap configuration, including `AZURE_KEY_VAULT_URL` plus service-principal environment credentials where needed. Prisma CLI migrations remain a separate deployment-time concern and require `DIRECT_URL` injection into the CLI process.

The Phase 2 backend requires `JWT_SECRET` to be at least 32 characters. Session JWTs are short-lived, use a fixed issuer/audience and HS256 algorithm, and are sent only through the `helpdesk_session` HttpOnly cookie.

Phase 7 Microsoft authentication additionally requires `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, and `FRONTEND_URL` in production. The redirect URI is an explicit deployment-facing URL, while internal Express routing remains prefix-agnostic. OAuth state is short-lived and signed in an HttpOnly cookie; Microsoft tokens are neither returned to the frontend nor persisted.

## EduCore peer integration

EduCore is a student course-registration backend. Communication is bidirectional REST with static `x-api-key` authentication; do not invent permanent endpoint names prematurely.

- HelpDesk exposes a peer API so EduCore can automatically create a ticket when registration fails for a technical/system reason, avoiding duplicate manual reports.
- HelpDesk consumes EduCore context—affected course, registration status, failure reason, and useful technical details—when technicians investigate registration tickets.

Keep this behind a peer-integration service. Do not tightly couple the core Ticket model to EduCore-specific fields.

The implemented incoming route is `POST /api/integrations/educore/tickets`, authenticated only by the HelpDesk-issued `x-api-key`. It resolves an existing active requester by email and creates a normal `OPEN`, `HIGH`-priority Course Registration ticket. `PeerTicketReference` stores the generic `EDUCORE` plus external event ID mapping, with a database unique constraint protecting idempotent retries and concurrency. The support-only endpoint `GET /api/tickets/:ticketId/educore-context` uses the existing JWT/RBAC ticket authorization, then calls the isolated EduCore HTTP client. The final EduCore context path remains partner-controlled and is configurable with `EDUCORE_CONTEXT_PATH_TEMPLATE`; its provisional default must not be treated as the finalized partner contract.

## Service boundaries

Current frontend modules are roughly `auth.api.ts`, `tickets.api.ts`, `categories.api.ts`, and `comments.api.ts`. Their mock internals should be replaceable by `fetch("/helpdesk/api/...")` without page rewrites.

Future backend boundaries should cover auth, tickets, categories, comments, attachments, AI/classification, peer integrations, and configuration/secrets. Prefer controller → domain service → Prisma/integration services. Do not scatter OpenAI, Storage, EduCore, or Key Vault calls through route handlers.

## Current frontend routes and quality bar

- `/login`: university Microsoft sign-in presentation. The backend does not provide development-only seeded-role login.
- `/dashboard`: summary counts, recent tickets, requester CTA.
- `/tickets`: own tickets with search, filters, sort, responsive table/cards.
- `/tickets/new`: title, description, manual/auto category, location, prototype attachments, async feedback, redirect.
- `/tickets/:ticketId`: metadata, description, attachments, conversation, activity, eligible edit/cancel.
- `/tickets/:ticketId/edit`: own `OPEN` tickets only.
- Technician/Admin destinations use the same Promise-based mock service boundary as requester pages; production backend integrations remain a later phase.

Every data-driven page needs loading, empty, and error states. Controls need labels, keyboard access, visible focus, and sufficient contrast. Never communicate status/priority by color alone. Use professional internal-university styling: neutral, compact, readable, responsive, restrained borders/radii and animation; avoid decorative gradients and generic SaaS excess.

## Incremental roadmap

Broad order: frontend product/UI → database/Prisma design → Microsoft auth + JWT/RBAC → REST ticket APIs → technician workflow → AI classification → attachments → admin → peer API → Key Vault → Docker/VPS/Nginx/HTTPS. The order may evolve; describing a future phase does not authorize implementing it.

## Review and verification

Before changes, read this file and relevant source/config/types, run `git status --short`, preserve unrelated edits, and trace UI data through API modules to mocks.

Review priorities:

1. Broken behavior, data loss, ownership/RBAC mistakes, route guards, unsafe claim transitions.
2. Service-boundary violations, leaked secrets, or contracts hostile to future REST integration.
3. Lifecycle, classification-origin, assignment-history, loading/error/empty, and async-state correctness.
4. Accessibility, responsive behavior, validation, maintainability, and visual consistency.

After frontend implementation run:

```sh
pnpm lint
pnpm build
```

When browser tooling is available, test desktop/mobile and mock role navigation, protected routes, filters, create/redirect, manual and auto-detected categories, details, comments/activity, OPEN-only edit, confirmed cancellation, and logout. Reviews report findings first by severity with file/line references, distinguish defects from assumptions, and name testing gaps when no findings exist.

## Current frontend definition of done

A Student can complete the requester journey; a Technician can filter/claim/progress/resolve assigned work; and an Admin can inspect/assign tickets and manage mock categories and application users. All state changes go through Promise-based service modules, create activity history where relevant, pass lint/build, and remain replaceable by the future REST API.
