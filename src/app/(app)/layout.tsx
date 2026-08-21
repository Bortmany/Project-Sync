// The signed-in shell: everything inside here requires a session.

import { requireUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { Providers } from "./providers";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <Providers>
      <div className="flex min-h-screen">
        <Sidebar role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar name={user.name} email={user.email} role={user.role} />
          <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
