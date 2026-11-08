# Initial release acceptance checklist

Use two households and at least three roommate accounts. Exercise these scenarios
against a dedicated test database and real app screens. Unchecked items are acceptance
criteria, not claims that features have been implemented.

## First usable flow

- [ ] Sign up, sign in, sign out, and recover cleanly from an expired session.
- [ ] Create a household, invite a roommate, and join with that invitation.
- [ ] Reject invalid, expired, and already-used invitations appropriately.
- [ ] Create a chore, assign it, and complete it from another authorized account.
- [ ] Reload and confirm the household, task, assignee, and completion persist.
- [ ] Show useful loading, empty, validation, and server-error states.

## Tasks and shared effort

- [ ] Daily/weekly recurrence creates distinct occurrences without duplicates.
- [ ] Completing one occurrence preserves the rest and records who actually did it.
- [ ] Reopening, skipping, and rescheduling preserve history.
- [ ] Rotation respects eligible roommates and manual overrides.
- [ ] Local deadlines remain correct across timezone and daylight-saving changes.
- [ ] Swap requests keep the original owner until accepted; simultaneous accepts
  cannot result in conflicting ownership.
- [ ] Fairness summaries explain the time/effort metric and reflect actual completion.

## Shopping and expenses

- [ ] Running-low shortcuts do not duplicate an existing pending item.
- [ ] Simultaneous purchase claims resolve to one owner and update both clients.
- [ ] Purchasing an item can create a linked expense without duplicate entries.
- [ ] Equal splits of $10 among three people total exactly $10.
- [ ] Custom splits must equal the expense total; payer and participants belong
  to the same household.
- [ ] Expense edits and recorded settlements update balances consistently.
- [ ] Recurring bills create one entry per billing period, including retries.
- [ ] Variable bills require the period's confirmed amount.
- [ ] Receipt access requires household membership; rejected uploads show clear errors.
- [ ] Recording a settlement never implies a bank transfer occurred.

## Calendar and reminders

- [ ] Manual availability works without connecting an external calendar.
- [ ] Schedule proposals respect duration, deadlines, busy time, and quiet hours.
- [ ] Accepting a proposal twice does not duplicate events.
- [ ] Roommates cannot see private calendar event titles/descriptions.
- [ ] Disconnects, revoked tokens, and provider failures show actionable status.
- [ ] Email notifications are labeled unavailable when SMTP is not configured.
- [ ] Quiet hours, preferences, and retry deduplication apply to reminders.
- [ ] Google/Apple support is described according to what is actually tested.

## Access, usability, and handoff

- [ ] A member of household A cannot fetch or mutate B's records by guessing IDs.
- [ ] Leaving/removing a member preserves historical expenses and completions.
- [ ] Demo data and real accounts are isolated.
- [ ] Main flows work at 390px width and by keyboard, with visible focus and labels.
- [ ] Fresh-install instructions cover environment configuration and migrations.
- [ ] Type checking, production build, and database-backed tests pass.
- [ ] Review the latest main branch before merging concurrent Claude/Codex work.
- [ ] Release notes distinguish implemented features from pending integrations.
