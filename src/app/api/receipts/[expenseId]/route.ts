import { getCurrentUser } from "@/server/session";
import { readReceipt } from "@/server/expenses";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { expenseId } = await params;
  try {
    const { data, mime } = await readReceipt(user.id, expenseId);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    // Same response for "doesn't exist" and "not yours" so ids can't be probed.
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
