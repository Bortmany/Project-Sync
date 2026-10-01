// The comment counter's rules: silent until 80% of the 5,000 limit, then "left", then "over".

import { describe, expect, it } from "vitest";
import { COMMENT_MAX_LENGTH, commentCounter } from "@/components/comments/comment-limit";
import { COMMENT_BODY_MAX, CreateCommentInput } from "@/lib/zod-schemas";

describe("commentCounter", () => {
  it("matches the server's limit", () => {
    expect(COMMENT_MAX_LENGTH).toBe(5000);
    // The counter and the server's validation read one constant; this fails if either stops.
    expect(COMMENT_MAX_LENGTH).toBe(COMMENT_BODY_MAX);
    const input = (length: number) =>
      CreateCommentInput.safeParse({ body: "a".repeat(length), mainTaskId: "ckabcdefghijklmnopqrstuvw" });
    expect(input(COMMENT_MAX_LENGTH + 1).success).toBe(false);
    expect(input(COMMENT_MAX_LENGTH).success).toBe(true);
  });

  it("says nothing up to and including 4,000 characters", () => {
    expect(commentCounter(0)).toEqual({ show: false });
    expect(commentCounter(4000)).toEqual({ show: false });
  });

  it("counts down from 4,001 to the limit, still allowed at exactly 5,000", () => {
    expect(commentCounter(4001)).toEqual({ show: true, over: false, message: "999 characters left" });
    expect(commentCounter(4999)).toEqual({ show: true, over: false, message: "1 character left" });
    expect(commentCounter(5000)).toEqual({ show: true, over: false, message: "0 characters left" });
  });

  it("refuses past the limit in a plain sentence", () => {
    expect(commentCounter(5001)).toEqual({
      show: true,
      over: true,
      message: "This comment is 1 character over the 5,000 limit. Shorten it to post.",
    });
    expect(commentCounter(5250)).toMatchObject({ show: true, over: true });
  });
});
