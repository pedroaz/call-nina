param([ValidateSet('install','update','status','uninstall')][string]$Command = 'install')
$ErrorActionPreference = 'Stop'
if (![Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -notin @('AMD64','x86')) { throw 'Windows x64 is required.' }
$repo = Split-Path $PSScriptRoot -Parent
$base = Join-Path $env:LOCALAPPDATA 'Call Nina Installer'
$node = Get-Command node -ErrorAction SilentlyContinue
$compatible = $false
if ($node) { & $node.Source -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a===26&&b>=5&&!process.versions.node.includes('-')?0:1)"; $compatible = $LASTEXITCODE -eq 0 }
if (!$compatible) {
  $version = (Get-Content (Join-Path $repo '.node-version') -Raw).Trim()
  if ($version -notmatch '^26\.\d+\.\d+$') { throw 'Invalid recommended Node version' }
  $nodeRoot = Join-Path $base "tools\node-v$version-win-x64"
  $executable = Join-Path $nodeRoot 'node.exe'
  if (!(Test-Path -LiteralPath $executable)) {
    if ($Command -in @('status','uninstall')) { throw 'Install a compatible Node 26.5–26.x runtime first.' }
    $tools = Join-Path $base 'tools'
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    for ($cursor = Get-Item -LiteralPath $tools; $null -ne $cursor; $cursor = $cursor.Parent) {
      if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installer paths cannot traverse reparse points.' }
    }
    $scratch = Join-Path $tools ('.download-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $scratch | Out-Null
    try {
      $archive = "node-v$version-win-x64.zip"
      Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$version/$archive" -OutFile (Join-Path $scratch $archive)
      $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$version/SHASUMS256.txt").Content
      $line = $sums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archive") }
      $expected = ($line -split '\s+')[0]
      if (!$expected -or (Get-FileHash (Join-Path $scratch $archive) -Algorithm SHA256).Hash -ne $expected) { throw 'Node checksum mismatch' }
      Expand-Archive (Join-Path $scratch $archive) -DestinationPath $scratch
      if (Test-Path -LiteralPath $nodeRoot) { throw 'Node destination already exists' }
      Move-Item -LiteralPath (Join-Path $scratch "node-v$version-win-x64") -Destination $nodeRoot
    } finally { Remove-Item -LiteralPath $scratch -Recurse -Force }
  }
  $nodePath = $executable
  $env:PATH = "$nodeRoot;$env:PATH"
} else { $nodePath = $node.Source }
& $nodePath (Join-Path $PSScriptRoot 'install.mjs') $Command
exit $LASTEXITCODE
