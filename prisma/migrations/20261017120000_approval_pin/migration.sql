-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "voidApprovedById" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approvalPinHash" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voidApprovedById_fkey" FOREIGN KEY ("voidApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

