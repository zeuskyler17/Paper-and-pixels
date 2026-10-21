-- GPS fix taken by the time clock at each punch (browser geolocation; WGS84 degrees, accuracy in metres).
ALTER TABLE "time_entries"
  ADD COLUMN "timeInLat" DOUBLE PRECISION,
  ADD COLUMN "timeInLng" DOUBLE PRECISION,
  ADD COLUMN "timeInAccuracy" DOUBLE PRECISION,
  ADD COLUMN "timeOutLat" DOUBLE PRECISION,
  ADD COLUMN "timeOutLng" DOUBLE PRECISION,
  ADD COLUMN "timeOutAccuracy" DOUBLE PRECISION;
