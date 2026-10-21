-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INVENTORY';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "releasedToId" INTEGER;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_releasedToId_fkey" FOREIGN KEY ("releasedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

