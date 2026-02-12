/**
 * Smart Call Time - Flow Integrator
 * Outbound Notification Module
 *
 * Handles outbound messages to the Google Chat space.
 * Primary message types:
 *   - EMAIL_READY: Posted by QueueProcessor when an email needs labeling
 *   - CONFIRM_COMPLETE: Posted after labels are applied (tells Hub to clean up)
 *   - REGISTER: Registration with the Hub
 *   - CONFIRMED: Test/registration confirmation
 *
 * Dependencies:
 *   - ConfigManager.gs: getConfigValue(), setConfigValue(), getChatWebhookUrl()
 *   - Logger.gs: logAction()
 */

// ============================================================================
// INSTANCE IDENTITY
// ============================================================================

/**
 * Gets or generates the instance name.
 * If not configured, generates from user's email.
 *
 * @returns {string} Instance name
 */
function getInstanceName() {
  var instanceName = getConfigValue('instance_name');

  if (!instanceName || instanceName.trim() === '') {
    try {
      var email = Session.getActiveUser().getEmail();
      if (email) {
        instanceName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      }
    } catch (e) {
      var ss = SpreadsheetApp.getActive();
      if (ss) {
        instanceName = ss.getName().replace(/[^a-zA-Z0-9]/g, '_');
      }
    }

    if (instanceName) {
      setConfigValue('instance_name', instanceName);
    }
  }

  return instanceName || 'Unknown_Instance';
}

// ============================================================================
// LABEL DATA
// ============================================================================

/**
 * Gets all labels with descriptions from Labels sheet.
 * Used when building EMAIL_READY messages for Chat.
 *
 * @returns {string} Formatted labels list (one per line)
 */
function getLabelsForNotification() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Labels');
  if (!sheet) return '';

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return '';

  // Columns: A=Label Name, B=Label ID, C=Nested Path, D=Type, E=Description
  var data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var labels = [];

  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    var name = data[i][0];
    var description = data[i][4] || '';
    labels.push(description ? name + ': ' + description : name);
  }

  return labels.join('\n');
}

// ============================================================================
// CHAT MESSAGE POSTING
// ============================================================================

/**
 * Posts a message to the Google Chat webhook.
 *
 * @param {string} webhookUrl - The webhook URL
 * @param {string} message - The message text
 */
function postToChat(webhookUrl, message) {
  try {
    var payload = JSON.stringify({ text: message });

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(webhookUrl, options);
    var responseCode = response.getResponseCode();

    if (responseCode === 200) {
      logAction('SYSTEM', 'NOTIFY', message.substring(0, 100));
    } else {
      logAction('SYSTEM', 'NOTIFY_ERROR', 'HTTP ' + responseCode + ': ' + response.getContentText());
    }
  } catch (error) {
    logAction('SYSTEM', 'NOTIFY_ERROR', error.message);
  }
}

// ============================================================================
// CONSISTENT CHAT MESSAGE FORMAT
// ============================================================================

/**
 * Builds a chat message using the consistent key-value header format.
 *
 * FORMAT:
 *   user: {instanceName}
 *   conversation_id: {conversationId}
 *   type: {messageType}
 *   status: {status}
 *
 *   {optional body}
 *
 * This is the ONLY function that builds chat messages. If the format
 * changes, update this function and the hub-side parseChatMessage() only.
 *
 * @param {string} instanceName - User instance name
 * @param {string} conversationId - Conversation/tracking ID (emailId or UUID)
 * @param {string} messageType - Message type (e.g. EMAIL_READY, CONFIRM_COMPLETE)
 * @param {string} status - Message status: 'processing' or 'closed'
 * @param {string} [body] - Optional message body after the header
 * @returns {string} Formatted chat message
 */
function buildChatMessage(instanceName, conversationId, messageType, status, body) {
  var header = 'user: ' + instanceName + '\n' +
               'conversation_id: ' + conversationId + '\n' +
               'type: ' + messageType + '\n' +
               'status: ' + (status || 'processing');
  if (body) {
    return header + '\n\n' + body;
  }
  return header;
}
