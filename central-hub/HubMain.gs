/**
 * Central Hub - Main Entry Points
 *
 * The Hub is deployed as a Google Chat App AND Web App.
 * - Chat App: Receives messages from AI in the shared Chat space
 * - Web App: Receives registration requests from user instances
 *
 * The Hub is a "dumb pipe" - it routes messages to user webhooks.
 * All business logic for processing emails stays on user sheets.
 */

// ============================================================================
// CHAT APP ENTRY POINTS
// ============================================================================

/**
 * Handles messages sent to the Chat app.
 * Called when AI responds with labels in the shared Chat space.
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Response message
 */
function onMessage(event) {
  try {
    const message = event.message.text;
    const sender = event.user.email || event.user.displayName;
    const messageName = event.message.name; // Track for cleanup

    logHub('MESSAGE_RECEIVED', `From: ${sender}, Message: ${message.substring(0, 100)}...`);

    // Parse the AI response to extract labels and target user
    const routeResult = routeMessage(message, sender);

    if (routeResult.success) {
      // Track this AI response message for later cleanup
      if (messageName && routeResult.instanceName) {
        appendMessageToPending(routeResult.instanceName, messageName);
      }

      return {
        text: `Routed to ${routeResult.instanceName}: ${routeResult.labels}`
      };
    } else {
      return {
        text: `Could not route message: ${routeResult.error}`
      };
    }

  } catch (error) {
    logHub('MESSAGE_ERROR', error.message);
    return {
      text: `Error: ${error.message}`
    };
  }
}

/**
 * Handles the app being added to a space.
 * Function name MUST match Google Cloud Console trigger: "onAddedToSpace"
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Welcome message
 */
function onAddedToSpace(event) {
  const spaceName = event.space.displayName || event.space.name;

  // Auto-save the space ID for sending messages
  if (event.space.name) {
    setHubConfig('chat_space_id', event.space.name);
    logHub('SPACE_ID_SAVED', event.space.name);
  }

  logHub('ADDED_TO_SPACE', spaceName);

  return {
    text: 'Smart Call Time Hub is ready! Users can register their instances, and I will route AI label responses to their sheets.'
  };
}

/**
 * Handles the app being removed from a space.
 * Function name MUST match Google Cloud Console trigger: "onRemovedFromSpace"
 *
 * @param {Object} event - Chat event object
 */
function onRemovedFromSpace(event) {
  logHub('REMOVED_FROM_SPACE', event.space.name);
}

/**
 * Handles slash commands (app commands).
 * Function name MUST match Google Cloud Console trigger: "onAppCommand"
 *
 * @param {Object} event - Chat event object
 * @returns {Object} Response message
 */
function onAppCommand(event) {
  const commandId = event.message?.slashCommand?.commandId || 'unknown';

  logHub('APP_COMMAND', `Command ID: ${commandId}`);

  // Currently no slash commands configured - can add later
  return {
    text: 'No commands configured yet. Tag me with @instance_name: Label1, Label2 to route labels.'
  };
}

// ============================================================================
// WEB APP ENTRY POINTS
// ============================================================================

/**
 * Handles POST requests to the Hub web app.
 * Used for user registration and direct API calls.
 *
 * @param {Object} e - Event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    logHub('POST_RECEIVED', `Action: ${action}`);

    switch (action) {
      case 'register':
        return handleRegistration(data);

      case 'unregister':
        return handleUnregistration(data);

      case 'ping':
        return jsonResponse({ success: true, status: 'Hub is running' });

      case 'route_labels':
        // Direct API call to route labels (for testing or Flow integration)
        const routeResult = routeLabelsToUser(data.instanceName, data.labels, data.emailId);
        return jsonResponse(routeResult);

      case 'confirm_complete':
        // User confirms labels were applied - clean up chat messages
        const completeResult = handleConfirmComplete(data);
        return jsonResponse(completeResult);

      default:
        return jsonResponse({ success: false, error: `Unknown action: ${action}` });
    }

  } catch (error) {
    logHub('POST_ERROR', error.message);
    return jsonResponse({ success: false, error: error.message });
  }
}

/**
 * Handles GET requests (status check).
 *
 * @param {Object} e - Event object
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  const userCount = getRegisteredUserCount();

  return jsonResponse({
    status: 'Smart Call Time Hub is running',
    registeredUsers: userCount,
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST / action=register': 'Register a user instance',
      'POST / action=unregister': 'Unregister a user instance',
      'POST / action=route_labels': 'Route labels to a user',
      'GET /': 'Status check (this response)'
    }
  });
}

// ============================================================================
// REGISTRATION HANDLERS
// ============================================================================

/**
 * Handles user registration.
 *
 * @param {Object} data - Registration data
 * @returns {TextOutput} JSON response
 */
function handleRegistration(data) {
  const { email, sheetId, instanceName, webhookUrl } = data;

  if (!email || !webhookUrl) {
    return jsonResponse({ success: false, error: 'Missing required fields: email, webhookUrl' });
  }

  const result = registerUser({
    email: email,
    sheetId: sheetId || '',
    instanceName: instanceName || email.split('@')[0],
    webhookUrl: webhookUrl,
    registeredAt: new Date().toISOString()
  });

  return jsonResponse(result);
}

/**
 * Handles user unregistration.
 *
 * @param {Object} data - Unregistration data
 * @returns {TextOutput} JSON response
 */
function handleUnregistration(data) {
  const { email, instanceName } = data;

  if (!email && !instanceName) {
    return jsonResponse({ success: false, error: 'Must provide email or instanceName' });
  }

  const result = unregisterUser(email || instanceName);
  return jsonResponse(result);
}

/**
 * Handles confirmation that labels were applied.
 * Deletes the related chat messages and removes the pending request.
 *
 * @param {Object} data - Completion data
 * @param {string} data.instanceName - Instance that completed
 * @param {string} data.emailId - Email ID that was processed
 * @returns {Object} Result
 */
function handleConfirmComplete(data) {
  const { instanceName, emailId } = data;

  if (!instanceName || !emailId) {
    return { success: false, error: 'Missing instanceName or emailId' };
  }

  try {
    // Get the pending request to find message IDs
    const pendingRequest = getPendingRequestByEmailId(instanceName, emailId);

    if (!pendingRequest) {
      logHub('CONFIRM_COMPLETE', `No pending request found for ${instanceName}/${emailId}`);
      return { success: true, message: 'No pending request found (may already be cleaned up)' };
    }

    // Delete the chat messages
    if (pendingRequest.messageNames && pendingRequest.messageNames.length > 0) {
      const deleteResult = deleteChatMessages(pendingRequest.messageNames);
      logHub('MESSAGES_DELETED', `${instanceName}: ${deleteResult.deleted} messages deleted`);
    }

    // Remove from pending sheet
    removePendingRequest(instanceName, emailId);

    logHub('CONFIRM_COMPLETE', `${instanceName}/${emailId} - cleaned up`);

    return {
      success: true,
      message: 'Request completed and chat messages cleaned up'
    };

  } catch (error) {
    logHub('CONFIRM_ERROR', `${instanceName}/${emailId}: ${error.message}`);
    return { success: false, error: error.message };
  }
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
  // They get consented as part of the same OAuth flow

  Logger.log('All Hub scopes authorized successfully.');
  return { status: 'authorized', scopes: 'spreadsheets, urlfetch, chat' };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Creates a JSON response.
 *
 * @param {Object} data - Response data
 * @returns {TextOutput} JSON text output
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Logs hub activity.
 *
 * @param {string} action - Action type
 * @param {string} details - Details
 */
function logHub(action, details) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('HubLog');

  if (!sheet) {
    console.log(`[HUB ${action}] ${details}`);
    return;
  }

  sheet.appendRow([
    new Date(),
    action,
    details
  ]);

  // Keep log manageable
  const maxRows = 1000;
  const lastRow = sheet.getLastRow();
  if (lastRow > maxRows) {
    sheet.deleteRows(2, lastRow - maxRows);
  }
}
