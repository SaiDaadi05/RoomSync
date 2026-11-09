import { requireHousehold } from "@/server/session";
import { exportLedgerCsv } from "@/server/insights";

/** CSV of the current household's expenses and payments. Members only. */
export async function GET() {
  const { user, household } = await requireHousehold();
  const csv = await exportLedgerCsv(user.id, household.id);
  const slug = household.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "household";
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-expenses.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
