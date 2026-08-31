-- The five trigram DropIndex lines Prisma generates here were deleted by hand, as every migration
-- in this repo does: the search indexes are hand-written raw SQL the schema does not know about.

-- AlterTable
ALTER TABLE "BillingEvent" ADD COLUMN     "occurredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "BillingEvent_orgId_occurredAt_idx" ON "BillingEvent"("orgId", "occurredAt");
