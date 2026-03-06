import type { Request, Response, SearchResult } from './RequestManager'

import { CONFIG } from './config'
import { Account, getPrivateKey } from './Crypto/Account'
import { type DB, startDatabase } from './db'
import MetadataManager from './Metadata'
import ITunes from './Metadata/plugins/iTunes'
import Spotify from './Metadata/plugins/Spotify'
import { DHT_Node } from './networking/dht'
import { startServer } from './networking/ws/server'
import Peers from './Peers'
import { StatsReporter } from './StatsReporter'

const startWorkers = async (peers: Peers, account: Account, metadataManager: MetadataManager, db: DB) => {
  await startServer(account, peers)
  const dhtNode = new DHT_Node(account, peers)
  await dhtNode.isReady()
  await peers.loadCache()
  await peers.isReady()
  new StatsReporter(account.address, `ws://${CONFIG.hostname}:${CONFIG.serverPort}`, metadataManager.installedPlugins, peers, dhtNode, db)
}

const {SPOTIFY_CLIENT_ID,SPOTIFY_CLIENT_SECRET} = process.env

export class Node {

  private constructor(private readonly metadataManager: MetadataManager, private readonly peers: Peers) {}

  static readonly init = async () => {
    const account = new Account(await getPrivateKey())
    const { db, repos } = startDatabase()
    const metadataManager = new MetadataManager([new ITunes(), ... SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET ? [new Spotify({ clientId: SPOTIFY_CLIENT_ID, clientSecret: SPOTIFY_CLIENT_SECRET })] : []], repos)
    let node: Node | undefined
    const peers = new Peers(account, metadataManager, repos, db, <T extends Request['type']>(type: T, query: string, searchPeers?: boolean): Promise<Response<T>> => node?.search(type, query, searchPeers))
    node = new Node(metadataManager, peers)
    await startWorkers(peers, account, metadataManager, db)
    return node
  }

  public readonly search = async <T extends Request['type']>(type: T, query: string, searchPeers = true): Promise<Response<T>> => {
    const results = await this.metadataManager.handleRequest({ query, type }, this.peers)
    if (!searchPeers) return results
    const plugins = new Set<string>()
    const hashes = new Set<bigint>(results.map(_result => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const {address, confidence, ...result} = _result
      plugins.add(result.plugin_id)
      return BigInt(Bun.hash(JSON.stringify(result)))
    }))

    const peerResults = await this.peers.requestAll({ query, type }, hashes, plugins)

    // Inject local results
    for (let i = 0; i < results.length; i++) {
      const hash = [...hashes.values()][i]
      const result: SearchResult[T] | undefined = results[i]
      if (hash && result) peerResults.set(hash, result)
    }

    return [...peerResults.values()]
  }
}

// TODO: show usernames in peers tab

