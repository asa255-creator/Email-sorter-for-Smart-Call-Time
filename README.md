# Smart Call Time - Flow Integrator

A Google Workspace integration platform for Google Flows. Automatically sort emails using AI-powered categorization.

## Features

- Automatically sort Gmail emails into labels using Google Flows + AI
- Real-time processing of new emails via web app API
- Batch processing of existing unread emails via queue
- Labels synced to spreadsheet for easy Flow access

## Installation

### Prerequisites

Install clasp (Google's Apps Script CLI):

```bash
npm install -g @google/clasp
clasp login
```

### Deploy

```bash
git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
cd Email-sorter-for-Smart-Call-Time
./setup.sh
```

This creates a Google Sheet with all the code attached and opens it in your browser.

### After Deployment

1. Refresh the spreadsheet
2. Click **Smart Call Time > Email Sorter > Setup**
3. Deploy as web app: **Deploy > New deployment > Web app**
4. Configure your Google Flows using the Instructions sheet

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

## Sheets Created

| Sheet | Purpose |
|-------|---------|
| **Instructions** | Setup guide, AI prompts, API reference |
| **Labels** | Gmail labels synced from your account |
| **Queue** | Email processing queue |
| **Config** | Settings (hidden) |
| **Log** | Processing history |

## API

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

## Menu Options

| Menu | Action |
|------|--------|
| Email Sorter > Setup | Initialize sheets and sync labels |
| Email Sorter > Sync Labels | Refresh Gmail labels |
| Email Sorter > Queue Unread Emails | Add unread emails to queue |
| Email Sorter > Process All Pending | Process queued items |
| Email Sorter > Clear Queue | Clear the queue |

## Development

```bash
clasp push          # Push changes to Apps Script
clasp push --watch  # Watch and auto-push
clasp pull          # Pull changes from Apps Script
clasp open          # Open in browser
```

## Multi-User

Each user runs their own deployment:
1. Clone repo
2. Run `./setup.sh`
3. Deploy their own web app
4. Configure their own Flows

## License

MIT
