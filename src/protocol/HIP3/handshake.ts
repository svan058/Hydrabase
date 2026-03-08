import z from "zod";

import type { Account } from "../../Crypto/Account";

import { CONFIG } from "../../config";
import { Signature } from "../../Crypto/Signature";
import { debug, warn } from "../../log";
import { version } from "../../networking/ws/server";

export const AuthSchema = z.object({
  address: z.string().regex(/^0x/iu, { message: "Address must start with 0x" }).transform(val => val as `0x${string}`),
  hostname: z.string().includes(':').transform(h => h as `${string}:${number}`),
  signature: z.string(),
  userAgent: z.string(),
  username: z.string()
})

type Auth = z.infer<typeof AuthSchema>

export const proveServer = (account: Account): Auth => ({
  address: account.address,
  hostname: `${CONFIG.hostname}:${CONFIG.port}`,
  signature: account.sign(`I am ${CONFIG.hostname}:${CONFIG.port}`).toString(),
  userAgent: `Hydrabase/${version}`,
  username: CONFIG.username
})

export const verifyServer = (hostname: string) => new Promise<[number, string] | Auth>(resolve => {
  fetch(`http://${hostname}/auth`).then(async response => { // TODO: UDP mode
    const auth = AuthSchema.parse(JSON.parse(await response.text()))
    const signature = Signature.fromString(auth.signature)
    if (hostname !== auth.hostname) resolve([500, 'Unexpected hostname'])
    if (signature.verify(`I am ${hostname}`, auth.address)) resolve(auth)
    return resolve([500, `Invalid signature`])
  }).catch(err => {
    warn('DEVWARN:', "[HIP3] Failed to authenticate server", {err})
    resolve([500, `Failed to authenticate server`])
  })
})

export const proveClient = (account: Account, hostname: string): Auth => ({
  address: account.address,
  hostname: `${CONFIG.hostname}:${CONFIG.port}`,
  signature: account.sign(`I am connecting to ${hostname}`).toString(),
  userAgent: `Hydrabase/${version}`,
  username: CONFIG.username
})

export const verifyClient = async (auth: Auth | { apiKey: string }): Promise<[number, string] | { address: `0x${string}`, hostname: `${string}:${number}`, userAgent: string; username: string }> => {
  if ('apiKey' in auth) {
    if (auth.apiKey !== CONFIG.apiKey) return [500, 'Invalid API Key']
    return { address: '0x0', hostname: 'API:4545', userAgent: `Hydrabase-API/${version}`, username: CONFIG.username }
  }

  debug(`[HIP3] Verifying client address ${auth.address}`)
  if (!Signature.fromString(auth.signature).verify(`I am connecting to ${CONFIG.hostname}:${CONFIG.port}`, auth.address)) return [403, 'Failed to authenticate address']

  debug(`[HIP3] Verifying client hostname ${auth.address} ${auth.hostname}`)
  const isHostnameValid = await new Promise<[number, string] | true>(resolve => {
    fetch(`http://${auth.hostname}/auth`).then(async response => { // TODO: UDP mode
      const serverAuth = AuthSchema.parse(JSON.parse(await response.text()))
      if (serverAuth.address === auth.address) return resolve(true)
      warn('DEVWARN:', "[HIP3] Invalid Address", {expected:auth.address,got:serverAuth.address})
      return resolve([500, `Invalid address`])
    }).catch(err => {
      warn('DEVWARN:', "[HIP3] Failed to authenticate client's hostname", {err})
      resolve([500, `Failed to verify hostname`])
    })
  })
  if (Array.isArray(isHostnameValid)) return isHostnameValid
  return auth
}
