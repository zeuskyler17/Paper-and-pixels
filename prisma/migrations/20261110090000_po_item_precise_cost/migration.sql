-- PO unit cost may hold fractions of a centavo (roll paper ordered per roll, stocked per cm).
ALTER TABLE "purchase_order_items" ALTER COLUMN "unitCost" SET DATA TYPE DOUBLE PRECISION;
