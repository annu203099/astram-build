<#
.SYNOPSIS
    Astram Zero-Trust Microkernel - one-click installer / onboarding.
.DESCRIPTION
    1. Verifies Node.js and (re)builds any missing package output.
    2. Starts the Astram daemon (detached, hidden) and waits for /api/health.
    3. Wraps the selected agents' MCP configs (global and/or project scope).
    4. Opens the dashboard.
    NOTE: keep this file ASCII-only - Windows PowerShell 5.1 reads BOM-less
    files as ANSI and non-ASCII characters break parsing.
.PARAMETER Scope
    global  - user-level configs only (e.g. ~/.gemini/antigravity/mcp_config.json)
    project - configs inside -ProjectDir only
    both    - (default) both
.PARAMETER Agents
    Comma-separated agent hosts: antigravity,claude-code,cursor,codex,quill,dsh (default: all)
#>
param (
    [string]$Scope = "both",
    [string]$Agents = "",
    [string]$ProjectDir = "",
    [string]$Port = "3080",
    [switch]$NoLaunch = $false,
    [switch]$NoProtect = $false
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ProjectDir) { $ProjectDir = (Get-Location).Path }

function Write-Step([string]$Message) { Write-Host ""; Write-Host "[Astram Setup] $Message" -ForegroundColor Cyan }
function Fail([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

Write-Host "=== ASTRAM ZERO-TRUST MICROKERNEL SETUP ===" -ForegroundColor Cyan

# 1. Node.js
Write-Step "Checking runtime..."
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js 20+ is required but was not found on PATH." }
Write-Host ("OK Node.js " + (& node -v)) -ForegroundColor Green

# 2. Build outputs (the MCP proxy that wrapped configs point at lives in dist/)
Write-Step "Checking build outputs..."
$required = @(
    "packages\mcp-proxy\dist\cli-proxy.js",
    "packages\mcp-proxy\dist\cli-astram.js",
    "packages\server-daemon\dist\index.js",
    "packages\dashboard-ui\dist\index.html"
)
$missing = $required | Where-Object { -not (Test-Path (Join-Path $Root $_)) }
if ($missing) {
    Write-Host "Missing: $($missing -join ', ') - building workspace..." -ForegroundColor Yellow
    Push-Location $Root
    try {
        & pnpm -r run build
        if ($LASTEXITCODE -ne 0) { Fail "pnpm build failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
    $stillMissing = $required | Where-Object { -not (Test-Path (Join-Path $Root $_)) }
    if ($stillMissing) { Fail "Build finished but outputs are missing: $($stillMissing -join ', ')" }
}
Write-Host "OK build outputs present" -ForegroundColor Green

# 3. Daemon
function Test-Health {
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

Write-Step "Starting Astram daemon on port $Port..."
if (Test-Health) {
    Write-Host "OK daemon already running" -ForegroundColor Green
} else {
    $astramHome = Join-Path $env:USERPROFILE ".astram"
    New-Item -ItemType Directory -Force -Path $astramHome | Out-Null
    $env:AEGIS_PORT = $Port
    $proc = Start-Process -FilePath $node.Source `
        -ArgumentList @("`"$Root\packages\server-daemon\dist\index.js`"") `
        -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $astramHome "daemon.out.log") `
        -RedirectStandardError (Join-Path $astramHome "daemon.err.log")
    $ok = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { break }
        if (Test-Health) { $ok = $true; break }
    }
    if (-not $ok) {
        $err = ""
        $errLog = Join-Path $astramHome "daemon.err.log"
        if (Test-Path $errLog) { $err = Get-Content $errLog -Raw }
        Fail "daemon did not become healthy on port $Port. $err (logs: $astramHome)"
    }
    Write-Host "OK daemon started (PID $($proc.Id))" -ForegroundColor Green
}

# 4. Protect selected agents
if (-not $NoProtect) {
    Write-Step "Applying protection (scope=$Scope agents=$(if ($Agents) { $Agents } else { 'all' }))..."
    $cli = Join-Path $Root "packages\mcp-proxy\dist\cli-astram.js"
    $cliArgs = @($cli, "protect", "--dir", $ProjectDir, "--scope", $Scope, "--port", $Port)
    if ($Agents) { $cliArgs += @("--agents", $Agents) }
    & node @cliArgs
    if ($LASTEXITCODE -ne 0) { Fail "astram protect failed (exit $LASTEXITCODE)." }
}

# 5. Dashboard
$appUrl = "http://127.0.0.1:$Port"
if (-not $NoLaunch) {
    Write-Step "Launching dashboard..."
    $edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
    if (Test-Path $edge) {
        Start-Process -FilePath $edge -ArgumentList "--app=$appUrl --window-size=1280,820"
    } else {
        Start-Process $appUrl
    }
}

Write-Host ""
Write-Host "OK Astram is running. Dashboard: $appUrl" -ForegroundColor Green
exit 0
