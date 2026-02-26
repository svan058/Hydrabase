import z from 'zod';
import type { Request } from '../RequestManager'
import { CONFIG } from '../config';
import type { Repositories } from '../db';

export const TrackSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  album: z.string(),
  duration_ms: z.number(),
  popularity: z.number(),
  preview_url: z.string(),
  external_urls: z.record(z.string(), z.url()),
  image_url: z.url(),
  plugin_id: z.string(),
  confidence: z.number().min(-1).max(1)
})

export type TrackSearchResult = z.infer<typeof TrackSearchResultSchema>

export const ArtistSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  popularity: z.number(),
  genres: z.array(z.string()),
  followers: z.number(),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  image_url: z.string(),
  plugin_id: z.string(),
  confidence: z.number().min(-1).max(1)
})
export type ArtistSearchResult = z.infer<typeof ArtistSearchResultSchema>

export const AlbumSearchResultSchema = z.object({
  soul_id: z.string(),
  id: z.string(),
  name: z.string(),
  artists: z.array(z.string()),
  release_date: z.string(),
  total_tracks: z.number(),
  album_type: z.string(),
  image_url: z.url(),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  plugin_id: z.string(),
  confidence: z.number().min(-1).max(1)
})
export type AlbumSearchResult = z.infer<typeof AlbumSearchResultSchema>

export interface SearchResult {
  track: TrackSearchResult
  artist: ArtistSearchResult
  album: AlbumSearchResult
  discog: AlbumSearchResult
}

export interface MetadataPlugin {
  id: string
  searchTrack: (query: string) => Promise<TrackSearchResult[]>
  searchArtist: (query: string) => Promise<ArtistSearchResult[]>
  searchAlbum: (query: string) => Promise<AlbumSearchResult[]>
}

export default class MetadataManager implements MetadataPlugin {
  public readonly id = 'Hydrabase'
  constructor(private readonly plugins: MetadataPlugin[], private readonly db: Repositories) {}

  private mergeBySoulId<T extends { soul_id: string, address: `0x${string}` }>(primary: T[], secondary: T[]): T[] {
    const seen = new Set(primary.map(r => `${r.soul_id}:${r.address}`))
    return [...primary, ...secondary.filter(r => !seen.has(`${r.soul_id}:${r.address}`))]
  }

  async searchTrack(query: string): Promise<TrackSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.track.searchByName(query),
      ...this.plugins.map(p => p.searchTrack(query))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.track.upsertFromPlugin(result)
    return this.mergeBySoulId(results, cached)
  }

  async searchArtist(query: string): Promise<ArtistSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.artist.searchByName(query),
      ...this.plugins.map(p => p.searchArtist(query))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.artist.upsertFromPlugin(result)
    return this.mergeBySoulId(results, cached)
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.album.searchByName(query),
      ...this.plugins.map(p => p.searchAlbum(query))
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.album.upsertFromPlugin(result)
    return this.mergeBySoulId(results, cached)
  }

  async searchDiscog(artistSoulId: string): Promise<AlbumSearchResult[]> {
    const results: AlbumSearchResult[] = [];
    for (const plugin of this.plugins) {
      const artist = this.db.artist.selectBySoulId(artistSoulId)
      if (id) results.push(...await plugin.searchDiscog(id))
    }
    for (const result of results) this.db.album.upsertFromPlugin(result)
    return results.map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }));
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }) {
    console.log('LOG:', `[META] Searching for ${request.type}: ${request.query}`)
    if (request.type === 'track') return await this.searchTrack(request.query)
    if (request.type === 'artist') return await this.searchArtist(request.query)
    if (request.type === 'album') return await this.searchAlbum(request.query)
    if (request.type === 'discog') return await this.searchDiscog(request.query)
    else {
      console.warn('WARN:', 'Invalid request')
      return []
    }
  }

  public get installedPlugins(): MetadataPlugin[] { return this.plugins }
}
