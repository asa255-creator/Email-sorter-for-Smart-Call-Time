/**
 * Central Hub - Chat Manager
 *
 * Manages sending messages to the shared Chat space.
 * Used to forward email content to AI for categorization.
 */

// ============================================================================
// CHAT SPACE CONFIGURATION
// ============================================================================

/**
 * Gets the configured Chat space webhook URL.
 *
 * @returns {string|null} Chat webhook URL
 */
function getChatWebhookUrl() {
  return getHubConfig('chat_webhook_url');
}

/**
 * Sets the Chat space webhook URL.
 *
 * @param {string} url - Webhook URL
 */
function setChatWebhookUrl(url) {
  setHubConfig('chat_webhook_url', url);
}

// ============================================================================
// MESSAGE SENDING
// ============================================================================

/**
 * Sends an email to the Chat space for AI categorization.
 * Called when a user's sheet has an email ready for processing.
 *
 * @param {Object} emailData - Email data to send
 * @param {string} emailData.instanceName - Source instance
 * @param {string} emailData.emailId - Email ID
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.from - Sender
 * @param {string} emailData.body - Email body (truncated)
 * @param {string} emailData.labels - Available labels with descriptions
 * @returns {Object} Result with success status
 */
function sendEmailToChat(emailData) {
  const webhookUrl = getChatWebhookUrl();

  if (!webhookUrl) {
    return {
      success: false,
      error: 'Chat webhook URL not configured. Run Hub Setup first.'
    };
  }

  try {
    // Build the message for AI
    const message = formatEmailForAI(emailData);

    // Send to Chat space
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        text: message
      })
    });

    if (response.getResponseCode() === 200) {
      // Create pending request to track this
      createPendingRequest(emailData.instanceName, emailData.emailId, {
        subject: emailData.subject,
        sentAt: new Date().toISOString()
      });

      logHub('CHAT_SENT', `${emailData.instanceName}: ${emailData.subject}`);

      return { success: true, message: 'Email sent to Chat for categorization' };
    } else {
      return {
        success: false,
        error: `Chat webhook returned ${response.getResponseCode()}`
      };
    }

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Formats email data for AI categorization.
 *
 * @param {Object} emailData - Email data
 * @returns {string} Formatted message
 */
function formatEmailForAI(emailData) {
  const parts = [];

  // Header with instance identifier
  parts.push(`@${emailData.instanceName} needs categorization:`);
  parts.push('');

  // Available labels
  if (emailData.labels) {
    parts.push('AVAILABLE LABELS:');
    parts.push(emailData.labels);
    parts.push('');
  }

  // Email content
  parts.push('EMAIL TO CATEGORIZE:');
  parts.push(`From: ${emailData.from || 'Unknown'}`);
  parts.push(`Subject: ${emailData.subject || '(no subject)'}`);
  parts.push('');

  if (emailData.body) {
    parts.push('Body:');
    parts.push(emailData.body.substring(0, 1000)); // Limit body length
    parts.push('');
  }

  // Instructions
  parts.push('INSTRUCTIONS:');
  parts.push(`Reply with: @${emailData.instanceName}: Label1, Label2`);
  parts.push('Or just the labels if this is the only pending request.');
  parts.push('Reply "NONE" if no labels apply.');

  return parts.join('\n');
}

/**
 * Sends a status message to Chat.
 *
 * @param {string} message - Status message
 * @returns {Object} Result
 */
function sendStatusToChat(message) {
  const webhookUrl = getChatWebhookUrl();

  if (!webhookUrl) {
    return { success: false, error: 'Chat webhook not configured' };
  }

  try {
    UrlFetchApp.fetch(webhookUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ text: message })
    });

    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// HUB CONFIG HELPERS
// ============================================================================

/**
 * Gets a hub configuration value.
 *
 * @param {string} key - Config key
 * @returns {string|null} Config value
 */
function getHubConfig(key) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('HubConfig');

  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      return data[i][1];
    }
  }

  return null;
}

/**
 * Sets a hub configuration value.
 *
 * @param {string} key - Config key
 * @param {string} value - Config value
 */
function setHubConfig(key, value) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName('HubConfig');

  if (!sheet) {
    sheet = ss.insertSheet('HubConfig');
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  }

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value]);
}
