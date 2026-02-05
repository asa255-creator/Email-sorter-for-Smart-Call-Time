#!/bin/bash

# ============================================================================
# Smart Call Time - Unified Setup Script
# ============================================================================
# Handles both User Instance and Central Hub deployments
#
# Usage:
#   ./setup.sh           # Interactive menu
#   ./setup.sh --clean   # Remove local config and start fresh
# ============================================================================

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Fix Node.js v25 memory issues
export NODE_OPTIONS="--max-old-space-size=8192"

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

print_header() {
    clear
    echo ""
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║         Smart Call Time - Setup Script                     ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

# ============================================================================
# PULL LATEST CODE
# ============================================================================

pull_latest() {
    print_info "Checking for updates..."

    if [ -d ".git" ]; then
        # Fetch and show status
        git fetch origin 2>/dev/null || true

        # Try to get current branch
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

        # Check for updates
        LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
        REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "unknown")

        if [ "$LOCAL" != "$REMOTE" ] && [ "$REMOTE" != "unknown" ]; then
            print_warning "Updates available on $CURRENT_BRANCH"
            read -p "Pull latest code? (y/n): " PULL_CHOICE
            if [ "$PULL_CHOICE" = "y" ] || [ "$PULL_CHOICE" = "Y" ]; then
                if git pull origin "$CURRENT_BRANCH" 2>/dev/null; then
                    print_success "Updated to latest"
                else
                    print_warning "Could not pull (continuing with local)"
                fi
            fi
        else
            print_success "Code is up to date"
        fi
    else
        print_warning "Not a git repo - skipping update check"
    fi
    echo ""
}

# ============================================================================
# DEPENDENCY CHECKS
# ============================================================================

check_dependencies() {
    print_info "Checking dependencies..."

    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm not found. Install Node.js first:"
        echo "  Mac: brew install node@20"
        echo "  Download: https://nodejs.org/"
        exit 1
    fi

    # Check Node version
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 25 ]; then
        print_warning "Node.js v25+ detected - memory workaround enabled"
    fi

    # Check clasp
    if ! command -v clasp &> /dev/null; then
        print_info "Installing clasp..."
        npm install -g @google/clasp
    fi

    # Check clasp login
    if ! clasp login --status 2>/dev/null | grep -q "You are logged in"; then
        print_warning "Not logged into clasp"
        clasp login
    else
        LOGGED_IN_AS=$(clasp login --status 2>/dev/null | grep -o '[^ ]*@[^ ]*' | head -1 || echo "unknown")
        print_success "Logged in as: $LOGGED_IN_AS"
    fi

    echo ""
}

# ============================================================================
# PROJECT TYPE SELECTION
# ============================================================================

select_project_type() {
    echo -e "${YELLOW}What are you setting up?${NC}"
    echo ""
    echo "  1) User Instance  - Individual email sorter sheet"
    echo "  2) Central Hub    - Shared hub for routing (admin only)"
    echo ""
    read -p "Enter choice (1 or 2): " TYPE_CHOICE

    case $TYPE_CHOICE in
        1) PROJECT_TYPE="user"; SRC_DIR="$SCRIPT_DIR/src" ;;
        2) PROJECT_TYPE="hub"; SRC_DIR="$SCRIPT_DIR/central-hub" ;;
        *) print_error "Invalid choice"; exit 1 ;;
    esac

    # Verify directory exists
    if [ ! -d "$SRC_DIR" ]; then
        print_error "Directory not found: $SRC_DIR"
        exit 1
    fi

    echo ""
}

# ============================================================================
# ACTION SELECTION
# ============================================================================

select_action() {
    echo -e "${YELLOW}What would you like to do?${NC}"
    echo ""
    echo "  1) Create NEW project (Google Sheet + Apps Script)"
    echo "  2) Update EXISTING project"
    echo "  3) Switch Google account"
    echo "  4) Exit"
    echo ""
    read -p "Enter choice (1-4): " ACTION_CHOICE
    echo ""
}

# ============================================================================
# CREATE NEW PROJECT
# ============================================================================

create_new_project() {
    local project_name

    if [ "$PROJECT_TYPE" = "hub" ]; then
        project_name="Smart Call Time Hub"
    else
        project_name="Smart Call Time - Email Sorter"
    fi

    print_info "Creating new project: $project_name"

    # Clean up any existing .clasp.json
    rm -f "$SRC_DIR/.clasp.json"
    rm -f "$HOME/.clasp.json"

    cd "$SRC_DIR"

    # Create new project
    if clasp create --type sheets --title "$project_name" --rootDir "$SRC_DIR"; then
        print_success "Project created"
    else
        print_error "Failed to create project"
        exit 1
    fi

    # Push code
    push_code

    # Deploy as web app
    deploy_webapp

    # Show completion
    show_completion
}

# ============================================================================
# UPDATE EXISTING PROJECT
# ============================================================================

update_existing_project() {
    print_info "Updating existing project..."
    echo ""

    # Check for existing .clasp.json
    if [ -f "$SRC_DIR/.clasp.json" ]; then
        EXISTING_ID=$(grep -o '"scriptId":"[^"]*"' "$SRC_DIR/.clasp.json" 2>/dev/null | cut -d'"' -f4)
        if [ -n "$EXISTING_ID" ]; then
            echo "Found existing project:"
            echo -e "  Script ID: ${CYAN}$EXISTING_ID${NC}"
            echo ""
            echo "  1) Use this project"
            echo "  2) Enter different Script ID"
            echo ""
            read -p "Enter choice (1 or 2): " UPDATE_CHOICE

            case $UPDATE_CHOICE in
                1) ;; # Use existing
                2) enter_script_id ;;
                *) print_error "Invalid choice"; exit 1 ;;
            esac
        else
            enter_script_id
        fi
    else
        echo "No existing project configuration found."
        echo ""
        enter_script_id
    fi

    echo ""

    # Push code
    push_code

    # Ask about deployment
    echo ""
    read -p "Deploy/update web app? (y/n): " DEPLOY_CHOICE
    if [ "$DEPLOY_CHOICE" = "y" ] || [ "$DEPLOY_CHOICE" = "Y" ]; then
        deploy_webapp
    fi

    show_completion
}

# ============================================================================
# ENTER SCRIPT ID
# ============================================================================

enter_script_id() {
    echo "To find your Script ID:"
    echo ""
    echo "  1. Open your Google Sheet"
    echo "  2. Click Extensions > Apps Script"
    echo "  3. Click Project Settings (gear icon)"
    echo "  4. Copy the Script ID"
    echo ""
    echo "Or visit: https://script.google.com to see all your projects"
    echo ""
    read -p "Enter Script ID: " SCRIPT_ID

    if [ -z "$SCRIPT_ID" ]; then
        print_error "Script ID is required"
        exit 1
    fi

    # Validate format (basic check)
    if [[ ! "$SCRIPT_ID" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        print_error "Invalid Script ID format"
        exit 1
    fi

    echo "{\"scriptId\":\"$SCRIPT_ID\",\"rootDir\":\"$SRC_DIR\"}" > "$SRC_DIR/.clasp.json"
    print_success "Configured for Script ID: $SCRIPT_ID"
}

# ============================================================================
# PUSH CODE
# ============================================================================

push_code() {
    print_info "Pushing code to Apps Script..."

    cd "$SRC_DIR"

    if clasp push --force; then
        print_success "Code pushed successfully"

        # Show what was pushed
        echo ""
        echo "Files pushed:"
        ls -1 *.gs *.json 2>/dev/null | while read f; do echo "  └─ $f"; done
    else
        print_error "Failed to push code"
        echo ""
        echo "Common fixes:"
        echo "  - Run: clasp login"
        echo "  - Check Script ID is correct"
        echo "  - Ensure you have edit access to the project"
        exit 1
    fi
}

# ============================================================================
# DEPLOY WEB APP
# ============================================================================

deploy_webapp() {
    print_info "Deploying as web app..."

    cd "$SRC_DIR"

    # Check existing deployments
    DEPLOY_LIST=$(clasp deployments 2>/dev/null || echo "")
    EXISTING=$(echo "$DEPLOY_LIST" | grep -c "@" || echo "0")

    if [ "$EXISTING" -gt 0 ]; then
        print_info "Found existing deployment - updating..."
        DEPLOY_ID=$(echo "$DEPLOY_LIST" | grep "@" | head -1 | awk '{print $2}')
        clasp deploy --deploymentId "$DEPLOY_ID" --description "Update $(date +%Y-%m-%d)" 2>/dev/null || \
        clasp deploy --description "Deploy $(date +%Y-%m-%d)"
    else
        clasp deploy --description "Initial deploy $(date +%Y-%m-%d)"
    fi

    # Get deployment URL
    DEPLOY_LIST=$(clasp deployments 2>/dev/null || echo "")
    DEPLOY_ID=$(echo "$DEPLOY_LIST" | grep "@" | tail -1 | awk '{print $2}')

    if [ -n "$DEPLOY_ID" ]; then
        WEBAPP_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"

        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  WEB APP DEPLOYED${NC}"
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo ""

        if [ "$PROJECT_TYPE" = "hub" ]; then
            echo -e "Hub URL (share with users):"
            echo -e "${YELLOW}$WEBAPP_URL${NC}"
            echo "$WEBAPP_URL" > "$SRC_DIR/.hub_url"
            print_info "URL saved to central-hub/.hub_url"
        else
            echo -e "Webhook URL (for Hub registration):"
            echo -e "${YELLOW}$WEBAPP_URL${NC}"
        fi
        echo ""
    else
        print_warning "Could not determine deployment URL"
        echo "Run 'clasp deployments' in $SRC_DIR to see deployments"
    fi
}

# ============================================================================
# SWITCH ACCOUNT
# ============================================================================

switch_account() {
    print_info "Logging out of current account..."
    clasp logout 2>/dev/null || true

    print_info "Opening browser for login..."
    clasp login

    print_success "Account switched"
    echo ""
}

# ============================================================================
# SHOW COMPLETION
# ============================================================================

show_completion() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  SETUP COMPLETE!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""

    if [ "$PROJECT_TYPE" = "hub" ]; then
        echo "Next steps for Hub:"
        echo ""
        echo "  1. Open the Hub spreadsheet and REFRESH the page"
        echo "  2. Click: Hub Admin > Initial Setup"
        echo "  3. Click: Hub Admin > Configure Chat Webhook"
        echo "  4. Click: Hub Admin > Configure Chat Space"
        echo ""
        if [ -f "$SRC_DIR/.hub_url" ]; then
            echo -e "Hub URL: ${YELLOW}$(cat "$SRC_DIR/.hub_url")${NC}"
        fi
    else
        echo "Next steps for User Instance:"
        echo ""
        echo "  1. Open the Google Sheet and REFRESH the page"
        echo "  2. Click: Smart Call Time > Email Sorter > Setup"
        echo "  3. Grant permissions when prompted"
        echo "  4. Configure labels on the Labels sheet"
        echo ""
    fi
    echo ""
}

# ============================================================================
# CLEAN START
# ============================================================================

clean_start() {
    print_header
    print_warning "This will remove all local configuration files."
    echo ""
    echo "Files to be removed:"
    [ -f "$SCRIPT_DIR/src/.clasp.json" ] && echo "  - src/.clasp.json"
    [ -f "$SCRIPT_DIR/central-hub/.clasp.json" ] && echo "  - central-hub/.clasp.json"
    [ -f "$SCRIPT_DIR/central-hub/.hub_url" ] && echo "  - central-hub/.hub_url"
    [ -f "$SCRIPT_DIR/central-hub/.chat_space_id" ] && echo "  - central-hub/.chat_space_id"
    [ -f "$HOME/.clasp.json" ] && echo "  - ~/.clasp.json (home directory)"
    echo ""
    echo "This does NOT delete your Google Sheets or Apps Script projects."
    echo ""
    read -p "Continue? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        rm -f "$SCRIPT_DIR/src/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.hub_url"
        rm -f "$SCRIPT_DIR/central-hub/.chat_space_id"
        rm -f "$HOME/.clasp.json"
        echo ""
        print_success "Local configuration removed"
        echo ""
        echo "Run ./setup.sh again to start fresh."
    else
        print_info "Cancelled"
    fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    print_header

    # Always check for updates first
    pull_latest

    # Check dependencies
    check_dependencies

    # Select project type (User or Hub)
    select_project_type

    # Select action (Create, Update, Switch)
    select_action

    case $ACTION_CHOICE in
        1) create_new_project ;;
        2) update_existing_project ;;
        3) switch_account; main ;;
        4) echo "Goodbye!"; exit 0 ;;
        *) print_error "Invalid choice"; exit 1 ;;
    esac
}

# ============================================================================
# ENTRY POINT
# ============================================================================

case "${1:-}" in
    --clean)
        clean_start
        ;;
    --help|-h)
        echo "Smart Call Time - Setup Script"
        echo ""
        echo "Usage: ./setup.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)    Interactive setup menu"
        echo "  --clean   Remove local config files and start fresh"
        echo "  --help    Show this help"
        echo ""
        echo "Examples:"
        echo "  ./setup.sh           # Run interactive setup"
        echo "  ./setup.sh --clean   # Clear config and start over"
        ;;
    *)
        main
        ;;
esac
