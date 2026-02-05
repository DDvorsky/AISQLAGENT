# AISQLAGENT - Local Docker Runner
# Downloads and runs the agent from GitHub

param(
    [string]$InitJsonPath = "",
    [string]$ProjectPath = "",
    [int]$Port = 0
)

$ErrorActionPreference = "Stop"

$REPO_URL = "https://github.com/DDvorsky/AISQLAGENT.git"
$AGENT_DIR = "$env:TEMP\aisqlagent"
$IMAGE_NAME = "aisqlagent:local"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AISQLAGENT - Local Docker Runner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Ask for port if not provided
if ($Port -eq 0) {
    $portInput = Read-Host "Enter port for agent UI [default: 3333]"
    if ($portInput) {
        $Port = [int]$portInput
    } else {
        $Port = 3333
    }
}

Write-Host ""
Write-Host "Using port: $Port" -ForegroundColor Green
Write-Host ""

# Check Docker
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
try {
    docker version | Out-Null
    Write-Host "      Docker is running" -ForegroundColor Green
} catch {
    Write-Host "      ERROR: Docker is not running!" -ForegroundColor Red
    Write-Host "      Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

# Clone or update repo
Write-Host "[2/5] Downloading AISQLAGENT from GitHub..." -ForegroundColor Yellow
if (Test-Path $AGENT_DIR) {
    Write-Host "      Updating existing clone..." -ForegroundColor Gray
    Push-Location $AGENT_DIR
    git pull
    Pop-Location
} else {
    Write-Host "      Cloning repository..." -ForegroundColor Gray
    git clone $REPO_URL $AGENT_DIR
}
Write-Host "      Downloaded to: $AGENT_DIR" -ForegroundColor Green

# Build Docker image
Write-Host "[3/5] Building Docker image (this may take a few minutes)..." -ForegroundColor Yellow
Push-Location $AGENT_DIR
$buildResult = docker build -t $IMAGE_NAME . 2>&1
$buildExitCode = $LASTEXITCODE
$buildResult | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }

if ($buildExitCode -ne 0) {
    Write-Host ""
    Write-Host "      ERROR: Docker build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location
Write-Host "      Image built: $IMAGE_NAME" -ForegroundColor Green

# Prepare volumes
Write-Host "[4/5] Preparing configuration..." -ForegroundColor Yellow

$volumes = @()

# Init.json
if ($InitJsonPath -and (Test-Path $InitJsonPath)) {
    $initJsonFull = (Resolve-Path $InitJsonPath).Path
    $volumes += "-v"
    $volumes += "${initJsonFull}:/app/config/init.json:ro"
    Write-Host "      init.json: $initJsonFull" -ForegroundColor Green
} else {
    Write-Host "      init.json: Not provided (configure in UI)" -ForegroundColor Yellow
    Write-Host "      TIP: Download init.json from AISQLWatch and run:" -ForegroundColor Gray
    Write-Host "           .\run-agent.ps1 -InitJsonPath 'C:\path\to\init.json'" -ForegroundColor Gray
}

# Project path
if ($ProjectPath -and (Test-Path $ProjectPath)) {
    $projectFull = (Resolve-Path $ProjectPath).Path
    $volumes += "-v"
    $volumes += "${projectFull}:/project:ro"
    Write-Host "      Project: $projectFull" -ForegroundColor Green
} else {
    Write-Host "      Project: Not mounted" -ForegroundColor Yellow
}

# Stop existing container
$existing = docker ps -aq -f "name=aisqlagent"
if ($existing) {
    Write-Host "      Stopping existing container..." -ForegroundColor Gray
    docker rm -f aisqlagent 2>&1 | Out-Null
}

# Run container
Write-Host "[5/5] Starting container on port $Port..." -ForegroundColor Yellow

$dockerArgs = @(
    "run", "-d",
    "--name", "aisqlagent",
    "--restart", "unless-stopped",
    "-p", "${Port}:3000",
    "--add-host", "host.docker.internal:host-gateway"
)
$dockerArgs += $volumes
$dockerArgs += $IMAGE_NAME

$containerId = & docker @dockerArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "      ERROR: Failed to start container!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  AISQLAGENT is running!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  UI:        http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Container: $($containerId.Substring(0,12))" -ForegroundColor Gray
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Gray
Write-Host "    View logs:  docker logs -f aisqlagent" -ForegroundColor Gray
Write-Host "    Stop:       docker stop aisqlagent" -ForegroundColor Gray
Write-Host "    Restart:    docker restart aisqlagent" -ForegroundColor Gray
Write-Host ""

# Open browser
Start-Process "http://localhost:$Port"
