/**
 * Central Hub - Timer Processor
 *
 * Runs on a 5-minute timer. Each cycle:
 *   1. scanForRegistrationMessages()  — Process REGISTER messages
 *   2. scanForConfirmationMessages()  — Process CONFIRM_COMPLETE, delete Chat messages
 *   3. scanAndReactToReadyMessages()  — Add ✅ to EMAIL_READY (triggers Google Flow)
 *   4. dispatchLabelResults()         — Send labeled results to users via webhook
 *   5. cleanupOldEntries()            — Remove completed rows older than 24h
 *
 * Dependencies:
 *   - ChatManager.gs: listChatMessages(), addReactionToMessage(), messageHasReaction(),
 *                      deleteChatMessages()
 *   - MessageRouter.gs: parseMessage(), getMessageType(), sendWebhookToUser()
 *   - EmailLabelingQueue.gs: getPendingLabelResults(), findLabelingResult(),
 *                             markLabelingDispatched(), markLabelingCompleted(),
 *                             cleanupOldLabelingEntries()
 *   - PendingRequests.gs: createPendingRequest(), getPendingRequestByEmailId(),
 *                          removePendingRequest()
 *   - UserRegistry.gs: getUserByInstance()
 *   - HubMain.gs: logHub(), handleChatRegistration(), parseRegistrationData()
 */

// ============================================================================
// MAIN TIMER ENTRY POINT
// ============================================================================

/**
 * Main timer function. Called every 5 minutes by a time-based trigger.
 * Processes all pending work in a single pass.
 */
function hubTimerProcess() {
  logHub('TIMER_START', 'Hub timer cycle starting');

  try {
    // Get all recent messages from Chat space (one API call, reused by all steps)
    var listResult = listChatMessages(100);

    if (!listResult.success) {
      logHub('TIMER_ERROR', 'Failed to list messages: ' + listResult.error);
      return;
    }

    var messages = listResult.messages || [];
    logHub('TIMER_MESSAGES', 'Found ' + messages.length + ' messages in Chat space');

    // Step 1: Process registration messages
    scanForRegistrationMessages(messages);

    // Step 2: Process CONFIRM_COMPLETE messages (cleanup Chat + mark completed)
    scanForConfirmationMessages(messages);

    // Step 3: Add ✅ emoji to EMAIL_READY messages (triggers Google Flow)
    scanAndReactToReadyMessages(messages);

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
// STEP 1: REGISTRATION MESSAGES
// ============================================================================

/**
 * Scans Chat messages for REGISTER requests.
 * Processes each registration and tracks messages for cleanup.
 *
 * @param {Array} messages - Array of Chat message objects
 */
function scanForRegistrationMessages(messages) {
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (!msg.text) continue;

    var parsed = parseMessage(msg.text);
    var msgType = getMessageType(parsed.labels);

    if (parsed.instanceName && msgType === 'REGISTER') {
      // Check if user is already registered
      var existingUser = getUserByInstance(parsed.instanceName);

      if (existingUser && (existingUser.status === 'pending' || existingUser.status === 'active')) {
        // User exists — check if the webhook URL in this REGISTER message differs
        // from what's stored. If so, re-process to update the URL (common when user
        // re-deploys their web app and gets a new URL).
        var regData = parseRegistrationData(msg.text);
        var newWebhookUrl = regData.webhook || '';

        if (newWebhookUrl && newWebhookUrl !== existingUser.webhookUrl) {
          logHub('TIMER_REGISTER_UPDATE', parsed.instanceName + ' already ' + existingUser.status +
            ' but webhook URL changed: ' + existingUser.webhookUrl + ' → ' + newWebhookUrl + ' — re-processing');
          handleChatRegistration(parsed, msg.text, msg.name);
        } else {
          logHub('TIMER_REGISTER_SKIP', parsed.instanceName + ' already ' + existingUser.status +
            ' with same webhook URL — skipping duplicate REGISTER');
        }
        continue;
      }

      logHub('TIMER_REGISTER', 'Found REGISTER from ' + parsed.instanceName);
      handleChatRegistration(parsed, msg.text, msg.name);
    }
  }
}

// ============================================================================
// STEP 2: CONFIRMATION MESSAGES (CLEANUP)
// ============================================================================

/**
 * Scans Chat messages for CONFIRM_COMPLETE.
 * When found:
 *   1. Looks up the emailId in the EmailLabelingQueue sheet
 *   2. Gets the stored Chat Message Name (the original EMAIL_READY message)
 *   3. Deletes the EMAIL_READY message from Chat
 *   4. Deletes the CONFIRM_COMPLETE message from Chat
 *   5. Marks the labeling queue row as completed
 *
 * @param {Array} messages - Array of Chat message objects
 */
function scanForConfirmationMessages(messages) {
  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (!msg.text) continue;

    var parsed = parseMessage(msg.text);
    var msgType = getMessageType(parsed.labels);

    if (!parsed.instanceName) continue;

    // Handle CONFIRM_COMPLETE — user confirmed labels were applied
    if (msgType === 'CONFIRM_COMPLETE') {
      processConfirmComplete(parsed, msg.name);
      continue;
    }

    // Handle CONFIRMED — test/registration confirmation
    if (msgType === 'CONFIRMED') {
      handleConfirmedMessage(parsed, msg.name);
      continue;
    }
  }
}

/**
 * Processes a CONFIRM_COMPLETE message.
 * Looks up the labeling result, deletes Chat messages, marks completed.
 *
 * @param {Object} parsed - Parsed message (instanceName, emailId)
 * @param {string} confirmMsgName - The CONFIRM_COMPLETE message's Chat name
 */
function processConfirmComplete(parsed, confirmMsgName) {
  var instanceName = parsed.instanceName;
  var emailId = parsed.emailId;

  if (!instanceName || !emailId) {
    logHub('CONFIRM_SKIP', 'Missing instanceName or emailId in CONFIRM_COMPLETE');
    return;
  }

  logHub('CONFIRM_PROCESSING', instanceName + '/' + emailId);

  // Find the labeling result to get the original EMAIL_READY Chat Message Name
  var labelResult = findLabelingResult(instanceName, emailId);
  var messagesToDelete = [];

  if (labelResult && labelResult.chatMessageName) {
    messagesToDelete.push(labelResult.chatMessageName);
  }

  // Also check the legacy PendingRequests for any tracked messages
  var pendingReq = getPendingRequestByEmailId(instanceName, emailId);
  if (pendingReq && pendingReq.messageNames) {
    for (var j = 0; j < pendingReq.messageNames.length; j++) {
      var name = pendingReq.messageNames[j];
      if (messagesToDelete.indexOf(name) === -1) {
        messagesToDelete.push(name);
      }
    }
  }

  // Add the CONFIRM_COMPLETE message itself for deletion
  if (confirmMsgName) {
    messagesToDelete.push(confirmMsgName);
  }

  // Delete all tracked Chat messages
  if (messagesToDelete.length > 0) {
    var deleteResult = deleteChatMessages(messagesToDelete);
    logHub('CONFIRM_CLEANUP', instanceName + '/' + emailId + ': deleted ' + deleteResult.deleted + ' messages');
  }

  // Mark labeling queue row as completed
  if (labelResult) {
    markLabelingCompleted(labelResult.row);
  }

  // Remove from pending requests
  if (pendingReq) {
    removePendingRequest(instanceName, emailId);
  }

  logHub('CONFIRM_DONE', instanceName + '/' + emailId + ' — cleanup complete');
}

// ============================================================================
// STEP 3: EMAIL_READY MESSAGES (ADD EMOJI)
// ============================================================================

/**
 * Scans Chat messages for EMAIL_READY that don't have ✅ yet.
 * Adds ✅ emoji reaction to all found messages.
 * Each reaction independently triggers the Google Flow.
 *
 * @param {Array} messages - Array of Chat message objects
 */
function scanAndReactToReadyMessages(messages) {
  var reactedCount = 0;

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (!msg.text) continue;

    var parsed = parseMessage(msg.text);
    var msgType = getMessageType(parsed.labels);

    if (msgType !== 'EMAIL_READY') continue;
    if (!parsed.instanceName) continue;

    // Skip if already has ✅ reaction
    if (messageHasReaction(msg)) {
      continue;
    }

    // Add ✅ emoji reaction — this triggers the Google Flow
    var result = addReactionToMessage(msg.name);

    if (result.success && !result.alreadyExists) {
      reactedCount++;
      logHub('TIMER_REACT', 'Added ✅ to ' + parsed.instanceName + '/' + (parsed.emailId || 'unknown') + ' (' + msg.name + ')');
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
