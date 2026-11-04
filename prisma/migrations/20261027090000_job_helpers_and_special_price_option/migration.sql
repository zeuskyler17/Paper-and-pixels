-- Special discounts can target one option value (e.g. a Leaves count); jobs can have extra workers (helpers).
ALTER TABLE "customer_prices" ADD COLUMN "optionValueId" INTEGER;
DROP INDEX IF EXISTS "customer_prices_customerId_productId_key";
CREATE UNIQUE INDEX "customer_prices_customerId_productId_optionValueId_key" ON "customer_prices"("customerId", "productId", "optionValueId");
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_optionValueId_fkey" FOREIGN KEY ("optionValueId") REFERENCES "product_option_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "job_helpers" (
    "jobId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "addedById" INTEGER,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_helpers_pkey" PRIMARY KEY ("jobId","userId")
);
CREATE INDEX "job_helpers_userId_idx" ON "job_helpers"("userId");
ALTER TABLE "job_helpers" ADD CONSTRAINT "job_helpers_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_helpers" ADD CONSTRAINT "job_helpers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
