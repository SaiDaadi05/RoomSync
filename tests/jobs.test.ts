import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/cron/reminders/route";

describe("cron route", () => {
  it("refuses without the secret", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect((await GET(new Request("http://x/api/cron/reminders"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/reminders", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  });

  it("runs every background job, not just reminders", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    const res = await GET(new Request("http://x/api/cron/reminders", { headers: { authorization: "Bearer s3cret-value" } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["billsAdded", "emailsSent", "ms", "pushesSent", "recaps", "reminders"]);
  });
});
