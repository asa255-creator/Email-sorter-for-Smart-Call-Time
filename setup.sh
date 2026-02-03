#!/bin/bash
# Smart Call Time - Setup Script
# This script deploys the code to Google Apps Script using clasp

set -e

echo "============================================"
echo "  Smart Call Time - Setup Script"
echo "============================================"
echo ""

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
    echo "  Mac:     brew install node"
    echo "  Windows: Download from https://nodejs.org/"
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

        cd src

        # Remove existing .clasp.json if present
        rm -f .clasp.json

        # Capture clasp create output to get URLs
        CREATE_OUTPUT=$(clasp create --type sheets --title "Smart Call Time - Flow Integrator" 2>&1)
        echo "$CREATE_OUTPUT"

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
        echo "  1. Find the Google Sheets URL in the output above"
        echo "  2. Open that URL in your browser"
        echo "  3. REFRESH the page"
        echo "  4. Click: Smart Call Time > Email Sorter > Setup"
        echo "  5. Grant permissions when prompted"
        echo ""
        ;;

    2)
        echo ""
        read -p "Enter your Script ID: " script_id

        if [ -z "$script_id" ]; then
            echo "No Script ID entered. Exiting."
            exit 1
        fi

        # Create .clasp.json in src directory
        cat > src/.clasp.json << EOF
{
  "scriptId": "$script_id",
  "rootDir": "."
}
EOF

        cd src
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
