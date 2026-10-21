-- Marks a deduction whose materials were put back in stock (job / order cancelled).
ALTER TABLE "stock_movements" ADD COLUMN "returnedAt" TIMESTAMP(3);
