// The comment box's character counter. The 5,000-character limit itself lives on the server
// (CreateCommentInput); this only tells the person how close they are, so a refusal is never a
// surprise. Quiet until the text passes 80% of the limit.

import { COMMENT_BODY_MAX } from "@/lib/zod-schemas";

/** The server's cap on one comment: the very same constant CreateCommentInput validates with. */
export const COMMENT_MAX_LENGTH = COMMENT_BODY_MAX;

/** The counter appears once the text passes this share of the limit. */
const SHOW_FROM = 0.8;

export type CommentCounter =
  | { show: false }
  | { show: true; over: boolean; message: string };

const NUMBER = new Intl.NumberFormat("en-GB");

/** What the line under the box should say for a comment of `length` characters, if anything. */
export function commentCounter(length: number, max = COMMENT_MAX_LENGTH): CommentCounter {
  if (length <= max * SHOW_FROM) return { show: false };
  if (length > max) {
    const extra = length - max;
    return {
      show: true,
      over: true,
      message: `This comment is ${NUMBER.format(extra)} ${extra === 1 ? "character" : "characters"} over the ${NUMBER.format(max)} limit. Shorten it to post.`,
    };
  }
  const left = max - length;
  return {
    show: true,
    over: false,
    message: `${NUMBER.format(left)} ${left === 1 ? "character" : "characters"} left`,
  };
}
