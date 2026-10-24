-- Owner/admin-approved special discount per customer (percent off every order).
ALTER TABLE "customers" ADD COLUMN "specialDiscountPct" DOUBLE PRECISION;
