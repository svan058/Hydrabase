import { schema } from '../schema'
import type { ArtistSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, eq, like } from 'drizzle-orm'

export class ArtistRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: ArtistSearchResult) {
    this.db.insert(schema.artist).values({
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: ArtistSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.artist).values({
      ...result,
      genres: result.genres.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }

  searchByName(query: string, includePeers = false): (TrackSearchResult & { address: `0x${string}` })[] {
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
}
