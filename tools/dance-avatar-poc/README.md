# Dance avatar proof of concept

This folder contains the local command boundary for the Dance Engine avatar proof of concept. Generated meshes, rigged GLBs, checkpoints, and caches stay outside the repository.

## Local mesh generation

Stable Fast 3D runs on the local RTX 3080 with the CUDA environment prepared for this workstation. The runner uses a local checkpoint directory so it does not depend on a Hugging Face login at inference time. That directory must contain both `model.safetensors` and the matching `config.yaml`.

Set these variables in the shell where the script is run:

```powershell
$env:SF3D_REPO = 'D:\stable-fast-3d'
$env:SF3D_PYTHON = 'D:\sf3d-venv\Scripts\python.exe'
$env:CUDA_HOME = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4'
$env:SF3D_MODEL = 'D:\path\to\stable-fast-3d-model'
```

Then run:

```powershell
.\tools\dance-avatar-poc\run-sf3d.ps1 -ImagePath 'D:\path\to\character.png' -OutputDirectory 'D:\dance-avatar-poc\mesh'
```

The supplied local checkpoint can be used by setting `SF3D_MODEL` to its directory. If the model is loaded from Hugging Face instead, the repository's access agreement and authentication still apply.

The result is an unrigged `mesh.glb`. It is not ready for Dance Engine playback until it has a humanoid skeleton and skin weights.

The default `-RemeshOption none` preserves Stable Fast 3D's native topology. For a
denser runtime mesh, the tested local configuration is:

```powershell
.\tools\dance-avatar-poc\run-sf3d.ps1 `
  -ImagePath 'D:\path\to\character.png' `
  -OutputDirectory 'D:\dance-avatar-poc\mesh-dense' `
  -TextureResolution 2048 `
  -RemeshOption triangle `
  -TargetVertexCount 100000
```

That produced approximately 112,000 vertices and 187,000 triangles from the teddy
source. Remeshing increases tessellation but does not recover geometry that was not
resolved by the single-view reconstruction.

## Rigging boundary

SkinTokens/TokenRig is the selected automatic rigging adapter for production. Its published inference guidance requires at least 14 GB VRAM, so the RTX 3090 is the target for that step. The local RTX 3080 is sufficient for the Stable Fast 3D mesh-generation step and for testing the Dance Engine with a compatible rigged GLB, but it is not treated as a guaranteed TokenRig inference device.

The Dance Engine accepts:

1. A rigged `.glb` file.
2. A `humanoid-v1` manifest JSON file with explicit semantic bone names.

The manifest prevents the runtime from silently guessing the skeleton. If a manifest is omitted, the test client falls back to bone-name heuristics and reports that condition in Runtime diagnostics.

## Test client

Start the site client normally and open:

```text
http://localhost:7903/dance-engine
```

In Avatar, choose the local rigged GLB and then its manifest. The runtime panel shows the mapped-bone coverage and any missing required roles. Generated files are intentionally selected from disk rather than copied into `client/public` or committed.

## Preserve the generated mesh while rigging

When a Stable Fast 3D GLB already has good geometry and materials, run TokenRig with
the transfer export path. This keeps the source mesh, UVs, textures, normal maps, and
scale while adding the generated humanoid skeleton and skin weights. The wrapper keeps
that path enabled by default and leaves voxel skin postprocessing disabled unless it is
explicitly requested.

Native Windows configuration:

```powershell
$env:SKINTOKENS_REPO = 'D:\SkinTokens'
$env:SKINTOKENS_PYTHON = 'D:\path\to\skintokens-python.exe'
.\tools\dance-avatar-poc\run-tokenrig.ps1 `
  -InputPath 'D:\path\to\stable-fast-avatar.glb' `
  -OutputPath 'D:\path\to\rigged-avatar-preserved.glb'
```

WSL configuration:

```powershell
$env:SKINTOKENS_WSL_REPO = '/mnt/d/SkinTokens'
$env:SKINTOKENS_WSL_PYTHON = '/mnt/d/skintokens-venv311/bin/python'
.\tools\dance-avatar-poc\run-tokenrig.ps1 `
  -UseWsl `
  -InputPath 'D:\path\to\stable-fast-avatar.glb' `
  -OutputPath 'D:\path\to\rigged-avatar-preserved.glb'
```

The wrapper defaults to the `sdpa` attention backend for compatibility with the
local RTX 3080 environment. Override it with `-AttentionImplementation
flash_attention_2` or set `SKINTOKENS_ATTENTION` when the installed FlashAttention,
PyTorch, and model dtypes are known to match. The local SkinTokens checkout also
starts its Blender helper before model imports; this avoids a WSL process-startup
deadlock caused by forking Blender after PyTorch initialization.

`-UseSkeleton` is only for an input that already has a skeleton. `-UsePostprocess`
enables TokenRig's voxel skin postprocessing and should remain off when preserving
source surface detail.
