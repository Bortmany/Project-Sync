// The Admin section's gate for contractors. THE EXTERNAL RULE: a contractor has no Admin area, so
// every page under /admin is the ordinary not-found page for them — never a "this is for
// administrators" screen, which would confirm the page exists. Everyone else is unaffected: internal
// staff who are not administrators still get the polite screen from the page itself.

import { hideAdminFromContractors } from "@/server/page-guards";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await hideAdminFromContractors();
  return children;
}
