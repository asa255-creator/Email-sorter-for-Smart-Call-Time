/**
 * Central Hub - Timer Processor
 *
 * Runs on a 5-minute timer. Each cycle:
 *   1. parseAllMessages()              — ONE centralized parse pass over all Chat messages
 *   2. handleRegistrations()           — Process REGISTER messages
 *   3. handleClosedConversations()     — Delete all messages for closed conversations
 *   4. handleReadyMessages()           — Add ✅ to EMAIL_READY (triggers Google Flow)
 *   5. dispatchLabelResults()          — Send labeled results to users via webhook
 *   6. cleanupOldEntries()             — Remove completed rows older than 24h
 *
 * MODULARITY: Only parseAllMessages() touches raw message text (via parseChatMessage()).
 * All other functions receive pre-parsed structured objects. If the chat message format
 * changes, only parseChatMessage() and buildChatMessage() need updating.
 *
 * Dependencies:
 *   - ChatManager.gs: listChatMessages(), addReactionToMessage(), messageHasReaction(),
 *                      deleteChatMessages()
 *   - MessageRouter.gs: parseChatMessage(), sendWebhookToUser(), MESSAGE_TYPES,
 *                        handleTestChatMessage(), handleSheetsChatTest()
 *   - EmailLabelingQueue.gs: getPendingLabelResults(), findLabelingResult(),
 *                             markLabelingDispatched(), markLabelingCompleted(),
 *                             cleanupOldLabelingEntries()
 *   - PendingRequests.gs: createPendingRequest(), getPendingRequestByEmailId(),
 *                          removePendingRequest()
 *   - UserRegistry.gs: getUserByInstance(), activateUser()
 *   - HubMain.gs: logHub(), handleChatRegistration(), parseRegistrationData()
 */

// ============================================================================
// MAIN TIMER ENTRY POINT
// ============================================================================

/**
 * Main timer function. Called every 5 minutes by a time-based trigger.
 * Fetches messages once, parses them once, then dispatches to handlers.
 */
function hubTimerProcess() {
  logHub('TIMER_START', 'Hub timer cycle starting');

  try {
    // Get all recent messages from Chat space (one API call)
    var listResult = listChatMessages(100);

    if (!listResult.success) {
      logHub('TIMER_ERROR', 'Failed to list messages: ' + listResult.error);
      return;
    }

    var rawMessages = listResult.messages || [];
    logHub('TIMER_MESSAGES', 'Found ' + rawMessages.length + ' messages in Chat space');

    // === SINGLE PARSE PASS — the ONLY place raw message text is parsed ===
    var parsed = parseAllMessages(rawMessages);

    // === DISPATCH pre-parsed results (no parsing inside these functions) ===

    // Step 1: Process registration messages
    handleRegistrations(parsed.registrations);

    // Step 2: Delete all messages for closed conversations (CONFIRM_COMPLETE, CONFIRMED)
    handleClosedConversations(parsed.closed, parsed.all);

    // Step 3: Add ✅ emoji to EMAIL_READY messages (triggers Google Flow)
    handleReadyMessages(parsed.ready);

    // Step 4: Dispatch new labeling results to users via webhook
    dispatchLabelResults();

    // Step 5: Clean up old completed entries
    cleanupOldLabelingEntries();
    cleanupPendingRequests();

  } catch (error) {
    logHub('TIMER_ERROR', 'Unhandled error: ' + error.message);
  }

  logHub('TIMER_END', 'Hub timer cycle complete');
}

// ============================================================================
// CENTRALIZED MESSAGE PARSING
// ============================================================================

/**
 * Parses all raw Chat messages in a single pass and buckets them by type/status.
 *
 * This is the ONLY function that calls parseChatMessage() on raw message text.
 * All downstream handler functions receive the pre-parsed objects from here.
 *
 * Each parsed entry includes:
 *   - user, conversationId, type, status, body (from parseChatMessage)
 *   - messageName: the Chat API message name (for deletion/reactions)
 *   - rawMessage: the original Chat message object (for reaction checks)
 *
 * @param {Array} rawMessages - Array of Chat message objects from listChatMessages()
 * @returns {Object} Bucketed messages: { all, registrations, closed, ready, test }
 */
function parseAllMessages(rawMessages) {
  var result = {
    all: [],
    registrations: [],
    closed: [],
    ready: [],
    test: []
  };

  for (var i = 0; i < rawMessages.length; i++) {
    var msg = rawMessages[i];
    if (!msg.text) continue;

    var parsed = parseChatMessage(msg.text);
    if (!parsed) continue;

    // Attach Chat API metadata (not part of the message format, but needed for actions)
    parsed.messageName = msg.name;
    parsed.rawMessage = msg;

    result.all.push(parsed);

    // Bucket by type and status
    if (parsed.type === MESSAGE_TYPES.REGISTER) {
      result.registrations.push(parsed);
    } else if (parsed.status === 'closed') {
      result.closed.push(parsed);
    } else if (parsed.type === MESSAGE_TYPES.EMAIL_READY && parsed.status !== 'closed') {
      // Only include EMAIL_READY that haven't been reacted to yet
      if (!messageHasReaction(msg)) {
        result.ready.push(parsed);
      }
    } else if (parsed.type === MESSAGE_TYPES.TEST_CHAT_CONNECTION ||
               parsed.type === MESSAGE_TYPES.SHEETS_CHAT_TEST) {
      result.test.push(parsed);
    }
  }

  return result;
}

// ============================================================================
// STEP 1: REGISTRATION MESSAGES
// ============================================================================

/**
 * Processes pre-parsed REGISTER messages.
 * No message parsing happens here — receives structured objects from parseAllMessages().
 *
 * @param {Array} registrations - Array of parsed REGISTER messages
 */
function handleRegistrations(registrations) {
  for (var i = 0; i < registrations.length; i++) {
    var parsed = registrations[i];

    if (!parsed.user) continue;

    // Check if user is already registered
    var existingUser = getUserByInstance(parsed.user);

    if (existingUser && (existingUser.status === 'pending' || existingUser.status === 'active')) {
      // User exists — check if webhook URL changed (re-deploy gets a new URL)
      var regData = parseRegistrationData(parsed.body);
      var newWebhookUrl = regData.webhook || '';

      if (newWebhookUrl && newWebhookUrl !== existingUser.webhookUrl) {
        logHub('TIMER_REGISTER_UPDATE', parsed.user + ' already ' + existingUser.status +
          ' but webhook URL changed: ' + existingUser.webhookUrl + ' → ' + newWebhookUrl + ' — re-processing');
        handleChatRegistration(parsed, parsed.rawMessage.text, parsed.messageName);
      } else {
        logHub('TIMER_REGISTER_SKIP', parsed.user + ' already ' + existingUser.status +
          ' with same webhook URL — skipping duplicate REGISTER');
      }
      continue;
    }

    logHub('TIMER_REGISTER', 'Found REGISTER from ' + parsed.user);
    handleChatRegistration(parsed, parsed.rawMessage.text, parsed.messageName);
  }
}

// ============================================================================
// STEP 2: CLOSED CONVERSATIONS (CLEANUP)
// ============================================================================

/**
 * Handles all messages with status=closed.
 * For each closed message, finds ALL messages in the chat space with the same
 * user + conversation_id and deletes them all.
 *
 * This replaces the old scanForConfirmationMessages(), processConfirmComplete(),
 * and handleConfirmedMessage() — unified into one cleanup path based on status.
 *
 * @param {Array} closedMessages - Array of parsed messages with status=closed
 * @param {Array} allMessages - All parsed messages (for finding conversation partners)
 */
function handleClosedConversations(closedMessages, allMessages) {
  // Track which conversations we've already processed to avoid duplicates
  var processed = {};

  for (var i = 0; i < closedMessages.length; i++) {
    var closed = closedMessages[i];
    if (!closed.user || !closed.conversationId) continue;

    var key = closed.user + '|' + closed.conversationId;
    if (processed[key]) continue;
    processed[key] = true;

    logHub('CLOSED_PROCESSING', closed.user + '/' + closed.conversationId + ' (type: ' + closed.type + ')');

    // Find ALL messages in the full list that share this user + conversationId
    var messagesToDelete = [];
    for (var j = 0; j < allMessages.length; j++) {
      var msg = allMessages[j];
      if (msg.user === closed.user && msg.conversationId === closed.conversationId) {
        if (msg.messageName) {
          messagesToDelete.push(msg.messageName);
        }
      }
    }

    // Also check the EmailLabelingQueue for tracked message names
    var labelResult = findLabelingResult(closed.user, closed.conversationId);
    if (labelResult && labelResult.chatMessageName) {
      if (messagesToDelete.indexOf(labelResult.chatMessageName) === -1) {
        messagesToDelete.push(labelResult.chatMessageName);
      }
    }

    // Also check PendingRequests for any tracked messages
    var pendingReq = getPendingRequestByEmailId(closed.user, closed.conversationId);
    if (pendingReq && pendingReq.messageNames) {
      for (var k = 0; k < pendingReq.messageNames.length; k++) {
        var name = pendingReq.messageNames[k];
        if (messagesToDelete.indexOf(name) === -1) {
          messagesToDelete.push(name);
        }
      }
    }

    // Delete all tracked Chat messages for this conversation
    if (messagesToDelete.length > 0) {
      var deleteResult = deleteChatMessages(messagesToDelete);
      logHub('CLOSED_CLEANUP', closed.user + '/' + closed.conversationId +
        ': deleted ' + deleteResult.deleted + ' messages');
    }

    // Mark labeling queue row as completed
    if (labelResult) {
      markLabelingCompleted(labelResult.row);
    }

    // Handle pending request cleanup
    if (pendingReq) {
      // If this was a registration confirmation, activate the user
      var pendingType = (pendingReq.metadata && pendingReq.metadata.type) || pendingReq.type || '';
      if (pendingType === 'registration') {
        activateUser(closed.user);
        logHub('REGISTRATION_COMPLETE', closed.user + ' — status set to active');
      }

      // Send success webhook to user
      var payload = {
        action: pendingType === 'registration' ? 'registration_complete' : 'test_sheets_chat_complete',
        instanceName: closed.user,
        conversationId: closed.conversationId,
        messagesDeleted: messagesToDelete.length,
        message: pendingType === 'registration'
          ? 'Registration complete. You are now fully registered.'
          : 'Conversation closed. Chat messages deleted.',
        origin: 'hub',
        timestamp: new Date().toISOString()
      };
      sendWebhookToUser(closed.user, payload);

      removePendingRequest(closed.user, closed.conversationId);
    }

    logHub('CLOSED_DONE', closed.user + '/' + closed.conversationId + ' — cleanup complete');
  }
}

// ============================================================================
// STEP 3: EMAIL_READY MESSAGES (ADD EMOJI)
// ============================================================================

/**
 * Adds ✅ emoji reaction to pre-parsed EMAIL_READY messages.
 * No message parsing here — receives pre-filtered list from parseAllMessages().
 *
 * @param {Array} readyMessages - Array of parsed EMAIL_READY messages without reactions
 */
function handleReadyMessages(readyMessages) {
  var reactedCount = 0;

  for (var i = 0; i < readyMessages.length; i++) {
    var parsed = readyMessages[i];
    if (!parsed.user) continue;

    // Add ✅ emoji reaction — this triggers the Google Flow
    var result = addReactionToMessage(parsed.messageName);

    if (result.success && !result.alreadyExists) {
      reactedCount++;
      logHub('TIMER_REACT', 'Added ✅ to ' + parsed.user + '/' +
        (parsed.conversationId || 'unknown') + ' (' + parsed.messageName + ')');
    }
  }

  if (reactedCount > 0) {
    logHub('TIMER_REACT_SUMMARY', 'Added ✅ to ' + reactedCount + ' EMAIL_READY message(s)');
  }
}

// ============================================================================
// STEP 4: DISPATCH LABEL RESULTS
// ============================================================================

/**
 * Checks the EmailLabelingQueue for rows with Status = "new".
 * Sends a webhook to each user with their assigned labels.
 * Marks rows as "dispatched" after successful webhook delivery.
 */
function dispatchLabelResults() {
  var pendingResults = getPendingLabelResults();

  if (pendingResults.length === 0) return;

  logHub('DISPATCH_START', 'Dispatching ' + pendingResults.length + ' labeling result(s)');

  for (var i = 0; i < pendingResults.length; i++) {
    var result = pendingResults[i];

    var payload = {
      action: 'apply_labels',
      emailId: result.emailId,
      labels: result.labels,
      chatMessageName: result.chatMessageName,
      fromHub: true,
      timestamp: new Date().toISOString()
    };

    var webhookResult = sendWebhookToUser(result.instanceName, payload);

    if (webhookResult.success) {
      markLabelingDispatched(result.row);
      logHub('DISPATCH_OK', result.instanceName + '/' + result.emailId + ': ' + result.labels);
    } else {
      logHub('DISPATCH_FAIL', result.instanceName + '/' + result.emailId + ': ' + webhookResult.error);
    }
  }
}

// ============================================================================
// TIMER SETUP
// ============================================================================

/**
 * Sets up the 5-minute recurring timer trigger for hubTimerProcess.
 * Removes any existing timer triggers for this function first.
 */
function setupHubTimer() {
  // Remove existing triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'hubTimerProcess') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create 5-minute recurring trigger
  ScriptApp.newTrigger('hubTimerProcess')
    .timeBased()
    .everyMinutes(5)
    .create();

  logHub('TIMER_SETUP', '5-minute timer trigger installed for hubTimerProcess');
}

/**
 * Removes the hub timer trigger.
 */
function removeHubTimer() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'hubTimerProcess') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  logHub('TIMER_REMOVED', 'Removed ' + removed + ' timer trigger(s)');
}
