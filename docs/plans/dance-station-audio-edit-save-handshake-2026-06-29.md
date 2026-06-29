## Goal

Fix site Dance Station Audio Edit asset saving by replacing the passive global export listener with an explicit request/response export handshake.

## Scope

- Use a request-specific `postMessage` flow when saving Audio Edit output as a private asset.
- Stop relying on the global AudioMass message listener to perform the actual asset save.

## Files

- `client/src/pages/DanceStationPage.tsx`

## Approach

1. Add a helper that sends `dance-station-export-audio` with a `requestId`.
2. Wait for the matching `dance-station-export-audio-result` message from the iframe.
3. Save the returned audio payload into the browser workspace directly from that promise chain.
4. Keep the global listener only for non-save events like ready/load/native download/errors.

## Risks

- If the iframe never responds, the save needs a timeout and a clear failure message.

## Verification

- Run the site build.
- Confirm `Save Edit As Asset` creates a new private asset and updates the save-status pill.
