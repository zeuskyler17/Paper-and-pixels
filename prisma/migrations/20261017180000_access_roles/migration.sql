-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accessRoleId" INTEGER;

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accessRoleId_fkey" FOREIGN KEY ("accessRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preset roles with today's access, then link every existing user to the matching role.
INSERT INTO "roles" ("name", "description", "permissions", "isAdmin", "sortOrder", "updatedAt") VALUES
  ('Admin (owner)', 'Full access to everything. Locked.', ARRAY[]::TEXT[], true, 0, CURRENT_TIMESTAMP),
  ('Cashier / Staff', 'Counter staff: orders, payments, customers, production board, deliveries, inventory, purchasing, expenses.',
     ARRAY['dashboard','orders','customers','jobs_manage','deliveries','products_view','inventory','purchasing','expenses'], false, 1, CURRENT_TIMESTAMP),
  ('Production worker', 'Sees and works on their own assigned jobs.', ARRAY['jobs_own'], false, 2, CURRENT_TIMESTAMP),
  ('Inventory personnel', 'Stockroom: materials, stock out, counts and conversions.', ARRAY['inventory'], false, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

UPDATE "users" u SET "accessRoleId" = r."id" FROM "roles" r
WHERE u."accessRoleId" IS NULL AND r."name" = CASE u."role"
  WHEN 'ADMIN' THEN 'Admin (owner)'
  WHEN 'STAFF' THEN 'Cashier / Staff'
  WHEN 'WORKER' THEN 'Production worker'
  WHEN 'INVENTORY' THEN 'Inventory personnel'
END;
