// The Messages section's gate for contractors, the same shape as the Admin one. THE EXTERNAL RULE: a
// contractor has no noticeboard, so /messages is the ordinary not-found page for them. It lives in
// the layout rather than only in the page because the page sits under loading.tsx: a not-found
// raised there arrives after the stream has started, and the browser is told 200. From the layout it
// is a real 404, exactly like /admin.

import { hideFromContractors } from "@/server/page-guards";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  await hideFromContractors();
  return children;
}
