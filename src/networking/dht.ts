import DHT, { type DHTNode } from 'bittorrent-dht'
import krpc from 'k-rpc'
import { portForward } from './upnp'
import WebSocketClient from './ws/client';
import type { Crypto } from '../Crypto';
import { CONFIG } from '../config';
import type Peers from '../Peers';
import { error, log } from '../log';

const knownPeers = new Set<`${string}:${number}`>();

const getRoomId = () => Bun.SHA1.hash(CONFIG.dhtRoomSeed + String(Math.round(Date.now()/1000/60/60)), 'hex')

const cacheFile = Bun.file('./data/dht-nodes.json')

const announce = (dht: DHT, port: number) => {
  const room = getRoomId()
  dht.announce(room, port, err => { if (err) error('ERROR:', '[DHT] An error occurred during announce', {err}) })
  dht.lookup(room, err => { if (err) error('ERROR:', '[DHT] An error occurred during lookup', {err}) })
}

export const discoverPeers = (crypto: Crypto, peers: Peers, dhtPort=CONFIG.dhtPort, serverPort=CONFIG.serverPort) => {
  portForward(dhtPort, 'Hydrabase (UDP)', 'UDP');
  const dht = new DHT({
    krpc: krpc(),
    bootstrap: ['router.bittorrent.com:6881', 'router.utorrent.com:6881', 'dht.transmissionbt.com:6881']
  })
  cacheFile.exists().then(exists => {
    if (!exists) return
    cacheFile.json().then((peers: DHTNode[]) => peers.forEach(peer => dht.addNode(peer)))
  })
  dht.listen(dhtPort, '0.0.0.0', () => log('LOG:', `[DHT] Listening on port ${dhtPort}`))
  dht.on('error', err => error('ERROR:', '[DHT] An error occurred', {err}))
  // dht.on('warning', warning => warn('WARN:', '[DHT] A warning was thrown', warning))
  dht.on('ready', () => {
    log('LOG:', '[DHT] Ready', `- ${dht.toJSON().nodes.length} Nodes`)

    announce(dht, serverPort)
    setInterval(() => announce(dht, serverPort), CONFIG.dhtReannounce)
  })
  let lastNodes = 0
  dht.on('node', () => {
    const nodes = dht.toJSON().nodes.length
    if (nodes % 25 === 0 && nodes !== lastNodes) {
      log('LOG:', `[DHT] Connected to ${nodes} nodes`)
      lastNodes = nodes
    }
    cacheFile.write(JSON.stringify(dht.toJSON().nodes))
    // log('LOG:', `[DHT] Discovered node ${node.host}:${node.port}`)
  })
  dht.on('peer', async peer => {
    if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.serverHostname}:${serverPort}`) return
    if (knownPeers.has(`${peer.host}:${peer.port}`) || CONFIG.blacklistedIPs.includes(peer.host)) return
    knownPeers.add(`${peer.host}:${peer.port}`)
    log('LOG:', `[DHT] Discovered peer ws://${peer.host}:${peer.port}`)
    const client = await WebSocketClient.init(crypto, `ws://${peer.host}:${peer.port}`, `ws://${CONFIG.serverHostname}:${serverPort}`, peers)
    if (client === false) return
    peers.add(client)
  })
  dht.on('announce', async (peer, _infoHash) => {
    if (_infoHash.toString('hex') !== getRoomId()) return
    if (knownPeers.has(`${peer.host}:${peer.port}`) || CONFIG.blacklistedIPs.includes(peer.host)) return
    if (`ws://${peer.host}:${peer.port}` === `ws://${CONFIG.serverHostname}:${serverPort}`) return
    log('LOG:', `[DHT] Received announce from ws://${peer.host}:${peer.port}`)
    const client = await WebSocketClient.init(crypto, `ws://${peer.host}:${peer.port}`, `ws://${CONFIG.serverHostname}:${serverPort}`, peers)
    if (client === false) return
    peers.add(client)
    knownPeers.add(`${peer.host}:${peer.port}`)
  })

  return {
    getNodes: () => dht.toJSON().nodes
  }
}
