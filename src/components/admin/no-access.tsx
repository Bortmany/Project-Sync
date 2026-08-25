// What someone sees if they reach an Admin page without administrator rights. The real gate is the
// assertCan inside the services — this is only the polite way of saying no.

import { Card } from "@/components/ui";

export function NoAccess() {
  return (
    <Card title="Admin">
      <p className="text-sm text-[var(--olng-text)]">
        This page is for administrators. Ask your Project Nexus admin if you need something changed
        here.
      </p>
    </Card>
  );
}
