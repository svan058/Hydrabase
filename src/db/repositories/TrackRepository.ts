import { schema } from '../schema'
import type { TrackSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, eq, like } from 'drizzle-orm'

export class TrackRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: TrackSearchResult) {
    this.db.insert(schema.track).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: TrackSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.track).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }

  searchByName(query: string, includePeers = false): (TrackSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.track)
      .where(and(like(schema.track.name, `%${query}%`), includePeers ? undefined : eq(schema.track.address, '0x0')))
      .all()
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        artists: row.artists.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }
}
