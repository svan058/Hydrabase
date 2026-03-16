# Task: Add comprehensive handshake logging for UDP auth flow

## Objective
Add detailed debug logging to the entire UDP handshake flow so we can see exactly where self-connection (and peer connection) fails. Currently we get "UDP auth timeout" with no visibility into what happened between h1 send and timeout.

## Context
Node can't connect to itself (localhost:4545). Logs show h1 being sent but then just "UDP auth timeout" 10s later. We need to see:
- Did the server receive the h1?
- Did it send h2 back?
- Did the h2 arrive at the socket?
- Did the awaiter match?
- Did verification pass or fail, and why?

## Changes Required

### `src/backend/networking/udp/client.ts` — `authenticateServerUDP`
Add logging at each stage:
1. **After txn ID generation:** `debug('[UDP] [CLIENT] Auth attempt to ${hostname} with txnId=${t}')`
2. **When awaiter fires:** `debug('[UDP] [CLIENT] Awaiter fired for txnId=${t}, msg.y=${msg.y}')`
3. **On error response:** `debug('[UDP] [CLIENT] Auth error from ${hostname}: ${msg.e[0]} ${msg.e[1]}')`
4. **On h2 received:** `debug('[UDP] [CLIENT] Received h2 from ${hostname}, verifying...')`
5. **On verification failure:** `debug('[UDP] [CLIENT] h2 verification failed for ${hostname}: ${JSON.stringify(verification)}')`
6. **On verification success:** already has `log('[UDP] [CLIENT] Authenticated server ${hostname}')` — keep it
7. **On timeout:** `debug('[UDP] [CLIENT] Auth timeout for ${hostname} txnId=${t} — no matching response received')`
8. **After h1 send:** `debug('[UDP] [CLIENT] Sent h1 to ${host}:${port} txnId=${t}')`

### `src/backend/networking/udp/server.ts` — message handler
The h1 and h2 branches in `messageHandler` need more detail:
1. **h1 received:** Already has `log('[UDP] [HANDSHAKE] Handshake initiated by peer', query)` — enhance to: `log('[UDP] [HANDSHAKE] Received h1 from ${peerHostname} txnId=${query.t} address=${query.h1.address} hostname=${query.h1.hostname}')`
2. **h1 processing result:** After `connectToUnauthenticatedPeer` call, log success/failure: `debug('[UDP] [HANDSHAKE] h1 processing for ${peerHostname}: ${result ? 'success' : 'failed'}')`
3. **h2 received (not matched by awaiter):** The current `log('[UDP] [HANDSHAKE] Peer completed handshake', query)` fires when h2 falls through to messageHandler (awaiter didn't catch it). Change to: `warn('DEVWARN:', '[UDP] [HANDSHAKE] Received h2 from ${peerHostname} txnId=${query.t} but no awaiter matched — this means the txnId doesn't match any pending auth request')`
4. **Awaiter match logging:** In `socket.on('message')`, after getting `data`, before checking awaiters: `debug('[UDP] [SERVER] Received msg y=${data.y} t=${data.t} from ${peer.address}:${peer.port}')`
5. **Awaiter hit/miss:** After checking `this.responseAwaiters.get(data.t)`: if found, `debug('[UDP] [SERVER] Awaiter matched for txnId=${data.t}')`. If not found AND data.y is 'h2', `debug('[UDP] [SERVER] No awaiter for h2 txnId=${data.t}, registered awaiters: ${[...this.responseAwaiters.keys()].join(', ')}')`

### `src/backend/networking/udp/client.ts` — `connectToUnauthenticatedPeer`
1. **Before sending h2:** `debug('[UDP] [CLIENT] Sending h2 to ${peerHostname} txnId=${auth.t}')`
2. **After verifyClient:** `debug('[UDP] [CLIENT] verifyClient result for ${peerHostname}: ${Array.isArray(identity) ? identity.join(' ') : 'success ' + identity.username}')`

### `src/backend/protocol/HIP1/handshake.ts` — `verifyClient`
1. **On signature verification:** `debug('[HIP1] Signature verify for ${auth.address}: message="I am connecting to ${node.hostname}:${node.port}" result=${signatureValid}')`
2. **Before hostname upgrade:** `debug('[HIP1] Hostname check: peer claims ${auth.hostname}, connecting from ${hostname}')`

## Constraints
- Use `debug()` for all new logging (not `log()`) — this is diagnostic, not operational
- Exception: upgrade existing `log()` calls to be more informative (keep as `log()`)
- Exception: the "h2 with no awaiter" case should be `warn()` — that's always a problem
- Do NOT change any logic, only add logging
- Do NOT change function signatures
- Do NOT change the handshake protocol or verification
- Import `debug` where it's not already imported

## Files
- `src/backend/networking/udp/client.ts`
- `src/backend/networking/udp/server.ts`
- `src/backend/protocol/HIP1/handshake.ts`

## Non-goals
- Don't fix the self-connect bug — just make it visible
- Don't add logging to HTTP/WebSocket paths
- Don't change PeerManager logging (it's already decent)

## Acceptance Criteria
- Every step of the handshake flow produces a debug log
- On timeout, we can see exactly which steps DID happen and which didn't
- `bun build src/backend/index.ts` passes
- No logic changes, only logging additions
