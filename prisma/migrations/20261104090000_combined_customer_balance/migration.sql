-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "combineBalances" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "combinedPaymentId" INTEGER;

-- CreateTable
CREATE TABLE "combined_payments" (
    "id" SERIAL NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "accountId" INTEGER,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "combined_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "combined_payments_receiptNo_key" ON "combined_payments"("receiptNo");

-- CreateIndex
CREATE INDEX "combined_payments_customerId_idx" ON "combined_payments"("customerId");

-- CreateIndex
CREATE INDEX "combined_payments_paidAt_idx" ON "combined_payments"("paidAt");

-- CreateIndex
CREATE INDEX "payments_combinedPaymentId_idx" ON "payments"("combinedPaymentId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_combinedPaymentId_fkey" FOREIGN KEY ("combinedPaymentId") REFERENCES "combined_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_payments" ADD CONSTRAINT "combined_payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_payments" ADD CONSTRAINT "combined_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combined_payments" ADD CONSTRAINT "combined_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

