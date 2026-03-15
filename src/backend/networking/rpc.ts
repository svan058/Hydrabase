import type dgram from 'dgram'

import bencode from 'bencode'

import type { Config, Socket } from '../../types/hydrabase'
import type PeerManager from '../PeerManager'

import { debug, error, log, warn } from '../../utils/log'
import { type Identity } from '../protocol/HIP1/handshake'
import { authenticatedPeers, udpConnections } from './udp'

export class RPC implements Socket {
  public isOpened = true
  public readonly messageHandlers: ((message: string) => void)[] = []
  public readonly peer
  private closeHandlers: (() => void)[] = []
  private readonly node: { host: string, port: number }
  private openHandler?: () => void
  private constructor(_peers: PeerManager, private readonly identity: { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string, username: string }, private readonly config: Config['rpc'], private readonly udpSocket?: dgram.Socket) {
    authenticatedPeers.set(`${identity.hostname}`, identity)
    udpConnections.set(identity.hostname, this)
    log(`[RPC] Connecting to peer ${identity.hostname}`)
    const [host, port] = identity.hostname.split(':') as [string, `${number}`]
    this.node = { host, port: Number(port) }
    this.peer = { ...identity, hostname: identity.hostname }
    setTimeout(() => this.openHandler?.(), 0)
  }
  static readonly fromInbound = (peers: PeerManager, identity: Identity, config: Config['rpc'], udpSocket?: dgram.Socket): RPC => new RPC(peers, identity, config, udpSocket)
  public readonly close = () => {
    this.isOpened = false
    udpConnections.delete(`${this.node.host}:${this.node.port}`)
    this.closeHandlers.map(handler => handler())
  }
  public readonly onClose = (handler: () => void) => {
    this.closeHandlers.push(() => handler())
  }
  public onMessage(handler: (message: string) => void) {
    this.messageHandlers.push(handler)
  }
  public onOpen(handler: () => void) {
    this.openHandler = () => handler()
  }
  public readonly send = (message: string) => {
    if (!this.udpSocket) {
      warn('DEVWARN:', `[RPC] No UDP socket available for sending to ${this.identity.hostname}`)
      return
    }
    const tid = Buffer.alloc(4)
    tid.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF))
    const encoded = bencode.encode({ a: { d: message }, q: `${this.config.prefix}_msg`, t: tid, y: 'q' })
    this.udpSocket.send(encoded, this.node.port, this.node.host, err => {
      if (err) {
        error('ERROR:', `[RPC] Message failed to send ${err.message}`)
        return
      }
      debug(`[RPC] Peer acknowledged message ${this.identity.hostname}`)
      if (!this.isOpened) {
        this.isOpened = true
        this.openHandler?.()
      }
    })
  }
}
