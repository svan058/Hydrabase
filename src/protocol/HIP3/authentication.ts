import type { Account } from "../../Crypto/Account";

import { CONFIG } from "../../config";
import { Signature } from "../../Crypto/Signature";
import { log, warn } from "../../log";
import { AuthSchema } from "../../networking/ws/client";
import type z from "zod";
import { version } from "../../networking/ws/server";

type Auth =
  | { apiKey: string; signature: Signature }
  | { apiKey: string; signature?: undefined }
  | { apiKey?: undefined; signature: Signature }

const prove = {
  client: {
    address: (account: Account, peerHostname: `ws://${string}`) => ({
      'x-address': account.address,
      'x-hostname': `ws://${CONFIG.serverHostname}:${CONFIG.serverPort}`,
      'x-signature': account.sign(`I am connecting to ${peerHostname}`).toString()
    })
  },
  server: {
    identity: (account: Account, port: number) => new Response(JSON.stringify({
      address: account.address,
      username: CONFIG.username,
      userAgent: `Hydrabase/${version}`,
      signature: account.sign(`I am ws://${CONFIG.serverHostname}:${port}`).toString()
    } satisfies z.infer<typeof AuthSchema>))
  }
}

const verifyAuth = (auth: Auth | undefined, address: string | undefined): [number, string] | { address: `0x${string}` } => {
  if (!auth) return [400, 'Missing authentication']
  if (auth.apiKey && auth.apiKey !== CONFIG.apiKey) return [401, 'Invalid API key']
  else if (auth.signature) {
    if (!address) return [400, 'Missing address header']
    if (!auth.signature.verify(`I am connecting to ws://${CONFIG.serverHostname}:${CONFIG.serverPort}`, address)) return [403, 'Authentication failed']
    return { address: address as `0x${string}` }
  }
  return { address: '0x0' }
}

const verify = {
  serverFromClient: (hostname: `ws://${string}`) => new Promise<{ address: `0x${string}`, username: string, userAgent: string } | false>(resolve => {
    log(`[HIP3] Verifying server address ${hostname}`)
    const authUrl = `${hostname.replace('ws://', 'http://')}/auth`
    fetch(authUrl).then(async response => {
      const auth = AuthSchema.parse(JSON.parse(await response.text()))
      return resolve(Signature.fromString(auth.signature).verify(`I am ${hostname}`, auth.address) ? { address: auth.address, username: auth.username, userAgent: auth["userAgent"] } : warn('DEVWARN:', "[HIP3] Invalid authentication from client's server"))
    }).catch((error: Error) => resolve(warn('WARN:', `[HIP3] Failed to authenticate server ${authUrl}`, `- ${error.name} ${error.message}`)))
  }),
  clientFromServer: async (headers: Record<string, string>): Promise<{ address: `0x${string}`,  hostname: `ws://${string}`, username: string, userAgent: string } | [number, string]> => {
    const { 'sec-websocket-protocol': protocol, 'x-address': unverifiedAddress, 'x-api-key': _unverifiedApiKey, 'x-signature': _unverifiedSignature, 'x-hostname': unverifiedHostname } = headers

    log(`[HIP3] Verifying client address`)
    const unverifiedSignature = _unverifiedSignature ? Signature.fromString(_unverifiedSignature) : undefined
    const unverifiedApiKey = _unverifiedApiKey ?? protocol?.split(',').map(s => s.trim()).find(s => s.startsWith('x-api-key-'))?.replace('x-api-key-', '')
    const unverifiedAuth = unverifiedApiKey !== undefined || unverifiedSignature !== undefined ? { apiKey: unverifiedApiKey, signature: unverifiedSignature } as Auth : undefined

    const res = verifyAuth(unverifiedAuth, unverifiedAddress)
    if (Array.isArray(res)) return res
    const { address } = res
    if (address === '0x0') return { username: CONFIG.username, address, hostname: 'ws://', userAgent: `Hydrabase-API/${version}` }

    log(`[HIP3] Verifying client hostname ${address}`)
    if (!unverifiedHostname) return [500, "Missing Hostname"]
    const data = await new Promise<{ username: string, userAgent: string, hostname: `ws://${string}` } | [number, string]>(resolve => {
      fetch(`${unverifiedHostname.replace('ws://', 'http://')}/auth`).then(async response => {
        const auth = AuthSchema.parse(JSON.parse(await response.text()))
        return resolve(Signature.fromString(auth.signature).verify(`I am ${unverifiedHostname}`, auth.address) ? { username: auth.username, userAgent: auth.userAgent, hostname: unverifiedHostname as `ws://${string}` } : [500, 'Invalid authentication from server'])
      }).catch(() => resolve([500, `Failed to verify hostname`]))
    })
    if (Array.isArray(data)) return data
    return { hostname: data.hostname, username: data.username, address, userAgent: data.userAgent }
  }
}

export const HIP3_CONN_Authentication =  {
  proveClientAddress: (account: Account, peerHostname: `ws://${string}`) => prove.client.address(account, peerHostname),
  proveServerIdentity: (account: Account, listenPort: number) => prove.server.identity(account, listenPort),
  verifyServerFromClient: async (hostname: `ws://${string}`) => verify.serverFromClient(hostname),
  verifyClientFromServer: (headers: Record<string, string>) => verify.clientFromServer(headers),
}
