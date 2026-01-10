# Docker Quick Start Guide

Get DevOrbit Dashboard running with Docker in minutes.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (version 20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) installed (version 2.0+)

## Quick Start

### 1. Download Configuration Files

```bash
# Create a directory for DevOrbit
mkdir devorbit-dashboard
cd devorbit-dashboard

# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/hpmartini/DevHub/main/docker-compose.yml

# Download .env.example
curl -O https://raw.githubusercontent.com/hpmartini/DevHub/main/.env.example

# Copy to .env
cp .env.example .env
```

### 2. Configure Environment Variables

Edit the `.env` file and set required variables:

```bash
# Edit .env file
nano .env
```

**Required variables:**
- `CODE_SERVER_PASSWORD` - Set a strong password for VS Code access
- `GEMINI_API_KEY` - Your Gemini AI API key (get one from [Google AI Studio](https://makersuite.google.com/app/apikey))

**Optional variables:**
- `POSTGRES_PASSWORD` - Database password (default: postgres)
- `CODE_SERVER_SUDO_PASSWORD` - Sudo password for code-server (leave empty to disable)
- `DEVORBIT_PORT` - Port for web interface (default: 3000)

### 3. Start the Application

```bash
# Pull the latest images from GitHub Container Registry
docker compose pull

# Start all services
docker compose up -d

# View logs
docker compose logs -f
```

### 4. Access the Dashboard

- **Main Dashboard**: http://localhost:3000
- **VS Code (code-server)**: http://localhost:8443

### 5. Configure Project Directories

1. Open the dashboard at http://localhost:3000
2. Go to Settings/Admin Panel
3. Add your project directories (e.g., `/home/coder/Projects`)

Note: By default, the following directories are mounted:
- `~/Projects` → `/home/coder/Projects`
- `~/PROJECTS` → `/home/coder/PROJECTS`

## Using Specific Versions

Instead of `latest`, you can use specific version tags:

```bash
# Edit docker-compose.yml and replace 'latest' with version
# For example, change:
#   image: ghcr.io/hpmartini/devorbit-frontend:latest
# To:
#   image: ghcr.io/hpmartini/devorbit-frontend:v1.0.0

docker compose pull
docker compose up -d
```

## Managing the Application

### View Status

```bash
# List running containers
docker compose ps

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f frontend
docker compose logs -f api
```

### Stop the Application

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: This will delete all data!)
docker compose down -v
```

### Restart Services

```bash
# Restart all services
docker compose restart

# Restart specific service
docker compose restart api
```

### Update to Latest Version

```bash
# Pull latest images
docker compose pull

# Recreate containers with new images
docker compose up -d
```

## Volume Management

DevOrbit uses Docker volumes for persistent data:

- `devorbit-data` - Application data
- `devorbit-sessions` - Terminal sessions
- `devorbit-postgres` - PostgreSQL database
- `devorbit-redis` - Redis cache
- `devorbit-code-server-config` - VS Code configuration

### Backup Data

```bash
# Backup PostgreSQL database
docker compose exec db pg_dump -U postgres devorbit > backup.sql

# Backup volumes
docker run --rm -v devorbit-data:/data -v $(pwd):/backup alpine tar czf /backup/devorbit-data.tar.gz -C /data .
```

### Restore Data

```bash
# Restore PostgreSQL database
docker compose exec -T db psql -U postgres devorbit < backup.sql

# Restore volumes
docker run --rm -v devorbit-data:/data -v $(pwd):/backup alpine tar xzf /backup/devorbit-data.tar.gz -C /data
```

## Troubleshooting

### Container won't start

```bash
# Check logs for errors
docker compose logs

# Verify environment variables
cat .env

# Ensure required variables are set
grep -E "CODE_SERVER_PASSWORD|GEMINI_API_KEY" .env
```

### Permission issues with mounted directories

```bash
# Check directory permissions
ls -la ~/Projects

# Fix permissions (run on host)
chmod -R 755 ~/Projects
```

### Port conflicts

If port 3000 or 8443 is already in use:

```bash
# Change port in docker-compose.yml
# Edit the ports section:
#   ports:
#     - "3001:80"  # Changed from 3000 to 3001

# Or set DEVORBIT_PORT in .env
echo "DEVORBIT_PORT=3001" >> .env
```

### Database connection issues

```bash
# Check database health
docker compose exec db pg_isready -U postgres

# Verify database exists
docker compose exec db psql -U postgres -l

# Reset database (WARNING: This will delete all data!)
docker compose down -v
docker compose up -d
```

## Advanced Configuration

### Using Custom Project Directories

Edit `docker-compose.yml` and add your custom directories:

```yaml
api:
  volumes:
    - /path/to/your/projects:/projects
    - ${HOME}/Projects:/home/coder/Projects
    - ${HOME}/PROJECTS:/home/coder/PROJECTS
```

### Changing Resource Limits

Edit the `deploy` section in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: '4.0'      # Maximum CPU cores
      memory: 4G       # Maximum memory
    reservations:
      cpus: '1.0'      # Reserved CPU cores
      memory: 1G       # Reserved memory
```

### Using External PostgreSQL/Redis

If you have existing PostgreSQL or Redis instances:

1. Remove the `db` and `redis` services from `docker-compose.yml`
2. Update environment variables:
   ```bash
   DATABASE_URL=postgres://user:pass@host:5432/dbname
   REDIS_URL=redis://host:6379
   ```

## Production Deployment

For production deployments:

1. Use strong passwords in `.env`
2. Enable HTTPS (use a reverse proxy like Nginx or Traefik)
3. Set up automated backups
4. Configure log rotation
5. Monitor resource usage
6. Use specific version tags instead of `latest`

Example production `docker-compose.yml` additions:

```yaml
services:
  api:
    restart: always
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Getting Help

- [GitHub Issues](https://github.com/hpmartini/DevHub/issues)
- [Documentation](https://github.com/hpmartini/DevHub/blob/main/README.md)
- [Release Notes](https://github.com/hpmartini/DevHub/releases)

## Security Considerations

1. **Never commit `.env` to version control**
2. **Use strong passwords for CODE_SERVER_PASSWORD**
3. **Keep Docker images updated**
4. **Only expose necessary ports**
5. **Use a firewall to restrict access**
6. **Regular backups of important data**
7. **Monitor logs for suspicious activity**

## Next Steps

After getting DevOrbit running:

1. Configure your Gemini API key in the dashboard
2. Add your project directories
3. Let AI analyze your projects
4. Start managing your development applications!

Enjoy using DevOrbit Dashboard! 🚀
