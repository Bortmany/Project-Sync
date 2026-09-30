-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyBriefEmailedAt" TIMESTAMP(3),
ADD COLUMN     "emailAlerts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailDailyBrief" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailWeeklyBrief" BOOLEAN NOT NULL DEFAULT false;
