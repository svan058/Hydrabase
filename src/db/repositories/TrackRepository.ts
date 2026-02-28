import { schema } from '../schema'
import type { TrackSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, or, eq, like } from 'drizzle-orm'

export class TrackRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: TrackSearchResult) {
    const set = {
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }
    this.db.insert(schema.track).values(set).onConflictDoUpdate({ set, target: [schema.track.id, schema.track.plugin_id, schema.track.address] }).run()
  }

  upsertFromPeer(result: TrackSearchResult, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }
    this.db.insert(schema.track).values(set).onConflictDoUpdate({ set, target: [schema.track.id, schema.track.plugin_id, schema.track.address] }).run()
  }

  searchByName(query: string, includePeers = true): (TrackSearchResult & { address: `0x${string}` })[] {
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
    
  lookupByArtistIds(artistIds: Map<string, string>, includePeers = true): (TrackSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.track)
      .where(and(or(...artistIds.entries().map(([pluginId, artistId]) => and(eq(schema.track.plugin_id, pluginId), eq(schema.track.artist_id, artistId)))), includePeers ? undefined : eq(schema.track.address, '0x0')))
      .all()
      .filter(row => row.name && row.image_url && row.external_urls) // nullable cols
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        artists: row.artists.split(','),
        external_urls: JSON.parse(row.external_urls),
      }))
  }
}
