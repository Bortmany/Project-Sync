-- Workspace deletion, with a seven-day grace period.
--
-- ADDITIVE ONLY: two nullable columns on Organization and one foreign key. Nothing is dropped,
-- renamed or made stricter, and null on both columns — which is what every existing workspace
-- means — reads as "nobody has asked for this workspace to be deleted", so nothing changes for
-- anybody when it is applied.
--
-- The DEADLINE is deliberately not a column: it is deleteRequestedAt plus the grace period, worked
-- out at read time exactly as OVERDUE and a locked phase are.
--
-- The five generated `DropIndex` lines for the hand-written trigram search indexes were deleted by
-- hand, as every migration in this repo does (see docs/CONVENTIONS.md, "Migration pattern").

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "deleteRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deleteRequestedById" TEXT;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_deleteRequestedById_fkey" FOREIGN KEY ("deleteRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
