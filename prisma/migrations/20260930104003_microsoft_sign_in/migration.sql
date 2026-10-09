-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "entraTenantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "microsoftOid" TEXT,
ADD COLUMN     "microsoftTenantId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_entraTenantId_key" ON "Organization"("entraTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_microsoftTenantId_microsoftOid_key" ON "User"("microsoftTenantId", "microsoftOid");
