-- Contractor access expiry: when an external contractor's access to this workspace ends.
--
-- Additive and safe on a populated install: one nullable column on an existing table, nothing else
-- touched. Null means "no expiry", which is exactly what every existing account means today, so
-- nobody who can sign in now loses access when this is applied. Only an EXTERNAL contractor ever
-- carries a date here — the admin service clears it for every other role — and "expired" itself is
-- never stored: it is derived from this date at read time, the same way OVERDUE is.
--
-- The five trigram DropIndex lines Prisma generated here were DELETED BY HAND, as
-- docs/CONVENTIONS.md requires: the search indexes are hand-written raw SQL the schema does not
-- know about, and every generated migration tries to drop them.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accessExpiresAt" TIMESTAMP(3);
