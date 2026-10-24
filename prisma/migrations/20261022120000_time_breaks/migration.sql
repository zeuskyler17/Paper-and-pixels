-- Break punches on the time clock, over-break minutes, and a per-employee late grace period.
ALTER TABLE "employees" ADD COLUMN "lateGraceMinutes" INTEGER;
ALTER TABLE "time_entries" ADD COLUMN "overbreakMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "time_breaks" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startByUserId" INTEGER,
    "endByUserId" INTEGER,
    "deviceId" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "time_breaks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "time_breaks_entryId_idx" ON "time_breaks"("entryId");
ALTER TABLE "time_breaks" ADD CONSTRAINT "time_breaks_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "time_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
