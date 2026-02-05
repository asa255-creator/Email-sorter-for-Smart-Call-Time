#!/bin/bash
# Smart Call Time - Setup Script
# This script deploys the code to Google Apps Script using clasp

set -e

# Configuration
HUB_URL="${HUB_URL:-}"  # Set this to your Hub's web app URL after deploying

echo "============================================"
echo "  Smart Call Time - Setup Script"
echo "============================================"
echo ""

# Get the directory where this script lives (the repo root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC_DIR="$SCRIPT_DIR/src"

# Always pull latest code from GitHub
echo "Pulling latest code from GitHub..."
cd "$SCRIPT_DIR"
git pull origin main 2>/dev/null || git pull 2>/dev/null || echo "Warning: Could not pull latest code. Continuing with local version."
echo ""

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

# Function to deploy as web app
deploy_webapp() {
    echo ""
    echo "Deploying as web app..."

    cd "$SRC_DIR"

    # Check for existing deployments
    EXISTING_DEPLOYS=$(clasp deployments 2>/dev/null | grep -c "web app" || echo "0")

    if [ "$EXISTING_DEPLOYS" != "0" ]; then
        echo ""
        echo "Found existing web app deployment(s)."
        clasp deployments
        echo ""
        read -p "Create NEW deployment or use existing? (new/existing): " deploy_choice

        if [ "$deploy_choice" == "existing" ]; then
            # Get the existing deployment URL
            DEPLOY_ID=$(clasp deployments 2>/dev/null | grep "@" | head -1 | awk '{print $2}')
            if [ -n "$DEPLOY_ID" ]; then
                WEBHOOK_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
                echo "Using existing deployment: $WEBHOOK_URL"
            else
                echo "Could not find deployment ID. Creating new deployment..."
                DEPLOY_OUTPUT=$(clasp deploy --description "Email Sorter Webhook" 2>&1)
                echo "$DEPLOY_OUTPUT"
                DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -o 'AKfycb[a-zA-Z0-9_-]*' | head -1)
                WEBHOOK_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
            fi
        else
            # Create new deployment
            DEPLOY_OUTPUT=$(clasp deploy --description "Email Sorter Webhook" 2>&1)
            echo "$DEPLOY_OUTPUT"
            DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -o 'AKfycb[a-zA-Z0-9_-]*' | head -1)
            WEBHOOK_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
        fi
    else
        # No existing deployments, create new
        DEPLOY_OUTPUT=$(clasp deploy --description "Email Sorter Webhook" 2>&1)
        echo "$DEPLOY_OUTPUT"
        DEPLOY_ID=$(echo "$DEPLOY_OUTPUT" | grep -o 'AKfycb[a-zA-Z0-9_-]*' | head -1)
        WEBHOOK_URL="https://script.google.com/macros/s/$DEPLOY_ID/exec"
    fi

    if [ -z "$WEBHOOK_URL" ] || [ "$WEBHOOK_URL" == "https://script.google.com/macros/s//exec" ]; then
        echo ""
        echo "WARNING: Could not automatically get webhook URL."
        echo "Please manually deploy as web app in Apps Script editor:"
        echo "  1. Open script in browser: clasp open"
        echo "  2. Deploy > New deployment > Web app"
        echo "  3. Copy the URL"
        echo ""
        read -p "Enter your webhook URL (or press Enter to skip): " WEBHOOK_URL
    fi

    echo ""
    echo "Webhook URL: $WEBHOOK_URL"

    # Store webhook URL for later use
    export WEBHOOK_URL
}

# Function to register with hub
register_with_hub() {
    if [ -z "$HUB_URL" ]; then
        echo ""
        echo "NOTE: Hub URL not configured. Skipping hub registration."
        echo "To register later, run: ./setup.sh --reconnect"
        return
    fi

    if [ -z "$WEBHOOK_URL" ]; then
        echo "No webhook URL available. Skipping hub registration."
        return
    fi

    echo ""
    echo "Registering with Central Hub..."

    # Get user email from clasp
    USER_EMAIL=$(clasp login --status 2>/dev/null | grep -o '[a-zA-Z0-9._%+-]*@[a-zA-Z0-9.-]*\.[a-zA-Z]*' | head -1)

    # Get script ID
    SCRIPT_ID=$(grep -o '"scriptId"[[:space:]]*:[[:space:]]*"[^"]*"' "$SRC_DIR/.clasp.json" 2>/dev/null | cut -d'"' -f4)

    # Get instance name from email
    INSTANCE_NAME=$(echo "$USER_EMAIL" | cut -d'@' -f1 | tr -cd '[:alnum:]_')

    # Get sheet ID (try to extract from clasp open output or ask user)
    echo "To complete registration, we need your Google Sheet ID."
    echo "You can find it in your spreadsheet URL: docs.google.com/spreadsheets/d/SHEET_ID/edit"
    read -p "Enter your Sheet ID: " SHEET_ID

    if [ -z "$SHEET_ID" ]; then
        echo "No Sheet ID provided. Skipping hub registration."
        echo "You can register later with: ./setup.sh --reconnect"
        return
    fi

    # Call hub registration endpoint
    REGISTER_RESPONSE=$(curl -s -X POST "$HUB_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"action\": \"register\",
            \"email\": \"$USER_EMAIL\",
            \"sheetId\": \"$SHEET_ID\",
            \"instanceName\": \"$INSTANCE_NAME\",
            \"webhookUrl\": \"$WEBHOOK_URL\"
        }" 2>/dev/null || echo '{"success": false, "error": "Could not connect to hub"}')

    echo "Hub response: $REGISTER_RESPONSE"

    if echo "$REGISTER_RESPONSE" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
        echo ""
        echo "Successfully registered with Central Hub!"
    else
        echo ""
        echo "WARNING: Hub registration may have failed."
        echo "You can try again later with: ./setup.sh --reconnect"
    fi
}

# Handle --switch-account flag
if [ "$1" == "--switch-account" ]; then
    echo "Switching Google account..."
    clasp logout 2>/dev/null || true
    clasp login
    echo ""
    echo "Account switched. Run ./setup.sh again to create a project."
    exit 0
fi

# Handle --reconnect flag
if [ "$1" == "--reconnect" ]; then
    echo "Reconnecting existing project..."
    echo ""

    # Check if logged in to clasp
    if ! clasp login --status 2>/dev/null | grep -q "You are logged in"; then
        echo "Please log in with your Google account."
        clasp login
    fi

    # Check for existing .clasp.json
    if [ ! -f "$SRC_DIR/.clasp.json" ]; then
        echo "ERROR: No existing project found in src/.clasp.json"
        echo "Run ./setup.sh without --reconnect to set up a new project."
        exit 1
    fi

    cd "$SRC_DIR"

    echo "Pushing latest code..."
    clasp push

    # Deploy/redeploy web app
    deploy_webapp

    # Register with hub
    register_with_hub

    echo ""
    echo "============================================"
    echo "  RECONNECT COMPLETE!"
    echo "============================================"
    echo ""
    echo "Webhook URL: $WEBHOOK_URL"
    echo ""
    exit 0
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
echo "  3. Reconnect & redeploy webhook"
echo "  4. Switch Google account"
echo ""
read -p "Enter choice (1, 2, 3, or 4): " choice

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

        # Deploy as web app
        deploy_webapp

        # Register with hub
        register_with_hub

        echo ""
        echo "============================================"
        echo "  SETUP COMPLETE!"
        echo "============================================"
        echo ""
        echo "Webhook URL: $WEBHOOK_URL"
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

        # Deploy as web app
        deploy_webapp

        # Register with hub
        register_with_hub

        echo ""
        echo "============================================"
        echo "  PUSH COMPLETE!"
        echo "============================================"
        echo ""
        echo "Webhook URL: $WEBHOOK_URL"
        echo ""
        echo "Open your spreadsheet in the browser, refresh, and run:"
        echo "  Smart Call Time > Email Sorter > Setup"
        echo ""
        ;;

    3)
        # Reconnect option (same as --reconnect flag)
        if [ ! -f "$SRC_DIR/.clasp.json" ]; then
            echo "ERROR: No existing project found in src/.clasp.json"
            echo "Use option 1 or 2 to set up a project first."
            exit 1
        fi

        cd "$SRC_DIR"

        echo "Pushing latest code..."
        clasp push

        # Deploy/redeploy web app
        deploy_webapp

        # Register with hub
        register_with_hub

        echo ""
        echo "============================================"
        echo "  RECONNECT COMPLETE!"
        echo "============================================"
        echo ""
        echo "Webhook URL: $WEBHOOK_URL"
        echo ""
        ;;

    4)
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
