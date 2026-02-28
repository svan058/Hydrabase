import z from 'zod';
import type { Request } from '../RequestManager'
import type { Repositories } from '../db';
import type Peers from '../Peers';
import { CONFIG } from '../config';

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
  'artist.albums': AlbumSearchResult
  'artist.tracks': TrackSearchResult
}

export interface MetadataPlugin {
  id: string
  searchTrack: (query: string) => Promise<TrackSearchResult[]>
  searchArtist: (query: string) => Promise<ArtistSearchResult[]>
  searchAlbum: (query: string) => Promise<AlbumSearchResult[]>
  lookupAlbums: (id: string, peers: Peers) => Promise<AlbumSearchResult[]>
  lookupTracks: (id: string, peers: Peers) => Promise<TrackSearchResult[]>
}

export default class MetadataManager implements MetadataPlugin {
  public readonly id = 'Hydrabase'
  constructor(private readonly plugins: MetadataPlugin[], private readonly db: Repositories) {}

  private merge<T extends { soul_id: string, address: `0x${string}` }>(primary: T[], secondary: T[]): T[] {
    const seen = new Set(primary.map(r => `${r.soul_id}:${r.address}`))
    return [...primary, ...secondary.filter(r => !seen.has(`${r.soul_id}:${r.address}`))]
  }

  async searchTrack(query: string): Promise<TrackSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.track.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchTrack(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.track.upsertFromPlugin(result)
    return this.merge(results, cached)
  }

  async searchArtist(query: string): Promise<ArtistSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.artist.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchArtist(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.artist.upsertFromPlugin(result)
    return this.merge(results, cached)
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.album.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchAlbum(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.album.upsertFromPlugin(result)
    return this.merge(results, cached)
  }

  async lookupAlbums(artistSoulId: string, peers: Peers): Promise<AlbumSearchResult[]> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({ plugin_id }) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return p.lookupAlbums(id, peers)
      }

      const bestId = matchArtistId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.lookupAlbums(bestId.id, peers)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }
    }))).filter(result => result !== undefined)
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.album.upsertFromPlugin(result)
    const cached = this.db.album.lookupByArtistIds(artistIds)
    return this.merge(results, cached)
  }

  async lookupTracks(artistSoulId: string, peers: Peers): Promise<TrackSearchResult[]> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({ plugin_id }) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return p.lookupTracks(id, peers)
      }

      const bestId = matchArtistId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.lookupTracks(bestId.id, peers)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }
    }))).filter(result => result !== undefined)
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) this.db.track.upsertFromPlugin(result)
    const cached = this.db.track.lookupByArtistIds(artistIds)
    return this.merge(results, cached)
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }, peers: Peers) {
    console.log('LOG:', `[META] Searching for ${request.type}: ${request.query}`)
    if (request.type === 'track') return await this.searchTrack(request.query)
    if (request.type === 'artist') return await this.searchArtist(request.query)
    if (request.type === 'album') return await this.searchAlbum(request.query)
    if (request.type === 'artist.albums') return await this.lookupAlbums(request.query, peers)
    if (request.type === 'artist.tracks') return await this.lookupTracks(request.query, peers)
    else {
      console.warn('WARN:', 'Invalid request')
      return []
    }
  }

  public get installedPlugins(): MetadataPlugin[] { return this.plugins }
}

const matchArtistId = (pluginArtists: (ArtistSearchResult & { address: `0x${string}` })[], peers: Peers): { id: string, confidence: number } | undefined => {
  const votes = new Map<string, { peerConfidences: number[], artistConfidences: number[] }>()
  for (const artist of pluginArtists) {
    const pastVotes = votes.get(artist.id) ?? { peerConfidences: [], artistConfidences: [] }
    pastVotes.artistConfidences.push(artist.confidence)
    pastVotes.peerConfidences.push(peers.getConfidence(artist.address))
    votes.set(artist.id, pastVotes)
  }

  const artistConfidences = new Map<string, number>()
  for (const entry of votes) {
    const [artistId, votes] = entry
    artistConfidences.set(artistId, computeConfidence(votes.artistConfidences, votes.peerConfidences))
  }

  const id = artistConfidences.size ? [...artistConfidences.entries()].reduce((a, b) => b[1] > a[1] ? b : a) : undefined
  return id ? { id: id[0], confidence: id[1] } : undefined
}

const computeConfidence = (artistConfidences: number[], peerConfidences: number[], k = 1.0): number => {
  if (peerConfidences.length === 0) return 0.5;

  let numerator = 0;
  let denominator = k;

  for (let i = 0; i < peerConfidences.length; i++) {
    const signal = (peerConfidences[i]! - 0.5) * 2;
    numerator += artistConfidences[i]! * signal;
    denominator += artistConfidences[i]!;
  }

  const raw = numerator / denominator;
  return (raw / 2) + 0.5;
}
