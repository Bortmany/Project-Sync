// Messages — the company noticeboard. The list itself is client-side so a post appears without a
// page reload, exactly like a comment thread.
//
// A contractor has no noticeboard: the sidebar never offers them this page, every read behind it
// answers "not found", and typing the address lands on the app's not-found screen rather than on an
// empty board — the same "not found, never forbidden" shape THE EXTERNAL RULE asks for everywhere.

import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { MessagesView } from "@/components/posts/messages-view";
import { SkeletonRows } from "@/components/ui";
import { currentActor } from "@/server/session";
import { isExternal } from "@/server/actor";

export const metadata = { title: "Messages — Tielora" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (isExternal(actor)) notFound();

  return (
    <Suspense fallback={<SkeletonRows rows={3} height="h-24" />}>
      <MessagesView />
    </Suspense>
  );
}
