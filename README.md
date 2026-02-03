# Smart Call Time - Flow Integrator

A Google Workspace integration platform for Google Flows. Automatically sort emails, documents, and more using AI-powered categorization.

## Features

### Email Sorter (Current)
- Automatically sort Gmail emails into labels using Google Flows + AI
- Real-time processing of new emails
- Batch processing of existing unread emails via queue
- Labels synced to spreadsheet for easy Flow access

### Future Modules (Planned)
- Document Sorter
- Alerts & Notifications
- Calendar Integration

---

## Installation Methods

### Option 1: One-Click Copy-Paste (Easiest)

**One file. One paste. Done.**

1. Create a new **Google Sheet**
2. Go to **Extensions > Apps Script**
3. Delete any existing code in `Code.gs`
4. Open [`dist/SmartCallTime.gs`](dist/SmartCallTime.gs) and **copy the entire file**
5. Paste into the Apps Script editor
6. **Save** (Ctrl+S)
7. **Close** the Apps Script tab
8. **Refresh** your spreadsheet
9. Click **Smart Call Time > Email Sorter > Setup**

---

### Option 2: Using clasp CLI (For Developers)

```bash
# Clone the repo
git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
cd Email-sorter-for-Smart-Call-Time

# Run the setup script
./setup.sh
```

Or manually:

```bash
# Install clasp
npm install -g @google/clasp

# Login
clasp login

# Create new Sheets project and push
cd src
clasp create --type sheets --title "Smart Call Time"
clasp push

# Open in browser
clasp open
```

---

### Option 3: Atomic Source Files

For developers who prefer separate files:

1. Create a Google Sheet
2. Go to Extensions > Apps Script
3. Create these files and copy contents from `src/`:
   - `Main.gs`
   - `SheetSetup.gs`
   - `LabelManager.gs`
   - `QueueProcessor.gs`
   - `ApiHandler.gs`
   - `ConfigManager.gs`
   - `Logger.gs`
4. Update `appsscript.json` (View > Show manifest file)

---

## Project Structure

```
├── dist/
│   └── SmartCallTime.gs      # BUNDLED FILE (copy this for easy install)
│
├── src/                       # Atomic source files
│   ├── Main.gs                # Entry points, menu, triggers
│   ├── SheetSetup.gs          # Sheet creation
│   ├── LabelManager.gs        # Gmail label operations
│   ├── QueueProcessor.gs      # Email queue processing
│   ├── ApiHandler.gs          # Web app API endpoints
│   ├── ConfigManager.gs       # Configuration management
│   └── Logger.gs              # Logging utilities
│
├── appsscript.json            # Apps Script manifest
├── setup.sh                   # CLI setup script
└── README.md
```

## Quick Start

After installation:

1. **Run Setup**: Smart Call Time > Email Sorter > Setup
2. **Deploy Web App**: Deploy > New deployment > Web app
3. **Configure Google Flows** using the Instructions sheet

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Google Flow    │────▶│  Google Sheets   │────▶│   Apps Script    │
│  (AI Selection)  │     │  (Labels/Queue)  │     │ (Apply Labels)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                         │                        │
        ▼                         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│      Gmail       │     │  Config/Logs     │     │    Web App       │
│   (Read Email)   │     │  (Settings)      │     │  (API Endpoint)  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### New Email Workflow
1. Google Flow triggers on new Gmail
2. Flow reads **Labels** sheet for available options
3. Flow uses AI to select appropriate labels
4. Flow calls web app API to apply labels

### Old Email Workflow (Queue)
1. Run "Queue Unread Emails" from menu
2. Flow reads **Queue** sheet (Status = "Pending")
3. Flow processes each email with AI
4. Flow writes labels to "Labels to Apply" column
5. Script auto-applies labels when column is updated

## Sheets Created

| Sheet | Purpose |
|-------|---------|
| **Instructions** | Setup guide, AI prompts, API reference |
| **Labels** | Gmail labels synced from your account |
| **Queue** | Email processing queue for batch operations |
| **Config** | Configuration settings (hidden) |
| **Log** | Processing history and audit trail |

## API Reference

### GET Request
Returns API status and available labels.

```
GET https://script.google.com/.../exec
```

### POST: APPLY_LABELS
```json
{
  "command": "APPLY_LABELS",
  "emailId": "abc123",
  "labels": ["Work", "Important"]
}
```

### POST: GET_LABELS
```json
{"command": "GET_LABELS"}
```

### POST: REMOVE_LABELS
```json
{
  "command": "REMOVE_LABELS",
  "emailId": "abc123",
  "labels": ["OldLabel"]
}
```

### POST: SYNC_LABELS
```json
{"command": "SYNC_LABELS"}
```

## Menu Options

| Menu Path | Action |
|-----------|--------|
| Email Sorter > Setup / Refresh | Initialize sheets and sync labels |
| Email Sorter > Sync Labels Now | Refresh Gmail labels |
| Email Sorter > Queue Unread Emails | Add unread emails to queue |
| Email Sorter > Process All Pending | Process all pending queue items |
| Email Sorter > Clear Queue | Clear the queue sheet |
| Settings > Show Configuration | View current settings |
| Settings > View Web App URL | Show deployed URL |

## Configuration

Edit the Config sheet (unhide first) to change:

| Setting | Default | Description |
|---------|---------|-------------|
| rate_limit_ms | 3000 | Delay between processing emails |
| batch_size | 50 | Max emails to queue at once |
| version | 1.0.0 | Current version |

## Multi-User Support

Each user gets their own isolated instance:

1. Copy the spreadsheet (or create new + paste code)
2. Run Setup
3. Deploy their own web app
4. Configure their own Flows

Each instance has isolated:
- Labels (from their Gmail)
- Queue (their emails)
- Configuration
- Web app URL

## Extending the Platform

The bundled file uses the **revealing module pattern** for atomic structure:

```javascript
const MyModule = (function() {
  // Private
  function privateFunc() { }

  // Public API
  return { publicFunc: privateFunc };
})();
```

To add new modules:

1. Add a new module section
2. Add menu items in `onOpen()`
3. Add API commands in the API module
4. Add sheets in the Sheets module

## Troubleshooting

### Menu not appearing
- Refresh the spreadsheet
- Check Extensions > Apps Script for errors

### Labels not syncing
- Run "Sync Labels" from menu
- Check Log sheet for errors

### Queue not auto-processing
- Ensure edit trigger is installed (runs during Setup)
- Check Status is "Pending" and labels column has values

### Web app errors
- Create a **NEW** deployment (not edit existing)
- Check execution logs in Apps Script

## Development

```bash
# Watch for changes
clasp push --watch

# Pull changes from Apps Script
clasp pull

# View logs
clasp logs
```

## License

MIT
