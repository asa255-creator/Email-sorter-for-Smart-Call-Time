# Smart Call Time - Flow Integrator

A Google Workspace integration for sorting emails using Google Flows + AI.

## Features

- Automatically sort Gmail emails into labels using Google Flows + AI
- Flow reads labels dynamically from spreadsheet (no hardcoding)
- Queue processes emails one at a time (Processing/Pending status)
- Full email context provided for old emails

---

## First-Time Setup

### Prerequisites

1. **Install Node.js** (use v20 LTS, NOT v25 which has memory bugs):
   - Mac: `brew install node@20`
   - Windows: Download from https://nodejs.org/ (LTS version)

2. **Install clasp:**
   ```bash
   npm install -g @google/clasp
   ```

3. **Clone the repo:**
   ```bash
   git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
   cd Email-sorter-for-Smart-Call-Time
   ```

### Option A: Create NEW Google Sheet (first time)

```bash
./setup.sh
```

Choose option 1, then:
1. Open the spreadsheet URL
2. Refresh the page
3. Click **Smart Call Time > Email Sorter > Setup**
4. Grant permissions when prompted

### Option B: Push to EXISTING Apps Script project

1. Get your Script ID from: Apps Script Editor > Project Settings > Script ID

2. Create `.clasp.json` in the `src/` folder:
   ```bash
   cd src
   echo '{"scriptId":"YOUR_SCRIPT_ID_HERE","rootDir":"."}' > .clasp.json
   ```

3. Push the code:
   ```bash
   clasp push
   ```

---

## Updating Code After Changes

If you already have this set up and want to push updated code:

```bash
cd Email-sorter-for-Smart-Call-Time
git pull
cd src
clasp push
```

**If you get memory errors** (Node v25 bug):
```bash
NODE_OPTIONS="--max-old-space-size=4096" clasp push
```

Or downgrade to Node v20:
```bash
brew install node@20
brew unlink node
brew link node@20
```

---

## Switching Google Accounts

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
