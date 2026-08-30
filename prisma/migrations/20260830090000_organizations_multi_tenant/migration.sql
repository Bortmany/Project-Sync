-- Organizations: the app becomes Tielora, one database serving many companies
-- (main-session-approved schema amendment — the SaaS conversion, Milestone 1).
--
-- Every tenant-owned row now reaches its organisation through one of three required columns:
-- User.orgId, Discipline.orgId and Project.orgId. Everything else in the schema hangs off one of
-- those three, so there is exactly one join away from "whose data is this?".
--
-- SAFE ON A POPULATED DATABASE. The three columns end up NOT NULL, but they are added nullable,
-- backfilled, and only then tightened — Postgres rejects a NOT NULL column with no default on a
-- table that already has rows. The backfill creates ONE "Legacy workspace" organisation and puts
-- everything that was already here inside it; on an empty database the guard finds nothing to move
-- and no organisation is created, so a fresh install starts with no junk company.
--
-- HAND-EDITED, as docs/CONVENTIONS.md requires: the generated diff carried five `DropIndex` lines
-- for the hand-written trigram search indexes (Project_name_trgm_idx, MainTask_title_trgm_idx,
-- DisciplineTask_title_trgm_idx, Document_title_trgm_idx, User_name_trgm_idx) because the Prisma
-- schema does not know about them. Those five lines were deleted — dropping them would silently
-- make global search slow. The two DropIndex lines that remain are deliberate: the global
-- uniqueness of a discipline code and a project code is what becomes per-organisation below.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industryTemplate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- AlterTable: nullable first, so a database with rows in it can take the column at all.
ALTER TABLE "Discipline" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "Project" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "User" ADD COLUMN     "orgId" TEXT;

-- Backfill: everything that already existed belongs to one legacy company.
-- Nothing happens on an empty database — the IF finds no rows and no organisation is inserted.
DO $$
DECLARE
  legacy_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "orgId" IS NULL)
     OR EXISTS (SELECT 1 FROM "Discipline" WHERE "orgId" IS NULL)
     OR EXISTS (SELECT 1 FROM "Project" WHERE "orgId" IS NULL)
  THEN
    legacy_id := 'org_legacy_workspace';

    INSERT INTO "Organization" ("id", "name", "slug", "industryTemplate", "createdAt")
    VALUES (legacy_id, 'Legacy workspace', 'legacy', 'OIL_AND_GAS', CURRENT_TIMESTAMP)
    ON CONFLICT ("slug") DO NOTHING;

    UPDATE "User" SET "orgId" = legacy_id WHERE "orgId" IS NULL;
    UPDATE "Discipline" SET "orgId" = legacy_id WHERE "orgId" IS NULL;
    UPDATE "Project" SET "orgId" = legacy_id WHERE "orgId" IS NULL;
  END IF;
END $$;

-- Now the columns can be required.
ALTER TABLE "Discipline" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "orgId" SET NOT NULL;

-- DropIndex
DROP INDEX "Discipline_code_key";

-- DropIndex
DROP INDEX "Project_code_key";

-- CreateIndex
-- On a populated install these three are the step that can fail: two disciplines sharing a code or
-- a name, or two projects sharing a code, are all legal today and become a clash once everything
-- sits in one legacy company. Clean the duplicates up first if that happens.
CREATE UNIQUE INDEX "Discipline_orgId_code_key" ON "Discipline"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Discipline_orgId_name_key" ON "Discipline"("orgId", "name");

-- CreateIndex
CREATE INDEX "Project_orgId_deletedAt_idx" ON "Project"("orgId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");

-- CreateIndex
CREATE INDEX "User_orgId_isActive_idx" ON "User"("orgId", "isActive");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
