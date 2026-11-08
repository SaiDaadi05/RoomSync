# AGENTS.md

Guidance for coding agents (Codex, Claude, etc.) and humans working on RoomSync. Read this and the open GitHub issues before starting any work.

## Project

RoomSync is a mobile-first web app for roommates: chores and errands (one-time and recurring), completion history, reminders, a shared shopping list, shared expenses with balances, and a weekly planner that schedules tasks into people's free time while keeping workload fair.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- PostgreSQL + Prisma 6 (`prisma/schema.prisma`, migrations in `prisma/migrations/`)
- Tailwind CSS 4 (component classes are `@utility` blocks in `src/app/globals.css`)
- Zod for input validation, Luxon for timezones, Vitest for tests, nodemailer for email

## Commands

```bash
npm install
cp .env.example .env              # set ENCRYPTION_KEY (see comment in file)
npx prisma migrate dev            # apply/create migrations (dev)
npm run db:seed                   # sample household: alex@/jordan@/sam@example.com, password123
npm run dev                       # http://localhost:3000
npm run worker                    # reminders + email delivery (separate process)
npm run lint                      # tsc --noEmit
npm test                          # Vitest against the roomsync_test DB (needs .env.test)
npm run build                     # production build
```

Tests need a Postgres database whose name contains `test` (for example `DATABASE_URL=postgresql://roomsync:roomsync@localhost:5432/roomsync_test` in `.env.test`). They truncate every table between tests.

**Before opening or updating a PR:** `npm run lint`, `npm test`, and `npm run build` must all pass. For UI changes, also click through the affected flow in a browser against `npm run build && npm start`.

## Layout

- `src/server/` is the service layer and the only place that touches the database for household data. Pages and server actions (`src/app/actions/`) are thin wrappers.
- `src/lib/` holds pure logic with no DB access: `recurrence.ts`, `scheduling.ts`, `money.ts`, `time.ts`.
- `src/app/(app)/` contains the signed-in screens (home, tasks, planner, shopping, expenses, household, notifications).
- `src/components/` holds UI. `forms.tsx` provides `ActionForm`/`SubmitButton`, so use them for every form.
- `tests/` holds integration tests (real DB) plus unit tests for `src/lib`.

## Rules (do not break these)

1. **Household access is enforced on the server.** Every service function takes the acting `userId` and calls `requireMember()` / `requireOwner()` / `assertAllMembers()` from `src/server/access.ts` before reading or writing household data. Never rely on the UI hiding something. Add an isolation test for any new household-owned data.
2. **Money is integer cents.** Never use floats for amounts. Parse with `parseMoneyToCents`, split with `splitEqually`, and validate that custom splits sum exactly to the total on the server.
3. **Recurring tasks keep history.** A `TaskDefinition` is the rule and each due date is its own `TaskOccurrence`. Never mutate or delete DONE/SKIPPED occurrences when a rule changes. Generation must stay idempotent (unique `definitionId + originalDueAt`).
4. **Times:** store instants in UTC. Recurrence rules use local dates/times in the household timezone. Availability uses each user's own timezone.
5. **No silent changes to other people's commitments.** Scheduling suggestions change nothing until accepted, and anything that reassigns someone else must notify them.
6. **Be honest about integrations.** Don't claim a calendar sync, email, or purchase happened unless it did. Email deliveries without SMTP are recorded as `SKIPPED`. Shopping links hand off to the retailer, and RoomSync never "orders". Settlements are bookkeeping only.
7. **Secrets stay server-side.** OAuth tokens are encrypted with `encryptSecret` (AES-256-GCM). Never send tokens or private calendar event details to the browser. Only busy/free blocks are used.
8. **Demo data stays separate.** Demo users/households have `isDemo = true`, and the two kinds can never share a household.
9. **Schema changes** go through `npx prisma migrate dev --name <change>` and the migration is committed.
10. **No `loading.tsx` Suspense boundary at the `(app)` layout level.** It made form saves stall the UI intermittently. If you add loading UI, re-run the browser flow several times.

## Git conventions

- **Commits are authored by the human you're working for, with no AI attribution.** Do not add `Co-Authored-By`, "Generated with …", or similar lines to commits or PR descriptions.
- One branch and one PR per area of work. Branch names: `<owner>/<short-topic>` (e.g. `codex/apple-calendar`, `claude/swap-requests`).
- Never force-push or rewrite history on a branch someone else is working on. Merge `main` in instead.
- Keep PRs focused. Describe what works, what was tested, and what's still not done.

## Coordination between agents

Two agents work on this repo (Claude and Codex), driven by different people. They can't talk to each other directly, so coordinate through this file and GitHub:

1. **Before starting**, pull `main`, read this file, and check open issues and PRs.
2. **Claim work** by assigning yourself to (or commenting on) the GitHub issue for it, and add it to the "In progress" table below in your branch. If there's no issue, open one first.
3. **Don't edit files another in-progress area owns** without coordinating in that area's issue. Shared files (`prisma/schema.prisma`, `src/server/access.ts`, `src/components/forms.tsx`, this file) need small, separate commits so conflicts are easy to resolve.
4. **When done**, move the row to "Done" in the same PR.

### In progress

| Area | Owner | Branch / PR | Notes |
|---|---|---|---|
| App foundation (all 5 stages, first pass) | Claude | `claude/app-foundation` / #2 | Awaiting review |
| Rebalance with consent + fairness history (#7) | Claude | `claude/rebalance` (stacked on #2) | Awaiting review |

### Done

| Area | Owner | PR |
|---|---|---|
| Scaffold: schema, auth, households, tasks engine | Claude | initial commit on `main` |

### Remaining work (GitHub issues; unclaimed unless listed above)

- (#3) **Google Calendar live verification:** the code exists (`src/server/calendar/google.ts`) but hasn't been tested against real Google. Needs a Google Cloud OAuth client (README → Google Calendar setup), then a test of connect, free/busy, add-to-calendar, and disconnect. Also: update or delete the Google event when a planned task is rescheduled or completed.
- (#4) **Apple Calendar:** not started. Needs a product decision first: iCloud CalDAV with an app-specific password vs. a native iOS app using EventKit. Check Apple's current docs before choosing.
- (#5) **Email reminders:** configure SMTP and verify the worker sends. Add an unsubscribe link and per-type preferences.
- (#6) **Swap requests with approval:** swaps are currently immediate plus a notification. Add a request → accept/decline flow.
- (#7) **Fairness improvements:** a "rebalance this week" suggestion that proposes reassigning already-assigned tasks (with consent), and fairness history over longer periods.
- (#8) **Receipts storage driver:** add an S3/R2 implementation of `src/server/storage.ts` for hosted deployments.
- (#9) **PWA:** service worker, offline shell, install prompt, and web push (as a separate, clearly labeled notification channel).
- (#10) **Deployment:** hosting, managed Postgres, a scheduled worker, and CI that runs lint, tests, and build on PRs.
- (#11) **Account features:** password reset, email verification, and member removal and role changes by the owner.
- (#12) **Editing expenses** (currently delete and re-add) and editing shopping items inline.
