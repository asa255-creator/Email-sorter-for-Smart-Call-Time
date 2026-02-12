# Architecture Change Plan: Message Queue System

## Overview of Changes

The system is shifting from a Google Flow-triggered model to a **timer-driven polling model** where:
- **User instances** poll their inbox on a 15-min timer and post ONE email at a time to Chat
- **Hub** polls Chat on a 5-min timer, adds emoji reactions to trigger Flows, and dispatches labeling results back to users
- **Google Flow** is triggered by the emoji reaction (not by sheet edits or direct Chat events)

---

## New Data Flow (End-to-End Loop)

```
USER (15min timer)                    CHAT SPACE                         HUB (5min timer)
─────────────────                    ──────────                         ────────────────
1. Check inbox for                        │
   unlabeled emails                       │
2. Add to local Queue sheet               │
3. Post TOP email to Chat  ──────►  [Message appears]                        │
                                          │                                   │
                                          │                    4. Scan for new messages
                                          │                    5. Scan for registration msgs
                                          │                    6. Scan for confirmation msgs
                                          │                       (delete associated messages)
                                          │                    7. Add ✅ emoji to ready    ◄───┐
                                     [✅ emoji added]             messages (can be multiple) │
                                          │                                   │               │
                                          │              8. ✅ triggers Google Flow           │
                                          │                    Flow extracts:                  │
                                          │                    - User (instance name)          │
                                          │                    - Message ID (Chat msg name)    │
                                          │                    - Email contents                │
                                          │                    - Labels array + descriptions   │
                                          │                                   │               │
                                          │              9. Gemini assigns label               │
                                          │                                   │               │
                                          │              10. Flow writes to "Emails Ready     │
                                          │                   for Labeling" sheet on Hub       │
                                          │                                   │               │
                                          │              11. Hub sees new rows, looks up       │
                                          │                   user webhook from Registry       │
                                          │                                   │               │
USER                                      │              12. Hub sends webhook to user ────────┘
─────                                     │                   (immediately, no timer wait)
13. doGet receives webhook                │
14. Label the email in Gmail              │
15. Move queue up one                     │
16. Post NEXT email to Chat  ──────►  [Next message]
                                          │
                              (cycle repeats from step 4)
```

---

## Critical Design Decision: Tracking ID Throughout the Loop

### Recommendation: Use **Email ID** as the primary tracking key, with **Chat Message Name** as a secondary reference

**Rationale:**
- The Email ID (`GmailApp.getMessageById()`) is the only ID that persists from start (user inbox scan) to finish (label application). It is meaningful at both endpoints.
- The Chat Message Name (`spaces/XXX/messages/YYY`) is only generated when the message is posted to Chat. It's needed for emoji reactions and message cleanup, but it doesn't exist at the time of queue creation.
- A single email maps to exactly one Chat message and one pending request. The mapping is 1:1.

**What gets passed through each stage:**

| Stage | Data Available | Key ID |
|-------|---------------|--------|
| User queues email | Email ID, Subject, From, Body | Email ID |
| User posts to Chat | Email ID embedded in message header `@user:[emailId]` | Email ID |
| Hub scans Chat | Chat Message Name + parsed Email ID from header | Both |
| Hub adds ✅ emoji | Chat Message Name (needed for API call) | Message Name |
| Flow triggers on ✅ | Chat Message Name, parses Email ID from message body | Both |
| Flow writes to Hub sheet | Email ID, User, Labels, Chat Message Name | Email ID |
| Hub sends webhook to user | Email ID, Labels | Email ID |
| User labels email | Email ID (to find in Gmail + Queue sheet) | Email ID |

**The Hub's "Emails Ready for Labeling" sheet should store both:**
- Email ID (for routing back to user)
- Chat Message Name (for later cleanup/deletion of the Chat message)

---

## Information Preserved Throughout the Loop

| Data Point | Created At | Needed At | How It Travels |
|------------|-----------|-----------|----------------|
| **Email ID** | User inbox scan | User label application | Embedded in Chat message header `@user:[emailId]`, parsed by Flow, written to Hub sheet, sent in webhook |
| **Instance Name** | User config | Hub webhook dispatch | Embedded in Chat message header `@user:[emailId]`, parsed by Flow, written to Hub sheet |
| **Chat Message Name** | When posted to Chat | Hub emoji reaction + cleanup | Stored in Hub's labeling queue sheet |
| **Email Contents** | User inbox scan | Gemini classification | Embedded in Chat message body |
| **Labels + Descriptions** | User's Labels sheet | Gemini classification | Embedded in Chat message body |
| **Assigned Label** | Gemini response | User label application | Written to Hub sheet, sent in webhook |
| **User Webhook URL** | Registration | Hub dispatches results | Stored in Hub Registry sheet |

---

# HUB CHANGES

Everything below applies to files in `central-hub/`.

---

## Hub Module 1: NEW `TimerProcessor.gs` (NEW FILE)

**Current behavior:** Hub is entirely event-driven via `onMessage()`.

**New behavior:** Hub gets a **5-minute timer** that does the following in order:

```
function hubTimerProcess() {
  // Step 1: Scan for registration messages
  scanForRegistrationMessages();

  // Step 2: Scan for confirmation messages, delete associated chat messages
  scanForConfirmationMessages();

  // Step 3: Scan for EMAIL_READY messages that need ✅ emoji
  scanAndReactToReadyMessages();

  // Step 4: Check "Emails Ready for Labeling" sheet for new results
  //         Send webhooks to users for each result (all at once, no waiting)
  dispatchLabelResults();
}
```

**Sub-functions:**

- `scanForRegistrationMessages()`: Uses Chat API `spaces.messages.list()` to find messages containing "REGISTER". Processes registration (same as current `handleChatRegistration`).

- `scanForConfirmationMessages()`: Finds messages containing "CONFIRMED" or "CONFIRM_COMPLETE". Looks up associated pending requests. Deletes the related Chat messages. Cleans up pending requests.

- `scanAndReactToReadyMessages()`:
  - Lists messages in the Chat space
  - Finds messages with "EMAIL_READY" that don't already have a ✅ reaction
  - Adds ✅ emoji reaction to ALL ready messages (not just one)
  - This is the key change: **multiple messages can be reacted to in one pass**
  - Each reaction triggers the Google Flow independently

- `dispatchLabelResults()`:
  - Reads "Emails Ready for Labeling" sheet
  - For each row: look up user in Registry, send webhook with labels
  - Can process ALL pending rows in one pass (no waiting for next timer)
  - Mark rows as "Dispatched" after sending webhook
  - Delete dispatched rows after confirmation (or on next timer pass)

---

## Hub Module 2: NEW `EmailLabelingQueue.gs` (NEW FILE)

**Purpose:** Manages the "Emails Ready for Labeling" sheet on the Hub.

**Sheet columns:**
| Column | Content |
|--------|---------|
| A | Email ID |
| B | Instance Name (user) |
| C | Assigned Label(s) |
| D | Chat Message Name (for cleanup) |
| E | Status (new / dispatched / completed) |
| F | Created At |
| G | Dispatched At |

**Functions:**
- `addLabelingResult(emailId, instanceName, labels, chatMessageName)` — Called by Google Flow after Gemini assigns labels
- `getPendingResults()` — Returns all rows with Status = "new"
- `markDispatched(emailId)` — After webhook sent
- `markCompleted(emailId)` — After user confirms labeling done
- `cleanupOldEntries()` — Remove completed entries older than 24h

---

## Hub Module 3: `ChatManager.gs` (MAJOR CHANGES)

**Current behavior:** `sendMessage()` and `deleteMessage()` using Chat API.

**New behavior — Add:**
- `addReaction(messageName, emoji)` — Add ✅ emoji to a message
  ```javascript
  function addReaction(messageName, emoji) {
    const url = "https://chat.googleapis.com/v1/" + messageName + "/reactions";
    const payload = { emoji: { unicode: emoji || "✅" } };
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  }
  ```
- `listMessages(spaceId, pageSize)` — List messages in the space for polling
  ```javascript
  function listMessages(spaceId, pageSize) {
    const url = "https://chat.googleapis.com/v1/" + spaceId + "/messages?pageSize=" + (pageSize || 50);
    // Use Chat API to list recent messages
    // Returns array of message objects with name, text, createTime, etc.
  }
  ```
- `getMessageReactions(messageName)` — Check if a message already has ✅
- Keep existing: `sendMessage()`, `deleteMessage()`

---

## Hub Module 4: `MessageRouter.gs` (MODERATE CHANGES)

**Current behavior:** Parses messages received via `onMessage()` event and routes immediately.

**New behavior:**
- The real-time `onMessage()` routing is largely replaced by timer-based polling
- `parseMessage()` still needed (used by TimerProcessor when scanning messages)
- `routeLabelsToUser()` replaced by `dispatchLabelResults()` in TimerProcessor
- Keep parsing logic, remove real-time routing logic
- May keep `onMessage()` as a fallback or for future use, but primary path is timer-based

---

## Hub Module 5: `HubMain.gs` (MODERATE CHANGES)

**Current behavior:** `onMessage()` is the primary entry point, processes everything in real-time.

**New behavior:**
- Add `hubTimerProcess()` as the new primary entry point (called by 5-min trigger)
- `onMessage()` can remain but with reduced responsibility:
  - Could still handle registration for faster response
  - Or simply log the message and let the timer handle it
- Add trigger setup for the 5-minute timer
- Add menu item to manually trigger `hubTimerProcess()`

---

## Hub Module 6: `HubSetup.gs` (MINOR CHANGES)

- Add creation of "Emails Ready for Labeling" sheet
- Add 5-minute timer trigger setup
- Update menu with new admin options

---

## Hub Module 7: `PendingRequests.gs` (MINOR CHANGES)

- May be simplified since the "Emails Ready for Labeling" sheet takes over some tracking
- Still useful for tracking registration conversations and cleanup
- Add: tracking of which messages have been reacted to (to avoid double-✅)

---

## Hub Module 8: Google Flow (EXTERNAL — CONFIGURATION CHANGES)

**Current trigger:** Sheet edit or Chat message arrival.

**New trigger:** ✅ emoji reaction on a Chat message.

**Flow steps:**
1. Trigger: Emoji reaction (✅) added to message in Chat space
2. Extract message content from the reacted message
3. Parse out: Instance Name, Email ID, Email contents, Labels array + descriptions
4. Send to Gemini for label assignment
5. Write result to Hub's "Emails Ready for Labeling" sheet via Apps Script web app call or direct sheet write

**Note:** This is configured in Google Workspace/Chat Flow UI, not in Apps Script. The plan here documents what the Flow needs to do.

---

## Hub Files — No Changes

| File | Reason |
|------|--------|
| `central-hub/UserRegistry.gs` | Registry structure unchanged; still stores user webhooks |
| `central-hub/HubConfig.gs` | Config keys unchanged |

---

## Hub Summary Table

| File | Change Level | Key Changes |
|------|-------------|-------------|
| **NEW** `central-hub/TimerProcessor.gs` | **NEW** | 5-min timer: scan, react, dispatch |
| **NEW** `central-hub/EmailLabelingQueue.gs` | **NEW** | "Emails Ready for Labeling" sheet CRUD |
| `central-hub/ChatManager.gs` | **MAJOR** | Add reactions, list messages, check reactions |
| `central-hub/MessageRouter.gs` | **MODERATE** | Decouple from real-time, support polling |
| `central-hub/HubMain.gs` | **MODERATE** | Add timer entry point, reduce onMessage |
| `central-hub/HubSetup.gs` | **MINOR** | New sheet, new trigger |
| `central-hub/PendingRequests.gs` | **MINOR** | Track reacted messages |
| `central-hub/UserRegistry.gs` | **NONE** | Unchanged |
| `central-hub/HubConfig.gs` | **NONE** | Unchanged |

---

# USER SHEET CHANGES

Everything below applies to files in `src/`.

---

## User Module 1: `QueueProcessor.gs` (MAJOR CHANGES)

**Current behavior:** Queue sheet is populated by menu action ("Queue Unlabeled Emails"), processes labels that appear in the sheet on a 15-min timer.

**New behavior:**
- **15-min timer** (`checkInboxAndPostNext()`):
  1. Scan inbox for unlabeled emails (no user labels)
  2. Add any new unlabeled emails to Queue sheet with Status = "Queued"
  3. If no email is currently "Posted" (awaiting labeling), take the top "Queued" row, post it to Chat, set Status = "Posted"
- **On webhook receipt** (`handleLabelWebhook()`):
  1. Find the Queue row by Email ID
  2. Apply labels to the email via Gmail API
  3. Delete the row (or mark "Completed")
  4. Immediately post the next "Queued" email to Chat (don't wait for timer)

**Key changes:**
- Remove: `promoteNextPending()` logic (replaced by post-on-webhook-receipt)
- Remove: Checking for "Processing" status with filled labels (labels now come via webhook, not sheet edits)
- Add: `postEmailToChat(emailId)` — formats and posts one email to Chat space
- Add: `processNextInQueue()` — finds top "Queued" row, posts to Chat
- Change: Timer from checking labels-in-sheet to checking-inbox-for-new-emails

**Queue Sheet Status Values (new):**
| Status | Meaning |
|--------|---------|
| Queued | In local queue, not yet sent to Chat |
| Posted | Sent to Chat, awaiting labeling |
| (deleted) | After labels applied, row is removed |

---

## User Module 2: `InboundWebhook.gs` (MODERATE CHANGES)

**Current behavior:** `doPost()` handles webhooks from Hub for registration, label updates, tests.

**New behavior:**
- Change `handleLabelUpdate()` to:
  1. Receive: `{ action: "apply_labels", emailId, labels, chatMessageName }`
  2. Apply labels to the Gmail message
  3. Delete/remove the Queue row for that Email ID
  4. Call `processNextInQueue()` to post the next email to Chat
  5. Return success/failure response

- **Important**: Change from `doPost` to `doGet` for webhook receipt (per user's specification), OR support both. Apps Script web apps can handle both `doGet(e)` and `doPost(e)`.

**Open question:** You mentioned `doGet` for receiving webhooks. Currently the system uses `doPost`. Do you want to switch to `doGet` (parameters in URL query string, limited size) or keep `doPost` (JSON body, more data capacity)? `doPost` is more standard for webhooks carrying data payloads. We could support both.

---

## User Module 3: `OutboundNotification.gs` (MODERATE CHANGES)

**Current behavior:** Posts various message types to Chat (EMAIL_READY, QUEUE_STARTED, QUEUE_COMPLETE, etc.).

**New behavior:**
- Simplify to primarily one message type: `EMAIL_READY`
- Message format stays similar but must include all info the Flow needs:
  ```
  @{instanceName}:[{emailId}] EMAIL_READY

  ===== AVAILABLE LABELS =====
  Label1: description
  Label2: description

  ===== EMAIL TO CATEGORIZE =====
  Email ID: {emailId}
  Subject: {subject}
  From: {from}
  Date: {date}

  {email body/context}
  ```
- Remove: `notifyQueueComplete()`, `notifyQueueStarted()` (Hub doesn't need these; processing is per-message now)
- Keep: Registration and confirmation messages
- Keep: Test messages

---

## User Module 4: `Main.gs` / Triggers (MINOR CHANGES)

**Current behavior:** 15-min trigger calls `checkQueueForProcessing()`.

**New behavior:**
- 15-min trigger calls new `checkInboxAndPostNext()` instead
- Menu items updated:
  - Remove "Queue Unlabeled Emails" (now automatic)
  - Add "Force Check Inbox Now" (manual trigger of `checkInboxAndPostNext()`)
  - Keep label sync, registration, testing menu items

---

## User Files — No Changes

| File | Reason |
|------|--------|
| `src/ConfigManager.gs` | Config keys unchanged; webhook URLs still stored the same way |
| `src/SheetSetup.gs` | Queue sheet structure stays compatible (may need minor column updates) |
| `src/LabelManager.gs` | Label application logic (`applyLabelsToEmail`) unchanged |
| `src/Logger.gs` | Logging unchanged |

---

## User Summary Table

| File | Change Level | Key Changes |
|------|-------------|-------------|
| `src/QueueProcessor.gs` | **MAJOR** | New inbox polling, post-to-chat, webhook-triggered next |
| `src/InboundWebhook.gs` | **MODERATE** | New label webhook handler, trigger next post |
| `src/OutboundNotification.gs` | **MODERATE** | Simplify to EMAIL_READY, remove queue notifications |
| `src/Main.gs` | **MINOR** | New trigger target, updated menu |
| `src/ConfigManager.gs` | **NONE** | Unchanged |
| `src/SheetSetup.gs` | **NONE** | Unchanged (minor column updates possible) |
| `src/LabelManager.gs` | **NONE** | Unchanged |
| `src/Logger.gs` | **NONE** | Unchanged |

---

## Implementation Order (Suggested)

### Phase 1: Hub Foundation
1. `central-hub/ChatManager.gs` — Add `addReaction()`, `listMessages()` (foundation for everything)
2. `central-hub/EmailLabelingQueue.gs` — New module for labeling results sheet
3. `central-hub/TimerProcessor.gs` — New 5-min timer logic
4. `central-hub/HubMain.gs` / `HubSetup.gs` — Wire up timer, add sheet creation

### Phase 2: User Sheet
5. `src/QueueProcessor.gs` — Rewrite for inbox polling + post-one-at-a-time
6. `src/InboundWebhook.gs` — New label webhook handler + next-post trigger
7. `src/OutboundNotification.gs` — Simplify message types
8. `src/Main.gs` — Update triggers and menu

### Phase 3: External + Testing
9. Google Flow — Reconfigure trigger (✅ emoji) and steps (external, not code)
10. Integration testing — End-to-end with test emails
