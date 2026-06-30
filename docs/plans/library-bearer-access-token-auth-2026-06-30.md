# Library Bearer Access Token Auth 2026-06-30

## Goal

Fix public library publish routes so they correctly accept bearer **site access tokens** from standalone Dance Station, instead of misclassifying them as creator publish tokens.

## Current State

`server/src/modules/library/routes.ts` uses `resolvePublishUser()` to authenticate library publish operations.

Current behavior:

1. if `accessToken` cookie exists, verify it as a site auth session
2. otherwise, if `Authorization: Bearer ...` exists, hash it and treat it as a `creator_publish_tokens` secret

This is wrong for Dance Station standalone, which sends:

- `Authorization: Bearer <site access token>`

The route then tries to look that access token up in the creator publish token table and fails.

## Root Cause

The library route supports:

- cookie-backed authenticated site sessions
- legacy creator publish tokens

But it does **not** support bearer site access tokens, even though standalone Dance Station uses that auth mode.

## Intended Change

Update `resolvePublishUser()` so bearer auth works in this order:

1. cookie `accessToken` -> verify as site session
2. bearer token -> try `verifyAccessToken(bearer)` first
3. if bearer token is not a valid site access token, fall back to creator publish token lookup

That preserves:

- normal site browser auth
- standalone Dance Station publish auth
- creator publish token compatibility

## Files To Change

- `server/src/modules/library/routes.ts`

## Tradeoffs

### Pros

- fixes standalone Dance Station publish flow cleanly
- keeps creator publish tokens working
- aligns bearer access token handling with actual site auth primitives

### Cons

- bearer auth path becomes slightly more complex

## Risks

1. Accidentally broadening auth acceptance.
   - Mitigation: only accept bearer as site session if `verifyAccessToken()` succeeds.

2. Regressing legacy creator publish token flows.
   - Mitigation: keep creator publish token lookup as explicit fallback.

## Implementation Approach

1. Change `resolvePublishUser()` to attempt bearer access token verification before creator token lookup.
2. Keep the existing cookie auth path unchanged.
3. Verify publish routes still work for:
   - site cookie auth
   - standalone bearer access token auth
   - creator publish token auth
