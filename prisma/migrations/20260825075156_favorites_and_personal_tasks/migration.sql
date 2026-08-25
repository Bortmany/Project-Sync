-- Sidebar favorites and the private personal to-do list (main-session-approved schema amendment).
--
-- HAND-EDITED, as docs/CONVENTIONS.md requires: `prisma migrate dev` generated five `DropIndex`
-- lines for the hand-written trigram search indexes (Project_name_trgm_idx, MainTask_title_trgm_idx,
-- DisciplineTask_title_trgm_idx, Document_title_trgm_idx, User_name_trgm_idx) because the Prisma
-- schema does not know about them. Those lines were deleted — dropping them would silently make
-- global search slow. The CHECK constraint at the bottom was added by hand for the same reason:
-- Prisma cannot express "exactly one of these three columns is set".

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "mainTaskId" TEXT,
    "disciplineTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_projectId_key" ON "Favorite"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_mainTaskId_key" ON "Favorite"("userId", "mainTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_disciplineTaskId_key" ON "Favorite"("userId", "disciplineTaskId");

-- CreateIndex
CREATE INDEX "PersonalTask_userId_sortOrder_idx" ON "PersonalTask"("userId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_mainTaskId_fkey" FOREIGN KEY ("mainTaskId") REFERENCES "MainTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_disciplineTaskId_fkey" FOREIGN KEY ("disciplineTaskId") REFERENCES "DisciplineTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalTask" ADD CONSTRAINT "PersonalTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A favorite points at exactly one thing: a project, a main task, or a discipline task.
-- Prisma cannot express this, so the database enforces it.
ALTER TABLE "Favorite" ADD CONSTRAINT "favorite_one_target" CHECK (num_nonnulls("projectId", "mainTaskId", "disciplineTaskId") = 1);
