-- Internal customers (the shop's own branches): orders to them are stock transfers, not sales — no prices, no payments.
ALTER TABLE "customers" ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false;
