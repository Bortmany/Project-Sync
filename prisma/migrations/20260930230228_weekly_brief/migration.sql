-- AlterTable
ALTER TABLE "OrgIntegration" ADD COLUMN     "weeklyBriefSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "weeklyBriefEmailedAt" TIMESTAMP(3);
