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

# Default Hub URL (can be overridden during setup)
DEFAULT_HUB_URL="https://script.google.com/macros/library/d/1ugWVACllgPu1i11H5oZ0w1_XwevLqzp-KkfRYPW6aWrB9nxwSyy1tkHJ/2"

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

# Config files to preserve across updates
CONFIG_FILES=(
    "src/.clasp.json"
    "central-hub/.clasp.json"
    "central-hub/.hub_url"
)

# Backup config files to /tmp before reset
backup_config_files() {
    local backup_dir="/tmp/sct_config_backup_$$"
    mkdir -p "$backup_dir"

    for file in "${CONFIG_FILES[@]}"; do
        if [ -f "$SCRIPT_DIR/$file" ]; then
            mkdir -p "$backup_dir/$(dirname "$file")"
            cp "$SCRIPT_DIR/$file" "$backup_dir/$file"
        fi
    done

    echo "$backup_dir"
}

# Restore config files from backup
restore_config_files() {
    local backup_dir="$1"

    if [ ! -d "$backup_dir" ]; then
        return
    fi

    for file in "${CONFIG_FILES[@]}"; do
        if [ -f "$backup_dir/$file" ]; then
            mkdir -p "$SCRIPT_DIR/$(dirname "$file")"
            cp "$backup_dir/$file" "$SCRIPT_DIR/$file"
        fi
    done

    # Clean up backup
    rm -rf "$backup_dir"
}

pull_latest() {
    print_info "Checking for updates..."

    if [ -d ".git" ]; then
        # Fetch latest from remote
        if ! git fetch origin 2>/dev/null; then
            print_warning "Could not fetch from remote (network issue?)"
            echo ""
            return
        fi

        # Try to get current branch
        CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

        # Check for updates on current branch
        LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
        REMOTE=$(git rev-parse "origin/$CURRENT_BRANCH" 2>/dev/null || echo "unknown")

        if [ "$REMOTE" = "unknown" ]; then
            # Remote branch doesn't exist yet (new feature branch)
            print_info "Branch: $CURRENT_BRANCH (no remote tracking)"
        elif [ "$LOCAL" != "$REMOTE" ]; then
            print_warning "Updates available on $CURRENT_BRANCH"
            read -p "Update to latest code? (y/n): " PULL_CHOICE
            if [ "$PULL_CHOICE" = "y" ] || [ "$PULL_CHOICE" = "Y" ]; then
                # Backup config files
                BACKUP_DIR=$(backup_config_files)
                print_info "Config files backed up"

                # Hard reset to remote (always succeeds, no merge conflicts)
                if git reset --hard "origin/$CURRENT_BRANCH" 2>/dev/null; then
                    print_success "Updated to latest"

                    # Restore config files
                    restore_config_files "$BACKUP_DIR"
                    print_info "Config files restored"
                else
                    print_warning "Reset failed - continuing with local code"
                    restore_config_files "$BACKUP_DIR"
                fi
            fi
        else
            print_success "Code is up to date on $CURRENT_BRANCH"
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

    # Register with Hub (User instances only)
    if [ "$PROJECT_TYPE" = "user" ]; then
        prompt_hub_registration
    fi

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

        # Register/update with Hub (User instances only)
        if [ "$PROJECT_TYPE" = "user" ]; then
            prompt_hub_registration
        fi
    else
        # Even without deploy, check if Hub registration needed (User only)
        if [ "$PROJECT_TYPE" = "user" ]; then
            echo ""
            read -p "Check Hub registration status? (y/n): " CHECK_HUB
            if [ "$CHECK_HUB" = "y" ] || [ "$CHECK_HUB" = "Y" ]; then
                prompt_hub_registration
            fi
        fi
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
# HUB REGISTRATION (User Instances Only)
# ============================================================================

# Get the current webapp URL from clasp deployments
get_webapp_url() {
    cd "$SRC_DIR"
    local deploy_list=$(clasp deployments 2>/dev/null || echo "")
    local deploy_id=$(echo "$deploy_list" | grep "@" | tail -1 | awk '{print $2}')

    if [ -n "$deploy_id" ]; then
        echo "https://script.google.com/macros/s/$deploy_id/exec"
    else
        echo ""
    fi
}

# Register or update registration with Hub
register_with_hub() {
    local webapp_url="$1"
    local hub_url="$2"

    if [ -z "$webapp_url" ]; then
        print_error "No webapp URL available"
        return 1
    fi

    print_info "Registering with Hub..."
    echo "  Webhook URL: $webapp_url"
    echo "  Hub URL: $hub_url"
    echo ""

    # Get user email from clasp login
    local user_email=$(clasp login --status 2>/dev/null | grep -o '[^ ]*@[^ ]*' | head -1)

    if [ -z "$user_email" ]; then
        print_warning "Could not determine email, using placeholder"
        user_email="unknown@user"
    fi

    # Generate instance name from email
    local instance_name=$(echo "$user_email" | cut -d'@' -f1 | tr -cd 'a-zA-Z0-9_')

    # Make registration request
    local response=$(curl -s -X POST "$hub_url" \
        -H "Content-Type: application/json" \
        -d "{
            \"action\": \"register\",
            \"email\": \"$user_email\",
            \"instanceName\": \"$instance_name\",
            \"webhookUrl\": \"$webapp_url\"
        }" 2>/dev/null)

    # Check response
    if echo "$response" | grep -q '"success":true'; then
        print_success "Registered with Hub successfully"

        # Check if response mentions update vs new registration
        if echo "$response" | grep -q '"message":"Registration updated"'; then
            print_info "Updated existing registration"
        else
            print_info "New registration created"
        fi

        # Note: Registration data is stored on Hub's Google Sheet
        # No local file needed

        return 0
    else
        print_error "Hub registration failed"
        echo "Response: $response"
        return 1
    fi
}

# Get Hub URL from central-hub/.hub_url or use default
get_hub_url() {
    local hub_url_file="$SCRIPT_DIR/central-hub/.hub_url"

    if [ -f "$hub_url_file" ]; then
        cat "$hub_url_file"
    else
        echo "$DEFAULT_HUB_URL"
    fi
}

# Prompt for Hub registration (User instances only)
prompt_hub_registration() {
    local webapp_url=$(get_webapp_url)

    if [ -z "$webapp_url" ]; then
        print_warning "No deployment found - skipping Hub registration"
        return
    fi

    echo ""
    echo -e "${YELLOW}Hub Registration${NC}"
    echo "───────────────────────────────────────────────────────"

    # Get Hub URL (from local .hub_url file or default)
    local detected_hub_url=$(get_hub_url)

    echo "Your webhook URL: $webapp_url"
    echo ""

    read -p "Register/update with Hub? (y/n): " DO_REG

    if [ "$DO_REG" = "y" ] || [ "$DO_REG" = "Y" ]; then
        echo ""
        echo "Hub URL options:"
        echo -e "  Detected: ${CYAN}$detected_hub_url${NC}"
        echo ""
        read -p "Use this Hub URL? (y/n): " USE_DETECTED

        local hub_url
        if [ "$USE_DETECTED" = "y" ] || [ "$USE_DETECTED" = "Y" ]; then
            hub_url="$detected_hub_url"
        else
            echo ""
            read -p "Enter Hub URL: " hub_url
            if [ -z "$hub_url" ]; then
                hub_url="$detected_hub_url"
            fi
        fi

        register_with_hub "$webapp_url" "$hub_url"
    else
        print_info "Skipped Hub registration"
        echo "You can register later by running setup again."
        echo "Note: Registration data is stored on the Hub's Google Sheet."
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
            echo ""
            echo "This URL is saved to central-hub/.hub_url"
            echo "User instances will use it for registration."
        fi
    else
        echo "Next steps for User Instance:"
        echo ""
        echo "  1. Open the Google Sheet and REFRESH the page"
        echo "  2. Click: Smart Call Time > Email Sorter > Setup"
        echo "  3. Grant permissions when prompted"
        echo "  4. Configure labels on the Labels sheet"
        echo ""
        echo "Hub registration data is stored on the Hub's Google Sheet."
        echo "Run setup and select 'Register with Hub' to connect."
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
    [ -f "$HOME/.clasp.json" ] && echo "  - ~/.clasp.json (home directory)"
    echo ""
    echo "This does NOT delete your Google Sheets or Apps Script projects."
    echo "Registration data is stored on the Hub's Google Sheet."
    echo ""
    read -p "Continue? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        rm -f "$SCRIPT_DIR/src/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.hub_url"
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
# FULL RESET
# ============================================================================

full_reset() {
    print_header
    print_warning "FULL RESET: This will delete ALL local config and reset to remote code."
    echo ""
    echo "This will:"
    echo "  1. Delete all local config files (.clasp.json, .hub_url)"
    echo "  2. Fetch latest code from remote"
    echo "  3. Hard reset all local code to match remote exactly"
    echo ""
    echo "Your Google Sheets and Apps Script projects are NOT affected."
    echo "Registration data on the Hub is NOT affected."
    echo ""
    read -p "Continue with full reset? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        # Delete local config files
        rm -f "$SCRIPT_DIR/src/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.hub_url"
        rm -f "$HOME/.clasp.json"
        print_success "Config files removed"

        # Fetch and hard reset
        print_info "Fetching latest from remote..."
        if git fetch origin 2>/dev/null; then
            CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
            if git reset --hard "origin/$CURRENT_BRANCH" 2>/dev/null; then
                print_success "Reset to origin/$CURRENT_BRANCH"
            else
                print_error "Reset failed"
                exit 1
            fi
        else
            print_error "Could not fetch from remote"
            exit 1
        fi

        echo ""
        print_success "Full reset complete!"
        echo ""
        echo "Run ./setup.sh to set up again."
    else
        print_info "Cancelled"
    fi
}

# ============================================================================
# ENTRY POINT
# ============================================================================

case "${1:-}" in
    --clean)
        clean_start
        ;;
    --reset)
        full_reset
        ;;
    --help|-h)
        echo "Smart Call Time - Setup Script"
        echo ""
        echo "Usage: ./setup.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)    Interactive setup menu"
        echo "  --clean   Remove local config files (keep code)"
        echo "  --reset   Full reset: delete config AND reset code to remote"
        echo "  --help    Show this help"
        echo ""
        echo "Examples:"
        echo "  ./setup.sh           # Run interactive setup"
        echo "  ./setup.sh --clean   # Clear config only"
        echo "  ./setup.sh --reset   # Nuclear option - full reset"
        ;;
    *)
        main
        ;;
esac
