param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath,
  [Parameter(Mandatory = $true)]
  [string]$OutputDirectory,
  [int]$TextureResolution = 1024,
  [ValidateSet('none', 'triangle', 'quad')]
  [string]$RemeshOption = 'none',
  [int]$TargetVertexCount = -1,
  [string]$ModelPath = $env:SF3D_MODEL
)

$ErrorActionPreference = 'Stop'

$repo = $env:SF3D_REPO
$python = $env:SF3D_PYTHON
if ([string]::IsNullOrWhiteSpace($repo) -or [string]::IsNullOrWhiteSpace($python)) {
  throw 'Set SF3D_REPO and SF3D_PYTHON before running this script.'
}
if ([string]::IsNullOrWhiteSpace($ModelPath)) {
  throw 'Set SF3D_MODEL or pass -ModelPath. The model directory must contain config.yaml and model.safetensors.'
}
if (-not (Test-Path -LiteralPath $ModelPath -PathType Container)) {
  throw "Stable Fast 3D model directory was not found: $ModelPath"
}
foreach ($requiredFile in @('config.yaml', 'model.safetensors')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ModelPath $requiredFile) -PathType Leaf)) {
    throw "Stable Fast 3D model directory is missing ${requiredFile}: $ModelPath"
  }
}
if (-not (Test-Path -LiteralPath $ImagePath -PathType Leaf)) {
  throw "Input image was not found: $ImagePath"
}
if (-not (Test-Path -LiteralPath (Join-Path $repo 'run.py') -PathType Leaf)) {
  throw "Stable Fast 3D run.py was not found under SF3D_REPO: $repo"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$cudaHome = $env:CUDA_HOME
if (-not [string]::IsNullOrWhiteSpace($cudaHome)) {
  $env:CUDA_PATH = $cudaHome
}

Push-Location $repo
try {
  & $python run.py $ImagePath --pretrained-model $ModelPath --output-dir $OutputDirectory --texture-resolution $TextureResolution --remesh_option $RemeshOption --target_vertex_count $TargetVertexCount
  if ($LASTEXITCODE -ne 0) {
    throw "Stable Fast 3D exited with code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
