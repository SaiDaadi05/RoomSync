/** The usual monthly bills offered during first-run setup. */
export const STARTER_BILLS = [
  { key: "rent", label: "Rent", category: "rent", day: 1, placeholder: "2400.00" },
  { key: "internet", label: "Internet", category: "internet", day: 15, placeholder: "60.00" },
  { key: "utilities", label: "Electric and gas", category: "utilities", day: 20, placeholder: "120.00" },
] as const;
