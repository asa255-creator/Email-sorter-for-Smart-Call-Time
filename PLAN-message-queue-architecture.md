# Architecture Change Plan: Message Queue System

## Overview of Changes

The system is shifting from a Google Flow-triggered model to a **timer-driven polling model** where:
- **User instances** poll their inbox on a 15-min timer and post ONE email at a time to Chat
- **Hub** polls Chat on a 5-min timer, adds emoji reactions to trigger Flows, and dispatches labeling results back to users
- **Google Flow** is triggered by the emoji reaction (not by sheet edits or direct Chat events)

---

## Complete Message Flow: Start to Finish

Here is every step a single email goes through, from discovery to cleanup.

### Step 1 — User: Inbox Scan (15-min timer)
- `checkInboxAndPostNext()` runs on the user sheet
- Searches Gmail for unlabeled emails (`has:nouserlabels`)
- Adds any NEW emails to the local Queue sheet with Status = `Queued`
- If no email currently has Status = `Posted`, takes the **top** `Queued` row

### Step 2 — User: Post to Chat
- Builds the `EMAIL_READY` message with the consistent format:
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

  {email body}
  ```
- Posts to the shared Chat space via `chat_webhook_url`
- Updates that Queue row's Status from `Queued` → `Posted`
- **Only ONE email is `Posted` at a time** — the rest wait as `Queued`

### Step 3 — Hub: Timer Fires (5-min timer)
- `hubTimerProcess()` runs and does the following **in order**:

#### Step 3a — Scan for Registration Messages
- Lists recent messages in the Chat space via `Chat.Spaces.Messages.list()`
- Finds any messages containing `REGISTER`
- Processes registration (same as current `handleChatRegistration`)
- Tracks message names in Pending sheet for later cleanup

#### Step 3b — Scan for Confirmation Messages
- Finds messages containing `CONFIRMED` or `CONFIRM_COMPLETE`
- Looks up associated pending requests by instance name + conversation ID
- **Deletes the related Chat messages** (the original + the confirmation)
- Removes the pending request entry

#### Step 3c — Scan for EMAIL_READY Messages & Add Emoji
- Finds messages containing `EMAIL_READY` that **don't already have a ✅ reaction**
- Adds ✅ emoji reaction to **ALL** ready messages (can batch multiple in one pass)
- Each emoji reaction independently triggers the Google Flow
- Uses `Chat.Spaces.Messages.reactions.create()` API

### Step 4 — Google Flow: Triggered by ✅ Emoji
- Flow trigger: emoji reaction (✅) added to a message in the Chat space
- Flow reads the message content that was reacted to
- Flow parses out:
  - **Instance Name** (from `@instanceName:` header)
  - **Email ID** (from `[emailId]` in header)
  - **Email contents** (subject, from, body from message body)
  - **Labels array + descriptions** (from AVAILABLE LABELS section)

### Step 5 — Gemini: Assigns Label
- Flow sends the email contents + available labels to Gemini
- Gemini responds with the assigned label(s)

### Step 6 — Flow: Writes Result to Hub Sheet
- Flow writes a row to the Hub's **"Emails Ready for Labeling"** sheet:
  | Email ID | Instance Name | Assigned Label(s) | Chat Message Name | Status | Created At |
  |----------|--------------|-------------------|-------------------|--------|------------|
  | abc123   | john_doe     | Work, Important   | spaces/X/messages/Y | new  | timestamp  |
- The Chat Message Name comes from the message that was reacted to — **this is preserved for cleanup later**

### Step 7 — Hub: Dispatch Label Results (same timer pass or next)
- `dispatchLabelResults()` runs (part of `hubTimerProcess()`, or called immediately after Step 3c)
- Reads all rows in "Emails Ready for Labeling" with Status = `new`
- For **each** row:
  1. Looks up the user's webhook URL from the Registry sheet by Instance Name
  2. Sends webhook to the user:
     ```json
     {
       "action": "apply_labels",
       "emailId": "abc123",
       "labels": "Work, Important",
       "chatMessageName": "spaces/X/messages/Y",
       "fromHub": true,
       "timestamp": "2026-02-12T10:30:00Z"
     }
     ```
  3. Marks the row Status → `dispatched`, records Dispatched At timestamp
- **Processes ALL pending rows in one pass** — does not wait for the next timer cycle

### Step 8 — User: Receives Webhook & Applies Labels
- User's `doGet()` (or `doPost()`) receives the webhook
- `handleLabelWebhook()`:
  1. Finds the Queue row matching the Email ID
  2. Calls `applyLabelsToEmail(emailId, labels)` — applies Gmail labels
  3. Deletes the Queue row (email is done)
  4. Returns success response to Hub:
     ```json
     {
       "success": true,
       "emailId": "abc123",
       "labelsApplied": ["Work", "Important"]
     }
     ```

### Step 9 — User: Confirms Completion & Posts Next Email
- After labels are applied (in the same webhook handler):
  1. **Posts `@instanceName:[emailId] CONFIRM_COMPLETE` to Chat** — tells the Hub "I applied the labels, safe to clean up"
  2. Calls `processNextInQueue()`
  3. Finds the next `Queued` row in the Queue sheet
  4. If found: posts it to Chat (back to Step 2), sets Status → `Posted`
  5. If none: queue is empty, waits for next 15-min timer to discover new emails
- **Why confirmation is required:** The Hub can't just delete the EMAIL_READY Chat message after dispatching labels — it has no proof the user actually applied them. The CONFIRM_COMPLETE message is the user saying "done, clean up." Without it, the Hub would lose the email data if the webhook had silently failed.

### Step 10 — Hub: Chat Message Cleanup (Next Timer Cycle)
- On the **next Hub timer pass**, `scanForConfirmationMessages()` runs:
  - Lists messages in the Chat space
  - Finds messages containing `CONFIRM_COMPLETE`
  - For each CONFIRM_COMPLETE:
    1. Parses the `emailId` from the message header
    2. Looks up the emailId in the **"Emails Ready for Labeling" sheet** to get the stored **Chat Message Name**
    3. **Deletes the original EMAIL_READY message** from Chat via `deleteChatMessages([chatMessageName])`
    4. **Deletes the CONFIRM_COMPLETE message itself** from Chat
    5. Marks the labeling sheet row Status → `completed`
  - `cleanupOldEntries()` removes `completed` rows older than 24h

### Complete — Cycle Repeats
- The user's next email (from Step 9) is now sitting in Chat
- Hub's next 5-min timer picks it up at Step 3c
- The cycle continues until all emails are processed

---

## Flow Diagram (Updated with Confirmation + Cleanup)

```
USER (15min timer)                    CHAT SPACE                         HUB (5min timer)
─────────────────                    ──────────                         ────────────────
1. Scan inbox, add to Queue               │
2. Post TOP email to Chat  ──────►  [EMAIL_READY message]                   │
                                          │                                   │
                                          │                    3a. Scan for registration msgs
                                          │                    3b. Scan for CONFIRM_COMPLETE msgs
                                          │                        → delete EMAIL_READY + CONFIRM
                                          │                        → mark labeling row completed
                                          │                    3c. Add ✅ to EMAIL_READY msgs
                                     [✅ emoji added]              (can be multiple at once)
                                          │                                   │
                                          │              4. ✅ triggers Google Flow
                                          │              5. Gemini assigns label
                                          │              6. Flow writes to Hub labeling sheet
                                          │                   (includes Chat Message Name)
                                          │                                   │
                                          │              7. Hub dispatches webhook to user
                                          │                                   │
8. Receive webhook                        │                                   │
9. Apply labels to Gmail                  │                                   │
10. Delete Queue row                      │                                   │
11. Post CONFIRM_COMPLETE  ──────►  [CONFIRM_COMPLETE msg]                   │
12. Post NEXT email to Chat ──────► [Next EMAIL_READY msg]                   │
                                          │                                   │
                                          │         (next timer cycle)        │
                                          │                    3b. See CONFIRM_COMPLETE
                                          │                        → delete old EMAIL_READY msg
                                          │                        → delete CONFIRM_COMPLETE msg
                                          │                    3c. See new EMAIL_READY msg
                                          │                        → add ✅ emoji
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
| 1. User queues email | Email ID, Subject, From, Body | Email ID |
| 2. User posts to Chat | Email ID embedded in header `@user:[emailId]` | Email ID |
| 3c. Hub scans Chat | Chat Message Name + parsed Email ID from header | Both |
| 3c. Hub adds ✅ emoji | Chat Message Name (needed for reaction API call) | Message Name |
| 4. Flow triggers on ✅ | Chat Message Name + parses Email ID from message body | Both |
| 6. Flow writes to Hub sheet | Email ID, Instance Name, Labels, Chat Message Name | Both |
| 7. Hub sends webhook to user | Email ID, Labels, Chat Message Name | Email ID |
| 8-9. User applies labels | Email ID (to find in Gmail + Queue) | Email ID |
| 10. Hub cleans up Chat | Chat Message Name (from labeling sheet) | Message Name |

**The Hub's "Emails Ready for Labeling" sheet stores both:**
- Email ID (for routing labels back to the correct user/email)
- Chat Message Name (for deleting the Chat message after processing)

---

## Information Preserved Throughout the Loop

| Data Point | Created At | Needed At | How It Travels |
|------------|-----------|-----------|----------------|
| **Email ID** | Step 1 (inbox scan) | Step 9 (label application) | Embedded in Chat message header `@user:[emailId]`, parsed by Flow, written to Hub sheet, sent in webhook back to user |
| **Instance Name** | User config | Step 7 (Hub webhook dispatch) | Embedded in Chat message header, parsed by Flow, written to Hub sheet, used to look up webhook URL |
| **Chat Message Name** | Step 2 (posted to Chat) | Step 10 (Hub cleanup) | Available from Chat API when Hub lists/reads messages, written to Hub labeling sheet by Flow, used to delete message after completion |
| **Email Contents** | Step 1 (inbox scan) | Step 5 (Gemini classification) | Embedded in Chat message body, read by Flow when ✅ triggers |
| **Labels + Descriptions** | User's Labels sheet | Step 5 (Gemini classification) | Embedded in Chat message body (AVAILABLE LABELS section) |
| **Assigned Label** | Step 5 (Gemini response) | Step 9 (user label application) | Written to Hub labeling sheet by Flow, sent to user via webhook |
| **User Webhook URL** | Registration | Step 7 (Hub dispatches results) | Stored in Hub Registry sheet, looked up by Instance Name |

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

  // Step 5: Clean up processed Chat messages
  cleanupProcessedMessages();
}
```

**Sub-functions:**

- `scanForRegistrationMessages()`: Uses Chat API `spaces.messages.list()` to find messages containing "REGISTER". Processes registration (same as current `handleChatRegistration`). Tracks message names in Pending sheet for later cleanup.

- `scanForConfirmationMessages()`: Finds messages containing "CONFIRMED" or "CONFIRM_COMPLETE". Looks up associated pending requests. Deletes the related Chat messages. Cleans up pending requests.

- `scanAndReactToReadyMessages()`:
  - Lists messages in the Chat space
  - Finds messages with "EMAIL_READY" that don't already have a ✅ reaction
  - Adds ✅ emoji reaction to ALL ready messages (not just one)
  - This is the key change: **multiple messages can be reacted to in one pass**
  - Each reaction triggers the Google Flow independently

- `dispatchLabelResults()`:
  - Reads "Emails Ready for Labeling" sheet
  - For each row with Status = `new`: look up user in Registry, send webhook with labels
  - Can process ALL pending rows in one pass (no waiting for next timer)
  - Mark rows as `dispatched` after sending webhook
  - If the webhook response confirms success immediately, can proceed to cleanup in the same pass

- **`cleanupProcessedMessages()`:**
  - This is NOT triggered by a sheet status — it's triggered by seeing **CONFIRM_COMPLETE messages in Chat**
  - `scanForConfirmationMessages()` already handles this (Step 3b):
    1. Finds CONFIRM_COMPLETE messages in Chat
    2. Parses the emailId
    3. Looks up the Chat Message Name in the labeling sheet
    4. Deletes the original EMAIL_READY message + the CONFIRM_COMPLETE message
    5. Marks the labeling row `completed`
  - Separately, `cleanupOldEntries()` removes `completed` rows older than 24h
  - **Why confirmation-gated:** The Hub can't delete Chat messages after dispatch alone — if the user's webhook silently failed, the email data would be lost. CONFIRM_COMPLETE is the user's proof that labels were applied.

---

## Hub Module 2: NEW `EmailLabelingQueue.gs` (NEW FILE)

**Purpose:** Manages the "Emails Ready for Labeling" sheet on the Hub.

**Sheet columns:**
| Column | Content |
|--------|---------|
| A | Email ID |
| B | Instance Name (user) |
| C | Assigned Label(s) |
| D | Chat Message Name (for cleanup/deletion) |
| E | Status (`new` / `dispatched` / `completed`) |
| F | Created At |
| G | Dispatched At |

**Functions:**
- `addLabelingResult(emailId, instanceName, labels, chatMessageName)` — Called by Google Flow after Gemini assigns labels. Status = `new`.
- `getPendingResults()` — Returns all rows with Status = `new`
- `getDispatchedResults()` — Returns all rows with Status = `dispatched` (for cleanup)
- `markDispatched(emailId)` — After webhook sent successfully
- `markCompleted(emailId)` — After Chat message deleted successfully
- `cleanupOldEntries()` — Remove `completed` entries older than 24h

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
    // Returns array of message objects with name, text, createTime, reactions, etc.
  }
  ```
- `getMessageReactions(messageName)` — Check if a message already has ✅ (to avoid double-reacting)
- Keep existing: `sendMessage()`, `deleteMessage()`, `deleteChatMessages()`, `sendCompletionToChat()`

**Note on `deleteChatMessages()`:** This existing function already handles the deletion logic. The new `cleanupProcessedMessages()` in TimerProcessor calls it with the Chat Message Names from the labeling queue sheet. No changes needed to the delete logic itself — just a new caller.

---

## Hub Module 4: `MessageRouter.gs` (MODERATE CHANGES)

**Current behavior:** Parses messages received via `onMessage()` event and routes immediately.

**New behavior:**
- The real-time `onMessage()` routing is largely replaced by timer-based polling
- `parseMessage()` still needed (used by TimerProcessor when scanning listed messages)
- `routeLabelsToUser()` replaced by `dispatchLabelResults()` in TimerProcessor
- `sendWebhookToUser()` still needed (called by TimerProcessor dispatch)
- Keep parsing logic + webhook sending, remove real-time routing orchestration
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

- Add creation of "Emails Ready for Labeling" sheet (7 columns, headers, frozen row)
- Add 5-minute timer trigger setup
- Update menu with new admin options

---

## Hub Module 7: `PendingRequests.gs` (MINOR CHANGES)

- May be simplified since the "Emails Ready for Labeling" sheet takes over email tracking
- Still useful for tracking registration conversations and test message cleanup
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
5. Write result to Hub's "Emails Ready for Labeling" sheet (including Chat Message Name for later cleanup)

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
| **NEW** `central-hub/TimerProcessor.gs` | **NEW** | 5-min timer: scan, react, dispatch, **cleanup Chat messages** |
| **NEW** `central-hub/EmailLabelingQueue.gs` | **NEW** | "Emails Ready for Labeling" sheet CRUD with `dispatched` → `completed` lifecycle |
| `central-hub/ChatManager.gs` | **MAJOR** | Add `addReaction()`, `listMessages()`, `getMessageReactions()` |
| `central-hub/MessageRouter.gs` | **MODERATE** | Decouple from real-time, keep parsing + webhook sending |
| `central-hub/HubMain.gs` | **MODERATE** | Add timer entry point, reduce onMessage |
| `central-hub/HubSetup.gs` | **MINOR** | New sheet, new trigger |
| `central-hub/PendingRequests.gs` | **MINOR** | Simplified role, track reactions |
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
  2. Add any new unlabeled emails to Queue sheet with Status = `Queued`
  3. If no email is currently `Posted` (awaiting labeling), take the top `Queued` row, post it to Chat, set Status = `Posted`
- **On webhook receipt** (`handleLabelWebhook()`):
  1. Find the Queue row by Email ID
  2. Apply labels to the email via Gmail API
  3. Delete the row (or mark "Completed")
  4. Immediately post the next `Queued` email to Chat (don't wait for timer)

**Key changes:**
- Remove: `promoteNextPending()` logic (replaced by post-on-webhook-receipt)
- Remove: Checking for "Processing" status with filled labels (labels now come via webhook, not sheet edits)
- Add: `postEmailToChat(emailId)` — formats and posts one email to Chat space
- Add: `processNextInQueue()` — finds top `Queued` row, posts to Chat
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
  4. **Post `CONFIRM_COMPLETE` to Chat** — tells Hub labels were applied, safe to clean up
  5. Call `processNextInQueue()` to post the next email to Chat
  6. Return success/failure response

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
- Remove: `notifyHubComplete()` (replaced by CONFIRM_COMPLETE)
- **Keep: `CONFIRM_COMPLETE` message** — essential for the Hub to know labels were applied and Chat cleanup is safe
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
| `src/OutboundNotification.gs` | **MODERATE** | Simplify to EMAIL_READY, remove CONFIRM_COMPLETE |
| `src/Main.gs` | **MINOR** | New trigger target, updated menu |
| `src/ConfigManager.gs` | **NONE** | Unchanged |
| `src/SheetSetup.gs` | **NONE** | Unchanged (minor column updates possible) |
| `src/LabelManager.gs` | **NONE** | Unchanged |
| `src/Logger.gs` | **NONE** | Unchanged |

---

## Implementation Order (Suggested)

### Phase 1: Hub Foundation
1. `central-hub/ChatManager.gs` — Add `addReaction()`, `listMessages()`, `getMessageReactions()`
2. `central-hub/EmailLabelingQueue.gs` — New module for labeling results sheet (with full lifecycle: new → dispatched → completed)
3. `central-hub/TimerProcessor.gs` — New 5-min timer logic including `cleanupProcessedMessages()`
4. `central-hub/HubMain.gs` / `HubSetup.gs` — Wire up timer, add sheet creation

### Phase 2: User Sheet
5. `src/QueueProcessor.gs` — Rewrite for inbox polling + post-one-at-a-time
6. `src/InboundWebhook.gs` — New label webhook handler + next-post trigger
7. `src/OutboundNotification.gs` — Simplify message types, remove CONFIRM_COMPLETE
8. `src/Main.gs` — Update triggers and menu

### Phase 3: External + Testing
9. Google Flow — Reconfigure trigger (✅ emoji) and steps (external, not code)
10. Integration testing — End-to-end with test emails
