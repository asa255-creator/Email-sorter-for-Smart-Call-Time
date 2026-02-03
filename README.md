# Smart Call Time - Flow Integrator

A Google Workspace integration platform for Google Flows. Automatically sort emails using AI-powered categorization.

## Features

- Automatically sort Gmail emails into labels using Google Flows + AI
- Real-time processing of new emails via web app API
- Batch processing of existing unread emails via queue
- Labels synced to spreadsheet for easy Flow access

---

## Step-by-Step Installation

### Step 1: Install Homebrew (Mac only, skip if already installed)

Open Terminal and run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the prompts. When done, close and reopen Terminal.

### Step 2: Install Node.js

**Mac:**
```bash
brew install node
```

**Windows:**
Download and install from https://nodejs.org/

**Verify installation:**
```bash
node --version
npm --version
```

### Step 3: Install clasp (Google Apps Script CLI)

```bash
npm install -g @google/clasp
```

### Step 4: Clone this repository

```bash
git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
cd Email-sorter-for-Smart-Call-Time
```

### Step 5: Run the setup script

```bash
./setup.sh
```

The script will:
1. Ask you to log in to your Google account (choose which account to use)
2. Create a new Google Sheet with all the code attached
3. Open the Sheet in your browser

### Step 6: Initialize the Email Sorter

1. **Refresh** the spreadsheet in your browser
2. Click **Smart Call Time > Email Sorter > Setup**
3. Grant the required permissions when prompted

### Step 7: Deploy as Web App

1. In the spreadsheet, go to **Extensions > Apps Script**
2. Click **Deploy > New deployment**
3. Select type: **Web app**
4. Execute as: **Me**
5. Who has access: **Anyone**
6. Click **Deploy** and copy the URL

### Step 8: Configure Google Flows

See the **Instructions** sheet in your spreadsheet for:
- How to set up Flows for new emails
- How to set up Flows for batch processing
- AI prompt templates

---

## Switching Google Accounts

To deploy to a different Google account:

```bash
./setup.sh --switch-account
```

Or manually:
```bash
clasp logout
clasp login
```

---

## Project Structure

```
src/
├── Main.gs             # Entry points, menu, triggers
├── SheetSetup.gs       # Sheet creation
├── LabelManager.gs     # Gmail label operations
├── QueueProcessor.gs   # Email queue processing
├── ApiHandler.gs       # Web app API endpoints
├── ConfigManager.gs    # Configuration management
└── Logger.gs           # Logging utilities

appsscript.json         # Apps Script manifest
setup.sh                # Deployment script
```

---

## How It Works

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Google Flow    │────▶│  Google Sheets   │────▶│   Apps Script    │
│  (AI Selection)  │     │  (Labels/Queue)  │     │ (Apply Labels)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### New Emails
1. Flow triggers on new Gmail
2. Flow reads **Labels** sheet
3. Flow uses AI to select labels
4. Flow calls web app API to apply labels

### Old Emails (Queue)
1. Menu: **Queue Unread Emails**
2. Flow reads **Queue** sheet (Status = "Pending")
3. Flow writes labels to "Labels to Apply" column
4. Script auto-applies labels

---

## Sheets Created

| Sheet | Purpose |
|-------|---------|
| **Instructions** | Setup guide, AI prompts, API reference |
| **Labels** | Gmail labels synced from your account |
| **Queue** | Email processing queue |
| **Config** | Settings (hidden) |
| **Log** | Processing history |

---

## API Reference

### POST: APPLY_LABELS
```json
{"command": "APPLY_LABELS", "emailId": "abc123", "labels": ["Work", "Important"]}
```

### POST: GET_LABELS
```json
{"command": "GET_LABELS"}
```

### POST: REMOVE_LABELS
```json
{"command": "REMOVE_LABELS", "emailId": "abc123", "labels": ["OldLabel"]}
```

### POST: SYNC_LABELS
```json
{"command": "SYNC_LABELS"}
```

---

## Menu Options

| Menu | Action |
|------|--------|
| Email Sorter > Setup | Initialize sheets and sync labels |
| Email Sorter > Sync Labels | Refresh Gmail labels |
| Email Sorter > Queue Unread Emails | Add unread emails to queue |
| Email Sorter > Process All Pending | Process queued items |
| Email Sorter > Clear Queue | Clear the queue |

---

## Development

```bash
clasp push          # Push changes to Apps Script
clasp push --watch  # Watch and auto-push
clasp pull          # Pull changes from Apps Script
clasp open          # Open in browser
```

---

## Troubleshooting

### "command not found: npm"
You need to install Node.js first. See Step 2.

### "command not found: clasp"
Run: `npm install -g @google/clasp`

### Menu not appearing in spreadsheet
Refresh the page and wait a few seconds.

### Permission denied running setup.sh
Run: `chmod +x setup.sh` then try again.

---

## License

MIT
