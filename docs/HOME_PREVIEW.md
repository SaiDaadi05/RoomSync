# RoomSync home design preview

This contribution is deliberately separate from Claude's active app implementation.
It adds no routes, dependencies, schema changes, or server behavior.

## Open the preview

Open `public/home-preview.html` directly in a browser, or run:

```sh
python3 -m http.server 8765 --directory public
```

Then visit `http://localhost:8765/home-preview.html`. Once the Next.js app has
pages, the same file will be served at `/home-preview.html`.

## Design direction

- White cards, a light-gray background, familiar blue actions, and neutral text.
- Three section buttons on desktop and mobile: Chores, Shopping, Expenses.
- Only one section is visible at a time. No sidebar, summary-card grid, or effort chart.
- System fonts and no external assets.
- Home opens to today's chores; shopping and expenses are one click away.
- Chore completion and undo update the summary immediately.
- Shopping claims help avoid duplicate purchases. The paper-towels shortcut
  is idempotent and reports when the item is already listed.
- Add-chore dialog supports assignment, native validation, Escape, and focus return.
- Text entered by a user is inserted as text, never interpreted as HTML.
- Household and balance figures are fictional and explicitly labeled.

Everything is in-memory and resets on reload. There is no persistence, authentication,
calendar integration, notification delivery, or money movement in this preview.
Tab changes preserve sample interaction state until refresh or reset.

## Integration handoff

Use this as a visual and interaction reference for the real React dashboard. Keep
Claude's existing component and server conventions. Replace sample data with authorized
household queries, and wire completion/assignment to the existing task services.
Do not copy the demo's in-memory state as the production storage layer.

Real task creation will need recurrence, deadline, duration, and eligibility fields.
Real shopping claims need atomic server updates so two roommates cannot both claim
the same item. Real summaries must distinguish each user's tasks from household tasks.
Include pending, failure, empty, and disconnected states when adding live services.

## Build status at review

Reviewed base commit: `6968bfcb3d0d42d1ae0a97cae568ac2adf141c02`.

- `npm ci`: passed.
- `npm run lint`: passed after Prisma client generation.
- `npm run build`: Prisma generation passed; Next.js stopped because this commit
  has neither an `app` nor a `pages` directory. Claude's UI work is still required.
- `npm test`: global setup stopped because no dedicated test database was configured.
  This is not a passing integration-test run. Never bypass the test database guard.
- DOM-level interaction checks using JSDOM passed: completion/undo, progress counts,
  duplicate prevention, claim/unclaim, literal user input, whitespace validation,
  section navigation/visibility, state across tabs, dialog close/focus-return handler,
  and reset. Native dialog
  methods were stubbed, so these checks do not validate native modal behavior.
- Browser rendering could not run in this environment: Chromium exited because
  the environment disallows its process-singleton socket. Desktop/mobile appearance
  still needs a real-browser review before integrating the design.

This branch supplies a design preview, not a production-ready initial app.
