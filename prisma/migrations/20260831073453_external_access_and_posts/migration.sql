-- External (contractor) access and the noticeboard.
--
-- Additive only: nothing existing is dropped, renamed or made stricter, so this is safe on a
-- populated database. Every new column carries a default or is nullable, so existing rows keep
-- working: every project starts with externalSignoffRequired = true (the safe direction), every
-- company with broadcastPolicy = 'ADMIN_PM', and companyName is null for everyone already here.
--
-- The generated diff's five trigram DropIndex lines (DisciplineTask_title, Document_title,
-- MainTask_title, Project_name, User_name) were DELETED BY HAND, as every migration in this repo
-- does: those indexes are hand-written raw SQL the Prisma schema does not know about.
--
-- The two ALTER TYPE ... ADD VALUE statements are safe inside the migration's transaction because
-- neither new value is USED anywhere in this migration (Postgres only refuses the two together).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ANNOUNCEMENT';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EXTERNAL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "broadcastPolicy" TEXT NOT NULL DEFAULT 'ADMIN_PM';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "externalSignoffRequired" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyName" TEXT;

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT,
    "disciplineId" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostDismissal" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Post_orgId_kind_createdAt_idx" ON "Post"("orgId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_orgId_disciplineId_idx" ON "Post"("orgId", "disciplineId");

-- CreateIndex
CREATE INDEX "Post_orgId_projectId_idx" ON "Post"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "Post_parentId_idx" ON "Post"("parentId");

-- CreateIndex
CREATE INDEX "PostDismissal_userId_idx" ON "PostDismissal"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostDismissal_postId_userId_key" ON "PostDismissal"("postId", "userId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_disciplineId_fkey" FOREIGN KEY ("disciplineId") REFERENCES "Discipline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDismissal" ADD CONSTRAINT "PostDismissal_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostDismissal" ADD CONSTRAINT "PostDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
