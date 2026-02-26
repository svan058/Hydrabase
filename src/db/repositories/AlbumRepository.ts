import { schema } from '../schema'
import type { AlbumSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, eq, like } from 'drizzle-orm'

export class AlbumRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: AlbumSearchResult) {
    this.db.insert(schema.album).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }).onConflictDoNothing().run()
  }

  upsertFromPeer(result: AlbumSearchResult, peerAddress: `0x${string}`) {
    this.db.insert(schema.album).values({
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }).onConflictDoNothing().run()
  }

  searchByName(query: string, includePeers = false): (TrackSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.album)
      .where(and(like(schema.album.name, `%${query}%`), includePeers ? undefined : eq(schema.album.address, '0x0')))
      .all()
      .filter(row => row.name && row.image_url && row.external_urls) // nullable cols
      .map(row => ({
        ...row,
        address: row.address as `0x${string}`,
        name: row.name!,
        artists: row.artists?.split(',') ?? [],
        release_date: row.release_date ?? '',
        total_tracks: row.total_tracks ?? 0,
        album_type: row.album_type ?? '',
        image_url: row.image_url!,
        external_urls: JSON.parse(row.external_urls!),
      }))
  }
}
