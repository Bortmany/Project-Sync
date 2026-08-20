// Global search. The query is validated here; the scoping to the person's own projects is in src/lib/search.ts.

import { z } from "zod";
import { MIN_QUERY_LENGTH, searchEverything } from "@/lib/search";
import { toFieldErrors } from "@/lib/zod-schemas";
import { failFrom, failWithFields, guardRead, ok } from "@/server/http";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z
    .string()
    .trim()
    .min(MIN_QUERY_LENGTH, "Type at least two characters to search.")
    .max(200, "That search is too long. Try a shorter word or code."),
});

export async function GET(request: Request) {
  const guard = await guardRead("search");
  if (guard.response) return guard.response;

  const url = new URL(request.url);
  const parsed = Query.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return failWithFields(
      "That search is not valid. Type at least two characters.",
      toFieldErrors(parsed.error),
    );
  }

  try {
    return ok(await searchEverything(guard.actor, parsed.data.q));
  } catch (error) {
    return failFrom(error, { route: "GET /api/search" });
  }
}
