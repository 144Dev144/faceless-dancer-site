# Generative Dance Controls and Pricing

## Scope

Expose the verified Wan postprocessing choices in the generative dance client
and carry them through the site API without changing the existing sequence
editor or artifact workflow.

## Changes

- Add checked-by-default controls for 2x enhancement and 48 FPS motion
  interpolation.
- Send the choices as a bounded `parameters.postprocess` object.
- Validate and preserve the object through the remote-generation request.
- Consume launcher-provided Wan duration pricing fields when estimating the
  payment amount.
- Add tests for serialization, validation, pricing display, and the existing
  Flux image request path.

The launcher and worker changes are maintained and committed in their own
repositories.
