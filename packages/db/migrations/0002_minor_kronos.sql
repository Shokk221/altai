DROP INDEX IF EXISTS "players_eos_idx";--> statement-breakpoint
ALTER TABLE "players" ALTER COLUMN "steam_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_eos_id_unique" UNIQUE("eos_id");--> statement-breakpoint
-- Elle eklendi: en az bir kimlik şartı. steam_id artık nullable ama kimliksiz
-- bir oyuncu satırının hiçbir değeri yok — ne agent'ın canlı verisiyle ne de
-- ban listesiyle eşleşebilir. Drizzle şemada CHECK ifade edemiyor.
ALTER TABLE "players"
  ADD CONSTRAINT "players_has_identity"
  CHECK ("steam_id" IS NOT NULL OR "eos_id" IS NOT NULL);
