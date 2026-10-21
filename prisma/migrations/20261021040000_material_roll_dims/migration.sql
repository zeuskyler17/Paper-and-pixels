-- Photo paper rolls: width and length per roll, so stock in metres can be shown as rolls.
ALTER TABLE "materials" ADD COLUMN "rollWidthCm" DOUBLE PRECISION, ADD COLUMN "rollLengthM" DOUBLE PRECISION;
