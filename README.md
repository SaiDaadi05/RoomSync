# RoomSync

Chores, errands, shared shopping, expenses, and scheduling for roommates.

**Stack:** Next.js 15 (App Router) · TypeScript · PostgreSQL + Prisma · Tailwind CSS 4 · Zod · Luxon · Vitest

## Quick start

```bash
# 1. Postgres 14+ running locally, then:
createuser -P roomsync          # password: roomsync (or edit DATABASE_URL)
createdb -O roomsync roomsync
createdb -O roomsync roomsync_test

# 2. App
npm install
cp .env.example .env            # fill in ENCRYPTION_KEY (command in the file)
npx prisma migrate deploy       # or: npm run db:migrate (dev)
npm run db:seed                 # optional sample household
npm run dev                     # http://localhost:3000
npm run worker                  # reminders + email delivery (separate process)
```

Sample logins after `db:seed`: `alex@example.com`, `jordan@example.com`, `sam@example.com`, password `password123`.

**Demo mode:** with `DEMO_MODE_ENABLED=true`, the landing and login pages show "Try the demo". Each click creates a separate household flagged `isDemo`, with made-up data, a banner on every screen, and an unroutable email domain. Demo and real accounts can never join each other's households.

**Tests:** `cp` a `.env.test` with `DATABASE_URL` pointing at `roomsync_test`, then `npm test`. Tests run against a real Postgres database and truncate it between tests. They refuse to run unless the database name contains "test".

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `APP_URL`, `ENCRYPTION_KEY`. Optional: `STORAGE_DIR`, `DEMO_MODE_ENABLED`, `SMTP_*`, `GOOGLE_CLIENT_ID/SECRET`.

## Architecture

- `src/server/*` is the service layer. Every function takes the acting user's id and calls `requireMember()` (in `access.ts`) before touching household data, so access is enforced on the backend, not only in the UI. Pages and server actions are thin wrappers over it.
- `src/lib/recurrence.ts` is the deterministic recurrence engine. Tasks are a `TaskDefinition` (the rule) plus one `TaskOccurrence` row per due date, generated 21 days ahead. A unique key on `(definitionId, originalDueAt)` makes generation idempotent. Completing or skipping one week never touches another week's history. Editing a rule regenerates only untouched future occurrences and keeps anything someone changed by hand.
- `src/lib/scheduling.ts` is the deterministic planner. It schedules earliest deadline first, uses only free time (manual availability ∩ preferred hours − calendar busy − already-planned tasks), and assigns unassigned work to the eligible person with the lowest effort load (planned minutes + half of recently completed minutes). Every suggestion comes with a plain-language reason, and nothing changes until someone accepts it.
- Money is stored as integer cents. Equal splits put remainder cents on the first participants, and custom splits must sum exactly to the total (checked on the server).
- Receipts are stored outside `/public` (`STORAGE_DIR`), validated by MIME type plus magic bytes (5 MB max), and served only through `/api/receipts/[expenseId]` after a membership check.
- Notifications: each one has per-channel `NotificationDelivery` rows. In-app is marked SENT. Email is PENDING only if the user opted in **and** SMTP is configured; otherwise it's SKIPPED with a reason. The worker sends emails and retries up to 3 times.

## Integration status

| Integration | Status |
|---|---|
| Google Calendar | **Implemented, not yet tested against live Google.** OAuth (offline, tokens AES-256-GCM encrypted at rest), free/busy reads (busy blocks only, never event details), and per-task event creation with deterministic event ids to prevent duplicates. Unit-tested with mocked HTTP. Needs credentials, see below. |
| Apple Calendar | **Not implemented.** Apple has no public OAuth/REST calendar API for web apps. Options: (a) CalDAV against iCloud with an app-specific password the user generates, or (b) a native iOS companion using EventKit. Needs a product decision before building. Manual availability works meanwhile. |
| Email reminders | Implemented through SMTP (nodemailer). Inactive until `SMTP_HOST` is set. |
| Amazon / retailers | Saved product links open the retailer's site for checkout. No ordering, catalog, or Fresh integration, and nothing pretends a purchase happened. |
| Task swaps | Request → accept/decline. Nothing changes hands until the other roommate accepts; a request expires if either task changes first. |
| Payments | None. "Record a payment" is bookkeeping only. |

### Google Calendar setup

1. In Google Cloud Console, create a project, enable the **Google Calendar API**, and configure the OAuth consent screen.
2. Add scopes: `openid`, `email`, `https://www.googleapis.com/auth/calendar.freebusy`, `https://www.googleapis.com/auth/calendar.events.owned`.
3. Create an OAuth client of type **Web application** with the redirect URI `${APP_URL}/api/calendar/google/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then go to Household → Calendars → Connect.
