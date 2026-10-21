-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "timeInPhotoId" INTEGER,
ADD COLUMN     "timeOutPhotoId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_timeInPhotoId_key" ON "time_entries"("timeInPhotoId");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_timeOutPhotoId_key" ON "time_entries"("timeOutPhotoId");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timeInPhotoId_fkey" FOREIGN KEY ("timeInPhotoId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timeOutPhotoId_fkey" FOREIGN KEY ("timeOutPhotoId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

