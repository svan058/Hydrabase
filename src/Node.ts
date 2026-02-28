import { startDatabase } from './db'
import MetadataManager from './Metadata'
import type { SearchResult } from './Metadata'
import Peers from './Peers'
import type { Request } from './RequestManager'
import { Crypto, getPrivateKey } from './Crypto'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { log, warn } from './log'

export default class Node {
  private readonly peers: Peers
  private readonly metadataManager: MetadataManager

  private constructor(crypto: Crypto) {
    const SPOTIFY_CLIENT_ID = process.env['SPOTIFY_CLIENT_ID']
    const SPOTIFY_CLIENT_SECRET = process.env['SPOTIFY_CLIENT_SECRET']

    const { repos, db } = startDatabase()
    this.metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)] : []], repos)
    this.peers = new Peers(this, crypto, this.metadataManager, repos, db)
  }

  static init = async (): Promise<Node> => {
    const node = new Node(new Crypto(await getPrivateKey()))

    return new Promise<Node>(res => {
      let i = 0
      const id = setInterval(async () => {
        if (node.peerCount === 0) {
          if (i === 0) log('LOG:', '[NODE] Waiting to connect to peers')
          if (i > 12) warn('WARN:', '[NODE] Taking a while to find peers to connect to')
          i++
          return
        }
        clearInterval(id)
        res(node)
      }, 5_000)
    })
  }

  public async search<T extends Request['type']>(type: T, query: string, searchPeers = true) {
    const results = await this.metadataManager.handleRequest({ type, query }, this.peers) as SearchResult[T][]
    if (!searchPeers) return results

    const hashes = new Set<bigint>()
    const plugins = new Set<string>()
    for (const result of results) {
      hashes.add(BigInt(Bun.hash(JSON.stringify(result))))
      plugins.add(result.plugin_id)
    }

    const peerResults = await this.peers.requestAll({ type, query }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]!;
      peerResults.set(hash, results[i]!)
    }

    return [...peerResults.values()]
  }

  get peerCount() {
    return this.peers.count
  }
}
