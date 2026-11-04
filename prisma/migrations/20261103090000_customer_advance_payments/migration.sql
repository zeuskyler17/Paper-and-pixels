-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ADVANCE';

-- CreateTable
CREATE TABLE "customer_deposits" (
    "id" SERIAL NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "accountId" INTEGER,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" INTEGER NOT NULL,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_uses" (
    "id" SERIAL NOT NULL,
    "depositId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "deposit_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_deposits_receiptNo_key" ON "customer_deposits"("receiptNo");

-- CreateIndex
CREATE INDEX "customer_deposits_customerId_idx" ON "customer_deposits"("customerId");

-- CreateIndex
CREATE INDEX "customer_deposits_receivedAt_idx" ON "customer_deposits"("receivedAt");

-- CreateIndex
CREATE INDEX "deposit_uses_depositId_idx" ON "deposit_uses"("depositId");

-- CreateIndex
CREATE INDEX "deposit_uses_paymentId_idx" ON "deposit_uses"("paymentId");

-- AddForeignKey
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "payment_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_uses" ADD CONSTRAINT "deposit_uses_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "customer_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_uses" ADD CONSTRAINT "deposit_uses_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

