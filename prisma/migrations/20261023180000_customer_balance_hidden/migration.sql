-- Owner/admin can hide a customer's balance (receivable) from non-admin logins.
ALTER TABLE "customers" ADD COLUMN "balanceHidden" BOOLEAN NOT NULL DEFAULT false;
