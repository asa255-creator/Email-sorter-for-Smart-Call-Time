# Email Sorter for Smart Call Time

Automatically sort Gmail emails into labels using Google Flows and Google Chat integration with AI-powered categorization.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NEW EMAIL FLOW (Flow-initiated)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Gmail          Google Flow         Apps Script          Google Chat       │
│     │                 │                   │                    │            │
│     │  New Email      │                   │                    │            │
│     │────────────────>│                   │                    │            │
│     │                 │  REQUEST_LABELS   │                    │            │
│     │                 │──────────────────>│                    │            │
│     │                 │                   │  Send to Chat      │            │
│     │                 │                   │───────────────────>│            │
│     │                 │   LABELS_LIST     │                    │            │
│     │                 │<──────────────────│                    │            │
│     │                 │                   │                    │            │
│     │                 │  (AI picks labels)│                    │            │
│     │                 │                   │                    │            │
│     │                 │  APPLY_LABELS     │                    │            │
│     │                 │──────────────────>│                    │            │
│     │  Labels Applied │                   │                    │            │
│     │<────────────────│───────────────────│                    │            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      OLD EMAIL CLEANUP (Script-initiated)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Gmail          Apps Script         Google Chat         Google Flow        │
│     │                 │                   │                    │            │
│     │  Get Unread     │                   │                    │            │
│     │<────────────────│                   │                    │            │
│     │                 │  PROCESS_EMAIL    │                    │            │
│     │                 │──────────────────>│                    │            │
│     │                 │                   │  Trigger Flow      │            │
│     │                 │                   │───────────────────>│            │
│     │                 │                   │                    │            │
│     │                 │                   │  (AI picks labels) │            │
│     │                 │                   │                    │            │
│     │                 │  APPLY_LABELS     │                    │            │
│     │                 │<──────────────────│<───────────────────│            │
│     │  Labels Applied │                   │                    │            │
│     │<────────────────│                   │                    │            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

- **Two Google Chat Spaces**:
  - **Automated Space** (hidden/muted): Machine-to-machine communication for label requests and applications
  - **Instructions Space** (visible): Setup instructions, label recommendations, and status updates

- **New Email Processing**: Google Flow detects new emails, requests available labels, uses AI to categorize, and applies labels automatically

- **One-Time Cleanup**: Process all existing unread emails with rate limiting to avoid API limits

- **Label Recommendations**: Flow can suggest new labels, which appear in the visible space for human review

## Setup Instructions

### 1. Create the Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click "New project"
3. Copy the contents of `Code.gs` into the editor
4. Copy `appsscript.json` (View > Show manifest file, then replace contents)
5. Save the project with a name like "Email Sorter"

### 2. Enable the Chat API

1. In Apps Script, go to **Resources > Advanced Google Services**
2. Find "Google Chat API" and toggle it ON
3. Click the "Google Cloud Platform API Dashboard" link
4. Search for "Google Chat API" and enable it

### 3. Run Onboarding Setup

1. In Apps Script, select `onboardingSetup` from the function dropdown
2. Click **Run**
3. Authorize the required permissions when prompted
4. Check the execution log for the created space IDs

### 4. Deploy as Chat App (Optional)

If you want the script to respond directly to Chat messages:

1. Go to **Deploy > New deployment**
2. Select type: "Add-on"
3. Configure and deploy

### 5. Configure Google Flows

Follow the instructions posted to the "Instructions & Recommendations" Chat space. The script posts detailed setup guides including:

- Message format reference
- AI prompt templates
- Step-by-step Flow configuration

## Message Formats

### Messages FROM the Script

| Message | Description |
|---------|-------------|
| `REQUEST_LABELS\|{emailId}` | Sent when Flow requests available labels |
| `LABELS_LIST\|{emailId}\|label1,label2,...` | Response with available labels |
| `PROCESS_EMAIL\|{emailId}` | Sent during old email cleanup to trigger Flow |

### Messages TO the Script

| Message | Description |
|---------|-------------|
| `APPLY_LABELS\|{emailId}\|label1,label2` | Apply these labels to the email |
| `RECOMMEND_LABEL\|{labelName}\|{reason}` | Suggest a new label (posts to visible space) |

## Available Functions

| Function | Description |
|----------|-------------|
| `onboardingSetup()` | Creates Chat spaces and posts instructions |
| `processUnreadEmails()` | One-time cleanup of all unread emails |
| `clearProcessingData()` | Reset processing state for re-runs |
| `listAllLabels()` | Display all available user labels |
| `showConfiguration()` | Show current configuration |
| `runAllTests()` | Verify Gmail and Chat API access |
| `factoryReset()` | Clear all settings (requires re-setup) |

## Configuration

Edit the `CONFIG` object in `Code.gs` to customize:

```javascript
const CONFIG = {
  RATE_LIMIT_MS: 3000,    // Milliseconds between processing emails
  BATCH_SIZE: 50,         // Max emails to process in one run
  SYSTEM_LABELS: [...]    // Labels to exclude from the list
};
```

## Webhook Alternative

If you prefer webhooks over Chat app deployment, the script includes a `doPost()` function. Deploy as a web app and send POST requests:

```json
{
  "command": "REQUEST_LABELS",
  "emailId": "abc123"
}
```

```json
{
  "command": "APPLY_LABELS",
  "emailId": "abc123",
  "labels": ["Work", "Important"]
}
```

## Troubleshooting

### Chat API Errors
- Ensure the Chat API is enabled in Advanced Google Services
- Verify the Google Cloud Platform API is also enabled

### Gmail Access Errors
- Run `testGmailAccess()` to verify permissions
- Re-authorize the script if needed

### Processing Errors
- Run `clearProcessingData()` to reset state
- Check execution logs for specific error messages

## License

MIT
