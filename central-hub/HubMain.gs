/**
 * Central Hub - Main Entry Points
 *
 * The Hub is a Google Sheet with a timer-based processor.
 * It does NOT function as a Chat App — there is no HTTP endpoint for Chat events.
 *
 * All message processing happens via the 5-minute timer in TimerProcessor.gs,
 * which polls the Chat space using Chat.Spaces.Messages.list().
 *
 * Web App (doGet/doPost):
 * - doGet: Status check only
 * - doPost: Direct webhook calls (ping, status) — NOT Chat events
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
    mode: 'timer-driven (5-min polling)',
    endpoints: {
      'GET /': 'Status check (this response)',
      'POST /': 'Direct webhook calls (ping, status)'
    }
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handles POST requests.
 * Only handles direct webhook calls (ping, status).
 * Does NOT handle Chat events — the Hub is purely timer-driven.
 *
 * @param {Object} e - Event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

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
    return hubJsonResponse({ success: false, error: 'Unknown request. Hub is timer-driven — no Chat events handled here.' });

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
// CHAT-BASED REGISTRATION HANDLERS
// (Called by TimerProcessor.scanForRegistrationMessages)
// ============================================================================

/**
 * Handles registration via Chat message.
 * Called by TimerProcessor when it finds a REGISTER message in Chat.
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

    var instanceName = parsed.user || parsed.instanceName;

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
 * Called by TimerProcessor when it finds an UNREGISTER message in Chat.
 *
 * @param {Object} parsed - Parsed message
 * @param {string} messageName - Chat message name for cleanup
 * @returns {Object} Result
 */
function handleChatUnregistration(parsed, messageName) {
  try {
    var result = unregisterUser(parsed.user || parsed.instanceName);

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
