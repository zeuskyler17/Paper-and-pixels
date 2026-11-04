-- Lay Flat albums get a separate print job: Job.kind (MAIN | PRINT), one job per (line, kind); Product.printJob flag.
CREATE TYPE "JobKind" AS ENUM ('MAIN', 'PRINT');
ALTER TABLE "jobs" ADD COLUMN "kind" "JobKind" NOT NULL DEFAULT 'MAIN';
DROP INDEX IF EXISTS "jobs_orderItemId_key";
CREATE UNIQUE INDEX "jobs_orderItemId_kind_key" ON "jobs"("orderItemId", "kind");
ALTER TABLE "products" ADD COLUMN "printJob" BOOLEAN NOT NULL DEFAULT false;
-- Lay Flat wedding albums come with their pages printed.
UPDATE "products" SET "printJob" = true WHERE "name" ILIKE '%lay%flat%';
