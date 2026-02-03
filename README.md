# AISQLAGENT - Remote Probe for AISQLWatch

A lightweight agent/probe that runs locally at customer site (Docker container) and enables AISQLWatch cloud application to access local SQL Server and source code files.

## Architecture

```
┌─────────────────────────────────────────┐
│         AISQLWatch Cloud Server         │
│    (holds all SQL queries & logic)      │
└────────────────────┬────────────────────┘
                     │ WSS (TLS)
                     │
┌────────────────────┴────────────────────┐
│           AISQLAGENT (this)             │
│         "Stateless Executor"            │
│  - Executes SQL commands from server    │
│  - Provides file access to server       │
│  - No local storage of queries/logic    │
└────────────────────┬────────────────────┘
          ┌──────────┴──────────┐
          │                     │
    ┌─────┴─────┐        ┌──────┴──────┐
    │ SQL Server│        │ Source Code │
    │  (local)  │        │  (volume)   │
    └───────────┘        └─────────────┘
```

## Quick Start

### 1. Get init.json from AISQLWatch

In AISQLWatch application, create a new "Remote Server" and download the generated `init.json` file.

### 2. Run with Docker Compose

```bash
# Place init.json in current directory
# Edit docker-compose.yml to set your project path

docker-compose up -d
```

### 3. Configure the Agent

Open http://localhost:3000 and configure:
- SQL Server connection (host, port, credentials)
- Test connection
- Create local username/password

## Configuration

### init.json (from server)

```json
{
  "serverId": "rs-xxx-xxx",
  "clientId": "probe-xxx",
  "clientSecret": "sk_live_xxx",
  "serverUrl": "wss://api.aisqlwatch.com/probe",
  "keycloakUrl": "https://auth.aisqlwatch.com/realms/aisqlwatch",
  "apiUrl": "https://api.aisqlwatch.com/v1"
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Web UI port | 3000 |
| `CONFIG_PATH` | Path to init.json | /app/config/init.json |
| `PROJECT_PATH` | Path to source code | /project |

## Security

This agent follows the **"Stateless Executor"** principle:

**What it DOES NOT store locally:**
- SQL queries (received from server, executed, forgotten)
- Business logic or analytical rules
- Query results cache
- Application configuration

**What it DOES store locally:**
- SQL Server connection string (required for connectivity)
- Server authentication credentials (init.json)
- Project path configuration

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Docker Build

```bash
# Build image
docker build -t aisqlagent:latest .

# Run container
docker run -p 3000:3000 \
  -v ./init.json:/app/config/init.json:ro \
  -v /path/to/project:/project:ro \
  aisqlagent:latest
```

## License

MIT
