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
  const emailId = emailData.emailId || '';

  // Header using consistent message format
  parts.push(`@${emailData.instanceName}:[${emailId}] EMAIL_READY`);
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

  // Instructions using consistent format
  parts.push('INSTRUCTIONS:');
  parts.push(`Reply with: @${emailData.instanceName}:[${emailId}] Label1, Label2`);
  parts.push(`Reply with: @${emailData.instanceName}:[${emailId}] NONE if no labels apply.`);

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
// MESSAGE LISTING (for timer-based polling)
// ============================================================================

/**
 * Lists recent messages in the Chat space.
 * Used by TimerProcessor to scan for EMAIL_READY, REGISTER, CONFIRM_COMPLETE, etc.
 *
 * @param {number} [pageSize] - Number of messages to retrieve (default 50, max 100)
 * @returns {Object} Result with messages array
 */
function listChatMessages(pageSize) {
  var spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return { success: false, error: 'Chat space ID not configured', messages: [] };
  }

  try {
    var response = Chat.Spaces.Messages.list(spaceId, {
      pageSize: pageSize || 50
    });

    return {
      success: true,
      messages: response.messages || []
    };

  } catch (error) {
    logHub('LIST_MESSAGES_ERROR', error.message);
    return { success: false, error: error.message, messages: [] };
  }
}

// ============================================================================
// EMOJI REACTIONS
// ============================================================================

/**
 * Adds an emoji reaction to a Chat message.
 * Used to add ✅ to EMAIL_READY messages, which triggers Google Flow.
 *
 * @param {string} messageName - Full message name (e.g., "spaces/xxx/messages/yyy")
 * @param {string} [emoji] - Unicode emoji to add (default "✅")
 * @returns {Object} Result with success status
 */
function addReactionToMessage(messageName, emoji) {
  try {
    Chat.Spaces.Messages.Reactions.create(
      { emoji: { unicode: emoji || '\u2705' } },
      messageName
    );

    logHub('REACTION_ADDED', messageName + ' ' + (emoji || '\u2705'));
    return { success: true };

  } catch (error) {
    // ALREADY_EXISTS means we already reacted — not an error
    if (error.message.indexOf('ALREADY_EXISTS') !== -1) {
      return { success: true, alreadyExists: true };
    }
    logHub('REACTION_ERROR', messageName + ': ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Checks if a message already has a specific emoji reaction from the app.
 * Used to avoid double-reacting to EMAIL_READY messages.
 *
 * @param {Object} message - Chat message object (from listChatMessages)
 * @param {string} [emoji] - Unicode emoji to check for (default "✅")
 * @returns {boolean} True if the message already has the reaction
 */
function messageHasReaction(message, emoji) {
  var targetEmoji = emoji || '\u2705';

  if (!message.emojiReactionSummaries) {
    return false;
  }

  for (var i = 0; i < message.emojiReactionSummaries.length; i++) {
    var summary = message.emojiReactionSummaries[i];
    if (summary.emoji && summary.emoji.unicode === targetEmoji) {
      return true;
    }
  }

  return false;
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
function sendCompletionToChat(instanceName, labels, emailId) {
  const spaceId = getHubConfig('chat_space_id');

  if (!spaceId) {
    return { success: false, error: 'Chat space not configured' };
  }

  try {
    const convId = emailId || 'completion';
    const message = Chat.Spaces.Messages.create(
      { text: `@${instanceName}:[${convId}] COMPLETE - Applied "${labels}"` },
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
