-- Who was logged in and which device was used for each time-clock punch (to spot buddy punching).
ALTER TABLE "time_entries"
  ADD COLUMN "timeInByUserId" INTEGER,
  ADD COLUMN "timeOutByUserId" INTEGER,
  ADD COLUMN "timeInDeviceId" VARCHAR(40),
  ADD COLUMN "timeOutDeviceId" VARCHAR(40);
