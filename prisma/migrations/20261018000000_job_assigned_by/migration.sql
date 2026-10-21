-- Who delegated the job to its worker, and when.
ALTER TABLE "jobs" ADD COLUMN "assignedById" INTEGER, ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
