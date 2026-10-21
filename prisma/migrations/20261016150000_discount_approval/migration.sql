-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountApprovedById" INTEGER;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_discountApprovedById_fkey" FOREIGN KEY ("discountApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

