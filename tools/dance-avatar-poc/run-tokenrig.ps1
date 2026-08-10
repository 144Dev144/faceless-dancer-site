param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [switch]$UseWsl,
  [string]$WslDistribution = $(if ($env:SKINTOKENS_WSL_DISTRIBUTION) { $env:SKINTOKENS_WSL_DISTRIBUTION } else { 'Ubuntu' }),
  [string]$WslRepo = $env:SKINTOKENS_WSL_REPO,
  [string]$WslPython = $env:SKINTOKENS_WSL_PYTHON,
  [switch]$UseSkeleton,
  [switch]$UsePostprocess,
  [int]$TopK = 5,
  [double]$TopP = 0.95,
  [double]$Temperature = 1.0,
  [double]$RepetitionPenalty = 2.0,
  [int]$NumBeams = 10,
  [string]$AttentionImplementation = $(if ($env:SKINTOKENS_ATTENTION) { $env:SKINTOKENS_ATTENTION } else { 'sdpa' })
)

$ErrorActionPreference = 'Stop'

function ConvertTo-WslDrivePath([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  if ($fullPath -notmatch '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
    throw "WSL mode requires a local Windows drive path: $fullPath"
  }
  return "/mnt/$($Matches.drive.ToLowerInvariant())/$($Matches.rest -replace '\\', '/')"
}

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) {
  throw "Input mesh was not found: $InputPath"
}
if ([IO.Path]::GetExtension($InputPath).ToLowerInvariant() -ne '.glb') {
  throw 'The avatar preservation pipeline currently requires a GLB input.'
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

if ($UseWsl) {
  if ([string]::IsNullOrWhiteSpace($WslRepo) -or [string]::IsNullOrWhiteSpace($WslPython)) {
    throw 'Set SKINTOKENS_WSL_REPO and SKINTOKENS_WSL_PYTHON or pass -WslRepo and -WslPython when using -UseWsl.'
  }

  $wslArgs = @(
    'env', "SKINTOKENS_ATTENTION=$AttentionImplementation",
    $WslPython,
    "$WslRepo/demo.py",
    '--input', (ConvertTo-WslDrivePath $InputPath),
    '--output', (ConvertTo-WslDrivePath $OutputPath),
    '--top_k', $TopK,
    '--top_p', $TopP,
    '--temperature', $Temperature,
    '--repetition_penalty', $RepetitionPenalty,
    '--num_beams', $NumBeams,
    '--use_transfer'
  )
  if ($UseSkeleton) { $wslArgs += '--use_skeleton' }
  if ($UsePostprocess) { $wslArgs += '--use_postprocess' }

  & wsl -d $WslDistribution --cd $WslRepo -- $wslArgs
} else {
  $repo = $env:SKINTOKENS_REPO
  $python = $env:SKINTOKENS_PYTHON
  if ([string]::IsNullOrWhiteSpace($repo) -or [string]::IsNullOrWhiteSpace($python)) {
    throw 'Set SKINTOKENS_REPO and SKINTOKENS_PYTHON when running TokenRig natively on Windows.'
  }
  $previousAttention = $env:SKINTOKENS_ATTENTION
  $env:SKINTOKENS_ATTENTION = $AttentionImplementation
  $args = @(
    '--input', $InputPath,
    '--output', $OutputPath,
    '--top_k', $TopK,
    '--top_p', $TopP,
    '--temperature', $Temperature,
    '--repetition_penalty', $RepetitionPenalty,
    '--num_beams', $NumBeams,
    '--use_transfer'
  )
  if ($UseSkeleton) { $args += '--use_skeleton' }
  if ($UsePostprocess) { $args += '--use_postprocess' }
  try {
    & $python (Join-Path $repo 'demo.py') @args
  } finally {
    $env:SKINTOKENS_ATTENTION = $previousAttention
  }
}

if ($LASTEXITCODE -ne 0) {
  throw "TokenRig exited with code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
  throw "TokenRig completed without producing the expected output: $OutputPath"
}

Write-Host "Preserved-material rigged GLB: $OutputPath"
