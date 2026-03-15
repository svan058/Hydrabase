import bencode from 'bencode'
import dgram from 'dgram'
import z from 'zod'

import type { Config } from '../../types/hydrabase'
import type { Account } from '../Crypto/Account'
import type PeerManager from '../PeerManager'

import { error, log, warn } from '../../utils/log'
import { FSMap } from '../FSMap'
import { type Auth, AuthSchema, type Identity, proveClient, proveServer, verifyClient, verifyServer } from '../protocol/HIP1/handshake'
import { RPC } from './rpc'

export const authenticatedPeers = new FSMap<`${string}:${number}`, Identity>('./data/authenticated-peers.json')
export const udpConnections = new Map<`${string}:${number}`, RPC>()

const decoder = new TextDecoder()
const BinaryString = z.instanceof(Uint8Array).transform(m => decoder.decode(m))
const BinaryHex = z.instanceof(Uint8Array).transform(m => `0x${m.toHex()}`)

const BaseMessage = z.object({
  t: BinaryHex,
  v: BinaryString.optional(),
  y: BinaryString,
}).strict()
const QueryMessage = BaseMessage.extend({
  a: z.record(z.string(), BinaryString),
  q: BinaryString,
  y: z.literal('q'),
}).strict()
const HandshakeRequestSchema = BaseMessage.extend({ 
  h1: AuthSchema,
  y: z.literal('h1') 
}).strict()
const HandshakeResponseSchema = BaseMessage.extend({ 
  h2: AuthSchema,
  y: z.literal('h2')
}).strict()
type HandshakeRequest = z.infer<typeof HandshakeRequestSchema>
type HandshakeResponse = z.infer<typeof HandshakeResponseSchema>
type Query = z.infer<typeof QueryMessage>
const ResponseMessage = BaseMessage.extend({
  r: z.object({
    id: BinaryString,
    nodes: BinaryString.optional(),
    token: BinaryString.optional(),
    values: z.array(BinaryString).optional(),
  }).strict(),
  y: z.literal('r'),
}).strict()
const ErrorMessage = BaseMessage.extend({
  e: z.tuple([z.number(), BinaryString]),
  y: z.literal('e'),
}).strict()
type Error = z.infer<typeof ErrorMessage>
const rpcMessageSchema = z.preprocess((msg: Record<string, unknown> & { y: Uint8Array }) => ({
  ...msg,
  y: decoder.decode(msg.y),
}), z.discriminatedUnion('y', [
  QueryMessage,
  ResponseMessage,
  ErrorMessage,
  HandshakeRequestSchema,
  HandshakeResponseSchema,
]))

const authHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: HandshakeRequest | HandshakeResponse, peer: { host: string, port: number }, config: Config['rpc'], node: Config['node'], apiKey: string | undefined, respond = true) => {
  log(`[RPC] Received auth from ${peer.host}:${peer.port}`)
  const headers = query.y === 'h1' ? query['h1'] : query['h2']
  if (headers.hostname !== `${peer.host}:${peer.port}`) {
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: query.t, y: 'h1' } satisfies HandshakeRequest), Number(headers.hostname.split(':')[1]), headers.hostname.split(':')[0])
    return
  }
  const identity = await verifyClient(node, `${peer.host}:${peer.port}`, headers, apiKey, () => [500, 'UDP hostname mismatch'])
  if (Array.isArray(identity)) {
    warn('DEVWARN:', `[RPC] Authentication failed ${peer.host}:${peer.port} - ${identity[1]}`)
    socket.send(bencode.encode({ e: [500, 'Failed to verify client'], t: query.t, y: 'e' } satisfies Error), peer.port, peer.host)
    return
  }
  log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${identity.hostname}`)
  if (!udpConnections.has(identity.hostname)) peerManager.add(RPC.fromInbound(peerManager, identity, config, socket))
  if (respond) socket.send(bencode.encode({ h2: proveServer(peerManager.account, node), t: query.t, y: 'h2' } satisfies HandshakeResponse), peer.port, peer.host)
}

const handleUDPAuthQuery = async (socket: dgram.Socket, peerManager: PeerManager, query: Query, peerHostname: `${string}:${number}`, node: Config['node'], config: Config['rpc'], apiKey: string | undefined, peer: { host: string, port: number }): Promise<boolean> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _id, token: _token, ...authFields } = query.a
  const parsed = AuthSchema.safeParse(authFields)
  if (!parsed.success) {
    warn('DEVWARN:', `[RPC] UDP auth query schema validation failed for ${peerHostname}: ${JSON.stringify(parsed.error.issues)}`)
    return false
  }
  const identity = await verifyClient(node, peerHostname, parsed.data, apiKey, () => [500, 'UDP hostname mismatch'] as [number, string])
  if (Array.isArray(identity)) {
    warn('DEVWARN:', `[RPC] UDP auth query verification failed for ${peerHostname}: ${identity[1]}`)
    return false
  }
  log(`[RPC] Authenticated peer ${identity.username} ${identity.address} at ${peerHostname} via UDP auth query`)
  authenticatedPeers.set(peerHostname, identity)
  // Respond with our server proof as a k-rpc response
  const tBytes = Buffer.from(query.t.slice(2), 'hex')
  socket.send(bencode.encode({ r: { id: `${node.hostname}:${node.port}`, ...proveServer(peerManager.account, node) }, t: tBytes, y: 'r' }), peer.port, peer.host)
  // Add peer connection using observed address (NAT-safe)
  if (!peerManager.has(identity.address)) {
    peerManager.add(RPC.fromInbound(peerManager, { ...identity, hostname: peerHostname }, config, socket))
  }
  return true
}

const messageHandler = async (socket: dgram.Socket, peerManager: PeerManager, query: Query, peer: { host: string, port: number }, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) => {
  const peerHostname = `${peer.host}:${peer.port}` as `${string}:${number}`

  // Always process auth queries, regardless of authentication state
  if (query.q === `${config.prefix}auth`) {
    const handled = await handleUDPAuthQuery(socket, peerManager, query, peerHostname, node, config, apiKey, peer)
    if (handled) return
  }

  if (!authenticatedPeers.has(peerHostname)) {
    warn('DEVWARN:', `[RPC] Received message from unauthenticated peer ${peerHostname}`)
    const tBytes = Buffer.from(query.t.slice(2), 'hex')
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: tBytes, y: 'h1' }), peer.port, peer.host)
    return
  }
  const message = query.a['d']?.toString()
  if (!message) return

  const connection = udpConnections.get(peerHostname)
  if (connection) {
    connection.messageHandlers.forEach(handler => handler(message))
    if (connection.messageHandlers.length === 0) warn('DEVWARN:', `[RPC] Couldn't find message handler ${peerHostname}`)
  } else {
    warn('DEVWARN:', `[RPC] Couldn't find connection ${peerHostname}`)
    const tBytes = Buffer.from(query.t.slice(2), 'hex')
    socket.send(bencode.encode({ h1: proveServer(peerManager.account, node), t: tBytes, y: 'h1' }), peer.port, peer.host)
  }
}

const randomTid = () => {
  const tid = Buffer.alloc(4)
  tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
  return tid
}

const decodeMessageType = (decoded: Record<string, unknown>): string | undefined => {
  const yBuf = decoded['y']
  if (!yBuf) return undefined
  return yBuf instanceof Uint8Array ? new TextDecoder().decode(yBuf) : String(yBuf)
}

const verifyAndCacheAuth = (hostname: `${string}:${number}`, data: unknown): [number, string] | Auth => {
  const parsed = AuthSchema.safeParse(data)
  if (!parsed.success) return [500, `Invalid auth response from ${hostname}`]
  const verified = verifyServer(parsed.data, hostname)
  if (verified !== true) return verified
  authenticatedPeers.set(hostname, parsed.data)
  return parsed.data
}

const parseRpcAuthResponse = (hostname: `${string}:${number}`, decoded: Record<string, unknown>): [number, string] | Auth | undefined => {
  const r = decoded['r'] as Record<string, Buffer | Uint8Array> | undefined
  if (!r) return undefined
  const serverAuth: Record<string, string> = {}
  for (const [key, val] of Object.entries(r)) {
    if (key === 'id') continue
    serverAuth[key] = val instanceof Uint8Array ? new TextDecoder().decode(val) : String(val)
  }
  return verifyAndCacheAuth(hostname, serverAuth)
}

const waitForRpcAuthResponse = (hostname: `${string}:${number}`, socket: dgram.Socket, host: string, portNum: number, timeoutMs: number): Promise<[number, string] | Auth> =>
  new Promise(resolve => {
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout>
    const handler = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      if (rinfo.address !== host || rinfo.port !== portNum) return
      try {
        const decoded = bencode.decode(msg) as Record<string, unknown>
        if (decodeMessageType(decoded) !== 'r') return
        const result = parseRpcAuthResponse(hostname, decoded)
        if (!result) return
        clearTimeout(timer)
        socket.removeListener('message', handler)
        resolve(result)
      } catch { /* ignore parse errors */ }
    }
    timer = setTimeout(() => {
      socket.removeListener('message', handler)
      resolve([500, `UDP auth timeout for ${hostname}`])
    }, timeoutMs)
    socket.on('message', handler)
  })

/**
 * Authenticate against a remote server over UDP.
 * Sends a k-rpc style auth query with proveClient credentials.
 * Also sends h1 handshake concurrently for peers that support it.
 */
export const authenticateServerUDP = (hostname: `${string}:${number}`, socket: dgram.Socket, account: Account, node: Config['node']): Promise<[number, string] | Auth> => {
  const [host, port] = hostname.split(':') as [string, `${number}`]
  const portNum = Number(port)

  // Send k-rpc auth query (primary path for outbound UDP auth)
  socket.send(bencode.encode({ a: proveClient(account, node, hostname), q: 'hydra_auth', t: randomTid(), y: 'q' }), portNum, host)
  log(`[UDP] Sent UDP auth to ${hostname}`)

  return waitForRpcAuthResponse(hostname, socket, host, portNum, 10_000)
}

/**
 * Create an outbound RPC connection from an already-authenticated identity.
 */
export const fromOutbound = (socket: dgram.Socket, peerManager: PeerManager, identity: Identity, config: Config['rpc']): false | RPC => {
  if (udpConnections.has(identity.hostname)) return false
  return RPC.fromInbound(peerManager, identity, config, socket)
}

export class UDP_Server {
  private constructor(peerManager: () => PeerManager, public readonly socket: dgram.Socket, node: Config['node'], config: Config['rpc'], apiKey: string | undefined) {
    socket.on('error', err => {
      error('ERROR:', `[UDP] An error was thrown ${err.name} - ${err.message}`);
      socket.close();
    })
    socket.on('message', async (_msg, peer) => {
      const result = rpcMessageSchema.safeParse(bencode.decode(_msg))
      if (!result.success) return // Ignore non-hydra messages (DHT traffic, malformed, etc.)
      const msg = result.data
      if (msg.y === 'h1') {
        log(`[UDP] Connection initiated by ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey)
      } else if (msg.y === 'h2') {
        log(`[UDP] Peer responded to connection ${peer.address}:${peer.port}`)
        await authHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, config, node, apiKey, false)
      }
      if (msg.y === 'q' && msg.q.startsWith('hydra_')) await messageHandler(socket, peerManager(), msg, { host: peer.address, port: peer.port }, node, config, apiKey)
    })
  }

  static init(peerManager: () => PeerManager, config: Config['rpc'], node: Config['node'], apiKey: string | undefined): Promise<UDP_Server> {
    const server = dgram.createSocket('udp4')
    // server.bind(port)

    return new Promise<UDP_Server>(res => {
      // server.on('listening', () => {
      //   const {address,port} = server.address()
      //   log(`[UDP] listening at ${address}:${port}`)
      //   res(new UDP_Server(server))
      // })
      res(new UDP_Server(peerManager, server, node, config, apiKey))
    })
  }
}
