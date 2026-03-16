# Task: Key UDP auth awaiters by transaction ID instead of hostname

## Objective
Fix the UDP authentication flow so that auth response awaiters are matched by the `t` (transaction ID) field instead of hostname. Currently, awaiters are keyed by the hostname we send to (e.g. `ddns.yazdani.au:4545`), but responses arrive from the resolved IP (`203.29.147.23:4545`), so the awaiter never fires and all UDP auth times out.

## Root Cause
In `server.ts`, `responseAwaiters` is a `Map<string, ResponseAwaiter>` keyed by hostname. In `client.ts`, `authenticateServerUDP` calls `server.awaitResponse(hostname, handler)`. When the h2 response arrives, `rinfo` gives the resolved IP, not the original hostname. Lookup fails. The h2 falls through to `messageHandler` which returns false. The awaiter times out after 10s.

## Solution
Use the `t` (transaction ID) field as the awaiter key. The `t` field is already part of the bencode protocol — it's echoed back in responses. Currently hardcoded to `'0'`. Change it to a unique random value per auth request.

## Changes Required

### `src/backend/networking/udp/server.ts`
1. Change `responseAwaiters` key from hostname to transaction ID string
2. Update `awaitResponse(key, handler)` and `cancelAwaiter(key)` — parameter is now a txn ID string, not hostname
3. In the `socket.on('message')` handler, look up awaiter by `result.data.t` instead of `peerHostname`
4. The `ResponseAwaiter` type signature can stay the same

### `src/backend/networking/udp/client.ts`
1. In `authenticateServerUDP`:
   - Generate a unique transaction ID: `const txnId = Buffer.alloc(4); txnId.writeUInt32BE(Math.floor(Math.random() * 0xFFFFFFFF)); const t = txnId.toString('hex')`
   - Call `server.awaitResponse(t, handler)` instead of `server.awaitResponse(hostname, handler)`
   - Call `server.cancelAwaiter(t)` in the timeout instead of `server.cancelAwaiter(hostname)`
   - Send h1 with the generated `t` value instead of hardcoded `'0'`

## Constraints
- Do NOT change any other logic (peer verification, self-connect guards, TCP code, etc.)
- Do NOT change the message schemas — `t` already exists in all message types
- Keep the 10s timeout behaviour
- The `t` field in the h1 message must match what the awaiter is keyed on
- Ensure the awaiter still correctly handles h2 responses (verify `msg.y === 'h2'`) and error responses (`msg.y === 'e'`)

## Files
- `src/backend/networking/udp/server.ts` — awaiter map key change + lookup change
- `src/backend/networking/udp/client.ts` — generate unique txn ID, use it for awaiter registration + h1 send

## Non-goals
- Don't touch HTTP auth, WebSocket, DHT, PeerManager, or any other files
- Don't change the `send()` method on `UDP_Client` (it already generates random `t` for queries)
- Don't add hostname-to-IP mapping or DNS resolution

## Acceptance Criteria
- `authenticateServerUDP` generates a unique `t` per auth attempt
- Awaiter is registered and looked up by `t`, not by hostname
- h2 responses from any IP are correctly matched to the pending auth request
- Timeout and error handling still work
- No other behaviour changes

## Validation
- `bun build src/backend/index.ts` (or equivalent type check) passes
- Grep for hardcoded `'0'` in h1 sends — should be gone from `authenticateServerUDP`
- Grep for hostname-keyed awaiter calls — should be gone
