-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'kiosque';

-- CreateTable
CREATE TABLE "MachinePunch" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "pinKey" TEXT NOT NULL,
    "punchedAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "deviceSn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachinePunch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MachinePunch_pinKey_punchedAt_key" ON "MachinePunch"("pinKey", "punchedAt");

-- CreateIndex
CREATE INDEX "MachinePunch_punchedAt_idx" ON "MachinePunch"("punchedAt");
