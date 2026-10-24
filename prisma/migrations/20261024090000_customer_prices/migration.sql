-- Special prices per customer and product (fixed unit price or percent off).
CREATE TABLE "customer_prices" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "unitPrice" INTEGER,
    "discountPct" DOUBLE PRECISION,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_prices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_prices_customerId_productId_key" ON "customer_prices"("customerId", "productId");
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_prices" ADD CONSTRAINT "customer_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
