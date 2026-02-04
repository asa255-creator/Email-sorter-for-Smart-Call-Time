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
 * Sends an outbound notification to the configured Google Chat webhook.
 * @param {string} messageType - Type of notification (e.g., 'OLD_EMAIL_READY')
 * @param {Object} data - Optional data to include
 */
function sendOutboundNotification(messageType, data) {
  const webhookUrl = getConfigValue('chat_webhook_url');
  const instanceName = getConfigValue('instance_name');

  if (!webhookUrl) {
    logAction('SYSTEM', 'NOTIFY_SKIP', 'No chat_webhook_url configured');
    return;
  }

  if (!instanceName) {
    logAction('SYSTEM', 'NOTIFY_SKIP', 'No instance_name configured');
    return;
  }

  const message = buildOutboundMessage(instanceName, messageType, data);
  postToChat(webhookUrl, message);
}

/**
 * Builds the outbound message string.
 * @param {string} instanceName - Unique instance identifier
 * @param {string} messageType - Type of notification
 * @param {Object} data - Optional data
 * @returns {string} Formatted message
 */
function buildOutboundMessage(instanceName, messageType, data) {
  // Format: [instance_name] MESSAGE_TYPE
  // Example: [Johns_Sorter] OLD_EMAIL_READY
  let message = `[${instanceName}] ${messageType}`;

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
