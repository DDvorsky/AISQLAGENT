@echo off
REM AISQLAGENT - Quick Docker Runner
REM Downloads and runs the agent from GitHub

setlocal enabledelayedexpansion

set REPO_URL=https://github.com/DDvorsky/AISQLAGENT.git
set AGENT_DIR=%TEMP%\aisqlagent
set IMAGE_NAME=aisqlagent:local

echo ========================================
echo   AISQLAGENT - Local Docker Runner
echo ========================================
echo.

REM Ask for port
set /p PORT="Enter port for agent UI [default: 3333]: "
if "%PORT%"=="" set PORT=3333

echo.
echo Using port: %PORT%
echo.

REM Check Docker
echo [1/5] Checking Docker...
docker version >nul 2>&1
if errorlevel 1 (
    echo       ERROR: Docker is not running!
    echo       Please start Docker Desktop and try again.
    pause
    exit /b 1
)
echo       Docker is running

REM Clone or update
echo [2/5] Downloading from GitHub...
if exist "%AGENT_DIR%" (
    echo       Updating existing clone...
    pushd "%AGENT_DIR%"
    git pull
    popd
) else (
    echo       Cloning repository...
    git clone %REPO_URL% "%AGENT_DIR%"
)
echo       Downloaded to: %AGENT_DIR%

REM Build
echo [3/5] Building Docker image (this may take a few minutes)...
pushd "%AGENT_DIR%"
docker build -t %IMAGE_NAME% .
if errorlevel 1 (
    echo.
    echo       ERROR: Docker build failed!
    echo       Check the errors above.
    popd
    pause
    exit /b 1
)
popd
echo       Image built: %IMAGE_NAME%

REM Stop existing
echo [4/5] Stopping any existing container...
docker rm -f aisqlagent >nul 2>&1

REM Run
echo [5/5] Starting container on port %PORT%...
docker run -d --name aisqlagent --restart unless-stopped -p %PORT%:3000 --add-host host.docker.internal:host-gateway %IMAGE_NAME%
if errorlevel 1 (
    echo.
    echo       ERROR: Failed to start container!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   AISQLAGENT is running!
echo ========================================
echo.
echo   UI: http://localhost:%PORT%
echo.
echo   Commands:
echo     View logs:  docker logs -f aisqlagent
echo     Stop:       docker stop aisqlagent
echo     Restart:    docker restart aisqlagent
echo.

REM Open browser
start http://localhost:%PORT%

pause
