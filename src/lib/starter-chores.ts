export const STARTER_CHORES = [
  { key: "trash", title: "Take out trash & recycling", category: "trash", minutes: 10, recurrence: "WEEKLY", weekdays: [2, 5], dueTime: "21:00" },
  { key: "dishes", title: "Run & empty the dishwasher", category: "kitchen", minutes: 15, recurrence: "DAILY", weekdays: [], dueTime: "21:00" },
  { key: "bathroom", title: "Clean the bathroom", category: "bathroom", minutes: 40, recurrence: "WEEKLY", weekdays: [6], dueTime: "18:00" },
  { key: "vacuum", title: "Vacuum common areas", category: "cleaning", minutes: 25, recurrence: "WEEKLY", weekdays: [7], dueTime: "18:00" },
  { key: "kitchen", title: "Wipe down kitchen counters & stove", category: "kitchen", minutes: 15, recurrence: "WEEKLY", weekdays: [3, 7], dueTime: "21:00" },
  { key: "fridge", title: "Clear out old food from the fridge", category: "kitchen", minutes: 15, recurrence: "WEEKLY", weekdays: [4], dueTime: "20:00" },
] as const;
