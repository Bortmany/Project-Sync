-- Daily brief digests: when the digest last ran for one company's chat channel.
--
-- Additive and safe on a populated install: one nullable column on an existing table, nothing else
-- touched. Null means "never sent", which is exactly what every existing row means today, so the
-- first sweep after 05:00 UTC sends the first digest — and only to channels whose administrator has
-- switched the new `dailyBrief` toggle on, which defaults to OFF.
--
-- The five trigram DropIndex lines Prisma generated here were DELETED BY HAND, as
-- docs/CONVENTIONS.md requires: the search indexes are hand-written raw SQL the schema does not
-- know about, and every generated migration tries to drop them.

-- AlterTable
ALTER TABLE "OrgIntegration" ADD COLUMN     "dailyBriefSentAt" TIMESTAMP(3);
