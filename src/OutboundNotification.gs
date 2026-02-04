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
 * Sends an outbound notification to the configured Google Chat webhook.
 * @param {string} messageType - Type of notification (e.g., 'OLD_EMAIL_READY')
 * @param {Object} data - Optional data to include
 */
function sendOutboundNotification(messageType, data) {
  const webhookUrl = getConfigValue('chat_webhook_url');

  if (!webhookUrl) {
    logAction('SYSTEM', 'NOTIFY_SKIP', 'No chat_webhook_url configured');
    return;
  }

  const instanceName = getInstanceName();
  const message = buildOutboundMessage(instanceName, messageType, data);
  postToChat(webhookUrl, message);
}

/**
 * Builds the outbound message string with all info Flow needs.
 * @param {string} instanceName - Unique instance identifier
 * @param {string} messageType - Type of notification
 * @param {Object} data - Optional data
 * @returns {string} Formatted message
 */
function buildOutboundMessage(instanceName, messageType, data) {
  const ss = SpreadsheetApp.getActive();
  const spreadsheetId = ss ? ss.getId() : 'unknown';
  const spreadsheetUrl = ss ? ss.getUrl() : 'unknown';

  // Format: [instance_name] MESSAGE_TYPE | Sheet: spreadsheet_id | URL: url
  // This gives Flow all the info it needs to work with the right sheet
  let message = `[${instanceName}] ${messageType}`;
  message += ` | SheetID: ${spreadsheetId}`;
  message += ` | URL: ${spreadsheetUrl}`;

  // Add optional data if provided
  if (data && data.count) {
    message += ` | Count: ${data.count}`;
  }

  return message;
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
// NOTIFICATION TYPES
// ============================================================================

/**
 * Notifies that an old email is ready for Flow to process.
 * Called after queueUnlabeledEmails() and promoteNextPending().
 */
function notifyOldEmailReady() {
  sendOutboundNotification('OLD_EMAIL_READY', {});
}

/**
 * Notifies that a batch of emails has been queued.
 * @param {number} count - Number of emails queued
 */
function notifyQueueStarted(count) {
  sendOutboundNotification('QUEUE_STARTED', { count: count });
}

/**
 * Notifies that the queue processing is complete.
 */
function notifyQueueComplete() {
  sendOutboundNotification('QUEUE_COMPLETE', {});
}
