import { CopyButton } from "./copy-button";
import { deleteCalendarFeedAction, resetCalendarFeedAction } from "@/app/actions/planner";

/** Subscribe link for Apple Calendar, Google Calendar, Outlook or anything that reads .ics URLs. */
export function CalendarFeedRow({ feed }: { feed: { url: string; lastFetchedAt: Date | null } | null }) {
  const webcal = feed?.url.replace(/^https?:\/\//, "webcal://");
  return (
    <div className="space-y-3 p-4">
      <div>
        <p className="font-medium">Apple Calendar and other calendar apps</p>
        <p className="text-xs text-muted">
          Subscribe to a private link and your own chores show up in Apple Calendar, Google Calendar or Outlook. It&apos;s one way: tick things off in RoomSync, not in the calendar.
        </p>
      </div>
      {!feed ? (
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/calendar/subscribe" className="btn-primary min-h-9 text-sm">Add to Apple Calendar</a>
          <a href="/api/calendar/subscribe?app=google" target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 text-sm">Add to Google Calendar</a>
          <form action={resetCalendarFeedAction}><button className="px-2 text-xs font-semibold text-ink underline underline-offset-2">Just show me the link</button></form>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input readOnly value={feed.url} aria-label="Your calendar link" className="input min-w-0 flex-1 font-mono text-xs" />
            <CopyButton text={feed.url} />
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={webcal} className="btn-primary min-h-9 text-sm">Add to Apple Calendar</a>
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-9 text-sm">Add to Google Calendar</a>
          </div>
          <p className="text-xs text-muted">
            Calendar apps check for changes on their own schedule: Apple usually within the hour, Google can take up to a day.
            {feed.lastFetchedAt ? ` Last checked ${feed.lastFetchedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : " Not checked by a calendar yet."}
            {" "}Anyone with this link can see your chore list, so keep it to yourself.
          </p>
          <div className="flex gap-4 text-xs">
            <form action={resetCalendarFeedAction}><button className="font-semibold text-ink underline underline-offset-2">Make a new link</button></form>
            <form action={deleteCalendarFeedAction}><button className="font-semibold text-red-700 underline underline-offset-2">Turn off</button></form>
          </div>
        </>
      )}
    </div>
  );
}
