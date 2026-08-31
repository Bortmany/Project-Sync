-- The five trigram DropIndex lines Prisma generates here were deleted by hand, as every migration
-- in this repo does: the search indexes are hand-written raw SQL the schema does not know about.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingCustomerId" TEXT,
ADD COLUMN     "billingSubscriptionId" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "orgId" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_eventId_key" ON "BillingEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
