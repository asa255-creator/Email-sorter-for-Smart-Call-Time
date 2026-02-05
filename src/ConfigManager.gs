/**
 * Smart Call Time - Flow Integrator
 * Configuration Manager Module
 *
 * Handles reading and writing configuration values from the Config sheet.
 */

// ============================================================================
// CONFIG ACCESS
// ============================================================================

/**
 * Gets a configuration value from the Config sheet.
 * @param {string} key - The configuration key
 * @returns {string|null} The configuration value or null if not found
 */
function getConfigValue(key) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Config');

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
 * Sets a configuration value in the Config sheet.
 * Creates the key if it doesn't exist.
 * @param {string} key - The configuration key
 * @param {string} value - The value to set
 */
function setConfigValue(key, value) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Config');

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();

  // Look for existing key
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  // Key not found, add new row
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
}

/**
 * Gets all configuration values as an object.
 * @returns {Object} Object with all config key-value pairs
 */
function getAllConfig() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Config');

  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  const config = {};

  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      config[data[i][0]] = data[i][1];
    }
  }

  return config;
}

/**
 * Deletes a configuration value.
 * @param {string} key - The configuration key to delete
 */
function deleteConfigValue(key) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Config');

  if (!sheet) return;

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ============================================================================
// ALIAS FUNCTIONS
// ============================================================================

/**
 * Alias for getConfigValue - used by other modules.
 * @param {string} key - The configuration key
 * @returns {string|null} The configuration value or null if not found
 */
function getConfig(key) {
  return getConfigValue(key);
}

/**
 * Alias for setConfigValue - used by other modules.
 * @param {string} key - The configuration key
 * @param {string} value - The value to set
 */
function setConfig(key, value) {
  setConfigValue(key, value);
}

// ============================================================================
// WEBHOOK CONFIG
// ============================================================================

/**
 * Gets the webhook URL for this instance.
 * @returns {string|null} The webhook URL
 */
function getWebhookUrl() {
  return getConfigValue('webhook_url');
}

/**
 * Sets the webhook URL for this instance.
 * @param {string} url - The webhook URL
 */
function setWebhookUrl(url) {
  setConfigValue('webhook_url', url);
}

/**
 * Gets the Central Hub URL.
 * @returns {string|null} The hub URL
 */
function getHubUrl() {
  return getConfigValue('hub_url');
}

/**
 * Sets the Central Hub URL.
 * @param {string} url - The hub URL
 */
function setHubUrl(url) {
  setConfigValue('hub_url', url);
}

/**
 * Gets the instance name for this deployment.
 * Auto-generates from user email if not set.
 * @returns {string} The instance name
 */
function getInstanceName() {
  let name = getConfigValue('instance_name');

  if (!name) {
    // Auto-generate from user email
    const email = Session.getActiveUser().getEmail();
    name = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
    setConfigValue('instance_name', name);
  }

  return name;
}

/**
 * Registers this instance with the Central Hub.
 * Called during setup or reconnect.
 * @param {string} hubUrl - The Hub's web app URL
 * @returns {Object} Registration result
 */
function registerWithHub(hubUrl) {
  if (!hubUrl) {
    return { success: false, error: 'No hub URL provided' };
  }

  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return { success: false, error: 'Webhook URL not set. Deploy as web app first.' };
  }

  const instanceName = getInstanceName();
  const email = Session.getActiveUser().getEmail();
  const sheetId = SpreadsheetApp.getActive().getId();

  try {
    const response = UrlFetchApp.fetch(hubUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'register',
        email: email,
        sheetId: sheetId,
        instanceName: instanceName,
        webhookUrl: webhookUrl
      }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.success) {
      setHubUrl(hubUrl);
      logAction('CONFIG', 'HUB_REGISTERED', `Registered with hub: ${instanceName}`);
    }

    return result;

  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CONFIG DEFAULTS
// ============================================================================

// ============================================================================
// HUB COMMUNICATION
// ============================================================================

/**
 * Notifies the Hub that email processing is complete.
 * Hub will delete related Chat messages and clean up pending request.
 *
 * @param {string} emailId - The email ID that was processed
 * @returns {Object} Result from Hub
 */
function notifyHubComplete(emailId) {
  const hubUrl = getHubUrl();
  if (!hubUrl) {
    logAction('CONFIG', 'HUB_NOTIFY_SKIP', 'No hub URL configured');
    return { success: false, error: 'No hub URL configured' };
  }

  const instanceName = getInstanceName();

  try {
    const response = UrlFetchApp.fetch(hubUrl, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        action: 'confirm_complete',
        instanceName: instanceName,
        emailId: emailId
      }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText());

    if (result.success) {
      logAction(emailId, 'HUB_NOTIFIED', 'Processing complete sent to Hub');
    } else {
      logAction(emailId, 'HUB_NOTIFY_ERROR', result.error || 'Unknown error');
    }

    return result;

  } catch (error) {
    logAction(emailId, 'HUB_NOTIFY_ERROR', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CONFIG DEFAULTS
// ============================================================================

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  rate_limit_ms: '3000',
  batch_size: '50',
  version: '1.0.0'
};

/**
 * Ensures all default config values exist.
 */
function ensureDefaultConfig() {
  Object.keys(DEFAULT_CONFIG).forEach(key => {
    if (!getConfigValue(key)) {
      setConfigValue(key, DEFAULT_CONFIG[key]);
    }
  });
}
