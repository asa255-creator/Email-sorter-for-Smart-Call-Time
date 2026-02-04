# Inbound Chat Handler

This module handles incoming messages from AI/Flow and updates the Queue sheet. It's **separate** from the main Email Sorter and can be deployed independently.

## Deployment Options

### Option 1: Flow-Triggered (NO DEPLOYMENT NEEDED) ✅ Recommended

Google Flows can call Apps Script functions directly without deploying as a webhook.

**How it works:**
1. Flow watches the Chat space for AI responses
2. Flow extracts the labels from the AI message
3. Flow calls `updateProcessingRowWithLabels(labels)` via Apps Script connector
4. The function updates the Queue sheet

**Flow Setup:**
1. Add action: "Google Apps Script" → "Run function"
2. Select your project
3. Function: `updateProcessingRowWithLabels`
4. Parameters: `labels` = the AI response text

### Option 2: Direct Script Call from Flow

For new emails where Flow already has all the data:

```javascript
// Flow calls this with email data and AI-assigned labels
addNewEmailToQueue({
  id: "email_id_here",
  subject: "Email subject",
  from: "sender@example.com",
  date: "2024-01-01T00:00:00Z",
  labels: "Label1, Label2"  // Already categorized by AI
})
```

### Option 3: Chat App (Requires Deployment)

Deploy as a Google Chat app to receive messages directly.

1. Create new Apps Script project with this code
2. Deploy → New deployment → Chat app
3. Configure Chat API in Google Cloud Console
4. Add app to your Chat space

### Option 4: Web App Webhook (Requires Deployment)

Deploy as a web app to receive HTTP POST requests.

1. Create new Apps Script project with this code
2. Deploy → New deployment → Web app
3. Copy the web app URL
4. Send POST requests:

```bash
curl -X POST "YOUR_WEB_APP_URL" \
  -H "Content-Type: application/json" \
  -d '{"labels": "Work, Important"}'
```

## Functions Available

| Function | Description | Deployment Needed |
|----------|-------------|-------------------|
| `updateProcessingRowWithLabels(labels)` | Updates first Processing row | No - Flow can call directly |
| `updateQueueWithLabels(emailId, labels)` | Updates specific email by ID | No - Flow can call directly |
| `addNewEmailToQueue(emailData)` | Adds new email with labels | No - Flow can call directly |
| `onMessage(event)` | Chat app message handler | Yes - Chat app deployment |
| `doPost(e)` | Web app POST handler | Yes - Web app deployment |

## Deploying Separately

This folder is NOT included in the main `setup.sh`. To deploy:

```bash
cd inbound-chat
echo '{"scriptId":"YOUR_NEW_SCRIPT_ID","rootDir":"."}' > .clasp.json
clasp push
```

Or create a new Apps Script project manually and copy the code.
