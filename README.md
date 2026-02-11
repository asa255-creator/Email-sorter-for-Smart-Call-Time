# Smart Call Time - Email Sorter

A Google Workspace integration for sorting emails using Google Flows + AI with multi-user support via Central Hub.

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              CENTRAL HUB                                   │
│                    (Single deployment for all users)                       │
│                                                                            │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                   │
│   │ UserRegistry│    │MessageRouter│    │ ChatManager │                   │
│   └─────────────┘    └─────────────┘    └─────────────┘                   │
│                              │                                             │
└──────────────────────────────┼─────────────────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   USER SHEET A  │  │   USER SHEET B  │  │   USER SHEET C  │
│                 │  │                 │  │                 │
│ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │
│ │QueueProcess │ │  │ │QueueProcess │ │  │ │QueueProcess │ │
│ │LabelManager │ │  │ │LabelManager │ │  │ │LabelManager │ │
│ │InboundHook  │ │  │ │InboundHook  │ │  │ │InboundHook  │ │
│ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Flow:**
1. User's sheet sends email to Hub → Hub forwards to Chat space for AI
2. AI responds with labels → Hub routes to user's webhook
3. User's sheet applies labels to email

---

## Project Structure

```
Email-sorter-for-Smart-Call-Time/
├── setup.sh                    # UNIFIED setup script (handles both User & Hub)
├── README.md                   # This file
│
├── src/                        # USER INSTANCE CODE
│   ├── appsscript.json         # Manifest (permissions, webapp config)
│   ├── Main.gs                 # Entry points, menu, triggers
│   ├── SheetSetup.gs           # Sheet creation and instructions
│   ├── LabelManager.gs         # Gmail label operations
│   ├── QueueProcessor.gs       # Email queue processing
│   ├── OutboundNotification.gs # Send emails to Chat for AI
│   ├── InboundWebhook.gs       # Receive labels from Hub
│   ├── ConfigManager.gs        # Configuration management
│   └── Logger.gs               # Logging utilities
│
├── central-hub/                # CENTRAL HUB CODE
│   ├── appsscript.json         # Manifest (Chat app + webapp)
│   ├── HubMain.gs              # Entry points (doPost, doGet, onMessage)
│   ├── HubConfig.gs            # Configuration management
│   ├── UserRegistry.gs         # User registration/management
│   ├── MessageRouter.gs        # Parse messages, route to users
│   ├── PendingRequests.gs      # Track requests awaiting AI response
│   ├── ChatManager.gs          # Send messages to Chat space
│   ├── HubSetup.gs             # Admin menu and setup
│   └── README.md               # Hub-specific documentation
```

---

# INSTALLATION

## Prerequisites

1. **Node.js** (use v20 LTS, NOT v25 which has memory bugs):
   ```bash
   # Mac
   brew install node@20

   # Windows - download from https://nodejs.org/ (LTS version)
   ```

2. **Clasp CLI**:
   ```bash
   npm install -g @google/clasp
   clasp login
   ```

3. **Clone the repository**:
   ```bash
   git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
   cd Email-sorter-for-Smart-Call-Time
   ```

---

## Quick Start

The unified setup script handles both Hub and User Instance deployments:

```bash
cd Email-sorter-for-Smart-Call-Time
./setup.sh
```

You'll be asked:
1. **What are you setting up?** → User Instance or Central Hub
2. **What would you like to do?** → Create new, Update existing, or Switch account

---

## Part 1: Deploy the Central Hub (One-Time Setup)

The Central Hub is deployed ONCE and shared by all users.

### Automated Setup

```bash
./setup.sh
```

1. Choose **"Central Hub"** when asked what you're setting up
2. Choose **"Create NEW project"**
3. The script will create a Google Sheet, push code, and deploy

**Save the Hub URL** that's displayed at the end - users need this!

### Option B: Manual Setup

<details>
<summary>Click to expand manual setup steps</summary>

#### Step 1: Create Hub Google Sheet

1. Go to [sheets.new](https://sheets.new) and create a new spreadsheet
2. Name it "Smart Call Time Hub"
3. Note the Sheet ID from the URL

#### Step 2: Create Hub Apps Script Project

1. In the spreadsheet, click **Extensions > Apps Script**
2. Delete the default `Code.gs` content
3. Create each file and copy content from `central-hub/`:

| File to Create | Copy From |
|---------------|-----------|
| HubMain.gs | central-hub/HubMain.gs |
| HubConfig.gs | central-hub/HubConfig.gs |
| UserRegistry.gs | central-hub/UserRegistry.gs |
| MessageRouter.gs | central-hub/MessageRouter.gs |
| PendingRequests.gs | central-hub/PendingRequests.gs |
| ChatManager.gs | central-hub/ChatManager.gs |
| HubSetup.gs | central-hub/HubSetup.gs |

4. Replace `appsscript.json` content (click gear icon > Show manifest)

#### Step 3: Deploy Hub as Web App

1. Click **Deploy > New deployment**
2. Click gear icon > **Web app**
3. Configure:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Copy the **Web app URL** - this is your `HUB_URL`

</details>

### Post-Deployment Configuration

After deploying (either method):

1. **Open the Hub spreadsheet** and refresh the page
2. **Run initial setup**: Hub Admin > Initial Setup
3. **Configure Chat Webhook** (for outbound messages):
   - Open Google Chat, create/open a space
   - Space settings > Integrations > Webhooks > Add webhook
   - Copy the webhook URL
   - Hub Admin > Configure Chat Webhook > Paste URL
4. **Configure Chat Space ID** (for auto-inviting users):
   - Get your space ID from the Chat URL: `https://chat.google.com/room/XXXXXXXXX`
   - Hub Admin > Configure Chat Space > Enter `spaces/XXXXXXXXX`

### (Optional) Deploy as Chat App

To receive AI responses directly via Chat app:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable the **Google Chat API**
4. Configure Chat API:
   - App name: Smart Call Time Hub
   - Functionality: "Receive 1:1 messages" and "Join spaces"
   - Connection settings: Apps Script project
   - Script ID: (from Apps Script > Project Settings)
5. Save and wait for propagation

---

## Part 2: Deploy User Instance

Each user runs this setup to create their own sheet and connect to the Hub.

### Automated Setup

```bash
./setup.sh
```

1. Choose **"User Instance"** when asked what you're setting up
2. Choose **"Create NEW project"** (or "Update existing" if reconnecting)
3. Follow the prompts

The setup will:
- Create your Google Sheet with all required tabs
- Push the code to Apps Script
- Deploy as web app

### Manual Setup (Alternative)

1. Create a new Google Sheet
2. Open **Extensions > Apps Script**
3. Get Script ID from **Project Settings**
4. Create `.clasp.json` in `src/` folder:
   ```bash
   cd src
   echo '{"scriptId":"YOUR_SCRIPT_ID","rootDir":"."}' > .clasp.json
   clasp push
   ```
5. In spreadsheet: Click **Smart Call Time > Email Sorter > Setup**
6. Deploy as web app and register with Hub manually

### Reconnecting to Hub

If you need to re-register with the Hub:

```bash
./setup.sh --reconnect
```

Or from the menu, choose option 3.

---

## Part 3: Configure Google Flow

### Create Flow for New Emails

1. Go to [Google Flows](https://flows.google.com)
2. Create new Flow: "Email Categorizer"
3. Trigger: **When a new email arrives in Gmail**
4. Add action: **Get email labels** (read Labels sheet from your spreadsheet)
5. Add action: **AI analysis** with prompt:

```
You are an email categorizer. Based on the email content below, select the most appropriate labels from the available options.

AVAILABLE LABELS:
{{labels_from_sheet}}

EMAIL:
Subject: {{email.subject}}
From: {{email.from}}
Body: {{email.body}}

Respond with ONLY the label names, comma-separated. Example: "Work, Important"
```

6. Add action: **Send message to Google Chat**
   - Use the Hub's Chat space
   - Include instance_name in message so Hub knows where to route

### Create Flow for Old Emails (Queue Processing)

1. Trigger: **When spreadsheet row changes** (Status column = "Processing")
2. Read the Context column for full email content
3. Same AI analysis step
4. Send to Chat with instance_name

---

## Updating Code

After pulling updates from GitHub:

```bash
cd Email-sorter-for-Smart-Call-Time
git pull
cd src
clasp push
```

**Memory error fix** (Node v25 bug):
```bash
NODE_OPTIONS="--max-old-space-size=8192" clasp push
```

---

## Sheets Reference

### User Instance Sheets

| Sheet | Purpose |
|-------|---------|
| **Instructions** | Setup guide, Flow instructions |
| **Labels** | Gmail labels with descriptions for AI |
| **Queue** | Email processing queue |
| **Config** | Settings (hidden) |
| **Log** | Processing history |

### Queue Columns

| Column | Content |
|--------|---------|
| A | Email ID |
| B | Subject |
| C | From |
| D | Date |
| E | Labels to Apply (from AI) |
| F | Status (Processing/Pending/Error) |
| G | Processed At |
| H | Context (full email for old emails) |

### Hub Sheets

| Sheet | Purpose |
|-------|---------|
| **Registry** | Registered user instances |
| **Pending** | Requests waiting for AI |
| **HubConfig** | Hub settings |
| **HubLog** | Activity log |

---

## Menu Options

### User Instance Menu

| Menu Item | Action |
|-----------|--------|
| Setup / Refresh | Initialize sheets and sync labels |
| Sync Labels Now | Refresh Gmail labels list |
| Queue Unlabeled Emails | Add unlabeled emails to queue |
| Process All Pending | Manually process queued items |
| Clear Queue | Clear the queue |

### Hub Admin Menu

| Menu Item | Action |
|-----------|--------|
| Run Initial Setup | Create Hub sheets |
| Configure Chat Webhook | Set outbound webhook URL |
| View Registered Users | Show all users |
| Test Chat Connection | Send test message |
| Test Route to User | Test webhook routing |

---

## API Reference

### User Webhook Endpoints

**POST /** - Receive labels from Hub
```json
{
  "action": "update_labels",
  "emailId": "abc123",
  "labels": "Work, Important"
}
```

**GET /** - Status check

### Hub Endpoints

**POST / action=register** - Register user instance
```json
{
  "action": "register",
  "email": "user@example.com",
  "instanceName": "myinstance",
  "webhookUrl": "https://script.google.com/macros/s/.../exec"
}
```

**POST / action=route_labels** - Route labels to user
```json
{
  "action": "route_labels",
  "instanceName": "myinstance",
  "labels": "Work, Important",
  "emailId": "abc123"
}
```

**GET /** - Hub status

---

## Troubleshooting

### Setup Issues

| Problem | Solution |
|---------|----------|
| "command not found: npm" | Install Node.js first |
| "command not found: clasp" | Run `npm install -g @google/clasp` |
| "Project file already exists" | Delete `.clasp.json` in src/ or use option 2 |
| Memory error | Run: `NODE_OPTIONS="--max-old-space-size=8192" clasp push` |
| "invalid_grant" error | Run `clasp login` |
| Menu not appearing | Refresh the spreadsheet page |
| Permission denied (setup.sh) | Run `chmod +x setup.sh` |

### Processing Issues

| Problem | Solution |
|---------|----------|
| Queue not processing | Check if Labels column has values; check Status = "Processing" |
| Multiple Processing rows stuck | Fixed in latest code - processes all ready rows |
| Labels not appearing | Check Hub connection; verify webhook URL is registered |
| Chat messages not sending | Verify chat_webhook_url in Config sheet |

### Hub Issues

| Problem | Solution |
|---------|----------|
| Users can't register | Check Hub is deployed with "Anyone" access |
| Messages not routing | Check Registry sheet has user entry |
| AI responses lost | Check Pending sheet; verify Chat app is receiving |

### Fresh Start

If you need to completely start over with local configuration:

```bash
./setup.sh --clean
```

This removes:
- `src/.clasp.json` (user instance config)
- `central-hub/.clasp.json` (hub config)
- `central-hub/.hub_url` (saved hub URL)
- `~/.clasp.json` (stray clasp config in home directory)

**Note:** This does NOT delete your Google Sheets or Apps Script projects - only local configuration files.

To also delete the local repository and re-clone:
```bash
cd ..
rm -rf Email-sorter-for-Smart-Call-Time
git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git
cd Email-sorter-for-Smart-Call-Time
./setup.sh
```

One-line full re-download (from your home folder):
```bash
cd ~ && rm -rf Email-sorter-for-Smart-Call-Time && git clone https://github.com/asa255-creator/Email-sorter-for-Smart-Call-Time.git && cd Email-sorter-for-Smart-Call-Time && ./setup.sh
```

If you see `Permission denied` or `Read-only file system`, you are likely in a protected directory (like `/` or `/Users`). Run the command above exactly as written so cloning happens in your home directory (`~`).

---

## Code Architecture

Both codebases follow atomic/modular design:

### User Instance (src/)

| Module | Responsibility |
|--------|---------------|
| Main.gs | Entry points, menu creation, trigger setup |
| SheetSetup.gs | Create and configure sheets |
| LabelManager.gs | Gmail label CRUD operations |
| QueueProcessor.gs | Queue state machine, email processing |
| OutboundNotification.gs | Send to Chat for AI processing |
| InboundWebhook.gs | Receive labels from Hub |
| ConfigManager.gs | Read/write configuration |
| Logger.gs | Logging to sheet |

### Central Hub (central-hub/)

| Module | Responsibility |
|--------|---------------|
| HubMain.gs | Entry points (doPost, doGet, onMessage) |
| HubConfig.gs | Configuration storage (single source of truth) |
| UserRegistry.gs | User CRUD, lookup by instance name, space invites |
| MessageRouter.gs | Parse AI responses, route to user webhooks |
| PendingRequests.gs | Track requests, handle timeouts |
| ChatManager.gs | Send messages to Chat space |
| HubSetup.gs | Admin menu, initial setup |

---

## Development

```bash
# Push changes to user instance
cd src && clasp push

# Watch mode (auto-push on save)
clasp push --watch

# Pull changes from Apps Script
clasp pull
```

### Testing Webhooks

Test user webhook:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'
```

Test Hub:
```bash
curl -X POST "HUB_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"ping"}'
```

---

## License

MIT
