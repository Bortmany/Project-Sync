-- The five trigram DropIndex lines Prisma generates were deleted by hand, as every migration in
-- this repo does: the search indexes are hand-written raw SQL the schema does not know about.
--
-- Additive only, and safe on a populated database: three new columns on "Post", all with defaults
-- that mean "exactly what this post already was" (no acknowledgement asked for, no contractors
-- included, no document attached), plus one new table nobody has a row in yet.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "includeExternals" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresAck" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PostAck" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostAck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostAck_userId_idx" ON "PostAck"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostAck_postId_userId_key" ON "PostAck"("postId", "userId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAck" ADD CONSTRAINT "PostAck_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAck" ADD CONSTRAINT "PostAck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
