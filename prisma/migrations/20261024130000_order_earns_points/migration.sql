-- Orders that used a special customer discount earn no loyalty points.
ALTER TABLE "orders" ADD COLUMN "earnsPoints" BOOLEAN NOT NULL DEFAULT true;
