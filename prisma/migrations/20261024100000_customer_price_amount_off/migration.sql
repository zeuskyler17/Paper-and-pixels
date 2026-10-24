-- Special prices become an amount deducted per item (no fixed price or percent). The table was still empty.
ALTER TABLE "customer_prices" DROP COLUMN "unitPrice";
ALTER TABLE "customer_prices" DROP COLUMN "discountPct";
ALTER TABLE "customer_prices" ADD COLUMN "amountOff" INTEGER NOT NULL;
