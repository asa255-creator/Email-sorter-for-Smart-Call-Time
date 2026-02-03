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
