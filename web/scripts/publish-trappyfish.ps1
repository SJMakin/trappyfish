param(
  [string]$Message = "Update Trappyfish",
  [string]$EngineRepo = (Join-Path $PSScriptRoot "..\.tmp\stockfish-js"),
  [string]$Remote = "sjmakin",
  [string]$RemoteBranch = "main",
  [int]$TimeoutSeconds = 900,
  [switch]$NoCommit,
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([string[]]$Arguments)

  & git -C $EngineRepo @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed"
  }
}

function Get-GitOutput {
  param([string[]]$Arguments)

  $output = & git -C $EngineRepo @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed"
  }
  return $output
}

function Get-BuildLog {
  $logUrl = "https://raw.githubusercontent.com/SJMakin/trappyfish/build-artifacts/build.log"
  $logPath = Join-Path $PSScriptRoot "..\.tmp\trappyfish-build.log"

  try {
    Invoke-WebRequest -Uri $logUrl -OutFile $logPath -UseBasicParsing
    return (Resolve-Path $logPath).Path
  } catch {
    return $null
  }
}

function Wait-TrappyfishBuild {
  param([string]$HeadSha)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $headers = @{ "User-Agent" = "trappyfish-local-publish" }
  $runUrl = "https://api.github.com/repos/SJMakin/trappyfish/actions/runs?per_page=20"

  while ((Get-Date) -lt $deadline) {
    $runs = Invoke-RestMethod -Uri $runUrl -Headers $headers
    $run = $runs.workflow_runs |
      Where-Object { $_.head_sha -eq $HeadSha } |
      Select-Object -First 1

    if ($null -eq $run) {
      Write-Host "Waiting for GitHub Actions run for $HeadSha..."
      Start-Sleep -Seconds 10
      continue
    }

    Write-Host "GitHub Actions run $($run.id): $($run.status) $($run.conclusion)"

    if ($run.status -ne "completed") {
      Start-Sleep -Seconds 10
      continue
    }

    if ($run.conclusion -eq "success") {
      return
    }

    $logPath = Get-BuildLog
    if ($logPath) {
      throw "Trappyfish build failed. Published build log: $logPath"
    }

    throw "Trappyfish build failed and no published build log was available."
  }

  throw "Timed out waiting for Trappyfish build for $HeadSha"
}

$EngineRepo = (Resolve-Path $EngineRepo).Path

$status = @(Get-GitOutput @("status", "--short"))
if ($status.Count -gt 0) {
  if ($NoCommit) {
    throw "Engine repo has uncommitted changes and -NoCommit was supplied."
  }

  Write-Host "Committing engine changes in $EngineRepo"
  Invoke-Git @("add", "-A")
  Invoke-Git @("commit", "-m", $Message)
} else {
  Write-Host "No engine changes to commit."
}

$headSha = (Get-GitOutput @("rev-parse", "HEAD") | Select-Object -First 1).Trim()

if (-not $SkipPush) {
  Write-Host "Pushing $headSha to $Remote/$RemoteBranch"
  Invoke-Git @("push", $Remote, "HEAD:$RemoteBranch")
} else {
  Write-Host "Skipping push for $headSha"
}

Wait-TrappyfishBuild -HeadSha $headSha

$updateScript = Join-Path $PSScriptRoot "update-trappyfish.ps1"
& powershell -ExecutionPolicy Bypass -File $updateScript
if ($LASTEXITCODE -ne 0) {
  throw "update-trappyfish.ps1 failed"
}
