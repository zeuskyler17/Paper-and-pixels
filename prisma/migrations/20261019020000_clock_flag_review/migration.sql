-- An admin can mark a flagged punch as checked (with a note); the flag then shows grey and leaves the alerts.
ALTER TABLE "time_entries"
  ADD COLUMN "flagsClearedAt" TIMESTAMP(3),
  ADD COLUMN "flagsClearedById" INTEGER,
  ADD COLUMN "flagsClearNote" VARCHAR(300);
