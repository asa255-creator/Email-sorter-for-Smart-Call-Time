#!/bin/bash
# Smart Call Time - Setup Script
# This script helps you deploy the code to Google Apps Script using clasp

echo "============================================"
echo "Smart Call Time - Setup Script"
echo "============================================"
echo ""

# Check if clasp is installed
if ! command -v clasp &> /dev/null; then
    echo "clasp is not installed. Installing..."
    npm install -g @google/clasp
fi

# Check if logged in
echo "Checking clasp login status..."
if ! clasp login --status &> /dev/null; then
    echo "Please log in to clasp:"
    clasp login
fi

echo ""
echo "Choose an option:"
echo "1. Create a NEW Google Sheet with the script"
echo "2. Push to an EXISTING Apps Script project"
echo ""
read -p "Enter choice (1 or 2): " choice

if [ "$choice" == "1" ]; then
    echo ""
    echo "Creating new Google Sheets project..."

    # Create new sheets project
    cd src
    clasp create --type sheets --title "Smart Call Time - Flow Integrator"

    echo ""
    echo "Pushing code..."
    clasp push

    echo ""
    echo "Opening in browser..."
    clasp open

    echo ""
    echo "============================================"
    echo "SETUP COMPLETE!"
    echo "============================================"
    echo ""
    echo "Next steps:"
    echo "1. In the opened spreadsheet, refresh the page"
    echo "2. Click: Smart Call Time > Email Sorter > Setup"
    echo "3. Deploy as web app: Deploy > New deployment"
    echo ""

elif [ "$choice" == "2" ]; then
    echo ""
    read -p "Enter your Script ID: " script_id

    # Create .clasp.json
    cat > .clasp.json << EOF
{
  "scriptId": "$script_id",
  "rootDir": "./src"
}
EOF

    echo "Pushing code..."
    clasp push

    echo ""
    echo "Opening in browser..."
    clasp open

    echo ""
    echo "============================================"
    echo "PUSH COMPLETE!"
    echo "============================================"
    echo ""
    echo "Refresh your document and run Setup from the menu."
    echo ""

else
    echo "Invalid choice. Exiting."
    exit 1
fi
