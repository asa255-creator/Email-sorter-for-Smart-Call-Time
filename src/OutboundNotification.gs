/**
 * Smart Call Time - Flow Integrator
 * Outbound Notification Module
 *
 * Handles all outbound notifications to Google Chat webhook.
 * Used to notify Google Flow when there's work to do.
 */

// ============================================================================
// OUTBOUND NOTIFICATIONS
// ============================================================================

/**
 * Gets or generates the instance name.
 * If not configured, generates from user's email.
 * @returns {string} Instance name
 */
function getInstanceName() {
  let instanceName = getConfigValue('instance_name');

  if (!instanceName || instanceName.trim() === '') {
    // Auto-generate from user's email
    try {
      const email = Session.getActiveUser().getEmail();
      if (email) {
        // Use part before @ and sanitize
        instanceName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
      }
    } catch (e) {
      // Fallback to spreadsheet name
      const ss = SpreadsheetApp.getActive();
      if (ss) {
        instanceName = ss.getName().replace(/[^a-zA-Z0-9]/g, '_');
      }
    }

    // Save it for future use
    if (instanceName) {
      setConfigValue('instance_name', instanceName);
    }
  }

  return instanceName || 'Unknown_Instance';
}

/**
 * Builds a simple outbound message for status notifications.
 * @param {string} instanceName - Unique instance identifier
 * @param {string} messageType - Type of notification
 * @param {Object} data - Optional data
 * @returns {string} Formatted message
 */
function buildSimpleMessage(instanceName, messageType, data) {
  let message = `[${instanceName}] ${messageType}`;

  if (data && data.count) {
    message += ` | Count: ${data.count}`;
  }

  return message;
}

/**
 * Gets all labels with descriptions from Labels sheet.
 * @returns {string} Formatted labels list
 */
function getLabelsForNotification() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Labels');
  if (!sheet) return '';

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return '';

  // Columns: A=Label Name, B=Label ID, C=Nested Path, D=Type, E=Description
  const data = sheet.getRange(2, 1, lastRow - 1, 5).getValues();

  const labels = data
    .filter(row => row[0]) // Has label name
    .map(row => {
      const name = row[0];
      const description = row[4] || '';
      return description ? `${name}: ${description}` : name;
    });

  return labels.join('\n');
}

/**
 * Gets the Processing row content from Queue sheet.
 * @returns {Object|null} Email data or null if no Processing row
 */
function getProcessingRowContent() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue');
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  // Find row with Status = "Processing"
  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][5] === 'Processing') { // Column F = Status
      return {
        rowNumber: i + 2,
        emailId: data[i][0],      // Column A
        subject: data[i][1],       // Column B
        from: data[i][2],          // Column C
        date: data[i][3],          // Column D
        context: data[i][7]        // Column H - full email content
      };
    }
  }

  return null;
}

/**
 * Posts a message to the Google Chat webhook.
 * @param {string} webhookUrl - The webhook URL
 * @param {string} message - The message text
 */
function postToChat(webhookUrl, message) {
  try {
    const payload = JSON.stringify({ text: message });

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(webhookUrl, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      logAction('SYSTEM', 'NOTIFY', message);
    } else {
      logAction('SYSTEM', 'NOTIFY_ERROR', `HTTP ${responseCode}: ${response.getContentText()}`);
    }
  } catch (error) {
    logAction('SYSTEM', 'NOTIFY_ERROR', error.message);
  }
}

// ============================================================================
// CONSISTENT CHAT MESSAGE FORMAT
// ============================================================================

/**
 * Builds a chat message using the consistent format.
 *
 * FORMAT: @{instanceName}:[{conversationId}] {MESSAGE_TYPE}
 *
 * - instanceName: identifies which user sheet sent the message
 * - conversationId: groups related messages for cleanup (emailId or UUID)
 * - MESSAGE_TYPE: identifies what action to take
 *
 * This format allows:
 * - Hub to route to the correct user via @instanceName
 * - Hub to group and delete all messages in a conversation via [conversationId]
 * - Google Workspace Flow to filter on MESSAGE_TYPE
 *
 * @param {string} instanceName - User instance name
 * @param {string} conversationId - Conversation/tracking ID (emailId or UUID)
 * @param {string} messageType - Message type (e.g. EMAIL_READY, CONFIRMED)
 * @param {string} [body] - Optional message body after the header line
 * @returns {string} Formatted chat message
 */
function buildChatMessage(instanceName, conversationId, messageType, body) {
  var header = '@' + instanceName + ':[' + conversationId + '] ' + messageType;
  if (body) {
    return header + '\n' + body;
  }
  return header;
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

/**
 * Notifies that an old email is ready for Flow to process.
 * Includes full email content and all labels with descriptions.
 * Called after queueUnlabeledEmails() and promoteNextPending().
 */
function notifyOldEmailReady() {
  const webhookUrl = getConfigValue('chat_webhook_url');
  if (!webhookUrl) {
    logAction('SYSTEM', 'NOTIFY_SKIP', 'No chat_webhook_url configured');
    return;
  }

  const instanceName = getInstanceName();
  const emailData = getProcessingRowContent();

  if (!emailData) {
    logAction('SYSTEM', 'NOTIFY_SKIP', 'No Processing row found');
    return;
  }

  const labels = getLabelsForNotification();

  // Build complete message with all data Flow needs, using consistent format
  const body = `
===== AVAILABLE LABELS =====
${labels}

===== EMAIL TO CATEGORIZE =====
Email ID: ${emailData.emailId}
Subject: ${emailData.subject}
From: ${emailData.from}
Date: ${emailData.date}

${emailData.context}

===== INSTRUCTIONS =====
Respond with: @${instanceName}:[${emailData.emailId}] Label1, Label2
Use ONLY labels from AVAILABLE LABELS above.
If nothing fits, respond with: @${instanceName}:[${emailData.emailId}] NONE`;

  const message = buildChatMessage(instanceName, emailData.emailId, 'EMAIL_READY', body);
  postToChat(webhookUrl, message);
}

/**
 * Notifies that a batch of emails has been queued.
 * @param {number} count - Number of emails queued
 */
function notifyQueueStarted(count) {
  const webhookUrl = getConfigValue('chat_webhook_url');
  if (!webhookUrl) return;

  const instanceName = getInstanceName();
  const batchId = Utilities.getUuid();
  const message = buildChatMessage(instanceName, batchId, 'QUEUE_STARTED', 'Count: ' + count);
  postToChat(webhookUrl, message);
}

/**
 * Notifies that the queue processing is complete.
 */
function notifyQueueComplete() {
  const webhookUrl = getConfigValue('chat_webhook_url');
  if (!webhookUrl) return;

  const instanceName = getInstanceName();
  const batchId = Utilities.getUuid();
  const message = buildChatMessage(instanceName, batchId, 'QUEUE_COMPLETE');
  postToChat(webhookUrl, message);
}
