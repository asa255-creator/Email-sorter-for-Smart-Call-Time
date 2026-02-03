/**
 * Smart Call Time - Flow Integrator
 * API Handler Module
 *
 * Handles web app endpoints (doGet/doPost) for Google Flows integration.
 * Deploy as web app to enable HTTP access.
 */

// ============================================================================
// WEB APP ENDPOINTS
// ============================================================================

/**
 * Handles GET requests to the web app.
 * Returns API status and available labels.
 * @param {Object} e - The event object
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  const labels = getGmailLabels();

  const response = {
    status: 'ok',
    message: 'Smart Call Time - Email Sorter API',
    version: getConfigValue('version') || '1.0.0',
    labels: labels.map(l => ({
      name: l.name,
      id: l.id
    })),
    commands: ['GET_LABELS', 'APPLY_LABELS', 'REMOVE_LABELS']
  };

  return createJsonResponse(response);
}

/**
 * Handles POST requests to the web app.
 * Routes to appropriate command handler.
 * @param {Object} e - The event object with postData
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    // Parse request body
    const data = JSON.parse(e.postData.contents);
    const command = data.command;

    let result;

    switch (command) {
      case 'GET_LABELS':
        result = handleGetLabels();
        break;

      case 'APPLY_LABELS':
        result = handleApplyLabels(data);
        break;

      case 'REMOVE_LABELS':
        result = handleRemoveLabels(data);
        break;

      case 'SYNC_LABELS':
        result = handleSyncLabels();
        break;

      default:
        result = {
          success: false,
          error: 'Unknown command: ' + command,
          validCommands: ['GET_LABELS', 'APPLY_LABELS', 'REMOVE_LABELS', 'SYNC_LABELS']
        };
    }

    return createJsonResponse(result);

  } catch (error) {
    return createJsonResponse({
      success: false,
      error: error.message
    });
  }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Handles GET_LABELS command.
 * Returns all available Gmail labels.
 * @returns {Object} Response object
 */
function handleGetLabels() {
  const labels = getGmailLabels();

  return {
    success: true,
    labels: labels.map(l => ({
      name: l.name,
      id: l.id,
      type: l.type
    }))
  };
}

/**
 * Handles APPLY_LABELS command.
 * Applies specified labels to an email.
 * @param {Object} data - Request data with emailId and labels
 * @returns {Object} Response object
 */
function handleApplyLabels(data) {
  const emailId = data.emailId;
  const labels = data.labels;

  // Validate input
  if (!emailId) {
    return { success: false, error: 'Missing emailId' };
  }

  if (!labels || !Array.isArray(labels)) {
    return { success: false, error: 'Missing or invalid labels array' };
  }

  // Apply labels
  const result = applyLabelsToEmail(emailId, labels);

  return {
    success: true,
    emailId: emailId,
    applied: result.applied,
    notFound: result.notFound
  };
}

/**
 * Handles REMOVE_LABELS command.
 * Removes specified labels from an email.
 * @param {Object} data - Request data with emailId and labels
 * @returns {Object} Response object
 */
function handleRemoveLabels(data) {
  const emailId = data.emailId;
  const labels = data.labels;

  if (!emailId) {
    return { success: false, error: 'Missing emailId' };
  }

  if (!labels || !Array.isArray(labels)) {
    return { success: false, error: 'Missing or invalid labels array' };
  }

  const result = removeLabelsFromEmail(emailId, labels);

  return {
    success: true,
    emailId: emailId,
    removed: result.removed,
    notFound: result.notFound
  };
}

/**
 * Handles SYNC_LABELS command.
 * Triggers a label sync from Gmail to the spreadsheet.
 * @returns {Object} Response object
 */
function handleSyncLabels() {
  const labels = syncLabelsToSheet();

  return {
    success: true,
    message: 'Labels synced',
    count: labels ? labels.length : 0
  };
}

// ============================================================================
// RESPONSE UTILITIES
// ============================================================================

/**
 * Creates a JSON response for the web app.
 * @param {Object} data - The data to return as JSON
 * @returns {TextOutput} ContentService text output
 */
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
