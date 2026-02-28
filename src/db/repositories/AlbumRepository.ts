import { schema } from '../schema'
import type { AlbumSearchResult } from '../../Metadata'
import type { DB } from '..'
import { and, or, eq, like } from 'drizzle-orm'

export class AlbumRepository {
  constructor(private readonly db: DB) {}

  upsertFromPlugin(result: AlbumSearchResult) {
    const set = {
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: '0x0',
      confidence: 1,
    }
    this.db.insert(schema.album).values(set).onConflictDoUpdate({ set, target: [schema.album.id, schema.album.plugin_id, schema.album.address] }).run()
  }

  upsertFromPeer(result: AlbumSearchResult, peerAddress: `0x${string}`) {
    const set = {
      ...result,
      artists: result.artists.join(','),
      external_urls: JSON.stringify(result.external_urls),
      address: peerAddress,
    }
    this.db.insert(schema.album).values(set).onConflictDoUpdate({ set, target: [schema.album.id, schema.album.plugin_id, schema.album.address] }).run()
  }

  searchByName(query: string, includePeers = true): (AlbumSearchResult & { address: `0x${string}` })[] {
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
  
  lookupByArtistIds(artistIds: Map<string, string>, includePeers = true): (AlbumSearchResult & { address: `0x${string}` })[] {
    return this.db.select().from(schema.album)
      .where(and(or(...artistIds.entries().map(([pluginId, artistId]) => and(eq(schema.album.plugin_id, pluginId), eq(schema.album.artist_id, artistId)))), includePeers ? undefined : eq(schema.album.address, '0x0')))
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
