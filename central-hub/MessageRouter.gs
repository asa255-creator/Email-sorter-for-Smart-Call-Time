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
 * Uses parseChatMessage() to extract user and routing info.
 *
 * @param {string} message - The incoming message text
 * @param {string} sender - The sender identifier
 * @returns {Object} Routing result
 */
function routeMessage(message, sender) {
  try {
    var parsed = parseChatMessage(message);

    if (!parsed) {
      return { success: false, error: 'Could not parse message' };
    }

    if (parsed.user) {
      // Direct routing to named user — use body as labels for LABEL_RESPONSE
      var labels = parsed.type === MESSAGE_TYPES.LABEL_RESPONSE ? parsed.body : parsed.type;
      return routeLabelsToUser(parsed.user, labels, parsed.conversationId);
    }

    // No user in message - check pending requests
    var pendingRequest = getOldestPendingRequest();

    if (pendingRequest) {
      var result = routeLabelsToUser(
        pendingRequest.instanceName,
        parsed.body || parsed.type,
        pendingRequest.emailId
      );

      if (result.success) {
        completePendingRequest(pendingRequest.requestId);
      }

      return result;
    }

    return {
      success: false,
      error: 'Could not determine target user. Include user field in message or ensure there is a pending request.'
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
// MESSAGE PARSING — CENTRALIZED (the ONLY place raw chat text is read)
// ============================================================================

/**
 * Parses a chat message using the standardized key-value header format.
 *
 * Expected format:
 *   user: {instanceName}
 *   conversation_id: {conversationId}
 *   type: {MESSAGE_TYPE}
 *   status: {processing|closed}
 *
 *   {optional body}
 *
 * This is the ONLY function that reads raw chat message text on the hub side.
 * If the message format changes, update this function and buildChatMessage() only.
 * All other functions receive the structured object returned here.
 *
 * Falls back to legacy format (@instanceName:[id] TYPE) for transition period.
 *
 * @param {string} messageText - Raw message text
 * @returns {Object|null} Parsed message: { user, conversationId, type, status, body }
 */
function parseChatMessage(messageText) {
  if (!messageText) return null;

  var lines = messageText.trim().split('\n');
  var header = {};
  var bodyStart = -1;

  // Parse key: value lines until first blank line
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '') {
      bodyStart = i + 1;
      break;
    }
    var match = line.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
    if (match) {
      header[match[1].toLowerCase()] = match[2].trim();
    }
  }

  // Check if we got the new format (has 'user' and 'type' keys)
  if (header['user'] && header['type']) {
    var body = bodyStart > 0 ? lines.slice(bodyStart).join('\n').trim() : '';
    return {
      user: header['user'],
      conversationId: header['conversation_id'] || null,
      type: header['type'].toUpperCase(),
      status: (header['status'] || 'processing').toLowerCase(),
      body: body
    };
  }

  // Fallback: try legacy format @instanceName:[id] TYPE
  return parseLegacyMessage(messageText);
}

/**
 * Parses the legacy message format: @instanceName:[conversationId] TYPE
 * Used during transition period for messages already in the chat space.
 *
 * @param {string} message - Raw message text
 * @returns {Object|null} Parsed message in the same shape as parseChatMessage()
 */
function parseLegacyMessage(message) {
  var trimmed = message.trim();
  var firstLine = trimmed.split('\n')[0].trim();

  // @instance_name:[conversationId] MESSAGE_TYPE or labels
  var colonMatch = firstLine.match(/^@?([a-zA-Z0-9_]+):\s*(.+)$/);

  if (colonMatch) {
    var instanceName = colonMatch[1];
    var labelsText = colonMatch[2];

    var idMatch = labelsText.match(/\[([^\]]+)\]\s*(.+)/);
    if (idMatch) {
      var typeStr = idMatch[2].trim();
      var msgType = getLegacyMessageType(typeStr);
      return {
        user: instanceName,
        conversationId: idMatch[1],
        type: msgType || typeStr,
        status: isClosedType(msgType) ? 'closed' : 'processing',
        body: trimmed.split('\n').slice(1).join('\n').trim()
      };
    }

    var msgType = getLegacyMessageType(labelsText.trim());
    return {
      user: instanceName,
      conversationId: null,
      type: msgType || labelsText.trim(),
      status: isClosedType(msgType) ? 'closed' : 'processing',
      body: trimmed.split('\n').slice(1).join('\n').trim()
    };
  }

  // [emailId] labels (no instance name)
  var idOnlyMatch = firstLine.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (idOnlyMatch) {
    var typeStr = idOnlyMatch[2].trim();
    var msgType = getLegacyMessageType(typeStr);
    return {
      user: null,
      conversationId: idOnlyMatch[1],
      type: msgType || typeStr,
      status: isClosedType(msgType) ? 'closed' : 'processing',
      body: trimmed.split('\n').slice(1).join('\n').trim()
    };
  }

  // Just text (no instance name or email ID)
  return {
    user: null,
    conversationId: null,
    type: null,
    status: null,
    body: firstLine
  };
}

/**
 * Checks if a type string matches a known legacy MESSAGE_TYPE.
 *
 * @param {string} payload - Text to check
 * @returns {string|null} The matched MESSAGE_TYPE or null
 */
function getLegacyMessageType(payload) {
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
 * Returns true if the message type implies the conversation is closed.
 *
 * @param {string} messageType - Message type
 * @returns {boolean}
 */
function isClosedType(messageType) {
  return messageType === MESSAGE_TYPES.CONFIRM_COMPLETE ||
         messageType === MESSAGE_TYPES.CONFIRMED;
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
 * CONSISTENT MESSAGE FORMAT (key-value header):
 *   user: {instanceName}
 *   conversation_id: {conversationId}
 *   type: {MESSAGE_TYPE}
 *   status: {processing|closed}
 *
 * This format allows:
 * - Hub to route to the correct user webhook
 * - Hub to group and delete all messages in a conversation by user + conversation_id
 * - Hub to clean up closed conversations (status=closed)
 * - Google Workspace Flow to filter on type field
 */
var MESSAGE_TYPES = {
  // Email processing
  EMAIL_READY: 'EMAIL_READY',
  LABEL_RESPONSE: 'LABEL_RESPONSE',

  // Registration (via chat)
  REGISTER: 'REGISTER',
  UNREGISTER: 'UNREGISTER',
  CONFIRM_COMPLETE: 'CONFIRM_COMPLETE',

  // Tests
  TEST_CHAT_CONNECTION: 'TEST_CHAT_CONNECTION',
  SHEETS_CHAT_TEST: 'SHEETS_CHAT_TEST',
  CONFIRMED: 'CONFIRMED'
};

/**
 * Returns true if the message type is a test/system message (not a label response).
 *
 * @param {string} messageType - Message type from parseChatMessage().type
 * @returns {boolean}
 */
function isSystemMessage(messageType) {
  var systemTypes = [
    MESSAGE_TYPES.EMAIL_READY,
    MESSAGE_TYPES.TEST_CHAT_CONNECTION,
    MESSAGE_TYPES.SHEETS_CHAT_TEST,
    MESSAGE_TYPES.CONFIRMED,
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
function isTestChatLabels(type) {
  if (!type) return false;
  return type === MESSAGE_TYPES.TEST_CHAT_CONNECTION || type === MESSAGE_TYPES.SHEETS_CHAT_TEST;
}

/**
 * Handles a test chat message routed through Chat.
 * Supports both legacy TEST_CHAT_CONNECTION and new SHEETS_CHAT_TEST.
 *
 * @param {Object} parsed - Parsed message from parseChatMessage()
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleTestChatMessage(parsed, messageName) {
  var testId = parsed.conversationId || '';

  // New Sheets Chat Test: Hub sends webhook, user replies CONFIRMED, hub deletes
  if (parsed.type === MESSAGE_TYPES.SHEETS_CHAT_TEST) {
    return handleSheetsChatTest(parsed, messageName);
  }

  // Legacy test: just send success webhook back
  var payload = {
    action: 'test_chat_success',
    instanceName: parsed.user,
    testId: testId,
    message: 'Test successful',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  var result = sendWebhookToUser(parsed.user, payload);

  if (result.success) {
    logHub('TEST_CHAT_SUCCESS', parsed.user + ' (' + (testId || 'no-id') + ')');
    return { success: true };
  }

  logHub('TEST_CHAT_FAILED', parsed.user + ': ' + result.error);
  return { success: false, error: result.error };
}

/**
 * Handles the SHEETS_CHAT_TEST flow:
 * 1. User sent chat with SHEETS_CHAT_TEST
 * 2. Hub tracks the message, sends webhook to user with test_sheets_chat_confirm
 * 3. User will send CONFIRMED chat (handled in handleClosedConversations)
 * 4. Hub deletes both messages
 *
 * @param {Object} parsed - Parsed message from parseChatMessage()
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleSheetsChatTest(parsed, messageName) {
  var conversationId = parsed.conversationId || Utilities.getUuid();

  // Track this message for later cleanup using pending request system
  createPendingRequest(parsed.user, conversationId, {
    type: 'sheets_chat_test',
    messageNames: messageName ? [messageName] : [],
    startedAt: new Date().toISOString()
  });

  // Send webhook to user telling them to reply CONFIRMED
  var payload = {
    action: 'test_sheets_chat_confirm',
    instanceName: parsed.user,
    conversationId: conversationId,
    message: 'Hub received your test. Sending CONFIRMED reply.',
    origin: 'hub',
    timestamp: new Date().toISOString()
  };

  var result = sendWebhookToUser(parsed.user, payload);

  if (result.success) {
    logHub('SHEETS_CHAT_TEST_RECEIVED', parsed.user + ' [' + conversationId + '] - webhook sent to user');
    return { success: true, conversationId: conversationId };
  }

  logHub('SHEETS_CHAT_TEST_FAILED', parsed.user + ': ' + result.error);
  return { success: false, error: result.error };
}
