import type { Db } from '@altai/db';
import { presenceSchema } from '@altai/db';
import { eq } from 'drizzle-orm';

export async function resolveServerId(db: Db, slug: string, name: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(presenceSchema.servers)
    .where(eq(presenceSchema.servers.slug, slug))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db.insert(presenceSchema.servers).values({ slug, name }).returning();
  if (!created) throw new Error(`servers satırı oluşturulamadı: ${slug}`);
  return created.id;
}
