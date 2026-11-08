"use server";

import { redirect } from "next/navigation";
import { createDemoHousehold } from "@/server/demo";
import { setCurrentHousehold, startSession } from "@/server/session";

export async function startDemoAction() {
  const { household, user } = await createDemoHousehold();
  await startSession(user.id);
  await setCurrentHousehold(household.id);
  redirect("/home");
}
