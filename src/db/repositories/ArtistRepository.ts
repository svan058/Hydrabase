import { schema } from '../schema'
import type { ArtistSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, eq, like } from 'drizzle-orm'

export class ArtistRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: ArtistSearchResult) {
    const set = {
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }
    this.db.insert(schema.artist).values(set).onConflictDoUpdate({ set, target: [schema.artist.id, schema.artist.plugin_id, schema.artist.address] }).run()
  }

  upsertFromPeer(result: ArtistSearchResult, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }
    this.db.insert(schema.artist).values(set).onConflictDoUpdate({ set, target: [schema.artist.id, schema.artist.plugin_id, schema.artist.address] }).run()
  }

  searchByName(query: string, includePeers = true): (ArtistSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.artist)
      .where(and(like(schema.artist.name, `%${query}%`), includePeers ? undefined : eq(schema.artist.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        genres: row.genres.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }

  lookupBySoulId(soulId: string, includePeers = true): (ArtistSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.artist)
      .where(and(eq(schema.artist.soul_id, soulId), includePeers ? undefined : eq(schema.artist.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        genres: row.genres.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }
}
