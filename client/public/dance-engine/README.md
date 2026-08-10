The Dance Engine accepts generated avatar files through its local file inputs. Do not place generated GLBs or model checkpoints in this directory. Use the Avatar controls at `/dance-engine` to load a rigged GLB and its `humanoid-v1` manifest from disk.

## Canonical rig adjustment

Avatar manifests produced by the avatar worker may include a `canonicalProfile` object. After loading the matching GLB and manifest, open **Rig adjustment** below the engine preview to inspect the front-facing model and canonical skeleton.

The editor supports:

- dragging canonical joints in the front-view editor;
- editing X/Y joint positions and bone lengths;
- resetting the working profile without modifying the source files; and
- downloading `canonical-profile-adjusted.json` or `manifest-adjusted.json` for the worker reskin step.

If a profile is supplied separately, use **Load profile JSON** in the adjustment panel. The browser only edits profile metadata; it does not rewrite skin weights or modify the GLB locally.
