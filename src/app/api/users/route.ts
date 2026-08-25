// Active people, for member and assignee pickers. Never returns a password hash or a session — UserDTO only.

import { z } from "zod";
import { toFieldErrors } from "@/lib/zod-schemas";
import { failFrom, failWithFields, guardRead, ok } from "@/server/http";
import { listUsers } from "@/server/services/directory";

export const dynamic = "force-dynamic";

const Query = z.object({ q: z.string().trim().max(200).optional() });

export async function GET(request: Request) {
  const guard = await guardRead("users");
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q");
  const parsed = Query.safeParse(rawQuery ? { q: rawQuery } : {});
  if (!parsed.success) {
    return failWithFields("That search is not valid. Try a shorter name or email.", toFieldErrors(parsed.error));
  }

  try {
    return ok(await listUsers(parsed.data.q));
  } catch (error) {
    return failFrom(error, { route: "GET /api/users" });
  }
}
