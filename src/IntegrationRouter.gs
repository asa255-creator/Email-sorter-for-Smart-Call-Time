/**
 * Smart Call Time - Flow Integrator
 * Integration Router Module
 *
 * Routes integration calls based on configuration.
 * Handles routing for both outbound and inbound communications.
 *
 * OUTBOUND (Script -> Flow):
 * - Always uses Google Chat webhook notification
 * - Configured via chat_webhook_url and instance_name
 *
 * INBOUND (Flow -> Script):
 * - direct_sheet_edit: Flow writes to Queue sheet, timer picks up changes
 * - chat_webhook_listener: (Future) Receives webhook from Chat listener
 */

// ============================================================================
// CONFIGURATION GETTERS
// ============================================================================

/**
 * Gets the configured inbound method.
 * @returns {string} 'direct_sheet_edit' or 'chat_webhook_listener'
 */
function getInboundMethod() {
  return getConfigValue('inbound_method') || 'direct_sheet_edit';
}

/**
 * Gets the configured instance name.
 * @returns {string} The instance name or empty string
 */
function getInstanceName() {
  return getConfigValue('instance_name') || '';
}

/**
 * Gets the configured chat webhook URL.
 * @returns {string} The webhook URL or empty string
 */
function getChatWebhookUrl() {
  return getConfigValue('chat_webhook_url') || '';
}

// ============================================================================
// INBOUND ROUTING
// ============================================================================

/**
 * Checks for inbound label data based on configured method.
 * Routes to appropriate inbound handler.
 * @returns {Object} Result with found status and row number if found
 */
function checkForInboundLabels() {
  const inboundMethod = getInboundMethod();

  switch (inboundMethod) {
    case 'direct_sheet_edit':
      return directSheet_checkForLabels();

    case 'chat_webhook_listener':
      // Future: Would check for webhook data
      // For now, fall back to direct sheet check
      logAction('SYSTEM', 'WARN', 'chat_webhook_listener not implemented, using direct_sheet_edit');
      return directSheet_checkForLabels();

    default:
      logAction('SYSTEM', 'ERROR', `Unknown inbound_method: ${inboundMethod}`);
      return { found: false, rowNumber: null };
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates that outbound notifications are properly configured.
 * @returns {Object} Validation result with isValid and errors array
 */
function validateOutboundConfig() {
  const errors = [];

  const webhookUrl = getChatWebhookUrl();
  if (!webhookUrl) {
    errors.push('chat_webhook_url is not configured');
  }

  const instanceName = getInstanceName();
  if (!instanceName) {
    errors.push('instance_name is not configured');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validates that inbound is properly configured.
 * @returns {Object} Validation result with isValid and errors array
 */
function validateInboundConfig() {
  const errors = [];
  const inboundMethod = getInboundMethod();

  if (inboundMethod === 'chat_webhook_listener') {
    errors.push('chat_webhook_listener is not yet implemented');
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}
