$ErrorActionPreference = "Stop"

$repo = "SJMakin/trappyfish"
$branch = "build-artifacts"
$baseUrl = "https://raw.githubusercontent.com/$repo/$branch/stockfish"
$targetDir = Join-Path $PSScriptRoot "..\public\stockfish"
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "trappyfish-assets"
$files = @(
  "trappyfish-lite-single.js",
  "trappyfish-lite-single.wasm"
)

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

foreach ($file in $files) {
  $url = "$baseUrl/$file"
  $target = Join-Path $targetDir $file
  $tmp = Join-Path $tempDir "$file.$PID.download"

  Write-Host "Downloading $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing

    $item = Get-Item -LiteralPath $tmp
    if ($item.Length -le 0) {
      throw "Downloaded file is empty: $file"
    }

    Move-Item -LiteralPath $tmp -Destination $target -Force
    Write-Host "Updated $target ($($item.Length) bytes)"
  } finally {
    if (Test-Path -LiteralPath $tmp) {
      Remove-Item -LiteralPath $tmp -Force
    }
  }
}

Write-Host "Trappyfish assets updated. Open http://127.0.0.1:5173/?engine=trappyfish"
