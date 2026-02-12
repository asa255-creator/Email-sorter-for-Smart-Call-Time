#!/bin/bash

# ============================================================================
# Smart Call Time - Unified Setup Script
# ============================================================================
# Handles both User Instance and Central Hub deployments
#
# Architecture:
#   - Hub: Web App + Chat App. Receives Chat events via HTTP endpoint.
#   - User: Web App (doGet/doPost). Receives webhooks FROM Hub.
#   - Communication TO Hub: Via Google Chat messages (chat_webhook_url)
#   - Communication TO User: Via webhooks (webhook_url in Hub's Registry sheet)
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

# Config files to preserve across updates (local-only files not tracked in git)
CONFIG_FILES=(
    "src/.clasp.json"
    "central-hub/.clasp.json"
    "src/.webapp_url"
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
            print_error "Could not fetch latest code from GitHub (network/auth issue)."
            echo ""
            echo "Setup aborted to prevent running stale local code."
            echo "Fix git connectivity, then run ./setup.sh again."
            return 1
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

            # Backup config files
            BACKUP_DIR=$(backup_config_files)
            print_info "Config files backed up"

            # Hard reset to remote (always succeeds, no merge conflicts)
            if git reset --hard "origin/$CURRENT_BRANCH" 2>/dev/null; then
                print_success "Updated to latest"

                # Restore config files
                restore_config_files "$BACKUP_DIR"
                print_info "Config files restored"

                # Re-exec with the updated setup.sh so new code takes effect
                print_info "Restarting with updated script..."
                exec "$0" "$@"
            else
                print_error "Failed to update to latest GitHub code."
                restore_config_files "$BACKUP_DIR"
                echo ""
                echo "Setup aborted to prevent running stale local code."
                return 1
            fi
        else
            print_success "Code is up to date on $CURRENT_BRANCH"
        fi
    else
        print_error "Not a git repository. Cannot verify latest GitHub code."
        echo ""
        echo "Setup aborted. Re-clone the repository from GitHub and try again."
        return 1
    fi
    echo ""
    return 0
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
    echo "  2) Central Hub    - Web App + Chat App for routing (admin only)"
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
    if [ "$PROJECT_TYPE" = "hub" ]; then
        echo "  1) Create NEW project (Google Sheet + Apps Script)"
        echo "  2) Update EXISTING project (push code only)"
        echo "  3) Switch Google account"
        echo "  4) Exit"
    else
        echo "  1) Create NEW project (Google Sheet + Apps Script)"
        echo "  2) Update EXISTING project"
        echo "  3) Switch Google account"
        echo "  4) Exit"
    fi
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

    # Both Hub and User need web app deployments
    deploy_webapp

    # Pre-authorize the script
    echo ""
    read -p "Authorize the script now? (y/n): " AUTH_CHOICE
    if [ "$AUTH_CHOICE" = "y" ] || [ "$AUTH_CHOICE" = "Y" ]; then
        pre_authorize
    else
        print_info "Skipped - you'll be prompted to authorize when you first use the Sheet"
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

    # Both Hub and User need web app deployments
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
# DEPLOY WEB APP (User Instances Only)
# ============================================================================

# Parse deployment IDs from plain-text `clasp deployments` output.
#
# `clasp deployments` prints lines like:
#   2 Deployments.
#   - AKfycbxxx @1 - Description text
#   - AKfycbyyy @HEAD -
#
# @HEAD = dev/library deployment (auto-created, not a web app)
# @N   = versioned deployment (these are the web app deployments)

# Get ALL versioned deployment IDs (excluding @HEAD) from plain-text clasp output.
get_webapp_deployment_ids() {
    local deploy_output
    deploy_output=$(clasp deployments 2>/dev/null || echo "")

    if [ -z "$deploy_output" ]; then
        return 0
    fi

    # Extract lines starting with "- AKfycb..." that are NOT @HEAD
    echo "$deploy_output" | grep -E '^- AKfycb' | grep -v '@HEAD' | \
        sed 's/^- //' | awk '{print $1}'
}

# Get the @HEAD (dev/library) deployment ID.
get_head_deployment_id() {
    local deploy_output
    deploy_output=$(clasp deployments 2>/dev/null || echo "")

    if [ -z "$deploy_output" ]; then
        echo ""
        return 0
    fi

    echo "$deploy_output" | grep -E '^- AKfycb.*@HEAD' | \
        sed 's/^- //' | awk '{print $1}'
}

# Get the most recent web app deployment ID (last versioned, highest @N).
get_webapp_deployment_id() {
    get_webapp_deployment_ids | tail -1
}

# Extract deployment ID from clasp deploy output (e.g., "- AKfycb... @6.").
extract_deploy_id_from_output() {
    local output="$1"
    echo "$output" | grep -o 'AKfycb[a-zA-Z0-9_-]*' | head -1
}

# Remove the @HEAD library deployment so only web app deployments remain.
remove_library_deployments() {
    local head_id
    head_id=$(get_head_deployment_id)

    if [ -z "$head_id" ]; then
        return 0
    fi

    print_info "Removing @HEAD library deployment..."
    clasp undeploy "$head_id" 2>/dev/null || \
        print_warning "Could not remove library deployment $head_id (may not exist)"
}

# Keep only the specified web app deployment active; remove extras.
remove_extra_webapp_deployments() {
    local keep_id="$1"
    local webapp_ids
    webapp_ids=$(get_webapp_deployment_ids)

    if [ -z "$webapp_ids" ]; then
        return 0
    fi

    while read -r deploy_id; do
        if [ -n "$deploy_id" ] && [ "$deploy_id" != "$keep_id" ]; then
            print_info "Removing extra deployment $deploy_id..."
            clasp undeploy "$deploy_id" 2>/dev/null || \
            print_warning "Could not remove extra web app deployment $deploy_id"
        fi
    done <<< "$webapp_ids"
}

deploy_webapp() {
    if [ "$PROJECT_TYPE" = "hub" ]; then
        print_info "Deploying Hub as web app..."
    else
        print_info "Deploying User instance as web app..."
    fi

    cd "$SRC_DIR"

    # Show current deployments for debugging
    print_info "Current deployments:"
    clasp deployments 2>/dev/null || print_warning "Could not list deployments"
    echo ""

    remove_library_deployments

    # Check for existing versioned (web app) deployment
    DEPLOY_ID=$(get_webapp_deployment_id)

    if [ -n "$DEPLOY_ID" ]; then
        print_success "Found existing web app deployment: $DEPLOY_ID"
        print_info "Updating in place..."
        local deploy_output
        deploy_output=$(clasp deploy --deploymentId "$DEPLOY_ID" --description "Update $(date +%Y-%m-%d)" 2>&1)
        local deploy_exit=$?

        if [ $deploy_exit -ne 0 ]; then
            print_warning "Web app update failed; keeping existing deployment without creating a new one."
        fi

        # Some clasp versions return a new deployment ID in output even on update.
        local output_deploy_id
        output_deploy_id=$(extract_deploy_id_from_output "$deploy_output")
        if [ -n "$output_deploy_id" ]; then
            DEPLOY_ID="$output_deploy_id"
        fi
    else
        print_info "No versioned web app deployment found - creating one..."
        local create_output
        create_output=$(clasp deploy --description "Initial web app deploy $(date +%Y-%m-%d)" 2>&1)
        echo "$create_output"

        # Extract deployment ID from the create output
        DEPLOY_ID=$(extract_deploy_id_from_output "$create_output")

        # Fallback: re-query deployments
        if [ -z "$DEPLOY_ID" ]; then
            DEPLOY_ID=$(get_webapp_deployment_id)
        fi
    fi

    if [ -n "$DEPLOY_ID" ]; then
        remove_extra_webapp_deployments "$DEPLOY_ID"
    fi

    # Build and persist the deployment URL
    if [ -n "$DEPLOY_ID" ]; then
        WEBAPP_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"

        # Save URL so scripts can find it
        echo "$WEBAPP_URL" > "$SRC_DIR/.webapp_url"

        echo ""
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        if [ "$PROJECT_TYPE" = "hub" ]; then
            echo -e "${GREEN}  HUB WEB APP DEPLOYED${NC}"
        else
            echo -e "${GREEN}  USER WEB APP DEPLOYED${NC}"
        fi
        echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
        echo ""
        echo -e "Web App URL:"
        echo -e "${YELLOW}$WEBAPP_URL${NC}"
        echo ""
        if [ "$PROJECT_TYPE" = "hub" ]; then
            echo "Paste this URL into Google Cloud Console:"
            echo "  Chat API > Configuration > Connection settings > HTTP endpoint URL"
            echo ""
            echo "See central-hub/README.md for full setup instructions."
        else
            echo "This URL will be sent to the Hub during registration."
            echo "Registration happens via Google Chat (not HTTP to Hub)."
        fi
        echo ""
    else
        print_warning "Could not determine deployment URL"
        echo "Run 'clasp deployments' in $SRC_DIR to see deployments"
    fi
}

# ============================================================================
# PRE-AUTHORIZE SCRIPT
# ============================================================================

pre_authorize() {
    print_info "Attempting to pre-authorize script..."

    cd "$SRC_DIR"

    local run_output
    run_output=$(clasp run authorize 2>&1)
    local run_exit=$?

    if [ $run_exit -eq 0 ]; then
        print_success "Script authorized successfully"
        return 0
    fi

    # clasp run failed - open browser for manual authorization
    if echo "$run_output" | grep -qi "not enabled\|API has not been used\|Apps Script API"; then
        print_info "Apps Script API not enabled - opening browser for authorization"
    elif echo "$run_output" | grep -qi "authorization\|consent\|PERMISSION_DENIED"; then
        print_info "Authorization needed - opening browser"
    else
        print_info "Could not run remotely - opening browser for authorization"
    fi

    # Get the script URL from .clasp.json
    local script_id=""
    if [ -f "$SRC_DIR/.clasp.json" ]; then
        script_id=$(grep -o '"scriptId":"[^"]*"' "$SRC_DIR/.clasp.json" 2>/dev/null | cut -d'"' -f4)
    fi

    if [ -n "$script_id" ]; then
        local script_url="https://script.google.com/d/$script_id/edit"
        echo ""
        echo "  Opening the Apps Script editor to trigger authorization..."
        echo -e "  URL: ${CYAN}$script_url${NC}"
        echo ""

        # Try to open in browser
        if command -v open &> /dev/null; then
            open "$script_url"
        elif command -v xdg-open &> /dev/null; then
            xdg-open "$script_url"
        elif command -v wslview &> /dev/null; then
            wslview "$script_url"
        else
            echo "  Could not auto-open browser. Please open the URL above manually."
        fi

        echo "  In the script editor:"
        echo "    1. Select the 'authorize' function from the dropdown"
        echo "    2. Click Run"
        echo "    3. Approve the permissions when prompted"
        echo ""
        read -p "Press Enter after you've authorized the script..."
        print_success "Authorization step complete"
    else
        print_warning "Could not determine Script ID - authorize manually from the Sheet"
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
        echo "  3. Enable the Google Chat API in Google Cloud Console"
        echo "  4. Click: Hub Admin > Configure Chat Space"
        echo "  5. Click: Hub Admin > Configure Chat Webhook"
        echo "  6. Click: Hub Admin > Timer > Start Hub Timer (5-min)"
        echo ""
        echo "  The Hub is purely timer-driven (no Chat App needed)."
        echo "  It polls Chat every 5 minutes to:"
        echo "    - Add emoji reactions to EMAIL_READY messages (triggers Flow)"
        echo "    - Dispatch labeled results to users via webhook"
        echo "    - Clean up confirmed Chat messages"
        echo ""
        echo "  See central-hub/README.md for detailed instructions."
    else
        echo "Next steps for User Instance:"
        echo ""
        echo "  1. Open the Google Sheet and REFRESH the page"
        echo "  2. Click: Smart Call Time > Email Sorter > Setup"
        echo "  3. Configure labels on the Labels sheet"
        echo "  4. Register with Hub: Settings > Register with Hub"
        echo ""
        echo "  Registration posts a REGISTER message to Google Chat."
        echo "  The Hub will see it, store your webhook URL, and confirm."
        echo ""
        echo "  Once registered, the 15-min timer will:"
        echo "    - Auto-scan your inbox for unlabeled emails"
        echo "    - Post one email at a time to Chat for AI labeling"
        echo "    - Apply labels automatically when the Hub sends them back"

        if [ -f "$SRC_DIR/.webapp_url" ]; then
            echo ""
            echo -e "  Your webhook URL: ${CYAN}$(cat "$SRC_DIR/.webapp_url")${NC}"
        fi
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
    [ -f "$HOME/.clasp.json" ] && echo "  - ~/.clasp.json (home directory)"
    echo ""
    echo "This does NOT delete your Google Sheets or Apps Script projects."
    echo ""
    read -p "Continue? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        rm -f "$SCRIPT_DIR/src/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.clasp.json"
        rm -f "$SCRIPT_DIR/src/.webapp_url"
        rm -f "$SCRIPT_DIR/central-hub/.webapp_url"
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
    if ! pull_latest; then
        exit 1
    fi

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
    echo "  1. Delete local config files (.clasp.json)"
    echo "  2. Fetch latest code from remote"
    echo "  3. Hard reset all local code to match remote exactly"
    echo ""
    echo "Your Google Sheets and Apps Script projects are NOT affected."
    echo ""
    read -p "Continue with full reset? (yes/no): " CONFIRM

    if [ "$CONFIRM" = "yes" ]; then
        # Delete local config files
        rm -f "$SCRIPT_DIR/src/.clasp.json"
        rm -f "$SCRIPT_DIR/central-hub/.clasp.json"
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
        echo "Architecture:"
        echo "  Hub:  Web App + Chat App. Receives Chat events via HTTP endpoint."
        echo "  User: Web App. Receives webhooks from Hub. Sends chat messages to Hub."
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
