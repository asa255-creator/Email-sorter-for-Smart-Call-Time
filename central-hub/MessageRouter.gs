/**
 * Central Hub - Message Router
 *
 * Parses incoming messages and routes them to the correct user webhook.
 * The Hub is a "dumb pipe" - it just forwards labels, doesn't process them.
 */

// ============================================================================
// MESSAGE ROUTING
// ============================================================================

/**
 * Routes an incoming message to the appropriate user.
 * Parses the message to extract instance name and labels.
 *
 * Expected message formats:
 * 1. "@instance_name: Label1, Label2, Label3"
 * 2. "instance_name: Label1, Label2"
 * 3. Just "Label1, Label2" (uses pending request to determine target)
 *
 * @param {string} message - The incoming message text
 * @param {string} sender - The sender identifier
 * @returns {Object} Routing result
 */
function routeMessage(message, sender) {
  try {
    // Try to parse instance name from message
    const parsed = parseMessage(message);

    if (parsed.instanceName) {
      // Direct routing to named instance
      return routeLabelsToUser(parsed.instanceName, parsed.labels, parsed.emailId);
    }

    // No instance name in message - check pending requests
    const pendingRequest = getOldestPendingRequest();

    if (pendingRequest) {
      // Route to the user who has a pending request
      const result = routeLabelsToUser(
        pendingRequest.instanceName,
        parsed.labels,
        pendingRequest.emailId
      );

      if (result.success) {
        // Mark request as completed
        completePendingRequest(pendingRequest.requestId);
      }

      return result;
    }

    return {
      success: false,
      error: 'Could not determine target user. Include @instance_name in message or ensure there is a pending request.'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Routes labels directly to a user's webhook.
 *
 * @param {string} instanceName - Target instance name
 * @param {string} labels - Labels to send
 * @param {string} emailId - Optional email ID
 * @returns {Object} Routing result
 */
function routeLabelsToUser(instanceName, labels, emailId) {
  const payload = {
    action: 'update_labels',
    labels: labels,
    emailId: emailId || '',
    fromHub: true,
    timestamp: new Date().toISOString()
  };

  const result = sendWebhookToUser(instanceName, payload);

  if (result.success) {
    logHub('ROUTED_SUCCESS', `${instanceName}: ${labels}`);
    return {
      success: true,
      instanceName: instanceName,
      labels: labels,
      webhookResponse: result.webhookResponse
    };
  }

  logHub('ROUTED_FAILED', `${instanceName}: ${result.error}`);
  return {
    success: false,
    error: result.error,
    instanceName: instanceName,
    responseText: result.responseText
  };
}

/**
 * Sends a JSON payload to a user's webhook.
 *
 * @param {string} instanceName - Target instance name
 * @param {Object} payload - Payload to send
 * @returns {Object} Result
 */
function sendWebhookToUser(instanceName, payload) {
  const user = getUserByInstance(instanceName);

  if (!user) {
    return {
      success: false,
      error: `User not found: ${instanceName}`,
      instanceName: instanceName
    };
  }

  if (!user.webhookUrl) {
    return {
      success: false,
      error: `No webhook URL for user: ${instanceName}`,
      instanceName: instanceName
    };
  }

  try {
    const response = UrlFetchApp.fetch(user.webhookUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        result = { rawResponse: responseText };
      }

      return {
        success: true,
        instanceName: instanceName,
        webhookResponse: result
      };
    }

    return {
      success: false,
      error: `Webhook returned HTTP ${responseCode}`,
      instanceName: instanceName,
      responseText: responseText
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to call webhook: ${error.message}`,
      instanceName: instanceName
    };
  }
}

// ============================================================================
// MESSAGE PARSING
// ============================================================================

/**
 * Parses a message to extract instance name and labels.
 *
 * @param {string} message - Raw message text
 * @returns {Object} Parsed message with instanceName, labels, emailId
 */
function parseMessage(message) {
  var trimmed = message.trim();

  // For multi-line messages, parse only the first line for routing info
  var firstLine = trimmed.split('\n')[0].trim();

  // Pattern 1: @instance_name:[conversationId] MESSAGE_TYPE or labels
  // Pattern 2: @instance_name: [conversationId] MESSAGE_TYPE or labels
  // Pattern 3: instance_name: [conversationId] MESSAGE_TYPE or labels
  var colonMatch = firstLine.match(/^@?([a-zA-Z0-9_]+):\s*(.+)$/);

  if (colonMatch) {
    var instanceName = colonMatch[1];
    var labelsText = colonMatch[2];

    // Check if there's a conversation/email ID in brackets
    var idMatch = labelsText.match(/\[([^\]]+)\]\s*(.+)/);

    if (idMatch) {
      return {
        instanceName: instanceName,
        emailId: idMatch[1],
        labels: idMatch[2].trim()
      };
    }

    return {
      instanceName: instanceName,
      emailId: null,
      labels: labelsText.trim()
    };
  }

  // Pattern 4: [emailId] labels (no instance name)
  var idOnlyMatch = firstLine.match(/^\[([^\]]+)\]\s*(.+)$/);

  if (idOnlyMatch) {
    return {
      instanceName: null,
      emailId: idOnlyMatch[1],
      labels: idOnlyMatch[2].trim()
    };
  }

  // Pattern 5: Just labels (no instance name or email ID)
  return {
    instanceName: null,
    emailId: null,
    labels: firstLine
  };
}

/**
 * Validates that labels look reasonable.
 *
 * @param {string} labels - Labels string
 * @returns {boolean} True if labels look valid
 */
function validateLabels(labels) {
  if (!labels || labels.trim() === '') {
    return false;
  }

  // Check for obviously invalid responses
  const invalid = ['error', 'failed', 'sorry', 'cannot', 'unable'];

  const lower = labels.toLowerCase();
  for (const word of invalid) {
    if (lower.startsWith(word)) {
      return false;
    }
  }

  return true;
}

// ============================================================================
// MESSAGE TYPE DETECTION
// ============================================================================

/**
 * Standard message types used in the consistent chat format.
 *
 * CONSISTENT MESSAGE FORMAT:
 *   @{instanceName}:[{conversationId}] {MESSAGE_TYPE}
 *
 * - instanceName: identifies which user sheet sent/should receive the message
 * - conversationId: groups related messages for cleanup (emailId or UUID)
 * - MESSAGE_TYPE: identifies what action to take
 *
 * This format allows:
 * - Hub to route to the correct user webhook
 * - Hub to group and delete all messages in a conversation
 * - Google Workspace Flow to filter on MESSAGE_TYPE
 */
var MESSAGE_TYPES = {
  // Email processing
  EMAIL_READY: 'EMAIL_READY',
  LABEL_RESPONSE: 'LABEL_RESPONSE',

  // Status
  QUEUE_STARTED: 'QUEUE_STARTED',
  QUEUE_COMPLETE: 'QUEUE_COMPLETE',

  // Registration (via chat - no web app)
  REGISTER: 'REGISTER',
  UNREGISTER: 'UNREGISTER',
  CONFIRM_COMPLETE: 'CONFIRM_COMPLETE',

  // Tests
  TEST_CHAT_CONNECTION: 'TEST_CHAT_CONNECTION',
  SHEETS_CHAT_TEST: 'SHEETS_CHAT_TEST',
  CONFIRMED: 'CONFIRMED'
};

/**
 * Extracts the message type from the parsed labels/payload field.
 *
 * @param {string} payload - The labels/payload text from parseMessage
 * @returns {string|null} The message type or null if not recognized
 */
function getMessageType(payload) {
  if (!payload) return null;
  var upper = payload.trim().toUpperCase();

  for (var key in MESSAGE_TYPES) {
    if (upper === MESSAGE_TYPES[key] || upper.startsWith(MESSAGE_TYPES[key])) {
      return MESSAGE_TYPES[key];
    }
  }

  return null;
}

/**
 * Returns true if the message type is a test/system message (not a label response).
 *
 * @param {string} messageType - Message type from getMessageType()
 * @returns {boolean}
 */
function isSystemMessage(messageType) {
  var systemTypes = [
    MESSAGE_TYPES.EMAIL_READY,
    MESSAGE_TYPES.TEST_CHAT_CONNECTION,
    MESSAGE_TYPES.SHEETS_CHAT_TEST,
    MESSAGE_TYPES.CONFIRMED,
    MESSAGE_TYPES.QUEUE_STARTED,
    MESSAGE_TYPES.QUEUE_COMPLETE,
    MESSAGE_TYPES.REGISTER,
    MESSAGE_TYPES.UNREGISTER,
    MESSAGE_TYPES.CONFIRM_COMPLETE
  ];
  return systemTypes.indexOf(messageType) !== -1;
}

// ============================================================================
// TEST MESSAGE HANDLING
// ============================================================================

/**
 * Returns true if labels represent a test chat connection message.
 *
 * @param {string} labels - Labels text
 * @returns {boolean}
 */
function isTestChatLabels(labels) {
  if (!labels) return false;
  var upper = labels.trim().toUpperCase();
  return upper.startsWith('TEST_CHAT_CONNECTION') || upper.startsWith('SHEETS_CHAT_TEST');
}

/**
 * Handles a test chat message routed through Chat.
 * Supports both legacy TEST_CHAT_CONNECTION and new SHEETS_CHAT_TEST.
 *
 * @param {Object} parsed - Parsed message (instanceName, labels, emailId)
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleTestChatMessage(parsed, messageName) {
  var testId = parsed.emailId || '';
  var msgType = getMessageType(parsed.labels);

  // New Sheets Chat Test: Hub sends webhook, user replies CONFIRMED, hub deletes
  if (msgType === MESSAGE_TYPES.SHEETS_CHAT_TEST) {
    return handleSheetsChatTest(parsed, messageName);
  }

  // Legacy test: just send success webhook back
  var payload = {
    action: 'test_chat_success',
    instanceName: parsed.instanceName,
    testId: testId,
    message: 'Test successful',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  var result = sendWebhookToUser(parsed.instanceName, payload);

  if (result.success) {
    logHub('TEST_CHAT_SUCCESS', parsed.instanceName + ' (' + (testId || 'no-id') + ')');
    return { success: true };
  }

  logHub('TEST_CHAT_FAILED', parsed.instanceName + ': ' + result.error);
  return { success: false, error: result.error };
}

/**
 * Handles the SHEETS_CHAT_TEST flow:
 * 1. User sent chat with SHEETS_CHAT_TEST
 * 2. Hub tracks the message, sends webhook to user with test_sheets_chat_confirm
 * 3. User will send CONFIRMED chat (handled by handleConfirmedMessage)
 * 4. Hub deletes both messages
 *
 * @param {Object} parsed - Parsed message
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleSheetsChatTest(parsed, messageName) {
  var conversationId = parsed.emailId || Utilities.getUuid();

  // Track this message for later cleanup using pending request system
  createPendingRequest(parsed.instanceName, conversationId, {
    type: 'sheets_chat_test',
    messageNames: messageName ? [messageName] : [],
    startedAt: new Date().toISOString()
  });

  // Send webhook to user telling them to reply CONFIRMED
  var payload = {
    action: 'test_sheets_chat_confirm',
    instanceName: parsed.instanceName,
    conversationId: conversationId,
    message: 'Hub received your test. Sending CONFIRMED reply.',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  var result = sendWebhookToUser(parsed.instanceName, payload);

  if (result.success) {
    logHub('SHEETS_CHAT_TEST_RECEIVED', parsed.instanceName + ' [' + conversationId + '] - webhook sent to user');
    return { success: true, conversationId: conversationId };
  }

  logHub('SHEETS_CHAT_TEST_FAILED', parsed.instanceName + ': ' + result.error);
  return { success: false, error: result.error };
}

/**
 * Handles a CONFIRMED message in chat.
 * Finds the matching pending request, deletes all tracked messages, cleans up.
 *
 * @param {Object} parsed - Parsed message (instanceName, emailId=conversationId)
 * @param {string} messageName - This CONFIRMED message's name
 * @returns {Object} Result
 */
function handleConfirmedMessage(parsed, messageName) {
  var conversationId = parsed.emailId || '';
  var instanceName = parsed.instanceName;

  if (!conversationId || !instanceName) {
    logHub('CONFIRMED_ERROR', 'Missing conversationId or instanceName');
    return { success: false, error: 'Missing conversationId or instanceName' };
  }

  // Find the pending request for this conversation
  var pending = getPendingRequestByEmailId(instanceName, conversationId);

  if (!pending) {
    logHub('CONFIRMED_NO_PENDING', instanceName + ' [' + conversationId + ']');
    return { success: true, message: 'No pending request found (may already be cleaned up)' };
  }

  // Collect all message names: original test message + this CONFIRMED message
  var allMessages = (pending.messageNames || []).slice();
  if (messageName) {
    allMessages.push(messageName);
  }

  // Delete all tracked chat messages
  if (allMessages.length > 0) {
    var deleteResult = deleteChatMessages(allMessages);
    logHub('CONFIRMED_CLEANUP', instanceName + ' [' + conversationId + ']: deleted ' + deleteResult.deleted + ' messages');
  }

  // Remove pending request
  removePendingRequest(instanceName, conversationId);

  // Send success webhook to user
  var payload = {
    action: 'test_sheets_chat_complete',
    instanceName: instanceName,
    conversationId: conversationId,
    messagesDeleted: allMessages.length,
    message: 'Test complete. Chat messages deleted.',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  sendWebhookToUser(instanceName, payload);

  logHub('SHEETS_CHAT_TEST_COMPLETE', instanceName + ' [' + conversationId + '] - ' + allMessages.length + ' messages deleted');

  return { success: true, deleted: allMessages.length };
}
