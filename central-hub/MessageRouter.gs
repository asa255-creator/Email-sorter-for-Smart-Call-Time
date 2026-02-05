/**
 * Central Hub - Message Router
 *
 * Parses incoming messages and routes them to the correct user webhook.
 * The Hub is a "dumb pipe" - it just forwards labels, doesn't process them.
 */

// ============================================================================
// MESSAGE ROUTING
// ============================================================================

/**
 * Routes an incoming message to the appropriate user.
 * Parses the message to extract instance name and labels.
 *
 * Expected message formats:
 * 1. "@instance_name: Label1, Label2, Label3"
 * 2. "instance_name: Label1, Label2"
 * 3. Just "Label1, Label2" (uses pending request to determine target)
 *
 * @param {string} message - The incoming message text
 * @param {string} sender - The sender identifier
 * @returns {Object} Routing result
 */
function routeMessage(message, sender) {
  try {
    // Try to parse instance name from message
    const parsed = parseMessage(message);

    if (parsed.instanceName) {
      // Direct routing to named instance
      return routeLabelsToUser(parsed.instanceName, parsed.labels, parsed.emailId);
    }

    // No instance name in message - check pending requests
    const pendingRequest = getOldestPendingRequest();

    if (pendingRequest) {
      // Route to the user who has a pending request
      const result = routeLabelsToUser(
        pendingRequest.instanceName,
        parsed.labels,
        pendingRequest.emailId
      );

      if (result.success) {
        // Mark request as completed
        completePendingRequest(pendingRequest.requestId);
      }

      return result;
    }

    return {
      success: false,
      error: 'Could not determine target user. Include @instance_name in message or ensure there is a pending request.'
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Routes labels directly to a user's webhook.
 *
 * @param {string} instanceName - Target instance name
 * @param {string} labels - Labels to send
 * @param {string} emailId - Optional email ID
 * @returns {Object} Routing result
 */
function routeLabelsToUser(instanceName, labels, emailId) {
  // Get user from registry
  const user = getUserByInstance(instanceName);

  if (!user) {
    return {
      success: false,
      error: `User not found: ${instanceName}`,
      instanceName: instanceName
    };
  }

  if (!user.webhookUrl) {
    return {
      success: false,
      error: `No webhook URL for user: ${instanceName}`,
      instanceName: instanceName
    };
  }

  // Call user's webhook
  try {
    const payload = {
      action: 'update_labels',
      labels: labels,
      emailId: emailId || '',
      fromHub: true,
      timestamp: new Date().toISOString()
    };

    const response = UrlFetchApp.fetch(user.webhookUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        result = { rawResponse: responseText };
      }

      logHub('ROUTED_SUCCESS', `${instanceName}: ${labels}`);

      return {
        success: true,
        instanceName: instanceName,
        labels: labels,
        webhookResponse: result
      };
    } else {
      logHub('ROUTED_FAILED', `${instanceName}: HTTP ${responseCode}`);

      return {
        success: false,
        error: `Webhook returned HTTP ${responseCode}`,
        instanceName: instanceName,
        responseText: responseText
      };
    }

  } catch (error) {
    logHub('ROUTE_ERROR', `${instanceName}: ${error.message}`);

    return {
      success: false,
      error: `Failed to call webhook: ${error.message}`,
      instanceName: instanceName
    };
  }
}

// ============================================================================
// MESSAGE PARSING
// ============================================================================

/**
 * Parses a message to extract instance name and labels.
 *
 * @param {string} message - Raw message text
 * @returns {Object} Parsed message with instanceName, labels, emailId
 */
function parseMessage(message) {
  const trimmed = message.trim();

  // Pattern 1: @instance_name: labels
  // Pattern 2: instance_name: labels
  const colonMatch = trimmed.match(/^@?([a-zA-Z0-9_]+):\s*(.+)$/);

  if (colonMatch) {
    const instanceName = colonMatch[1];
    const labelsText = colonMatch[2];

    // Check if there's an email ID in brackets
    const idMatch = labelsText.match(/\[([^\]]+)\]\s*(.+)/);

    if (idMatch) {
      return {
        instanceName: instanceName,
        emailId: idMatch[1],
        labels: idMatch[2].trim()
      };
    }

    return {
      instanceName: instanceName,
      emailId: null,
      labels: labelsText.trim()
    };
  }

  // Pattern 3: [emailId] labels
  const idOnlyMatch = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);

  if (idOnlyMatch) {
    return {
      instanceName: null,
      emailId: idOnlyMatch[1],
      labels: idOnlyMatch[2].trim()
    };
  }

  // Pattern 4: Just labels (no instance name or email ID)
  return {
    instanceName: null,
    emailId: null,
    labels: trimmed
  };
}

/**
 * Validates that labels look reasonable.
 *
 * @param {string} labels - Labels string
 * @returns {boolean} True if labels look valid
 */
function validateLabels(labels) {
  if (!labels || labels.trim() === '') {
    return false;
  }

  // Check for obviously invalid responses
  const invalid = ['error', 'failed', 'sorry', 'cannot', 'unable'];

  const lower = labels.toLowerCase();
  for (const word of invalid) {
    if (lower.startsWith(word)) {
      return false;
    }
  }

  return true;
}
