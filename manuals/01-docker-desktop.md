# AISQLAGENT - Docker Desktop Deployment

## Prerequisites

- Docker Desktop installed and running
- Internet connection (to download image or build from source)

---

## Option A: Quick Start (Windows)

Download and run the script:

```batch
# Download run-agent.bat from GitHub and execute
# Or run from PowerShell:
curl -o run-agent.bat https://raw.githubusercontent.com/DDvorsky/AISQLAGENT/main/scripts/run-agent.bat
.\run-agent.bat
```

The script will:
1. Check if Docker is running
2. Clone/update the repository
3. Build the Docker image
4. Start the container with persistent storage
5. Open the UI in your browser

---

## Option B: Manual Setup

### 1. Pull or Build Image

**From registry (if available):**
```bash
docker pull registry.danyverse.com/aisqlwatch/agent:latest
```

**Or build from source:**
```bash
git clone https://github.com/DDvorsky/AISQLAGENT.git
cd AISQLAGENT
docker build -t aisqlagent:local .
```

### 2. Create Volume for Persistent Config

```bash
docker volume create aisqlagent-config
```

### 3. Run Container

```bash
docker run -d \
  --name aisqlagent \
  --restart unless-stopped \
  -p 3333:3000 \
  -v aisqlagent-config:/app/config \
  --add-host host.docker.internal:host-gateway \
  aisqlagent:local
```

**Parameters explained:**
- `-p 3333:3000` - UI available at http://localhost:3333
- `-v aisqlagent-config:/app/config` - Persistent storage for init.json and SQL config
- `--add-host host.docker.internal:host-gateway` - Allows connecting to localhost SQL Server

### 4. Access UI

Open http://localhost:3333 in your browser.

---

## First-time Setup

1. Open the UI (http://localhost:3333)
2. You'll see "Configuration Required" screen
3. Upload `init.json` file (downloaded from AISQLWatch)
4. Agent will restart automatically
5. Enter password to access configuration
6. Configure SQL Server connection

---

## Connecting to Local SQL Server

If SQL Server runs on the same machine:

| Setting | Value |
|---------|-------|
| Server | `host.docker.internal` |
| Port | `1433` |
| User | Your SQL username |
| Password | Your SQL password |

---

## Useful Commands

```bash
# View logs
docker logs -f aisqlagent

# Stop agent
docker stop aisqlagent

# Start agent
docker start aisqlagent

# Restart agent
docker restart aisqlagent

# Remove and recreate (keeps config!)
docker rm -f aisqlagent
docker run -d --name aisqlagent ... (same command as above)

# Backup config
docker cp aisqlagent:/app/config ./backup-config

# View config files
docker exec aisqlagent ls -la /app/config
```

---

## Troubleshooting

### Agent can't connect to SQL Server

1. Ensure SQL Server allows TCP/IP connections
2. Check firewall settings
3. For local SQL Server, use `host.docker.internal` as server address

### Lost configuration after restart

Make sure you're using the volume mount (`-v aisqlagent-config:/app/config`).

### Port already in use

Change the port: `-p 3456:3000` instead of `-p 3333:3000`
