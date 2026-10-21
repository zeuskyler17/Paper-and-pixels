-- What a material is for: albums, picture frames, printing, general consumables, or shared across lines.
CREATE TYPE "MaterialUse" AS ENUM ('ALBUM', 'FRAME', 'PRINTING', 'GENERAL', 'SHARED');
ALTER TABLE "materials" ADD COLUMN "usedFor" "MaterialUse";
