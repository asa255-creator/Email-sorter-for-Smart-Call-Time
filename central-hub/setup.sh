#!/bin/bash

# ============================================================================
# Central Hub Setup Script
# ============================================================================
# Automates deployment of the Smart Call Time Central Hub
#
# Usage:
#   ./setup.sh              # Interactive menu
#   ./setup.sh --configure  # Re-configure Chat space after deployment
# ============================================================================

set -e

# Get script directory (works even if called from different location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Fix Node.js memory issues (v25 bug)
export NODE_OPTIONS="--max-old-space-size=8192"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

print_header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  Smart Call Time - Central Hub Setup${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}! $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

check_dependencies() {
    print_info "Checking dependencies..."

    # Check for npm
    if ! command -v npm &> /dev/null; then
        print_error "npm not found. Please install Node.js first."
        echo "  Mac: brew install node@20"
        echo "  Or download from: https://nodejs.org/"
        exit 1
    fi

    # Check Node version (warn about v25)
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 25 ]; then
        print_warning "Node.js v25+ detected - may have memory issues"
        print_info "NODE_OPTIONS set to mitigate memory bugs"
    fi

    # Check for clasp
    if ! command -v clasp &> /dev/null; then
        print_warning "clasp not found. Installing..."
        npm install -g @google/clasp
    fi

    # Check clasp login
    if ! clasp login --status &> /dev/null; then
        print_warning "Not logged into clasp. Please login:"
        clasp login
    fi

    print_success "Dependencies OK"
}

cleanup_stray_clasp() {
    # Remove any stray .clasp.json files that might interfere
    if [ -f "$HOME/.clasp.json" ]; then
        print_warning "Found stray .clasp.json in home directory, removing..."
        rm "$HOME/.clasp.json"
    fi
}

# ============================================================================
# DEPLOYMENT FUNCTIONS
# ============================================================================

create_new_hub() {
    print_info "Creating new Central Hub project..."

    cleanup_stray_clasp

    # Remove existing .clasp.json if present
    if [ -f "$SCRIPT_DIR/.clasp.json" ]; then
        print_warning "Removing existing .clasp.json..."
        rm "$SCRIPT_DIR/.clasp.json"
    fi

    # Create new Google Sheet with Apps Script
    print_info "Creating Google Sheet and Apps Script project..."
    clasp create --type sheets --title "Smart Call Time Hub" --rootDir "$SCRIPT_DIR"

    if [ ! -f "$SCRIPT_DIR/.clasp.json" ]; then
        print_error "Failed to create project. Check clasp login status."
        exit 1
    fi

    print_success "Project created"

    # Push the code
    push_code

    # Deploy as web app
    deploy_webapp

    # Show next steps
    show_next_steps
}

connect_existing() {
    print_info "Connecting to existing Apps Script project..."

    cleanup_stray_clasp

    echo ""
    echo "To find your Script ID:"
    echo "1. Open your Hub Google Sheet"
    echo "2. Go to Extensions > Apps Script"
    echo "3. Go to Project Settings (gear icon)"
    echo "4. Copy the Script ID"
    echo ""

    read -p "Enter Script ID: " SCRIPT_ID

    if [ -z "$SCRIPT_ID" ]; then
        print_error "Script ID cannot be empty"
        exit 1
    fi

    # Create .clasp.json
    echo "{\"scriptId\":\"$SCRIPT_ID\",\"rootDir\":\"$SCRIPT_DIR\"}" > "$SCRIPT_DIR/.clasp.json"

    print_success "Connected to project"

    # Push the code
    push_code

    # Check for existing deployment or create new
    deploy_webapp
}

push_code() {
    print_info "Pushing code to Apps Script..."

    cd "$SCRIPT_DIR"

    if clasp push --force; then
        print_success "Code pushed successfully"
    else
        print_error "Failed to push code"
        exit 1
    fi
}

deploy_webapp() {
    print_info "Deploying as web app..."

    cd "$SCRIPT_DIR"

    # Check for existing deployments
    EXISTING=$(clasp deployments 2>/dev/null | grep -c "@" || echo "0")

    if [ "$EXISTING" -gt 1 ]; then
        print_warning "Existing deployment found"

        # Get existing deployment URL
        DEPLOY_INFO=$(clasp deployments 2>/dev/null | grep "@" | head -1)
        DEPLOY_ID=$(echo "$DEPLOY_INFO" | awk '{print $2}')

        echo ""
        read -p "Update existing deployment? (y/n): " UPDATE_CHOICE

        if [ "$UPDATE_CHOICE" = "y" ] || [ "$UPDATE_CHOICE" = "Y" ]; then
            clasp deploy --deploymentId "$DEPLOY_ID" --description "Hub $(date +%Y-%m-%d)"
            print_success "Deployment updated"
        else
            print_info "Creating new deployment..."
            clasp deploy --description "Hub $(date +%Y-%m-%d)"
        fi
    else
        # New deployment
        DEPLOY_OUTPUT=$(clasp deploy --description "Hub $(date +%Y-%m-%d)" 2>&1)
        echo "$DEPLOY_OUTPUT"
    fi

    # Extract and display the web app URL
    DEPLOY_ID=$(clasp deployments 2>/dev/null | grep "@" | tail -1 | awk '{print $2}')

    if [ -n "$DEPLOY_ID" ]; then
        HUB_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"

        echo ""
        echo -e "${GREEN}============================================${NC}"
        echo -e "${GREEN}  HUB DEPLOYED SUCCESSFULLY${NC}"
        echo -e "${GREEN}============================================${NC}"
        echo ""
        echo -e "Hub URL (share with users):"
        echo -e "${YELLOW}$HUB_URL${NC}"
        echo ""
        echo "Save this URL! Users will need it for their setup."
        echo ""

        # Save to file for reference
        echo "$HUB_URL" > "$SCRIPT_DIR/.hub_url"
        print_info "URL saved to .hub_url file"
    else
        print_error "Could not determine deployment URL"
        print_info "Run 'clasp deployments' to see your deployments"
    fi
}

configure_chat_space() {
    print_info "Configure Chat Space for user invites"

    echo ""
    echo "To find your Chat space ID:"
    echo "1. Open Google Chat"
    echo "2. Open or create the space for AI categorization"
    echo "3. Look at the URL: https://chat.google.com/room/XXXXXXXXX"
    echo "4. The space ID is: spaces/XXXXXXXXX"
    echo ""

    read -p "Enter Chat space ID (or press Enter to skip): " SPACE_ID

    if [ -n "$SPACE_ID" ]; then
        # Ensure proper format
        if [[ ! "$SPACE_ID" == spaces/* ]]; then
            SPACE_ID="spaces/$SPACE_ID"
        fi

        echo ""
        print_info "Space ID: $SPACE_ID"
        echo ""
        echo "To save this in the Hub:"
        echo "1. Open the Hub spreadsheet"
        echo "2. Go to Hub Admin > Configure Chat Space"
        echo "3. Enter: $SPACE_ID"
        echo ""

        # Save to file for reference
        echo "$SPACE_ID" > "$SCRIPT_DIR/.chat_space_id"
        print_success "Space ID saved to .chat_space_id"
    else
        print_warning "Skipped - configure later via Hub Admin menu"
    fi
}

show_next_steps() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}  NEXT STEPS${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "1. Open the Hub spreadsheet"
    echo "   - Refresh the page to see the 'Hub Admin' menu"
    echo ""
    echo "2. Run initial setup"
    echo "   - Hub Admin > Initial Setup"
    echo "   - Grant permissions when prompted"
    echo ""
    echo "3. Configure Chat (for outbound messages)"
    echo "   - Create a Chat space webhook"
    echo "   - Hub Admin > Configure Chat Webhook"
    echo ""
    echo "4. Configure Chat Space ID (for auto-invites)"
    echo "   - Hub Admin > Configure Chat Space"
    echo "   - Enter your space ID"
    echo ""
    echo "5. (Optional) Deploy as Chat App"
    echo "   - Required if you want Hub to receive messages directly"
    echo "   - See README for Google Cloud Console setup"
    echo ""
    echo "6. Share the Hub URL with users"
    echo "   - They'll use it in their setup.sh"
    echo ""

    if [ -f "$SCRIPT_DIR/.hub_url" ]; then
        echo -e "Hub URL: ${YELLOW}$(cat "$SCRIPT_DIR/.hub_url")${NC}"
    fi
    echo ""
}

# ============================================================================
# MAIN MENU
# ============================================================================

show_menu() {
    print_header

    echo "What would you like to do?"
    echo ""
    echo "  1) Create NEW Hub (Google Sheet + Apps Script)"
    echo "  2) Push to EXISTING Apps Script project"
    echo "  3) Deploy/Update web app only"
    echo "  4) Configure Chat space ID"
    echo "  5) Show Hub URL"
    echo "  6) Exit"
    echo ""

    read -p "Enter choice [1-6]: " choice

    case $choice in
        1)
            check_dependencies
            create_new_hub
            ;;
        2)
            check_dependencies
            connect_existing
            ;;
        3)
            check_dependencies
            deploy_webapp
            show_next_steps
            ;;
        4)
            configure_chat_space
            ;;
        5)
            if [ -f "$SCRIPT_DIR/.hub_url" ]; then
                echo ""
                echo -e "Hub URL: ${YELLOW}$(cat "$SCRIPT_DIR/.hub_url")${NC}"
                echo ""
            else
                print_warning "Hub URL not found. Deploy first."
            fi
            ;;
        6)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac
}

# ============================================================================
# ENTRY POINT
# ============================================================================

# Handle command line arguments
case "${1:-}" in
    --configure)
        configure_chat_space
        ;;
    --deploy)
        check_dependencies
        deploy_webapp
        ;;
    --push)
        check_dependencies
        push_code
        ;;
    --help|-h)
        echo "Usage: ./setup.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)       Interactive menu"
        echo "  --configure  Configure Chat space ID"
        echo "  --deploy     Deploy/update web app"
        echo "  --push       Push code only"
        echo "  --help       Show this help"
        ;;
    *)
        show_menu
        ;;
esac
