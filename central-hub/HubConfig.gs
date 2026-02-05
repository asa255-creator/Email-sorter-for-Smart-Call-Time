/**
 * Central Hub - Configuration Manager
 *
 * Manages Hub configuration values stored in the HubConfig sheet.
 * Single source for config operations - used by all other modules.
 */

// ============================================================================
// CONFIG CRUD
// ============================================================================

/**
 * Gets a hub configuration value.
 *
 * @param {string} key - Config key
 * @returns {string|null} Config value or null if not found
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
 * Creates the key if it doesn't exist.
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

/**
 * Gets all hub configuration values.
 *
 * @returns {Object} Object with all config key-value pairs
 */
function getAllHubConfig() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('HubConfig');

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
 * Deletes a hub configuration value.
 *
 * @param {string} key - Config key to delete
 */
function deleteHubConfig(key) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('HubConfig');

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
// SPECIFIC CONFIG GETTERS/SETTERS
// ============================================================================

/**
 * Gets the Chat webhook URL.
 * @returns {string|null} Chat webhook URL
 */
function getChatWebhookUrl() {
  return getHubConfig('chat_webhook_url');
}

/**
 * Sets the Chat webhook URL.
 * @param {string} url - Webhook URL
 */
function setChatWebhookUrl(url) {
  setHubConfig('chat_webhook_url', url);
}

/**
 * Gets the Chat space ID.
 * @returns {string|null} Chat space ID
 */
function getChatSpaceId() {
  return getHubConfig('chat_space_id');
}

/**
 * Sets the Chat space ID.
 * @param {string} spaceId - Space ID (format: spaces/XXXXXXX)
 */
function setChatSpaceId(spaceId) {
  setHubConfig('chat_space_id', spaceId);
}

/**
 * Gets the hub version.
 * @returns {string} Hub version
 */
function getHubVersion() {
  return getHubConfig('hub_version') || '1.0.0';
}
