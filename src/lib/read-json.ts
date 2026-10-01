// Reads a JSON request body with a ceiling, for the public sign-in routes. An unbounded
// `request.json()` lets anybody make the server buffer a huge body before a single check runs.

/** The default ceiling: far above any real sign-in proof (a Teams token is under 16 KB). */
export const JSON_BODY_LIMIT_BYTES = 32 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Parses the body as JSON, refusing (by throwing) anything over `maxBytes`. A declared
 * Content-Length over the ceiling is refused before a byte is read; the text is measured again
 * after, because a header can lie or be absent. Throws on unreadable JSON, as `request.json()` does.
 */
export async function readJsonLimited(request: Request, maxBytes = JSON_BODY_LIMIT_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BodyTooLargeError();
  return JSON.parse(text) as unknown;
}
