# Smart Call Time - Flow Integrator

A Google Sheets-based integration platform for Google Flows. Currently supports email sorting with AI-powered label categorization.

## Features

### Email Sorter
- Automatically sort Gmail emails into labels using Google Flows and AI
- Supports processing new incoming emails in real-time
- Batch process existing unread emails via queue system
- Labels synced to a spreadsheet for easy Flow access

### Future Modules (Planned)
- Document Sorter
- Alerts & Notifications
- Calendar Integration

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Google Flow    │────▶│  Google Sheets   │────▶│   Apps Script    │
│  (AI Selection)  │     │  (Labels/Queue)  │     │ (Apply Labels)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                         │                        │
        │                         │                        │
        ▼                         ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│      Gmail       │     │  Config/Logs     │     │    Web App       │
│   (Read Email)   │     │  (Settings)      │     │  (API Endpoint)  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## Project Structure

```
src/
├── Main.gs           # Entry points, menu setup, triggers
├── SheetSetup.gs     # Sheet creation and initialization
├── LabelManager.gs   # Gmail label operations
├── QueueProcessor.gs # Email queue processing
├── ApiHandler.gs     # Web app endpoints (doGet/doPost)
├── ConfigManager.gs  # Configuration management
└── Logger.gs         # Logging utilities

appsscript.json       # Apps Script manifest
README.md             # This file
```

## Setup Instructions

### 1. Create a Google Sheet

1. Create a new Google Sheet
2. Go to **Extensions > Apps Script**
3. Copy all `.gs` files from `src/` into the script editor
4. Copy `appsscript.json` content (View > Show manifest file)
5. Save the project

### 2. Run Setup

1. Refresh the spreadsheet
2. Click **Smart Call Time > Email Sorter > Setup / Refresh**
3. Authorize the required permissions
4. Review the Instructions sheet that appears

### 3. Deploy as Web App

1. In Apps Script, go to **Deploy > New deployment**
2. Select type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Click **Deploy** and copy the URL

### 4. Configure Google Flows

Follow the instructions in the **Instructions** sheet for:
- Setting up a Flow for new email processing
- Setting up a Flow for queue-based old email processing
- AI prompt templates for label selection

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

Response:
```json
{
  "status": "ok",
  "labels": [{"name": "Work", "id": "Work"}, ...],
  "commands": ["GET_LABELS", "APPLY_LABELS", "REMOVE_LABELS"]
}
```

### POST: GET_LABELS
Get all available Gmail labels.

```json
{"command": "GET_LABELS"}
```

Response:
```json
{
  "success": true,
  "labels": [{"name": "Work", "id": "Work", "type": "Top-level"}, ...]
}
```

### POST: APPLY_LABELS
Apply labels to an email.

```json
{
  "command": "APPLY_LABELS",
  "emailId": "abc123",
  "labels": ["Work", "Important"]
}
```

Response:
```json
{
  "success": true,
  "emailId": "abc123",
  "applied": ["Work", "Important"],
  "notFound": []
}
```

### POST: REMOVE_LABELS
Remove labels from an email.

```json
{
  "command": "REMOVE_LABELS",
  "emailId": "abc123",
  "labels": ["Old Label"]
}
```

### POST: SYNC_LABELS
Trigger a label sync from Gmail.

```json
{"command": "SYNC_LABELS"}
```

## Queue Workflow

1. **Queue Emails**: Menu > Smart Call Time > Email Sorter > Queue Unread Emails
2. **Flow Processes**: Your Google Flow reads pending rows, uses AI to select labels
3. **Flow Updates**: Flow writes selected labels to "Labels to Apply" column
4. **Auto-Apply**: Script detects the edit and applies labels automatically
5. **Complete**: Status changes to "Complete" with timestamp

## Menu Options

| Menu Path | Action |
|-----------|--------|
| Email Sorter > Setup / Refresh | Initialize or refresh setup |
| Email Sorter > Sync Labels Now | Sync Gmail labels to sheet |
| Email Sorter > Queue Unread Emails | Add unread emails to queue |
| Email Sorter > Process All Pending | Process all pending queue items |
| Email Sorter > Clear Queue | Clear the queue sheet |
| Settings > Show Configuration | View current settings |
| Settings > View Web App URL | Show deployed web app URL |
| Settings > Refresh All | Refresh all data |

## Configuration

Edit the Config sheet (unhide first) to change:

| Setting | Default | Description |
|---------|---------|-------------|
| rate_limit_ms | 3000 | Delay between processing emails |
| batch_size | 50 | Max emails to queue at once |

## Multi-User Support

Each user creates their own copy of the spreadsheet:
1. Make a copy of the template spreadsheet
2. Run setup (creates their own sheets/config)
3. Deploy their own web app
4. Configure their own Google Flows

Each instance is isolated with its own:
- Labels (from their Gmail)
- Queue (their emails)
- Configuration
- Web app URL

## Extending the Platform

To add new modules (e.g., Document Sorter):

1. Create new `.gs` files for the module
2. Add menu items in `Main.gs`:
   ```javascript
   .addSubMenu(ui.createMenu('Document Sorter')
     .addItem('Setup', 'documentSorterSetup'))
   ```
3. Add new sheets in `SheetSetup.gs`
4. Add API commands in `ApiHandler.gs`

## Troubleshooting

### Labels not syncing
- Run "Sync Labels Now" from the menu
- Check the Log sheet for errors

### Queue not processing
- Ensure Status is "Pending"
- Check that "Labels to Apply" column has values
- Run "Process All Pending" manually

### Web app errors
- Redeploy with "New deployment" (not "Manage deployments")
- Check execution logs in Apps Script

## License

MIT
