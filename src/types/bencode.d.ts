declare module 'bencode' {
  export function decode(data: Buffer | Uint8Array): Record<string, unknown>
  export function encode(data: unknown): Buffer
}
