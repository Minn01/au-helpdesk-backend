ALTER TYPE "CategorySource" ADD VALUE 'PEER_INTEGRATION';

CREATE TYPE "PeerSourceSystem" AS ENUM ('EDUCORE');

CREATE TABLE "peer_ticket_references" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticketId" UUID NOT NULL,
    "sourceSystem" "PeerSourceSystem" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "peer_ticket_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "peer_ticket_references_sourceSystem_externalEventId_key"
ON "peer_ticket_references"("sourceSystem", "externalEventId");

CREATE INDEX "peer_ticket_references_ticketId_idx"
ON "peer_ticket_references"("ticketId");

ALTER TABLE "peer_ticket_references"
ADD CONSTRAINT "peer_ticket_references_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
