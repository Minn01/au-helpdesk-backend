ALTER TABLE "users"
ADD COLUMN "microsoftTenantId" UUID,
ADD COLUMN "microsoftObjectId" UUID;

CREATE UNIQUE INDEX "users_microsoftTenantId_microsoftObjectId_key"
ON "users"("microsoftTenantId", "microsoftObjectId");
