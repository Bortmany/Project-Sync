-- Stage gates: a project's phases, and which phase each main task sits behind.
-- Additive and safe on a populated install: the new column is nullable (existing main tasks stay
-- unphased and are never gated) and no existing model, field, enum value or index is changed.
--
-- The five trigram DropIndex lines Prisma generated here were DELETED BY HAND, as
-- docs/CONVENTIONS.md requires: the search indexes are hand-written raw SQL the schema does not
-- know about, and every generated migration tries to drop them.

-- AlterTable
ALTER TABLE "MainTask" ADD COLUMN     "phaseId" TEXT;

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "overriddenById" TEXT,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectPhase_projectId_sortOrder_idx" ON "ProjectPhase"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPhase_projectId_name_key" ON "ProjectPhase"("projectId", "name");

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MainTask" ADD CONSTRAINT "MainTask_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
