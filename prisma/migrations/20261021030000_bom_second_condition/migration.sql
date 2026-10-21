-- A material line can depend on two chosen values (e.g. Size = 10x14 AND Paper = Luster).
ALTER TABLE "bill_of_materials" ADD COLUMN "optionValue2Id" INTEGER;
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_optionValue2Id_fkey" FOREIGN KEY ("optionValue2Id") REFERENCES "product_option_values"("id") ON DELETE SET NULL ON UPDATE CASCADE;
