/**
 * Central Hub - Chat Manager
 *
 * Manages sending and deleting messages in the shared Chat space.
 * Uses Chat API (not webhook) to get message IDs for cleanup.
 *
 * Dependencies:
 *   - HubConfig.gs: getHubConfig(), getChatSpaceId()
 *   - PendingRequests.gs: createPendingRequest()
 *   - HubMain.gs: logHub()
 */

// ============================================================================
// MESSAGE SENDING (via Chat API)
// ============================================================================

/**
 * Sends an email to the Chat space for AI categorization.
 * Uses Chat API to get message ID for later deletion.
 *
 * @param {Object} emailData - Email data to send
 * @param {string} emailData.instanceName - Source instance
 * @param {string} emailData.emailId - Email ID
 * @param {string} emailData.subject - Email subject
 * @param {string} emailData.from - Sender
 * @param {string} emailData.body - Email body (truncated)
 * @param {string} emailData.labels - Available labels with descriptions
 * @returns {Object} Result with success status and messageName
 */
function sendEmailToChat(emailData) {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return {
      success: false,
      error: 'Chat space ID not configured. Run Hub Admin > Configure Chat Space first.'
    };
  }

  try {
    // Build the message for AI
    const messageText = formatEmailForAI(emailData);

    // Send via Chat API (returns message with name/ID)
    const message = Chat.Spaces.Messages.create(
      { text: messageText },
      spaceId
    );

    const messageName = message.name;

    // Create pending request with message name for later cleanup
    createPendingRequest(emailData.instanceName, emailData.emailId, {
      subject: emailData.subject,
      sentAt: new Date().toISOString(),
      messageNames: [messageName]
    });

    logHub('CHAT_SENT', `${emailData.instanceName}: ${emailData.subject} (${messageName})`);

    return {
      success: true,
      message: 'Email sent to Chat for categorization',
      messageName: messageName
    };

  } catch (error) {
    logHub('CHAT_SEND_ERROR', error.message);
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
  parts.push(`📧 @${emailData.instanceName} needs categorization:`);
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
  parts.push('Reply "NONE" if no labels apply.');

  return parts.join('\n');
}

// ============================================================================
// MESSAGE DELETION
// ============================================================================

/**
 * Deletes chat messages by their names/IDs.
 * Called when labels have been applied and cleanup is requested.
 *
 * @param {string[]} messageNames - Array of message names (e.g., "spaces/xxx/messages/yyy")
 * @returns {Object} Result with count of deleted messages
 */
function deleteChatMessages(messageNames) {
  if (!messageNames || messageNames.length === 0) {
    return { success: true, deleted: 0 };
  }

  let deleted = 0;
  const errors = [];

  for (const messageName of messageNames) {
    try {
      Chat.Spaces.Messages.remove(messageName);
      deleted++;
      logHub('MESSAGE_DELETED', messageName);
    } catch (error) {
      // Message may already be deleted or not found
      if (error.message.includes('NOT_FOUND')) {
        logHub('MESSAGE_NOT_FOUND', messageName);
      } else {
        errors.push(`${messageName}: ${error.message}`);
        logHub('DELETE_ERROR', `${messageName}: ${error.message}`);
      }
    }
  }

  return {
    success: errors.length === 0,
    deleted: deleted,
    errors: errors.length > 0 ? errors : undefined
  };
}

// ============================================================================
// STATUS MESSAGES
// ============================================================================

/**
 * Sends a status message to Chat (doesn't track for deletion).
 *
 * @param {string} messageText - Status message
 * @returns {Object} Result
 */
function sendStatusToChat(messageText) {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return { success: false, error: 'Chat space not configured' };
  }

  try {
    Chat.Spaces.Messages.create(
      { text: messageText },
      spaceId
    );

    return { success: true };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Sends a completion confirmation to Chat (brief, will auto-delete).
 *
 * @param {string} instanceName - Instance that completed
 * @param {string} labels - Labels that were applied
 * @returns {Object} Result with messageName
 */
function sendCompletionToChat(instanceName, labels) {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return { success: false, error: 'Chat space not configured' };
  }

  try {
    const message = Chat.Spaces.Messages.create(
      { text: `✓ ${instanceName}: Applied "${labels}"` },
      spaceId
    );

    return {
      success: true,
      messageName: message.name
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}
