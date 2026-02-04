# Smart Call Time - Flow Integrator

A Google Workspace integration for sorting emails using Google Flows + AI.

## Features

- Automatically sort Gmail emails into labels using Google Flows + AI
- Flow reads labels dynamically from spreadsheet (no hardcoding)
- Queue processes emails one at a time (Processing/Pending status)
- Full email context provided for old emails

---

## Quick Update (existing users)

If you already have this installed and want to update to the latest code:

```bash
cd Email-sorter-for-Smart-Call-Time && git pull && cd src && clasp push
```

**Note:** This only updates the code. Your triggers, sheets, and data are NOT affected. You do NOT need to re-run setup.

---

## Step-by-Step Installation

### Step 1: Install Homebrew (Mac only, skip if already installed)

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
1. Ask you to log in to your Google account
2. Create a new Google Sheet with all the code attached
3. Show you the URL to open

### Step 6: Initialize the Email Sorter

1. Open the spreadsheet URL from the setup output
2. **Refresh** the page
3. Click **Smart Call Time > Email Sorter > Setup**
4. Grant the required permissions when prompted

### Step 7: Configure Google Flows

See the **Instructions** sheet in your spreadsheet for:
- How to set up Flows for new emails
- How to set up Flows for batch processing old emails
- AI prompt templates

---

## Switching Google Accounts

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
├── SheetSetup.gs       # Sheet creation and instructions
├── LabelManager.gs     # Gmail label operations
├── QueueProcessor.gs   # Email queue processing
├── ConfigManager.gs    # Configuration management
├── Logger.gs           # Logging utilities
└── appsscript.json     # Apps Script manifest

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
1. Flow triggers on new Gmail arrival
2. Flow reads **Labels** sheet for available labels
3. Flow uses AI to select labels
4. Flow adds row to **Queue** with Status = "Processing"
5. Script applies labels and deletes the row

### Old Emails (Queue)
1. Menu: **Queue Unlabeled Emails** (adds emails with Context filled)
2. First row gets Status = "Processing"
3. Flow triggers on "Processing" row, reads Context column
4. Flow writes labels to "Labels to Apply" column
5. Script applies labels, deletes row, promotes next to "Processing"
6. This triggers Flow again for next email

---

## Sheets Created

| Sheet | Purpose |
|-------|---------|
| **Instructions** | Setup guide, Flow instructions, AI prompts |
| **Labels** | Gmail labels with Description column for AI context |
| **Queue** | Email processing queue with Context column |
| **Config** | Settings (hidden) |
| **Log** | Processing history |

---

## Queue Columns

| Column | Purpose |
|--------|---------|
| A: Email ID | Gmail message ID |
| B: Subject | Email subject |
| C: From | Sender |
| D: Date | Email date |
| E: Labels to Apply | Flow fills this |
| F: Status | "Processing" / "Pending" / "Error" |
| G: Processed At | Timestamp |
| H: Context | Full email content (for old emails) |

---

## Menu Options

| Menu | Action |
|------|--------|
| Setup / Refresh | Initialize sheets and sync labels |
| Sync Labels Now | Refresh Gmail labels |
| Queue Unlabeled Emails | Add unlabeled emails to queue |
| Process All Pending | Manually process queued items |
| Clear Queue | Clear the queue |

---

## Development

```bash
clasp push          # Push changes to Apps Script
clasp push --watch  # Watch and auto-push
clasp pull          # Pull changes from Apps Script
```

---

## Troubleshooting

### "command not found: npm"
Install Node.js first. See Step 2.

### "command not found: clasp"
Run: `npm install -g @google/clasp`

### Menu not appearing in spreadsheet
Refresh the page and wait a few seconds.

### Permission denied running setup.sh
Run: `chmod +x setup.sh` then try again.

---

## License

MIT
