import z from 'zod';

import type { Repositories } from '../db';
import type Peers from '../Peers';
import type { Request } from '../RequestManager'

import { CONFIG } from '../config';
import { log, warn } from '../log';

export const TrackSearchResultSchema = z.object({
  album: z.string(),
  artists: z.array(z.string()),
  confidence: z.number().min(-1).max(1),
  duration_ms: z.number(),
  external_urls: z.record(z.string(), z.url()),
  id: z.string(),
  image_url: z.url(),
  name: z.string(),
  plugin_id: z.string(),
  popularity: z.number(),
  preview_url: z.string(),
  soul_id: z.string()
})

export type TrackSearchResult = z.infer<typeof TrackSearchResultSchema>

export const ArtistSearchResultSchema = z.object({
  confidence: z.number().min(-1).max(1),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  followers: z.number(),
  genres: z.array(z.string()),
  id: z.string(),
  image_url: z.string(),
  name: z.string(),
  plugin_id: z.string(),
  popularity: z.number(),
  soul_id: z.string()
})
export type ArtistSearchResult = z.infer<typeof ArtistSearchResultSchema>

export const AlbumSearchResultSchema = z.object({
  album_type: z.string(),
  artists: z.array(z.string()),
  confidence: z.number().min(-1).max(1),
  external_urls: z.object({
    itunes: z.url(),
    spotify: z.url()
  }).partial(),
  id: z.string(),
  image_url: z.url(),
  name: z.string(),
  plugin_id: z.string(),
  release_date: z.string(),
  soul_id: z.string(),
  total_tracks: z.number()
})
export type AlbumSearchResult = z.infer<typeof AlbumSearchResultSchema>

export interface MetadataPlugin {
  id: string
  lookupAlbums: (id: string, peers: Peers) => Promise<AlbumSearchResult[]>
  lookupTracks: (id: string, peers: Peers) => Promise<TrackSearchResult[]>
  searchAlbum: (query: string) => Promise<AlbumSearchResult[]>
  searchArtist: (query: string) => Promise<ArtistSearchResult[]>
  searchTrack: (query: string) => Promise<TrackSearchResult[]>
}

export interface SearchResult {
  album: AlbumSearchResult
  artist: ArtistSearchResult
  'artist.albums': AlbumSearchResult
  'artist.tracks': TrackSearchResult
  track: TrackSearchResult
}

const computeConfidence = (artistConfidences: number[], peerConfidences: number[], k = 1.0): number => {
  if (peerConfidences.length === 0) return 0.5

  let numerator = 0
  let denominator = k

  for (let i = 0; i < peerConfidences.length; i++) {
    const artistConfidence = artistConfidences[i] ?? 0
    numerator += artistConfidence * ((peerConfidences[i] ?? 0) - 0.5) * 2
    denominator += artistConfidence
  }

  return ((numerator / denominator) / 2) + 0.5
}

const matchArtistId = (pluginArtists: (ArtistSearchResult & { address: `0x${string}` })[], peers: Peers): undefined | { confidence: number; id: string } => {
  const votes = new Map<string, { artistConfidences: number[]; peerConfidences: number[], }>()
  for (const artist of pluginArtists) {
    const pastVotes = votes.get(artist.id) ?? { artistConfidences: [], peerConfidences: [] }
    votes.set(artist.id, {
      artistConfidences: [...pastVotes.artistConfidences, artist.confidence],
      peerConfidences: [...pastVotes.peerConfidences, peers.getConfidence(artist.address)]
    })
  }

  const artistConfidences = new Map<string, number>()
  for (const entry of votes) {
    const [artistId, votes] = entry
    artistConfidences.set(artistId, computeConfidence(votes.artistConfidences, votes.peerConfidences))
  }

  const id = artistConfidences.size ? [...artistConfidences.entries()].reduce((a, b) => !a || b[1] > a[1] ? b : a, [...artistConfidences.entries()][0]) : undefined
  return id ? { confidence: id[1], id: id[0] } : undefined
}

export default class MetadataManager implements MetadataPlugin {
  public readonly id = 'Hydrabase'
  public get installedPlugins(): MetadataPlugin[] { return this.plugins }

  constructor(private readonly plugins: MetadataPlugin[], private readonly db: Repositories) {}

  private static merge<T extends { address: `0x${string}`; soul_id: string, }>(primary: T[], secondary: T[]): T[] {
    const seen = new Set(primary.map(r => `${r.soul_id}:${r.address}`))
    return [...primary, ...secondary.filter(r => !seen.has(`${r.soul_id}:${r.address}`))]
  }

  public async handleRequest<T extends Request['type']>(request: Request & { type: T }, peers: Peers) {
    log('LOG:', `[META] Searching for ${request.type}: ${request.query}`)
    if (request.type === 'track') return await this.searchTrack(request.query)
    else if (request.type === 'artist') return await this.searchArtist(request.query)
    else if (request.type === 'album') return await this.searchAlbum(request.query)
    else if (request.type === 'artist.albums') return await this.lookupAlbums(request.query, peers)
    else if (request.type === 'artist.tracks') return await this.lookupTracks(request.query, peers)
    warn('DEVWARN:', `[HIP2] Invalid request ${request.type}`)
    return []
  }

  async lookupAlbums(artistSoulId: string, peers: Peers): Promise<AlbumSearchResult[]> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({ plugin_id }) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return (await p.lookupAlbums(id, peers)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }

      const bestId = matchArtistId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.lookupAlbums(bestId.id, peers)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }
      return []
    })))
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.album.upsertFromPlugin(result)}
    const cached = this.db.album.lookupByArtistIds(artistIds)
    return MetadataManager.merge(results, cached)
  }

  async lookupTracks(artistSoulId: string, peers: Peers): Promise<TrackSearchResult[]> {
    const artists = this.db.artist.lookupBySoulId(artistSoulId)
    const artistIds = new Map<string, string>()
    const pluginResults = (await Promise.all(this.plugins.map(async p => {
      const pluginArtists = artists.filter(({ plugin_id }) => plugin_id === p.id)
      const { id } = pluginArtists.find(({address}) => address === '0x0') ?? {}
      if (id) {
        artistIds.set(p.id, id)
        return (await p.lookupTracks(id, peers)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }

      const bestId = matchArtistId(pluginArtists, peers)
      if (bestId) {
        artistIds.set(p.id, bestId.id)
        return (await p.lookupTracks(bestId.id, peers)).map(result => ({ ...result, confidence: (result.confidence+bestId.confidence)/2, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      }
      return []
    })))
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.track.upsertFromPlugin(result)}
    const cached = this.db.track.lookupByArtistIds(artistIds)
    return MetadataManager.merge(results, cached)
  }

  async searchAlbum(query: string): Promise<AlbumSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.album.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchAlbum(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.album.upsertFromPlugin(result)}
    return MetadataManager.merge(results, cached)
  }

  async searchArtist(query: string): Promise<ArtistSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.artist.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchArtist(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.artist.upsertFromPlugin(result)}
    return MetadataManager.merge(results, cached)
  }

  async searchTrack(query: string): Promise<TrackSearchResult[]> {
    const [cached, ...pluginResults] = await Promise.all([
      this.db.track.searchByName(query),
      ...this.plugins.map(async p =>
        (await p.searchTrack(query)).map(result => ({ ...result, soul_id: `soul_${Bun.hash(`${result.plugin_id}:${result.id}`.slice(0, CONFIG.soulIdCutoff))}` }))
      )
    ])
    const results = pluginResults.flat().map(result => ({ ...result, address: '0x0' as const }))
    for (const result of results) {this.db.track.upsertFromPlugin(result)}
    return MetadataManager.merge(results, cached)
  }
}
