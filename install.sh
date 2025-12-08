#!/bin/bash
#
# LaunchDB One-Click Installer
# Usage: sudo bash <(curl -fsSL https://launchdb.io/install.sh)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠️${NC}  $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

log_section() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
    echo ""
}

# Input validation functions
validate_domain() {
    local domain="$1"
    # Allow alphanumeric, dots, hyphens (standard domain format)
    if [[ ! "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$ ]]; then
        return 1
    fi
    return 0
}

validate_email() {
    local email="$1"
    # Basic email validation (alphanumeric, @, dots, hyphens)
    if [[ ! "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        return 1
    fi
    return 0
}

validate_cors_origin() {
    local cors="$1"
    # Allow * or http(s):// URLs
    if [ "$cors" = "*" ]; then
        return 0
    fi
    # Allow standard URL format
    if [[ "$cors" =~ ^https?://[a-zA-Z0-9][a-zA-Z0-9.:/,-]+$ ]]; then
        return 0
    fi
    return 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "This script must be run as root (use sudo)"
    exit 1
fi

log_section "LaunchDB Installer"
log_info "Installing LaunchDB - The Open Source BaaS Platform"
echo ""

# Variables
INSTALL_DIR="/opt/launchdb"
ENV_FILE="${INSTALL_DIR}/.env"
CF_DIR="${INSTALL_DIR}/.cloudflared"

# ============================================================
# System Requirements Check
# ============================================================

log_section "Checking System Requirements"

# Check OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
    log_info "Detected OS: $PRETTY_NAME"
else
    log_error "Cannot detect OS. Supported: Ubuntu 20.04+, Debian 11+"
    exit 1
fi

# Verify supported OS
SUPPORTED_OS=false
case "$OS" in
    ubuntu)
        if [ "${VERSION%%.*}" -lt 20 ]; then
            log_error "Ubuntu 20.04 or higher required (found ${VERSION})"
            exit 1
        fi
        SUPPORTED_OS=true
        PACKAGE_MANAGER="apt"
        ;;
    debian)
        if [ "${VERSION%%.*}" -lt 11 ]; then
            log_error "Debian 11 or higher required (found ${VERSION})"
            exit 1
        fi
        SUPPORTED_OS=true
        PACKAGE_MANAGER="apt"
        ;;
    *)
        log_error "Unsupported OS: ${PRETTY_NAME}"
        log_error "LaunchDB officially supports:"
        log_error "  - Ubuntu 20.04+"
        log_error "  - Debian 11+"
        echo ""
        log_info "For other operating systems, please install Docker manually first,"
        log_info "then run: docker run --rm -v /opt/launchdb:/data launchdb/installer"
        exit 1
        ;;
esac

log_success "OS supported: ${PRETTY_NAME}"

# Check disk space (minimum 10GB)
AVAILABLE_SPACE=$(df / | tail -1 | awk '{print $4}')
REQUIRED_SPACE=$((10 * 1024 * 1024)) # 10GB in KB

if [ "$AVAILABLE_SPACE" -lt "$REQUIRED_SPACE" ]; then
    log_error "Insufficient disk space. Need 10GB, have $(($AVAILABLE_SPACE / 1024 / 1024))GB"
    exit 1
fi

log_success "Disk space sufficient ($(($AVAILABLE_SPACE / 1024 / 1024))GB available)"

# ============================================================
# Docker Installation
# ============================================================

log_section "Installing Docker"

if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | awk '{print $3}' | sed 's/,//')
    log_success "Docker already installed (v$DOCKER_VERSION)"
else
    log_info "Docker not found. Installing Docker..."

    # Install dependencies
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release

    # Add Docker GPG key
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/${OS}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    # Add Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${OS} \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start Docker
    systemctl enable docker
    systemctl start docker

    log_success "Docker installed successfully"
fi

# Verify Docker Compose
if docker compose version &> /dev/null; then
    COMPOSE_VERSION=$(docker compose version | awk '{print $4}')
    log_success "Docker Compose available (v$COMPOSE_VERSION)"
else
    log_error "Docker Compose not available. Please install Docker Compose v2+"
    exit 1
fi

# ============================================================
# Port Conflict Detection
# ============================================================

log_section "Checking Port Availability"

PORT_80_USED=""
PORT_443_USED=""

# Use ss (socket statistics) instead of lsof - more widely available
if ss -tlnH sport = :80 2>/dev/null | grep -q :80; then
    PORT_80_USED=$(ss -tlnp sport = :80 2>/dev/null | grep :80 | awk '{print $6}' | grep -oP 'pid=\K[0-9]+' | head -1)
fi

if ss -tlnH sport = :443 2>/dev/null | grep -q :443; then
    PORT_443_USED=$(ss -tlnp sport = :443 2>/dev/null | grep :443 | awk '{print $6}' | grep -oP 'pid=\K[0-9]+' | head -1)
fi

USE_ALTERNATE_PORTS=false
USE_CLOUDFLARE_TUNNEL=false

if [ -n "$PORT_80_USED" ] || [ -n "$PORT_443_USED" ]; then
    log_warn "Port 80 and/or 443 are already in use"

    if [ -n "$PORT_80_USED" ]; then
        PROCESS_80=$(ps -p "$PORT_80_USED" -o comm= 2>/dev/null || echo "unknown")
        log_info "Port 80 used by: $PROCESS_80 (PID $PORT_80_USED)"
    fi

    if [ -n "$PORT_443_USED" ]; then
        PROCESS_443=$(ps -p "$PORT_443_USED" -o comm= 2>/dev/null || echo "unknown")
        log_info "Port 443 used by: $PROCESS_443 (PID $PORT_443_USED)"
    fi

    echo ""
    echo "Choose an option:"
    echo "  1) Use alternate ports (8080/8443)"
    echo "  2) Use Cloudflare Tunnel (recommended - no ports needed)"
    echo "  3) Exit and free up ports manually"
    echo ""

    read -p "Enter choice [1-3]: " CHOICE

    case $CHOICE in
        1)
            log_info "Using alternate ports 8080/8443"
            USE_ALTERNATE_PORTS=true
            ;;
        2)
            log_info "Using Cloudflare Tunnel"
            USE_CLOUDFLARE_TUNNEL=true
            ;;
        3)
            log_info "Exiting. Please free up ports 80/443 and run installer again"
            exit 0
            ;;
        *)
            log_error "Invalid choice"
            exit 1
            ;;
    esac
else
    log_success "Ports 80 and 443 are available"
fi

# ============================================================
# CORS Origin Configuration
# ============================================================

log_section "CORS Configuration"

echo "Enter your frontend domain for CORS (or press Enter for '*' - dev only):"
echo "  Examples: https://app.yourdomain.com, http://localhost:3000"
echo "  Note: '*' allows all origins (insecure for production)"
echo ""

while true; do
    read -p "CORS_ORIGIN: " CORS_INPUT

    if [ -z "$CORS_INPUT" ]; then
        CORS_ORIGIN="*"
        log_warn "Using CORS_ORIGIN=* (all origins allowed)"
        break
    fi

    if validate_cors_origin "$CORS_INPUT"; then
        CORS_ORIGIN="$CORS_INPUT"
        log_success "CORS_ORIGIN set to: $CORS_ORIGIN"
        break
    else
        log_error "Invalid CORS origin format. Use '*' or 'https://domain.com'"
    fi
done

# ============================================================
# Secret Generation
# ============================================================

log_section "Generating Secrets"

log_info "Generating secure random secrets..."

# Generate secrets
POSTGRES_SUPERUSER_PASSWORD=$(openssl rand -base64 24)
AUTHENTICATOR_PASSWORD=$(openssl rand -base64 24)
LAUNCHDB_MASTER_KEY=$(openssl rand -base64 32)
PLATFORM_JWT_SECRET=$(openssl rand -base64 32)
POSTGREST_JWT_SECRET=$(openssl rand -base64 32)
INTERNAL_API_KEY=$(openssl rand -hex 32)
POSTGREST_ADMIN_KEY=$(openssl rand -hex 32)
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)

log_success "All secrets generated (32-byte random values)"

# ============================================================
# Domain Configuration
# ============================================================

log_section "Domain Configuration"

if [ "$USE_CLOUDFLARE_TUNNEL" = true ]; then
    echo "Enter your domain for the Cloudflare Tunnel (e.g., api.yourdomain.com):"
    echo "Note: You'll create a CNAME record pointing this domain to your tunnel"

    while true; do
        read -p "Domain: " DOMAIN_INPUT

        if [ -z "$DOMAIN_INPUT" ]; then
            log_error "Domain is required for Cloudflare Tunnel"
            continue
        fi

        if validate_domain "$DOMAIN_INPUT"; then
            DOMAIN="$DOMAIN_INPUT"
            ACME_EMAIL="noreply@${DOMAIN}"
            log_success "Domain: $DOMAIN"
            log_info "Email set to: $ACME_EMAIL"
            break
        else
            log_error "Invalid domain format (use: api.example.com)"
        fi
    done
else
    echo "Enter your domain name (e.g., api.yourdomain.com):"

    while true; do
        read -p "Domain: " DOMAIN_INPUT

        if [ -z "$DOMAIN_INPUT" ]; then
            log_error "Domain is required"
            continue
        fi

        if validate_domain "$DOMAIN_INPUT"; then
            DOMAIN="$DOMAIN_INPUT"
            break
        else
            log_error "Invalid domain format (use: api.example.com)"
        fi
    done

    echo "Enter email for Let's Encrypt notifications:"

    while true; do
        read -p "Email: " EMAIL_INPUT

        if [ -z "$EMAIL_INPUT" ]; then
            log_error "Email is required"
            continue
        fi

        if validate_email "$EMAIL_INPUT"; then
            ACME_EMAIL="$EMAIL_INPUT"
            break
        else
            log_error "Invalid email format (use: user@example.com)"
        fi
    done

    log_success "Domain: $DOMAIN"
    log_success "Email: $ACME_EMAIL"
fi

# ============================================================
# Create Installation Directory
# ============================================================

log_section "Creating Installation Directory"

if [ -d "$INSTALL_DIR" ]; then
    log_warn "Directory $INSTALL_DIR already exists"
    read -p "Overwrite? [y/N]: " OVERWRITE

    if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
        log_error "Installation cancelled"
        exit 1
    fi

    log_info "Backing up existing installation..."
    mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

log_success "Created $INSTALL_DIR"

# ============================================================
# Download LaunchDB Files
# ============================================================

log_section "Downloading LaunchDB"

LAUNCHDB_VERSION="${LAUNCHDB_VERSION:-v0.1.0}"
GITHUB_REPO="${GITHUB_REPO:-abushadab/launchdb}"
LAUNCHDB_SHA256="${LAUNCHDB_SHA256:-}"

log_info "Downloading LaunchDB ${LAUNCHDB_VERSION} from ${GITHUB_REPO}..."

# SHA256 verification enforcement
if [ "$LAUNCHDB_VERSION" = "latest" ]; then
    # Require SHA256 for "latest" (development/main branch)
    if [ -z "$LAUNCHDB_SHA256" ]; then
        log_error "SHA256 verification is required when using LAUNCHDB_VERSION=latest"
        log_error "Please specify LAUNCHDB_SHA256 or use a specific version tag (e.g., v0.1.0)"
        exit 1
    fi
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/archive/refs/heads/main.tar.gz"
elif [ "$LAUNCHDB_VERSION" = "v0.1.0" ]; then
    # For v0.1.0 release: SHA256 required for security
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/${LAUNCHDB_VERSION}.tar.gz"
    if [ -z "$LAUNCHDB_SHA256" ]; then
        log_error "SHA256 verification is required for v0.1.0 release"
        log_error "Get the hash from: https://github.com/${GITHUB_REPO}/releases/tag/v0.1.0"
        log_error "Install with: LAUNCHDB_SHA256=<hash> curl -fsSL https://launchdb.io/install.sh | sudo bash"
        exit 1
    fi
else
    # Other tagged versions
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/archive/refs/tags/${LAUNCHDB_VERSION}.tar.gz"
    if [ -z "$LAUNCHDB_SHA256" ]; then
        log_warn "Installing without SHA256 verification (not recommended for production)"
    fi
fi

# Download to temporary file for verification
TEMP_TARBALL="/tmp/launchdb-${LAUNCHDB_VERSION}.tar.gz"

if ! curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_TARBALL"; then
    log_error "Failed to download LaunchDB from ${DOWNLOAD_URL}"
    log_info "Please check your internet connection and repository URL"
    rm -f "$TEMP_TARBALL"
    exit 1
fi

# Verify SHA256 checksum if provided
if [ -n "$LAUNCHDB_SHA256" ]; then
    log_info "Verifying download integrity..."
    ACTUAL_SHA256=$(sha256sum "$TEMP_TARBALL" | awk '{print $1}')

    if [ "$ACTUAL_SHA256" != "$LAUNCHDB_SHA256" ]; then
        log_error "SHA256 checksum verification failed!"
        log_error "Expected: $LAUNCHDB_SHA256"
        log_error "Got:      $ACTUAL_SHA256"
        rm -f "$TEMP_TARBALL"
        exit 1
    fi

    log_success "Download integrity verified"
fi

# Extract
if ! tar -xzf "$TEMP_TARBALL" --strip-components=1 -C "$INSTALL_DIR"; then
    log_error "Failed to extract LaunchDB"
    rm -f "$TEMP_TARBALL"
    exit 1
fi

rm -f "$TEMP_TARBALL"
log_success "LaunchDB downloaded and extracted"

# ============================================================
# Generate .env File
# ============================================================

log_section "Generating Configuration"

cat > "$ENV_FILE" <<EOF
# LaunchDB Environment Configuration
# Generated: $(date)
# DO NOT commit this file to version control!

# ============================================================
# Database Configuration
# ============================================================

POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=${POSTGRES_SUPERUSER_PASSWORD}
AUTHENTICATOR_PASSWORD=${AUTHENTICATOR_PASSWORD}

# ============================================================
# Security & Encryption
# ============================================================

LAUNCHDB_MASTER_KEY=${LAUNCHDB_MASTER_KEY}
PLATFORM_JWT_SECRET=${PLATFORM_JWT_SECRET}
POSTGREST_JWT_SECRET=${POSTGREST_JWT_SECRET}
INTERNAL_API_KEY=${INTERNAL_API_KEY}
POSTGREST_ADMIN_KEY=${POSTGREST_ADMIN_KEY}
BACKUP_ENCRYPTION_KEY=${BACKUP_ENCRYPTION_KEY}

# ============================================================
# Domain & TLS
# ============================================================

DOMAIN="${DOMAIN}"
ACME_EMAIL="${ACME_EMAIL}"

# ============================================================
# Application Configuration
# ============================================================

CORS_ORIGIN="${CORS_ORIGIN}"
LOG_LEVEL=info
NODE_ENV=production

# ============================================================
# Manager API Paths (REQUIRED)
# ============================================================

HOST_SCRIPT_DIR=${INSTALL_DIR}/infrastructure/scripts
HOST_CONFIG_DIR=${INSTALL_DIR}/infrastructure/postgrest/projects

EOF

# Add port configuration if using alternate ports
if [ "$USE_ALTERNATE_PORTS" = true ]; then
    cat >> "$ENV_FILE" <<EOF

# ============================================================
# Alternate Ports
# ============================================================

LAUNCHDB_HTTP_PORT=8080
LAUNCHDB_HTTPS_PORT=8443

EOF
fi

# Add Cloudflare Tunnel token if using CF Tunnel
if [ "$USE_CLOUDFLARE_TUNNEL" = true ]; then
    cat >> "$ENV_FILE" <<EOF

# ============================================================
# Cloudflare Tunnel
# ============================================================

CLOUDFLARE_TUNNEL_TOKEN=REPLACE_AFTER_TUNNEL_CREATION

# NOTE: In tunnel mode, Caddy doesn't need port bindings
# Cloudflared connects to Caddy via internal Docker network
# No ACME/TLS challenge needed (tunnel handles TLS)

EOF
fi

# Set secure permissions
chmod 600 "$ENV_FILE"

log_success "Configuration file created: $ENV_FILE"
log_info "Permissions set to 600 (root only)"

# ============================================================
# Cloudflare Tunnel Setup
# ============================================================

if [ "$USE_CLOUDFLARE_TUNNEL" = true ]; then
    log_section "Cloudflare Tunnel Setup"

    # Create Cloudflare credentials directory with secure permissions
    mkdir -p "$CF_DIR"
    chmod 700 "$CF_DIR"
    log_success "Created secure credentials directory: $CF_DIR"

    # Step 1: Cloudflare login
    log_info "Opening browser for Cloudflare login..."
    if ! docker run --rm -it --user root -v "${CF_DIR}:/root/.cloudflared" \
        cloudflare/cloudflared:2025.11.1 tunnel login; then
        log_error "Cloudflare login failed"
        exit 1
    fi

    log_success "Cloudflare login successful"

    # Step 2: Create tunnel
    log_info "Creating tunnel..."
    TUNNEL_NAME="launchdb-$(openssl rand -hex 4)"
    TUNNEL_OUTPUT=$(docker run --rm --user root -v "${CF_DIR}:/root/.cloudflared" \
        cloudflare/cloudflared:2025.11.1 tunnel create "$TUNNEL_NAME" 2>&1)

    TUNNEL_ID=$(echo "$TUNNEL_OUTPUT" | grep -oP '[a-f0-9-]{36}' | head -1)

    if [ -z "$TUNNEL_ID" ]; then
        log_error "Failed to create tunnel"
        echo "$TUNNEL_OUTPUT"
        exit 1
    fi

    log_success "Tunnel created: $TUNNEL_ID"

    # Step 3: Get tunnel token
    log_info "Getting tunnel token..."
    TUNNEL_TOKEN=$(docker run --rm --user root -v "${CF_DIR}:/root/.cloudflared" \
        cloudflare/cloudflared:2025.11.1 tunnel token "$TUNNEL_ID" 2>&1)

    if [ -z "$TUNNEL_TOKEN" ]; then
        log_error "Failed to get tunnel token"
        exit 1
    fi

    # Step 4: Update .env with token (avoid sed - token has special chars)
    grep -v "CLOUDFLARE_TUNNEL_TOKEN=" "$ENV_FILE" > "$ENV_FILE.tmp"
    echo "CLOUDFLARE_TUNNEL_TOKEN=${TUNNEL_TOKEN}" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log_success "Tunnel token added to .env"

    # Step 5: Show CNAME instructions
    echo ""
    log_info "Add this CNAME record in your Cloudflare dashboard:"
    echo "  Name:   ${DOMAIN%%.*} (or your subdomain)"
    echo "  Target: ${TUNNEL_ID}.cfargotunnel.com"
    echo "  Points to: ${DOMAIN}"
    echo ""

    read -p "Press Enter when CNAME is added..."

    # Step 6: Start services
    log_info "Starting LaunchDB with Cloudflare Tunnel..."
    cd "$INSTALL_DIR"
    docker compose -f docker-compose.yml -f docker-compose.cloudflare.yml --profile cloudflare up -d

    log_success "LaunchDB started with Cloudflare Tunnel!"
    log_info "Access LaunchDB at: https://${DOMAIN}"

    exit 0
fi

# ============================================================
# Start LaunchDB
# ============================================================

log_section "Starting LaunchDB"

log_info "Starting Docker services..."

docker compose up -d

log_success "LaunchDB services started"

# ============================================================
# Health Check
# ============================================================

log_section "Verifying Installation"

log_info "Waiting for services to be healthy (up to 90 seconds)..."

# Wait for services with retries
MAX_ATTEMPTS=18
ATTEMPT=0
HEALTHY_COUNT=0
TOTAL_SERVICES=8

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    HEALTHY_COUNT=0

    for SERVICE in postgres pgbouncer platform-api migrations auth-service storage-service postgrest-manager reverse-proxy; do
        CONTAINER="launchdb-${SERVICE}"
        if [ "$SERVICE" = "reverse-proxy" ]; then
            CONTAINER="launchdb-caddy"
        fi

        STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")

        if [ "$STATUS" = "healthy" ]; then
            ((HEALTHY_COUNT++))
        fi
    done

    if [ $HEALTHY_COUNT -eq $TOTAL_SERVICES ]; then
        break
    fi

    ((ATTEMPT++))
    echo -n "."
    sleep 5
done

echo ""
echo ""

# Final health check with detailed output
for SERVICE in postgres pgbouncer platform-api migrations auth-service storage-service postgrest-manager reverse-proxy; do
    CONTAINER="launchdb-${SERVICE}"
    if [ "$SERVICE" = "reverse-proxy" ]; then
        CONTAINER="launchdb-caddy"
    fi

    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "not found")

    if [ "$STATUS" = "healthy" ]; then
        log_success "$SERVICE: healthy"
    elif [ "$STATUS" = "not found" ]; then
        log_warn "$SERVICE: container not found"
    else
        log_warn "$SERVICE: $STATUS (may still be starting)"
    fi
done

echo ""

if [ $HEALTHY_COUNT -eq $TOTAL_SERVICES ]; then
    log_success "All services healthy!"
else
    log_warn "$HEALTHY_COUNT/$TOTAL_SERVICES services healthy after ${ATTEMPT} checks"
    log_info "Some services may need more time. Check status with: docker compose ps"
    log_info "View logs with: docker compose logs -f"
fi

# ============================================================
# Installation Complete
# ============================================================

log_section "Installation Complete!"

echo ""
log_success "LaunchDB is now running!"
echo ""

if [ "$USE_ALTERNATE_PORTS" = true ]; then
    echo "Access URL: https://${DOMAIN}:8443"
else
    echo "Access URL: https://${DOMAIN}"
fi

echo ""
echo "Next steps:"
echo "  1. Configure DNS to point ${DOMAIN} to this server"
echo "  2. Wait for Let's Encrypt TLS certificate (automatic)"
echo "  3. Access LaunchDB at https://${DOMAIN}"
echo ""
echo "Useful commands:"
echo "  View logs:    docker compose logs -f"
echo "  Stop:         docker compose stop"
echo "  Start:        docker compose start"
echo "  Restart:      docker compose restart"
echo "  Status:       docker compose ps"
echo ""
echo "Configuration:"
echo "  Directory:    $INSTALL_DIR"
echo "  Config file:  $ENV_FILE"
echo ""
echo "Backup your secrets!"
echo "  cp $ENV_FILE ~/launchdb-secrets-backup.txt"
echo "  chmod 400 ~/launchdb-secrets-backup.txt"
echo ""

log_info "Installation directory: $INSTALL_DIR"
log_info "For documentation, visit: https://github.com/yourusername/launchdb"

echo ""
log_success "Happy building! 🚀"
echo ""
