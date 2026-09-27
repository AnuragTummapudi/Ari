-- Add ownership and private resume object references without rewriting existing demo rows.
ALTER TABLE "Role" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "Role_ownerId_idx" ON "Role"("ownerId");
ALTER TABLE "Candidate" ADD COLUMN "resumeStorageKey" TEXT;
