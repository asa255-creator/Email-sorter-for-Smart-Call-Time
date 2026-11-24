#!/bin/bash

# ============================================================================
# Email Sorter - setup
# ============================================================================
# Pushes the code in src/ to a Google Sheets-bound Apps Script project.
#
# Usage:
#   ./setup.sh           # Interactive menu
#   ./setup.sh --clean   # Remove local config and start fresh
#   ./setup.sh --reset   # Remove local config and reset code to the remote branch
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Node.js v25 memory workaround for clasp
export NODE_OPTIONS="--max-old-space-size=8192"

print_header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  Email Sorter - Setup${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
}
print_success() { echo -e "${GREEN}✓ $1${NC}"; }
print_error() { echo -e "${RED}✗ $1${NC}"; }
print_warning() { echo -e "${YELLOW}! $1${NC}"; }
print_info() { echo -e "${BLUE}→ $1${NC}"; }

# ============================================================================
# UPDATE LOCAL CODE
# ============================================================================

pull_latest() {
    print_info "Checking for updates..."
    if [ ! -d ".git" ]; then
        print_error "Not a git repository. Re-clone it from GitHub and try again."
        return 1
    fi
    if ! git fetch origin 2>/dev/null; then
        print_error "Could not fetch from GitHub (network or login problem)."
        return 1
    fi

    local branch local_rev remote_rev
    branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
    local_rev=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
    remote_rev=$(git rev-parse "origin/$branch" 2>/dev/null || echo "unknown")

    if [ "$remote_rev" = "unknown" ]; then
        print_info "Branch: $branch (not on GitHub yet)"
    elif [ "$local_rev" != "$remote_rev" ]; then
        print_warning "Updates available on $branch"
        local backup=""
        [ -f "$SRC_DIR/.clasp.json" ] && backup=$(cat "$SRC_DIR/.clasp.json")
        git reset --hard "origin/$branch"
        [ -n "$backup" ] && echo "$backup" > "$SRC_DIR/.clasp.json"
        print_success "Updated to latest. Restarting..."
        exec "$0" "$@"
    else
        print_success "Code is up to date on $branch"
    fi
    echo ""
}

# ============================================================================
# DEPENDENCIES
# ============================================================================

check_dependencies() {
    print_info "Checking dependencies..."
    if ! command -v npm &> /dev/null; then
        print_error "npm not found. Install Node.js first:"
        echo "  Mac: brew install node@20"
        echo "  Download: https://nodejs.org/"
        exit 1
    fi
    if ! command -v clasp &> /dev/null; then
        print_info "Installing clasp..."
        npm install -g @google/clasp
    fi
    if ! clasp login --status 2>/dev/null | grep -qi "logged in"; then
        print_warning "Not logged into clasp"
        clasp login
    else
        print_success "clasp is logged in"
    fi
    echo ""
}

# ============================================================================
# PROJECT
# ============================================================================

create_new_project() {
    print_info "Creating a new Google Sheet with the Email Sorter script..."
    rm -f "$SRC_DIR/.clasp.json" "$HOME/.clasp.json"
    cd "$SRC_DIR"
    if clasp create --type sheets --title "Email Sorter" --rootDir "$SRC_DIR"; then
        print_success "Project created"
    else
        print_error "Failed to create project"
        exit 1
    fi
    push_code
    offer_authorize
    show_completion
}

update_existing_project() {
    if [ -f "$SRC_DIR/.clasp.json" ]; then
        local existing_id
        existing_id=$(grep -o '"scriptId": *"[^"]*"' "$SRC_DIR/.clasp.json" | sed 's/.*"\([^"]*\)"$/\1/')
        echo "Found existing project:"
        echo -e "  Script ID: ${CYAN}$existing_id${NC}"
        echo ""
        echo "  1) Use this project"
        echo "  2) Enter a different Script ID"
        echo ""
        read -p "Enter choice (1 or 2): " choice
        case $choice in
            1) ;;
            2) enter_script_id ;;
            *) print_error "Invalid choice"; exit 1 ;;
        esac
    else
        enter_script_id
    fi
    echo ""
    push_code
    remove_old_webapp
    offer_authorize
    show_completion
}

enter_script_id() {
    echo "To find your Script ID:"
    echo "  1. Open your Google Sheet"
    echo "  2. Click Extensions > Apps Script"
    echo "  3. Click Project Settings (gear icon) and copy the Script ID"
    echo ""
    read -p "Enter Script ID: " script_id
    if [[ ! "$script_id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        print_error "That does not look like a Script ID"
        exit 1
    fi
    echo "{\"scriptId\":\"$script_id\",\"rootDir\":\"$SRC_DIR\"}" > "$SRC_DIR/.clasp.json"
    print_success "Configured for Script ID: $script_id"
}

push_code() {
    print_info "Pushing code to Apps Script..."
    cd "$SRC_DIR"
    if clasp push --force; then
        print_success "Code pushed"
        ls -1 *.gs *.json 2>/dev/null | while read -r f; do echo "  └─ $f"; done
    else
        print_error "Failed to push code"
        echo "  Try: clasp login, and check the Script ID and that you can edit the project."
        exit 1
    fi
}

# The old version ran a public web app for the Hub. Its deployments keep
# serving the old code until they are removed.
remove_old_webapp() {
    cd "$SRC_DIR"
    local ids
    ids=$(clasp deployments 2>/dev/null | grep -E '^- AKfycb' | grep -v '@HEAD' | sed 's/^- //' | awk '{print $1}' || true)
    if [ -z "$ids" ]; then
        return 0
    fi
    echo ""
    print_warning "Found web app deployments from the old Hub version:"
    echo "$ids" | sed 's/^/    /'
    echo "  They accept requests from anyone and are no longer used."
    read -p "Remove them now? (y/n): " choice
    if [ "$choice" = "y" ] || [ "$choice" = "Y" ]; then
        for id in $ids; do
            if clasp undeploy "$id" >/dev/null 2>&1 || clasp delete-deployment "$id" >/dev/null 2>&1; then
                print_success "Removed $id"
            else
                print_warning "Could not remove $id. Remove it in Apps Script: Deploy > Manage deployments > Archive."
            fi
        done
    else
        print_info "Skipped. You can archive them in Apps Script: Deploy > Manage deployments."
    fi
}

offer_authorize() {
    echo ""
    read -p "Open the script to grant permissions now? (y/n): " choice
    if [ "$choice" != "y" ] && [ "$choice" != "Y" ]; then
        print_info "Skipped. The sheet asks for permission the first time you use the menu."
        return 0
    fi
    local script_id
    script_id=$(grep -o '"scriptId": *"[^"]*"' "$SRC_DIR/.clasp.json" | sed 's/.*"\([^"]*\)"$/\1/')
    local url="https://script.google.com/d/$script_id/edit"
    echo ""
    echo -e "  Opening ${CYAN}$url${NC}"
    if command -v open &> /dev/null; then open "$url"
    elif command -v xdg-open &> /dev/null; then xdg-open "$url"
    elif command -v wslview &> /dev/null; then wslview "$url"
    fi
    echo "  In the editor: pick the 'authorize' function, click Run, and approve the permissions."
    read -p "Press Enter when done..."
}

switch_account() {
    clasp logout 2>/dev/null || true
    clasp login
    print_success "Account switched"
}

show_completion() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  DONE${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "Next:"
    echo "  1. Open the Google Sheet and refresh the page"
    echo "  2. Click Email Sorter > Set up / upgrade"
    echo "  3. On the Labels sheet, choose an Inbox action for each label"
    echo "     (or run Email Sorter > Suggest labels from my mail)"
    echo "  4. Click Email Sorter > Sort now and read the Log sheet"
    echo ""
}

clean_start() {
    print_header
    print_warning "This removes local configuration (src/.clasp.json). Your Sheet and script are not touched."
    read -p "Continue? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        rm -f "$SRC_DIR/.clasp.json" "$HOME/.clasp.json"
        print_success "Local configuration removed. Run ./setup.sh to start again."
    else
        print_info "Cancelled"
    fi
}

full_reset() {
    print_header
    print_warning "This removes local configuration AND resets local code to the remote branch."
    read -p "Continue? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        rm -f "$SRC_DIR/.clasp.json" "$HOME/.clasp.json"
        git fetch origin
        git reset --hard "origin/$(git rev-parse --abbrev-ref HEAD)"
        print_success "Reset complete. Run ./setup.sh to set up again."
    else
        print_info "Cancelled"
    fi
}

main() {
    print_header
    pull_latest "$@" || exit 1
    check_dependencies
    echo "What would you like to do?"
    echo ""
    echo "  1) Create a NEW Email Sorter sheet"
    echo "  2) Update an EXISTING sheet (also upgrades the old Hub version)"
    echo "  3) Switch Google account"
    echo "  4) Exit"
    echo ""
    read -p "Enter choice (1-4): " choice
    case $choice in
        1) create_new_project ;;
        2) update_existing_project ;;
        3) switch_account; main ;;
        4) exit 0 ;;
        *) print_error "Invalid choice"; exit 1 ;;
    esac
}

case "${1:-}" in
    --clean) clean_start ;;
    --reset) full_reset ;;
    --help|-h)
        echo "Usage: ./setup.sh [--clean | --reset | --help]"
        echo "  (none)   Interactive setup"
        echo "  --clean  Remove local config files"
        echo "  --reset  Remove local config and reset code to the remote branch"
        ;;
    *) main ;;
esac
