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

### 3. Configure the Chat App in Google Cloud Console

This is where you connect Google Chat to your Hub so Chat events reach your web app.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select the GCP project linked to your Apps Script
   - To find your project: in Apps Script editor, go to **Project Settings** (gear icon) and note the GCP project number
   - If no project is linked, click **Change project** and enter your GCP project number
3. In Cloud Console, navigate to: **APIs & Services > Enabled APIs & services**
4. Search for **Google Chat API** and click **Enable**
5. Once enabled, click **Google Chat API** to open it
6. Go to the **Configuration** tab

#### Fill in the Chat App settings:

| Field | Value |
|-------|-------|
| **App name** | Smart Call Time Hub |
| **Avatar URL** | (optional) |
| **Description** | Email sorter central hub |
| **Interactive features** | Enabled (toggle ON) |
| **Functionality** | Check both: "Receive 1:1 messages" and "Join spaces and group conversations" |
| **Connection settings** | Select **HTTP endpoint URL** |
| **HTTP endpoint URL** | Paste your **Web App URL** from step 2 |
| **Authentication Audience** | Select **HTTP endpoint URL** |
| **Visibility** | "Specific people and groups in your domain" — add yourself or your team |

7. Click **Save**

#### After saving:

1. Open **Google Chat** in your browser
2. Click **+ New chat** or **Find apps** (magnifying glass icon)
3. Search for "Smart Call Time Hub" (the app name you entered above)
4. Add the app to your Chat space
5. The Hub will receive an `ADDED_TO_SPACE` event and auto-save the space ID

#### Adding a Webhook to the Chat Space (for user-side outbound messages):

User instances need a **Chat space webhook URL** to post messages into the space.
This is separate from the Chat App — it's an incoming webhook that lets external scripts post messages.

1. In **Google Chat**, open the Chat space where you added the Hub app
2. Click the **space name** at the top to open space settings
3. Click **Apps & integrations** (or **Integrations > Manage webhooks** in older UI)
4. Click **Add webhooks**
5. Give it a name (e.g. "Email Sorter Inbound") and optionally an avatar URL
6. Click **Save** and **copy the webhook URL**
7. In the Hub spreadsheet: **Hub Admin > Configure Chat Webhook** — paste the URL
8. Share this same webhook URL with user instances (they store it as `chat_webhook_url` in their Config sheet)

> **Note:** The Chat App endpoint (step 3 above) receives events FROM Google Chat.
> The Chat space webhook (this step) allows scripts to post messages INTO the space.
> Both are needed for the full round-trip flow.

### 4. Initial Setup (in the Hub Spreadsheet)

1. Reload the spreadsheet to get the Hub Admin menu
2. **Hub Admin > Initial Setup** - creates required sheets
3. **Hub Admin > Configure Chat Space** - enter the space ID
   - To find it: open the Chat space in a browser, the URL contains the space ID
   - Format: `spaces/XXXXXXXXX`

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

## OAuth Scopes

The Hub uses **user-auth** (not service account), so the scopes in `appsscript.json` matter:

| Scope | Purpose |
|-------|---------|
| `chat.messages` | Send and delete messages in the Chat space |
| `chat.messages.readonly` | List/read messages (View Recent Chat Messages) |
| `chat.spaces.readonly` | Verify setup (Chat.Spaces.get) |
| `chat.memberships` | Space membership operations |
| `spreadsheets` | Read/write Registry, Pending, Config, Log sheets |
| `script.external_request` | Send outbound webhooks to user instances |

> **Do NOT use** `chat.bot` — that is a service-account-only scope and will cause
> "Access blocked / Error 400: invalid_scope" on the OAuth consent screen.

## Separate Deployment

The Hub is deployed separately from user instances:

```bash
cd central-hub
clasp create --type sheets --title "Smart Call Time Hub"
clasp push
clasp deploy --type web
```
