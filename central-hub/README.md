# Central Hub

The Central Hub manages multiple user instances of the Email Sorter. It acts as a "dumb pipe" - routing messages between users and AI without processing email content itself.

## Architecture

```
User Sheet  ──webhook──>  Central Hub  ──chat──>  AI (in Chat space)
                               │
                               │
AI Response <──chat──  Central Hub  ──webhook──>  User Sheet
```

## Deployment

### 1. Create Google Sheet for Hub

1. Create a new Google Sheet
2. Open Extensions > Apps Script
3. Delete default Code.gs
4. Create these files and copy the code:
   - HubMain.gs
   - UserRegistry.gs
   - MessageRouter.gs
   - PendingRequests.gs
   - ChatManager.gs
   - HubSetup.gs
5. Replace appsscript.json content

### 2. Deploy as Web App

1. Deploy > New deployment > Web app
2. Execute as: Me
3. Who has access: Anyone
4. Copy the web app URL - this is the `HUB_URL` for users

### 3. Deploy as Chat App (Optional)

If you want to receive AI messages directly:

1. Deploy > New deployment > Chat app
2. Configure in Google Cloud Console:
   - Enable Chat API
   - Configure Chat app settings
3. Add the app to your Chat space

### 4. Configure Chat Webhook

1. In your Chat space, create a webhook (Space settings > Webhooks)
2. Copy the webhook URL
3. In the Hub spreadsheet: Hub Admin > Configure Chat Webhook
4. Paste the webhook URL

## Sheets Created

- **Registry** - Registered user instances
- **Pending** - Requests waiting for AI response
- **HubLog** - Activity log
- **HubConfig** - Hub configuration

## User Registration

Users register automatically when running `./setup.sh` if `HUB_URL` is set.

Manual registration:
```bash
curl -X POST "HUB_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "register",
    "email": "user@example.com",
    "instanceName": "myinstance",
    "webhookUrl": "https://script.google.com/macros/s/.../exec"
  }'
```

## Message Flow

1. User's sheet sends email to Hub (via webhook)
2. Hub forwards to Chat space for AI
3. AI responds with labels in Chat
4. Hub receives response (via Chat app or monitors space)
5. Hub routes labels to user's webhook
6. User's sheet applies labels to email

## API Endpoints

### POST /

| Action | Description | Payload |
|--------|-------------|---------|
| `register` | Register user instance | `{email, instanceName, webhookUrl}` |
| `unregister` | Unregister user | `{email}` or `{instanceName}` |
| `ping` | Health check | `{}` |
| `route_labels` | Route labels to user | `{instanceName, labels, emailId?}` |

### GET /

Returns hub status and registered user count.

## Testing

From the Hub spreadsheet:
- Hub Admin > Test Chat Connection
- Hub Admin > Test Route to User

## Separate Deployment

The Hub is deployed separately from user instances:

```bash
cd central-hub
clasp create --type sheets --title "Smart Call Time Hub"
clasp push
clasp deploy
```
