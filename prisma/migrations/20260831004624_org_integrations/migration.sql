-- Chat notifications: one webhook per kind (Slack, Teams) per organisation.
--
-- Additive and safe on a populated install: a brand-new table, nothing existing is touched, and an
-- organisation with no row here has no integration at all — dormant until an administrator pastes a
-- URL in Admin → Integrations.
--
-- `kind` is a plain string, not a Postgres enum, on purpose: a third chat tool needs no migration.
-- `webhookUrl` is a bearer secret and is never read back out by any API.
--
-- The five trigram DropIndex lines Prisma generated here were DELETED BY HAND, as
-- docs/CONVENTIONS.md requires: the search indexes are hand-written raw SQL the schema does not
-- know about, and every generated migration tries to drop them.

-- CreateTable
CREATE TABLE "OrgIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "eventToggles" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgIntegration_orgId_kind_key" ON "OrgIntegration"("orgId", "kind");

-- AddForeignKey
ALTER TABLE "OrgIntegration" ADD CONSTRAINT "OrgIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgIntegration" ADD CONSTRAINT "OrgIntegration_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
