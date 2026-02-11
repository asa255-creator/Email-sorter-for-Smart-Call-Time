# Central Hub

The Central Hub manages multiple user instances of the Email Sorter. It acts as a "dumb pipe" - routing messages between users and AI without processing email content itself.

## Architecture

```
User Sheet  ──chat msg──>  Chat Space  ──event──>  Central Hub
                                                        │
                                                  (routes labels)
                                                        │
                                                        v
                                               User Sheet (webhook)
```

## Deployment

### 1. Create Google Sheet for Hub

1. Create a new Google Sheet
2. Open Extensions > Apps Script
3. Delete default Code.gs
4. Create these files and copy the code:
   - HubMain.gs
   - HubConfig.gs
   - UserRegistry.gs
   - MessageRouter.gs
   - PendingRequests.gs
   - ChatManager.gs
   - HubSetup.gs
   - HubTest.gs
   - TestManager.gs
5. Replace appsscript.json content

### 2. Deploy as Web App

1. In Apps Script editor: **Deploy > New deployment**
2. Select type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. Click **Deploy** and copy the Web App URL
6. Save this URL - you will paste it into Google Cloud Console (step 3 below)

### 3. Configure as Chat App in Google Cloud Console

This is where you tell Google Chat to send messages to your Hub.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project (or create one)
3. Navigate to: **APIs & Services > Enabled APIs & services**
4. Search for **Google Chat API** and enable it
5. Click **Google Chat API** then go to the **Configuration** tab
6. Fill in the Chat App settings:
   - **App name**: Smart Call Time Hub
   - **Avatar URL**: (optional)
   - **Description**: Email sorter central hub
   - **Functionality**: Check "Receive 1:1 messages" and "Join spaces and group conversations"
   - **Connection settings**: Select **HTTP endpoint URL**
   - **HTTP endpoint URL**: Paste your Web App URL from step 2
   - **Authentication Audience**: Select **HTTP endpoint URL**
   - **Visibility**: Make available to specific people or your domain
7. Click **Save**

After saving, the Chat App will appear in Google Chat. Add it to your Chat space and it will start receiving messages.

### 4. Initial Setup (in the Hub Spreadsheet)

1. Reload the spreadsheet to get the Hub Admin menu
2. **Hub Admin > Initial Setup** - creates required sheets
3. **Hub Admin > Configure Chat Space** - enter the space ID
   - To find it: open the Chat space in a browser, the URL contains the space ID
   - Format: `spaces/XXXXXXXXX`

### 5. Configure Chat Webhook (for user-side outbound)

Users need the Chat space webhook URL to post messages:

1. In Google Chat, open the space
2. Click the space name > **Apps & integrations** (or **Manage webhooks**)
3. Create a new webhook, copy the URL
4. In the Hub spreadsheet: **Hub Admin > Configure Chat Webhook**
5. Share this webhook URL with user instances (they store it as `chat_webhook_url`)

## Sheets Created

- **Registry** - Registered user instances
- **Pending** - Requests waiting for AI response
- **HubLog** - Activity log
- **HubConfig** - Hub configuration

## User Registration

Users register by posting a Chat message:

```
@instanceName:[register] REGISTER
email=user@example.com
webhook=https://script.google.com/macros/s/.../exec
sheetId=SPREADSHEET_ID
```

The Hub processes this via `onMessage()`, registers the user, and sends a confirmation webhook back.

## Web App Endpoints

### GET /
Returns hub status (version, user count, chat space configured).

### POST /
Receives two types of requests:

| Type | Description |
|------|-------------|
| Google Chat events | Messages from the Chat space (type=MESSAGE, ADDED_TO_SPACE, etc.) |
| `ping` action | Health check - returns `{ success: true, status: "healthy" }` |
| `status` action | Returns registered user count and config status |

## Message Flow

1. User's sheet posts email to Chat space (via webhook URL)
2. Google Chat sends the message event to the Hub's web app endpoint
3. Hub's `onMessage()` processes the message
4. AI responds with labels in Chat
5. Hub receives AI response (via same `onMessage()`)
6. Hub routes labels to user's webhook
7. User's sheet applies labels to email

## Testing

From the Hub spreadsheet menu:
- **Hub Admin > View Recent Chat Messages** - see what's in the Chat space
- **Hub Admin > Test Webhook Ping** - ping a user's webhook
- **Hub Admin > Test Chat Connection** - full round-trip test
- **Hub Admin > Test Sheets Chat Round-Trip** - full test with message cleanup

## Separate Deployment

The Hub is deployed separately from user instances:

```bash
cd central-hub
clasp create --type sheets --title "Smart Call Time Hub"
clasp push
clasp deploy --type web
```
