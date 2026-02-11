/**
 * Smart Call Time - Flow Integrator
 * Configuration Manager Module
 *
 * Handles reading and writing configuration values from the Config sheet.
 *
 * Webhook URLs are stored in the Config sheet:
 * - chat_webhook_url: Google Chat space webhook for posting messages
 * - webhook_url: This instance's deployed web app URL (for receiving from Hub)
 *
 * The Hub does NOT have a web app. All communication TO the Hub goes through
 * Google Chat messages. The Hub sends webhooks TO this instance.
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
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Config');

  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
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
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Config');

  if (!sheet) return;

  var data = sheet.getDataRange().getValues();

  // Look for existing key
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  // Key not found, add new row
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, 1, 2).setValues([[key, value]]);
}

/**
 * Gets all configuration values as an object.
 * @returns {Object} Object with all config key-value pairs
 */
function getAllConfig() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Config');

  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var config = {};

  for (var i = 1; i < data.length; i++) {
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
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName('Config');

  if (!sheet) return;

  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
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
 * Gets the webhook URL for this instance (our deployed web app URL).
 * Hub sends webhooks TO this URL.
 * Stored in Config sheet under key 'webhook_url'.
 *
 * If the Config sheet value is empty, attempts to auto-detect from
 * ScriptApp.getService().getUrl() and saves it to the Config sheet.
 *
 * @returns {string|null} The webhook URL
 */
function getWebhookUrl() {
  var url = getConfigValue('webhook_url');
  if (url) return url;

  // Auto-detect: ScriptApp.getService().getUrl() returns the web app URL
  // when the script is deployed as a web app.
  url = detectWebAppUrl();
  if (url) {
    setConfigValue('webhook_url', url);
    logAction('CONFIG', 'WEBHOOK_AUTO_DETECT', 'Auto-detected web app URL: ' + url);
  }
  return url;
}

/**
 * Detects the deployed web app URL using ScriptApp.
 * Returns null if the script is not deployed as a web app.
 * @returns {string|null} The detected URL or null
 */
function detectWebAppUrl() {
  try {
    var url = ScriptApp.getService().getUrl();
    if (url && url.indexOf('script.google.com') !== -1) {
      return url;
    }
  } catch (e) {
    // Not deployed as web app, or insufficient permissions
  }
  return null;
}

/**
 * Sets the webhook URL for this instance.
 * @param {string} url - The webhook URL
 */
function setWebhookUrl(url) {
  setConfigValue('webhook_url', url);
}

/**
 * Gets the Google Chat webhook URL for posting messages to the chat space.
 * Stored in Config sheet under key 'chat_webhook_url'.
 * @returns {string|null} The chat webhook URL
 */
function getChatWebhookUrl() {
  return getConfigValue('chat_webhook_url');
}

/**
 * Gets the instance name for this deployment.
 * Auto-generates from user email if not set.
 * @returns {string} The instance name
 */
function getInstanceName() {
  var name = getConfigValue('instance_name');

  if (!name) {
    // Auto-generate from user email
    var email = Session.getActiveUser().getEmail();
    name = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
    setConfigValue('instance_name', name);
  }

  return name;
}

// ============================================================================
// REGISTRATION VIA CHAT
// ============================================================================

/**
 * Registers this instance with the Hub by posting a REGISTER message to Google Chat.
 *
 * The Hub has NO web app - all communication goes through Chat.
 * Registration message format:
 *   @instanceName:[register] REGISTER
 *   email=user@example.com
 *   webhook=https://script.google.com/macros/s/.../exec
 *   sheetId=SPREADSHEET_ID
 *
 * The Hub's onMessage() handler will:
 * 1. Parse the registration data
 * 2. Store it in the Registry sheet (webhook URL stored in Hub's Google Sheet)
 * 3. Send a confirmation webhook to our webhook URL
 * 4. Delete the registration chat message
 *
 * @returns {Object} Result
 */
function registerWithHub() {
  var chatWebhookUrl = getChatWebhookUrl();
  if (!chatWebhookUrl) {
    return { success: false, error: 'No chat_webhook_url configured. Set it in the Config sheet.' };
  }

  var webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    return { success: false, error: 'Webhook URL not set in Config sheet. Use Settings > Set Webhook URL.' };
  }

  var instanceName = getInstanceName();
  var email = Session.getActiveUser().getEmail();
  var sheetId = SpreadsheetApp.getActive().getId();

  // Build registration message using consistent chat format
  var body = 'email=' + email + '\n' +
             'webhook=' + webhookUrl + '\n' +
             'sheetId=' + sheetId;

  var message = buildChatMessage(instanceName, 'register', 'REGISTER', body);

  // Post to Google Chat (Hub will see it via onMessage)
  postToChat(chatWebhookUrl, message);

  logAction('CONFIG', 'REGISTER_SENT', 'Registration posted to chat for ' + instanceName);

  return {
    success: true,
    message: 'Registration message sent to Chat. Hub will confirm via webhook.',
    instanceName: instanceName
  };
}

// ============================================================================
// HUB COMMUNICATION VIA CHAT
// ============================================================================

/**
 * Notifies the Hub that email processing is complete by posting to Chat.
 * Hub will delete related Chat messages and clean up pending request.
 *
 * Posts: @instanceName:[emailId] CONFIRM_COMPLETE
 *
 * @param {string} emailId - The email ID that was processed
 * @returns {Object} Result
 */
function notifyHubComplete(emailId) {
  var chatWebhookUrl = getChatWebhookUrl();
  if (!chatWebhookUrl) {
    logAction('CONFIG', 'HUB_NOTIFY_SKIP', 'No chat_webhook_url configured');
    return { success: false, error: 'No chat_webhook_url configured' };
  }

  var instanceName = getInstanceName();

  // Post CONFIRM_COMPLETE to chat - Hub's onMessage will handle cleanup
  var message = buildChatMessage(instanceName, emailId, 'CONFIRM_COMPLETE');
  postToChat(chatWebhookUrl, message);

  logAction(emailId, 'HUB_NOTIFIED', 'CONFIRM_COMPLETE posted to chat');

  return { success: true };
}

// ============================================================================
// CONFIG DEFAULTS
// ============================================================================

/**
 * Default configuration values.
 */
var DEFAULT_CONFIG = {
  rate_limit_ms: '3000',
  batch_size: '50',
  version: '1.0.0'
};

/**
 * Ensures all default config values exist.
 */
function ensureDefaultConfig() {
  Object.keys(DEFAULT_CONFIG).forEach(function(key) {
    if (!getConfigValue(key)) {
      setConfigValue(key, DEFAULT_CONFIG[key]);
    }
  });
}
