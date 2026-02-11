/**
 * Central Hub - Main Entry Points
 *
 * The Hub is deployed ONLY as a Google Chat App.
 * It does NOT have a web app (no doGet/doPost).
 *
 * ALL input to the Hub comes through Google Chat messages:
 * - Registration requests from user instances
 * - AI label responses routed to user webhooks
 * - Confirm-complete notifications from user instances
 * - Test messages
 *
 * The Hub reads/writes webhook URLs from Google Sheets (Registry).
 * The Hub sends outbound webhooks to user instances via UrlFetchApp.
 */

// ============================================================================
// CHAT APP ENTRY POINTS
// ============================================================================

/**
 * Handles messages sent to the Chat app.
 * This is the ONLY entry point for all Hub communication.
 *
 * Message types handled:
 * - REGISTER: User instance requesting registration
 * - UNREGISTER: User instance requesting unregistration
 * - CONFIRM_COMPLETE: User confirms labels applied, Hub cleans up
 * - SHEETS_CHAT_TEST / CONFIRMED: Test flow messages
 * - EMAIL_READY / QUEUE_STARTED / QUEUE_COMPLETE: Status messages
 * - Labels: AI responses routed to user webhooks
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Response message
 */
function onMessage(event) {
  try {
    const message = event.message.text;
    const sender = event.user.email || event.user.displayName;
    const messageName = event.message.name; // Track for cleanup

    logHub('MESSAGE_RECEIVED', 'From: ' + sender + ', Message: ' + message.substring(0, 100) + '...');

    const parsed = parseMessage(message);
    const msgType = getMessageType(parsed.labels);

    // Handle REGISTER messages - user instance wants to register
    if (parsed.instanceName && msgType === 'REGISTER') {
      var regResult = handleChatRegistration(parsed, message, messageName);
      if (regResult.success) {
        return { text: parsed.instanceName + ': Registration successful. Webhook confirmed.' };
      }
      return { text: 'Registration failed: ' + regResult.error };
    }

    // Handle UNREGISTER messages
    if (parsed.instanceName && msgType === 'UNREGISTER') {
      var unregResult = handleChatUnregistration(parsed, messageName);
      if (unregResult.success) {
        return { text: parsed.instanceName + ': Unregistered.' };
      }
      return { text: 'Unregister failed: ' + unregResult.error };
    }

    // Handle CONFIRM_COMPLETE messages - user confirms labels were applied
    if (parsed.instanceName && msgType === 'CONFIRM_COMPLETE') {
      var completeResult = handleChatConfirmComplete(parsed, messageName);
      if (completeResult.success) {
        return { text: parsed.instanceName + ': Confirmed. ' + (completeResult.deleted || 0) + ' messages cleaned up.' };
      }
      return { text: 'Confirm complete failed: ' + completeResult.error };
    }

    // Handle CONFIRMED messages - user confirmed a test, delete tracked messages
    if (parsed.instanceName && msgType === 'CONFIRMED') {
      var confirmResult = handleConfirmedMessage(parsed, messageName);
      if (confirmResult.success) {
        return { text: parsed.instanceName + ': Confirmed. ' + (confirmResult.deleted || 0) + ' messages cleaned up.' };
      }
      return { text: 'Confirm handling failed: ' + confirmResult.error };
    }

    // Handle test chat messages (both legacy TEST_CHAT_CONNECTION and new SHEETS_CHAT_TEST)
    if (parsed.instanceName && isTestChatLabels(parsed.labels)) {
      var testResult = handleTestChatMessage(parsed, messageName);
      if (testResult.success) {
        return { text: 'Test chat received for ' + parsed.instanceName + '. Webhook sent.' };
      }
      return { text: 'Test chat connection failed: ' + testResult.error };
    }

    // Handle system/status messages (QUEUE_STARTED, QUEUE_COMPLETE, EMAIL_READY) - log them
    if (parsed.instanceName && msgType && isSystemMessage(msgType)) {
      logHub('STATUS_MESSAGE', parsed.instanceName + ': ' + msgType);

      // Track EMAIL_READY messages for later cleanup
      if (msgType === 'EMAIL_READY' && messageName) {
        var emailId = parsed.emailId || '';
        if (emailId) {
          createPendingRequest(parsed.instanceName, emailId, {
            type: 'email_ready',
            messageNames: [messageName],
            startedAt: new Date().toISOString()
          });
        }
      }

      return { text: 'Status received: ' + parsed.instanceName + ' ' + msgType };
    }

    // Parse the AI response to extract labels and target user
    var routeResult = routeMessage(message, sender);

    if (routeResult.success) {
      // Track this AI response message for later cleanup
      if (messageName && routeResult.instanceName) {
        appendMessageToPending(routeResult.instanceName, messageName);
      }
      return { text: 'Routed to ' + routeResult.instanceName + ': ' + routeResult.labels };
    } else {
      return { text: 'Could not route message: ' + routeResult.error };
    }

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
