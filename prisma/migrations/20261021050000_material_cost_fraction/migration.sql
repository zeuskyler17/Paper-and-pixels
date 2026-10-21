-- Material / movement unit cost may hold fractions of a centavo (roll paper priced per cm).
ALTER TABLE "materials" ALTER COLUMN "unitCost" TYPE DOUBLE PRECISION;
ALTER TABLE "stock_movements" ALTER COLUMN "unitCost" TYPE DOUBLE PRECISION;
