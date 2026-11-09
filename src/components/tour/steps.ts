/**
 * The feature walkthrough. Each step opens a page and, if it can find it,
 * spotlights one part of it. Targets are found from what's already on the page
 * (a section heading, an id, an aria label) so pages don't need tour-specific
 * markup. If a target isn't there (an empty household, a feature that's hidden
 * for this user), the step still shows, just without the spotlight.
 */
export type TourTarget =
  | { heading: string } // the <section> whose h2 starts with this text
  | { selector: string }; // first visible element matching this CSS selector

export type TourStep = {
  route: string;
  title: string;
  body: string;
  target?: TourTarget;
};

export const TOUR_STEPS: TourStep[] = [
  {
    route: "/home",
    title: "This is Home",
    body: "Everything that needs you today: your chores, what's up for grabs, who owes what, and what the house is out of.",
    target: { selector: "main h1" },
  },
  {
    route: "/home",
    title: "Add anything from one button",
    body: "Chores, shopping items and shared costs all start here, wherever you are in the app.",
    target: { selector: "[aria-haspopup='menu']" },
  },
  {
    route: "/tasks",
    title: "Chores that repeat on their own",
    body: "Set a chore once (weekly trash, monthly fridge clean-out) and RoomSync makes each due date, keeps the history, and reminds whoever's up. Tap Done when it's done.",
    target: { selector: "main h1" },
  },
  {
    route: "/planner",
    title: "A fair weekly plan",
    body: "The planner fits chores into everyone's free time and keeps the workload even. Nothing changes until someone accepts it.",
    target: { heading: "Suggested plan" },
  },
  {
    route: "/planner",
    title: "Swap when life happens",
    body: "Can't make it? Ask a roommate to swap. They get a request and nothing moves until they say yes.",
    target: { heading: "Swap a task" },
  },
  {
    route: "/shopping",
    title: "One shared shopping list",
    body: "Anyone can add to it. Tick things off when you buy them, and log what you spent so it lands in Money.",
    target: { heading: "On the list" },
  },
  {
    route: "/expenses",
    title: "Who owes whom, always up to date",
    body: "Add a cost and split it evenly, by shares, by percent, or item by item. Balances update for everyone right away.",
    target: { heading: "Everyone's balance" },
  },
  {
    route: "/expenses",
    title: "Settle up",
    body: "When someone pays someone back, record it here. RoomSync only keeps the books; the money itself moves however you like.",
    target: { heading: "Record a payment" },
  },
  {
    route: "/notifications",
    title: "Reminders",
    body: "Due chores, swap requests and new costs show up here, and by email too if your household turns it on.",
    target: { selector: "main h1" },
  },
  {
    route: "/household",
    title: "Bring your roommates in",
    body: "Share an invite link or code from here. You can also replay this tour from this page any time.",
    target: { selector: "#invite" },
  },
];
