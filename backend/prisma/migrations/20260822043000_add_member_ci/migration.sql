-- El CI es obligatorio para los registros nuevos y único dentro de cada gimnasio.
-- A filas anteriores se les asigna un marcador de 11 dígitos que el administrador
-- debe sustituir por el CI real. El prefijo 000000 permite identificarlas fácilmente.
ALTER TABLE "Member" ADD COLUMN "ci" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "gymId" ORDER BY "createdAt", "id") AS row_number
  FROM "Member"
)
UPDATE "Member" AS member
SET "ci" = '000000' || LPAD(numbered.row_number::TEXT, 5, '0')
FROM numbered
WHERE member."id" = numbered."id";

ALTER TABLE "Member" ALTER COLUMN "ci" SET NOT NULL;
CREATE UNIQUE INDEX "Member_gymId_ci_key" ON "Member"("gymId", "ci");
