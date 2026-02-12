/**
 * Central Hub - Main Entry Points
 *
 * The Hub is deployed as BOTH a Web App and a Google Chat App.
 *
 * Web App (doPost/doGet):
 * - Receives Google Chat events when configured as an HTTP endpoint
 * - Handles direct webhook calls (ping, status)
 *
 * Chat App (onMessage, onAddedToSpace, etc.):
 * - Receives Google Chat events when configured as an Apps Script project
 *
 * Both entry points route to the same message handling logic.
 *
 * The Hub reads/writes webhook URLs from Google Sheets (Registry).
 * The Hub sends outbound webhooks to user instances via UrlFetchApp.
 */

// ============================================================================
// WEB APP ENTRY POINTS
// ============================================================================

/**
 * Handles GET requests (status check).
 *
 * @param {Object} e - Event object
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  var config = getAllHubConfig();
  var users = [];
  try { users = getAllActiveUsers(); } catch (err) { /* registry may not exist yet */ }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'Smart Call Time Hub Active',
    version: config.hub_version || '1.0.0',
    registeredUsers: users.length,
    chatSpaceConfigured: !!config.chat_space_id,
    timestamp: new Date().toISOString(),
    endpoints: {
      'GET /': 'Status check (this response)',
      'POST /': 'Receive Google Chat events or direct webhook calls'
    }
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles POST requests.
 *
 * Two modes:
 * 1. Google Chat HTTP endpoint events (have event.type, event.message, etc.)
 * 2. Direct webhook calls (have action field)
 *
 * @param {Object} e - Event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // --- Google Chat HTTP endpoint events ---
    // When the Hub is configured as an HTTP endpoint in Cloud Console,
    // Google Chat sends events here instead of calling onMessage() directly.
    if (data.type === 'MESSAGE' && data.message) {
      var chatResult = onMessage(data);
      return hubJsonResponse(chatResult);
    }

    if (data.type === 'ADDED_TO_SPACE' && data.space) {
      var addResult = onAddedToSpace(data);
      return hubJsonResponse(addResult);
    }

    if (data.type === 'REMOVED_FROM_SPACE') {
      onRemovedFromSpace(data);
      return hubJsonResponse({ text: 'Acknowledged' });
    }

    // --- Direct webhook calls ---
    if (data.action === 'ping') {
      return hubJsonResponse({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
    }

    if (data.action === 'status') {
      var users = [];
      try { users = getAllActiveUsers(); } catch (err) {}
      return hubJsonResponse({
        success: true,
        registeredUsers: users.length,
        chatSpaceConfigured: !!getHubConfig('chat_space_id'),
        timestamp: new Date().toISOString()
      });
    }

    // Unknown request
    logHub('DOPOST_UNKNOWN', 'Unknown request: ' + JSON.stringify(data).substring(0, 200));
    return hubJsonResponse({ success: false, error: 'Unknown request type. Expected Chat event or action.' });

  } catch (error) {
    logHub('DOPOST_ERROR', error.message);
    return hubJsonResponse({ success: false, error: error.message });
  }
}

/**
 * Creates a JSON response for web app endpoints.
 *
 * @param {Object} data - Response data
 * @returns {TextOutput} JSON text output
 */
function hubJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// CHAT APP ENTRY POINTS
// ============================================================================

/**
 * Handles messages sent to the Chat app.
 * Called directly by Chat (Apps Script project mode) or via doPost (HTTP endpoint mode).
 *
 * In the timer-based architecture, most message processing is handled by
 * hubTimerProcess() in TimerProcessor.gs. This onMessage handler serves as
 * a lightweight fallback for real-time responses when the Hub is configured
 * as a Chat App (Apps Script project mode or HTTP endpoint mode).
 *
 * It logs incoming messages and handles a few cases that benefit from
 * immediate response (REGISTER, UNREGISTER, tests). The heavy lifting
 * (EMAIL_READY reactions, CONFIRM_COMPLETE cleanup, label dispatch) is
 * done by the 5-minute timer.
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Response message
 */
function onMessage(event) {
  try {
    var message = event.message.text;
    var sender = event.user.email || event.user.displayName;
    var messageName = event.message.name;

    logHub('MESSAGE_RECEIVED', 'From: ' + sender + ', Message: ' + message.substring(0, 100) + '...');

    var parsed = parseMessage(message);
    var msgType = getMessageType(parsed.labels);

    // Handle REGISTER messages immediately for faster feedback
    if (parsed.instanceName && msgType === 'REGISTER') {
      var regResult = handleChatRegistration(parsed, message, messageName);
      if (regResult.success) {
        return { text: parsed.instanceName + ': Registration successful. Webhook confirmed.' };
      }
      return { text: 'Registration failed: ' + regResult.error };
    }

    // Handle UNREGISTER messages immediately
    if (parsed.instanceName && msgType === 'UNREGISTER') {
      var unregResult = handleChatUnregistration(parsed, messageName);
      if (unregResult.success) {
        return { text: parsed.instanceName + ': Unregistered.' };
      }
      return { text: 'Unregister failed: ' + unregResult.error };
    }

    // Handle test messages immediately for faster feedback
    if (parsed.instanceName && isTestChatLabels(parsed.labels)) {
      var testResult = handleTestChatMessage(parsed, messageName);
      if (testResult.success) {
        return { text: 'Test chat received for ' + parsed.instanceName + '. Webhook sent.' };
      }
      return { text: 'Test chat connection failed: ' + testResult.error };
    }

    // Handle CONFIRMED messages (test round-trip) immediately
    if (parsed.instanceName && msgType === 'CONFIRMED') {
      var confirmResult = handleConfirmedMessage(parsed, messageName);
      if (confirmResult.success) {
        return { text: parsed.instanceName + ': Confirmed. ' + (confirmResult.deleted || 0) + ' messages cleaned up.' };
      }
      return { text: 'Confirm handling failed: ' + confirmResult.error };
    }

    // All other messages (EMAIL_READY, CONFIRM_COMPLETE, label responses)
    // are handled by the 5-minute timer in TimerProcessor.gs.
    // Just log and acknowledge.
    if (parsed.instanceName && msgType) {
      logHub('MESSAGE_QUEUED', parsed.instanceName + ': ' + msgType + ' (will be processed by timer)');
      return { text: 'Received: ' + parsed.instanceName + ' ' + msgType + '. Will be processed on next timer cycle.' };
    }

    // Unknown message — log it
    logHub('MESSAGE_UNKNOWN', 'Unrecognized message from ' + sender);
    return { text: 'Message received. Will be processed on next timer cycle.' };

  } catch (error) {
    logHub('MESSAGE_ERROR', error.message);
    return { text: 'Error: ' + error.message };
  }
}

/**
 * Handles the app being added to a space.
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Welcome message
 */
function onAddedToSpace(event) {
  var spaceName = event.space.displayName || event.space.name;

  // Auto-save the space ID for sending messages
  if (event.space.name) {
    setHubConfig('chat_space_id', event.space.name);
    logHub('SPACE_ID_SAVED', event.space.name);
  }

  logHub('ADDED_TO_SPACE', spaceName);

  return {
    text: 'Smart Call Time Hub is ready! Users can register by posting REGISTER messages to this space.'
  };
}

/**
 * Handles the app being removed from a space.
 *
 * @param {Object} event - Chat event object
 */
function onRemovedFromSpace(event) {
  logHub('REMOVED_FROM_SPACE', event.space.name);
}

/**
 * Handles slash commands (app commands).
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Response message
 */
function onAppCommand(event) {
  var commandId = event.message && event.message.slashCommand ? event.message.slashCommand.commandId : 'unknown';
  logHub('APP_COMMAND', 'Command ID: ' + commandId);

  return {
    text: 'No commands configured yet. Post @instance_name:[id] REGISTER to register, or labels to route.'
  };
}

// ============================================================================
// CHAT-BASED REGISTRATION HANDLERS
// ============================================================================

/**
 * Handles registration via Chat message.
 *
 * Expected message body (lines after the header):
 *   email=user@example.com
 *   webhook=https://script.google.com/macros/s/.../exec
 *   sheetId=SPREADSHEET_ID (optional)
 *
 * @param {Object} parsed - Parsed message (instanceName, emailId, labels)
 * @param {string} fullMessage - Full message text (to extract key=value pairs)
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleChatRegistration(parsed, fullMessage, messageName) {
  try {
    // Parse registration data from message body
    var regData = parseRegistrationData(fullMessage);

    if (!regData.email || !regData.webhook) {
      return { success: false, error: 'Missing required fields. Message must include email=... and webhook=...' };
    }

    var instanceName = parsed.instanceName;

    // Register user in the Registry sheet
    var result = registerUser({
      email: regData.email,
      sheetId: regData.sheetId || '',
      instanceName: instanceName,
      webhookUrl: regData.webhook,
      registeredAt: new Date().toISOString()
    });

    if (!result.success) {
      return result;
    }

    logHub('CHAT_REGISTRATION', instanceName + ' (' + regData.email + ') webhook=' + regData.webhook);

    // Track the registration message for later cleanup (when CONFIRMED arrives)
    var conversationId = 'register';
    createPendingRequest(instanceName, conversationId, {
      type: 'registration',
      messageNames: messageName ? [messageName] : [],
      startedAt: new Date().toISOString()
    });

    // Send confirmation webhook to the user's deployed URL
    // User must reply with CONFIRMED chat message to prove webhook works
    var confirmPayload = {
      action: 'registration_confirmed',
      instanceName: instanceName,
      email: regData.email,
      conversationId: conversationId,
      message: 'Registration successful. Post CONFIRMED to chat to complete verification.',
      timestamp: new Date().toISOString()
    };

    var webhookResult = sendWebhookToUser(instanceName, confirmPayload);

    if (webhookResult.success) {
      logHub('REGISTRATION_WEBHOOK_SENT', instanceName + ': waiting for CONFIRMED reply in chat');
    } else {
      logHub('REGISTRATION_CONFIRM_FAILED', instanceName + ': ' + webhookResult.error);
    }

    // Do NOT delete chat messages yet - wait for CONFIRMED from user
    // The handleConfirmedMessage() handler will delete them when CONFIRMED arrives

    return {
      success: true,
      instanceName: instanceName,
      webhookSent: webhookResult.success
    };

  } catch (error) {
    logHub('REGISTRATION_ERROR', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Handles unregistration via Chat message.
 *
 * @param {Object} parsed - Parsed message
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleChatUnregistration(parsed, messageName) {
  try {
    var result = unregisterUser(parsed.instanceName);

    // Delete the chat message
    if (messageName) {
      deleteChatMessages([messageName]);
    }

    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handles CONFIRM_COMPLETE via Chat message.
 * User posts this after applying labels. Hub deletes tracked messages.
 *
 * @param {Object} parsed - Parsed message (instanceName, emailId)
 * @param {string} messageName - This message's name for cleanup
 * @returns {Object} Result
 */
function handleChatConfirmComplete(parsed, messageName) {
  var instanceName = parsed.instanceName;
  var emailId = parsed.emailId;

  if (!instanceName || !emailId) {
    return { success: false, error: 'Missing instanceName or emailId' };
  }

  try {
    // Get the pending request to find tracked message IDs
    var pendingRequest = getPendingRequestByEmailId(instanceName, emailId);

    var allMessages = [];

    if (pendingRequest && pendingRequest.messageNames && pendingRequest.messageNames.length > 0) {
      allMessages = pendingRequest.messageNames.slice();
    }

    // Also delete this CONFIRM_COMPLETE message itself
    if (messageName) {
      allMessages.push(messageName);
    }

    // Delete all tracked chat messages
    var deleteResult = { deleted: 0 };
    if (allMessages.length > 0) {
      deleteResult = deleteChatMessages(allMessages);
      logHub('CONFIRM_COMPLETE_CLEANUP', instanceName + '/' + emailId + ': deleted ' + deleteResult.deleted + ' messages');
    }

    // Remove from pending sheet
    if (pendingRequest) {
      removePendingRequest(instanceName, emailId);
    }

    logHub('CONFIRM_COMPLETE', instanceName + '/' + emailId + ' - cleaned up');

    return {
      success: true,
      deleted: deleteResult.deleted,
      message: 'Request completed and chat messages cleaned up'
    };

  } catch (error) {
    logHub('CONFIRM_ERROR', instanceName + '/' + emailId + ': ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Parses registration key=value pairs from a chat message body.
 *
 * @param {string} message - Full message text
 * @returns {Object} { email, webhook, sheetId }
 */
function parseRegistrationData(message) {
  var data = { email: '', webhook: '', sheetId: '' };
  var lines = message.split('\n');

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var emailMatch = line.match(/^email\s*=\s*(.+)$/i);
    if (emailMatch) {
      data.email = emailMatch[1].trim();
      continue;
    }
    var webhookMatch = line.match(/^webhook\s*=\s*(.+)$/i);
    if (webhookMatch) {
      data.webhook = webhookMatch[1].trim();
      continue;
    }
    var sheetMatch = line.match(/^sheetId\s*=\s*(.+)$/i);
    if (sheetMatch) {
      data.sheetId = sheetMatch[1].trim();
      continue;
    }
  }

  return data;
}

// ============================================================================
// AUTHORIZATION
// ============================================================================

/**
 * Touches all OAuth scopes so the consent prompt covers everything at once.
 * Run this once (from the editor or via clasp run) to authorize the Hub.
 */
function authorize() {
  // Spreadsheet scope
  SpreadsheetApp.getActive();

  // External request scope
  UrlFetchApp.getRequest && UrlFetchApp;

  // Chat scopes are covered by the advanced service declaration in appsscript.json

  Logger.log('All Hub scopes authorized successfully.');
  return { status: 'authorized', scopes: 'spreadsheets, urlfetch, chat' };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Logs hub activity.
 *
 * @param {string} action - Action type
 * @param {string} details - Details
 */
function logHub(action, details) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('HubLog');

  if (!sheet) {
    console.log('[HUB ' + action + '] ' + details);
    return;
  }

  sheet.appendRow([
    new Date(),
    action,
    details
  ]);

  // Keep log manageable
  var maxRows = 1000;
  var lastRow = sheet.getLastRow();
  if (lastRow > maxRows) {
    sheet.deleteRows(2, lastRow - maxRows);
  }
}
