#!/bin/bash

# Website Screenshot API Deployment Script
# This script handles deployment to different environments

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DEFAULT_ENV="production"
DEFAULT_REGISTRY="your-registry.com"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Help function
show_help() {
    cat << EOF
Website Screenshot API Deployment Script

Usage: $0 [OPTIONS] ENVIRONMENT

ENVIRONMENTS:
    development     Deploy to development environment
    staging         Deploy to staging environment
    production      Deploy to production environment

OPTIONS:
    -h, --help              Show this help message
    -v, --version VERSION   Specify version/tag to deploy (default: latest)
    -r, --registry REGISTRY Docker registry URL (default: $DEFAULT_REGISTRY)
    -b, --build             Build new image before deployment
    -f, --force             Force deployment without confirmation
    -d, --dry-run           Show what would be deployed without executing
    --skip-tests            Skip running tests before deployment
    --skip-migrations       Skip database migrations
    --rollback VERSION      Rollback to specified version

EXAMPLES:
    $0 production                           # Deploy latest to production
    $0 staging -v v1.2.3                   # Deploy specific version to staging
    $0 production -b -f                     # Build and force deploy to production
    $0 --rollback v1.2.2 production        # Rollback production to v1.2.2

EOF
}

# Parse command line arguments
ENVIRONMENT=""
VERSION="latest"
REGISTRY="$DEFAULT_REGISTRY"
BUILD_IMAGE=false
FORCE_DEPLOY=false
DRY_RUN=false
SKIP_TESTS=false
SKIP_MIGRATIONS=false
ROLLBACK_VERSION=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--version)
            VERSION="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -b|--build)
            BUILD_IMAGE=true
            shift
            ;;
        -f|--force)
            FORCE_DEPLOY=true
            shift
            ;;
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        --skip-tests)
            SKIP_TESTS=true
            shift
            ;;
        --skip-migrations)
            SKIP_MIGRATIONS=true
            shift
            ;;
        --rollback)
            ROLLBACK_VERSION="$2"
            shift 2
            ;;
        development|staging|production)
            ENVIRONMENT="$1"
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Validate environment
if [[ -z "$ENVIRONMENT" ]]; then
    log_error "Environment is required"
    show_help
    exit 1
fi

if [[ ! "$ENVIRONMENT" =~ ^(development|staging|production)$ ]]; then
    log_error "Invalid environment: $ENVIRONMENT"
    show_help
    exit 1
fi

# Set environment-specific configurations
case $ENVIRONMENT in
    development)
        COMPOSE_FILE="docker-compose.yml"
        NAMESPACE="web2img-dev"
        REPLICAS=1
        ;;
    staging)
        COMPOSE_FILE="docker-compose.yml"
        NAMESPACE="web2img-staging"
        REPLICAS=2
        ;;
    production)
        COMPOSE_FILE="docker-compose.prod.yml"
        NAMESPACE="web2img-prod"
        REPLICAS=3
        ;;
esac

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running"
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check if required files exist
    if [[ ! -f "$PROJECT_ROOT/$COMPOSE_FILE" ]]; then
        log_error "Compose file not found: $COMPOSE_FILE"
        exit 1
    fi
    
    # Check if environment file exists
    if [[ ! -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]] && [[ "$ENVIRONMENT" != "development" ]]; then
        log_warning "Environment file not found: .env.$ENVIRONMENT"
    fi
    
    log_success "Prerequisites check passed"
}

# Load environment variables
load_environment() {
    log_info "Loading environment configuration..."
    
    # Load base environment
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        set -a
        source "$PROJECT_ROOT/.env"
        set +a
    fi
    
    # Load environment-specific configuration
    if [[ -f "$PROJECT_ROOT/.env.$ENVIRONMENT" ]]; then
        set -a
        source "$PROJECT_ROOT/.env.$ENVIRONMENT"
        set +a
    fi
    
    # Set deployment-specific variables
    export DEPLOY_ENVIRONMENT="$ENVIRONMENT"
    export DEPLOY_VERSION="$VERSION"
    export DEPLOY_TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
    
    log_success "Environment configuration loaded"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        log_warning "Skipping tests"
        return 0
    fi
    
    log_info "Running tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run unit tests
    if ! npm test; then
        log_error "Tests failed"
        exit 1
    fi
    
    log_success "Tests passed"
}

# Build Docker image
build_image() {
    if [[ "$BUILD_IMAGE" == false ]] && [[ -z "$ROLLBACK_VERSION" ]]; then
        log_info "Skipping image build"
        return 0
    fi
    
    log_info "Building Docker image..."
    
    cd "$PROJECT_ROOT"
    
    IMAGE_TAG="$REGISTRY/web2img:$VERSION"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would build image: $IMAGE_TAG"
        return 0
    fi
    
    # Build the image
    docker build -t "$IMAGE_TAG" .
    
    # Tag as latest for the environment
    docker tag "$IMAGE_TAG" "$REGISTRY/web2img:$ENVIRONMENT-latest"
    
    # Push to registry
    docker push "$IMAGE_TAG"
    docker push "$REGISTRY/web2img:$ENVIRONMENT-latest"
    
    log_success "Image built and pushed: $IMAGE_TAG"
}

# Run database migrations
run_migrations() {
    if [[ "$SKIP_MIGRATIONS" == true ]]; then
        log_warning "Skipping database migrations"
        return 0
    fi
    
    log_info "Running database migrations..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would run database migrations"
        return 0
    fi
    
    # Run migrations using a temporary container
    docker run --rm \
        --network "${NAMESPACE}_default" \
        -e NODE_ENV="$ENVIRONMENT" \
        -e DB_HOST="$DB_HOST" \
        -e DB_PORT="$DB_PORT" \
        -e DB_USER="$DB_USER" \
        -e DB_PASSWORD="$DB_PASSWORD" \
        -e DB_DATABASE="$DB_DATABASE" \
        "$REGISTRY/web2img:$VERSION" \
        node ace migration:run
    
    log_success "Database migrations completed"
}

# Deploy application
deploy_application() {
    log_info "Deploying application to $ENVIRONMENT..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would deploy using $COMPOSE_FILE"
        return 0
    fi
    
    # Set image version in environment
    export IMAGE_VERSION="$VERSION"
    
    # Deploy using Docker Compose
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Pull latest images
    $COMPOSE_CMD -f "$COMPOSE_FILE" pull
    
    # Deploy with zero-downtime strategy
    if [[ "$ENVIRONMENT" == "production" ]]; then
        # Rolling update for production
        $COMPOSE_CMD -f "$COMPOSE_FILE" up -d --scale web2img="$REPLICAS" --no-recreate
        
        # Wait for health checks
        log_info "Waiting for health checks..."
        sleep 30
        
        # Verify deployment
        if ! curl -f "http://localhost/health" &> /dev/null; then
            log_error "Health check failed after deployment"
            exit 1
        fi
    else
        # Standard deployment for dev/staging
        $COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    fi
    
    log_success "Application deployed successfully"
}

# Rollback deployment
rollback_deployment() {
    if [[ -z "$ROLLBACK_VERSION" ]]; then
        return 0
    fi
    
    log_info "Rolling back to version $ROLLBACK_VERSION..."
    
    cd "$PROJECT_ROOT"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would rollback to version $ROLLBACK_VERSION"
        return 0
    fi
    
    # Set rollback version
    export IMAGE_VERSION="$ROLLBACK_VERSION"
    
    # Deploy the rollback version
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    $COMPOSE_CMD -f "$COMPOSE_FILE" up -d
    
    # Wait for health checks
    log_info "Waiting for health checks..."
    sleep 30
    
    # Verify rollback
    if ! curl -f "http://localhost/health" &> /dev/null; then
        log_error "Health check failed after rollback"
        exit 1
    fi
    
    log_success "Rollback completed successfully"
}

# Verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would verify deployment"
        return 0
    fi
    
    # Wait for services to be ready
    sleep 10
    
    # Check health endpoint
    local max_attempts=30
    local attempt=1
    
    while [[ $attempt -le $max_attempts ]]; do
        if curl -f "http://localhost/health" &> /dev/null; then
            log_success "Health check passed"
            break
        fi
        
        log_info "Health check attempt $attempt/$max_attempts failed, retrying..."
        sleep 10
        ((attempt++))
    done
    
    if [[ $attempt -gt $max_attempts ]]; then
        log_error "Health check failed after $max_attempts attempts"
        exit 1
    fi
    
    # Run smoke tests
    log_info "Running smoke tests..."
    
    # Test single screenshot endpoint
    if ! curl -f -H "X-API-Key: test-key" -H "Content-Type: application/json" \
         -d '{"url":"https://httpbin.org/json"}' \
         "http://localhost/screenshot" &> /dev/null; then
        log_warning "Screenshot endpoint smoke test failed"
    fi
    
    log_success "Deployment verification completed"
}

# Cleanup old images
cleanup_images() {
    log_info "Cleaning up old Docker images..."
    
    if [[ "$DRY_RUN" == true ]]; then
        log_info "DRY RUN: Would cleanup old images"
        return 0
    fi
    
    # Remove dangling images
    docker image prune -f
    
    # Remove old versions (keep last 5)
    docker images "$REGISTRY/web2img" --format "table {{.Tag}}\t{{.CreatedAt}}" | \
        grep -v latest | \
        sort -k2 -r | \
        tail -n +6 | \
        awk '{print $1}' | \
        xargs -r -I {} docker rmi "$REGISTRY/web2img:{}" || true
    
    log_success "Image cleanup completed"
}

# Confirmation prompt
confirm_deployment() {
    if [[ "$FORCE_DEPLOY" == true ]] || [[ "$DRY_RUN" == true ]]; then
        return 0
    fi
    
    echo
    log_warning "You are about to deploy to $ENVIRONMENT environment"
    log_warning "Version: $VERSION"
    log_warning "Registry: $REGISTRY"
    echo
    
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
}

# Main deployment flow
main() {
    log_info "Starting deployment to $ENVIRONMENT environment"
    log_info "Version: $VERSION"
    log_info "Registry: $REGISTRY"
    
    if [[ "$DRY_RUN" == true ]]; then
        log_warning "DRY RUN MODE - No actual changes will be made"
    fi
    
    check_prerequisites
    load_environment
    confirm_deployment
    
    if [[ -n "$ROLLBACK_VERSION" ]]; then
        rollback_deployment
    else
        run_tests
        build_image
        run_migrations
        deploy_application
    fi
    
    verify_deployment
    cleanup_images
    
    log_success "Deployment completed successfully!"
    log_info "Environment: $ENVIRONMENT"
    log_info "Version: ${ROLLBACK_VERSION:-$VERSION}"
    log_info "Timestamp: $DEPLOY_TIMESTAMP"
}

# Run main function
main "$@"