#!/bin/bash
# Smart Call Time - Setup Script
# This script deploys the code to Google Apps Script using clasp

set -e

echo "============================================"
echo "  Smart Call Time - Setup Script"
echo "============================================"
echo ""

# Get the directory where this script lives (the repo root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_DIR="$SCRIPT_DIR/src"

# Validate we're in the right place
if [ ! -d "$SRC_DIR" ]; then
    echo "ERROR: Cannot find src/ directory."
    echo "Make sure you're running this from the repo root."
    exit 1
fi

if [ ! -f "$SRC_DIR/appsscript.json" ]; then
    echo "ERROR: Cannot find src/appsscript.json"
    echo "The repository structure appears corrupted."
    exit 1
fi

# Check for nested clone (common mistake)
if [ -d "$SCRIPT_DIR/Email-sorter-for-Smart-Call-Time" ]; then
    echo "ERROR: Found nested clone of repository!"
    echo ""
    echo "You have 'Email-sorter-for-Smart-Call-Time/' inside your repo."
    echo "This causes duplicate files. Delete it with:"
    echo ""
    echo "  rm -rf \"$SCRIPT_DIR/Email-sorter-for-Smart-Call-Time\""
    echo ""
    exit 1
fi

# Clean up any stray .clasp.json in root (should only be in src/)
if [ -f "$SCRIPT_DIR/.clasp.json" ]; then
    echo "Removing stray .clasp.json from root directory..."
    rm -f "$SCRIPT_DIR/.clasp.json"
fi

# Check Node version - v25 has memory bugs with clasp
NODE_VERSION=$(node -v 2>/dev/null | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VERSION" == "25" ]; then
    echo "WARNING: Node v25 has known memory bugs with clasp."
    echo ""
    echo "Recommended: Downgrade to Node v20 LTS:"
    echo "  brew unlink node"
    echo "  brew install node@20"
    echo "  brew link --overwrite node@20"
    echo ""
    echo "Attempting to continue with memory workaround..."
    echo ""
fi

# Fix Node v25 memory bug - use maximum heap size
export NODE_OPTIONS="--max-old-space-size=8192"

# Handle --switch-account flag
if [ "$1" == "--switch-account" ]; then
    echo "Switching Google account..."
    clasp logout 2>/dev/null || true
    clasp login
    echo ""
    echo "Account switched. Run ./setup.sh again to create a project."
    exit 0
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "ERROR: npm is not installed."
    echo ""
    echo "Please install Node.js first:"
    echo ""
    echo "  Mac:     brew install node@20"
    echo "  Windows: Download LTS from https://nodejs.org/"
    echo ""
    exit 1
fi

# Check if clasp is installed
if ! command -v clasp &> /dev/null; then
    echo "Installing clasp (Google Apps Script CLI)..."
    npm install -g @google/clasp
    echo ""
fi

# Check if logged in to clasp
echo "Checking Google account login..."
if ! clasp login --status 2>/dev/null | grep -q "You are logged in"; then
    echo ""
    echo "Please log in with your Google account."
    echo "A browser window will open - select the account you want to use."
    echo ""
    clasp login
fi

echo ""
echo "Choose an option:"
echo ""
echo "  1. Create a NEW Google Sheet (recommended for first-time setup)"
echo "  2. Push to an EXISTING Apps Script project"
echo "  3. Switch Google account"
echo ""
read -p "Enter choice (1, 2, or 3): " choice

case $choice in
    1)
        echo ""
        echo "Creating new Google Sheets project..."
        echo ""

        # Remove existing .clasp.json if present
        rm -f "$SRC_DIR/.clasp.json"

        # Change to src directory
        cd "$SRC_DIR"

        # Create new project
        clasp create --type sheets --title "Smart Call Time - Flow Integrator"

        # Verify .clasp.json was created and fix rootDir if needed
        if [ -f ".clasp.json" ]; then
            # Extract scriptId and recreate with correct rootDir
            SCRIPT_ID=$(grep -o '"scriptId"[[:space:]]*:[[:space:]]*"[^"]*"' .clasp.json | cut -d'"' -f4)
            if [ -n "$SCRIPT_ID" ]; then
                cat > .clasp.json << EOF
{
  "scriptId": "$SCRIPT_ID",
  "rootDir": "."
}
EOF
            fi
        fi

        echo ""
        echo "Pushing code to Google..."
        clasp push

        echo ""
        echo "============================================"
        echo "  SETUP COMPLETE!"
        echo "============================================"
        echo ""
        echo "Next steps:"
        echo ""
        echo "  1. Open the Google Sheets URL shown above"
        echo "  2. REFRESH the page"
        echo "  3. Click: Smart Call Time > Email Sorter > Setup"
        echo "  4. Grant permissions when prompted"
        echo ""
        ;;

    2)
        echo ""
        read -p "Enter your Script ID: " script_id

        if [ -z "$script_id" ]; then
            echo "No Script ID entered. Exiting."
            exit 1
        fi

        # Create .clasp.json in src directory with correct rootDir
        cat > "$SRC_DIR/.clasp.json" << EOF
{
  "scriptId": "$script_id",
  "rootDir": "."
}
EOF

        cd "$SRC_DIR"
        echo "Pushing code..."
        clasp push

        echo ""
        echo "============================================"
        echo "  PUSH COMPLETE!"
        echo "============================================"
        echo ""
        echo "Open your spreadsheet in the browser, refresh, and run:"
        echo "  Smart Call Time > Email Sorter > Setup"
        echo ""
        ;;

    3)
        echo ""
        echo "Logging out of current account..."
        clasp logout 2>/dev/null || true
        echo ""
        echo "Please log in with a different Google account:"
        clasp login
        echo ""
        echo "Account switched! Run ./setup.sh again to create a project."
        echo ""
        ;;

    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac
