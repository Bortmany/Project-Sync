import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readJsonLimited } from "@/lib/read-json";

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://tielora.test/x", { method: "POST", body, headers });
}

describe("readJsonLimited", () => {
  it("reads an ordinary body", async () => {
    expect(await readJsonLimited(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses a body over the ceiling, whatever the header says", async () => {
    await expect(readJsonLimited(post(JSON.stringify({ a: "x".repeat(200) })), 100)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("refuses a declared length over the ceiling before reading", async () => {
    await expect(readJsonLimited(post("{}", { "content-length": "999999" }), 100)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("still throws on unreadable JSON", async () => {
    await expect(readJsonLimited(post("not json"))).rejects.toThrow();
  });
});
