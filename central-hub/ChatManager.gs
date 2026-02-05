/**
 * Central Hub - Chat Manager
 *
 * Manages sending messages to the shared Chat space.
 * Used to forward email content to AI for categorization.
 *
 * Dependencies:
 *   - HubConfig.gs: getChatWebhookUrl(), getHubConfig(), setHubConfig()
 *   - PendingRequests.gs: createPendingRequest()
 *   - HubMain.gs: logHub()
 */

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
