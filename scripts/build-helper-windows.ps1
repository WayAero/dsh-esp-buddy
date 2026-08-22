$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $projectRoot '.pyinstaller'
$source = Join-Path $projectRoot 'helper\buddy_ble.py'
$dist = Join-Path $projectRoot 'bin\win32-x64'

python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name buddy-ble `
  --distpath $dist `
  --workpath (Join-Path $buildRoot 'work') `
  --specpath $buildRoot `
  $source

if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller exited with code $LASTEXITCODE"
}

$artifact = Join-Path $dist 'buddy-ble.exe'
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
  throw "Helper artifact was not created: $artifact"
}

Get-Item -LiteralPath $artifact | Select-Object FullName, Length, LastWriteTime
