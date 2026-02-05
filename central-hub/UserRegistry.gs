/**
 * Central Hub - User Registry
 *
 * Manages the registry of user instances.
 * Stores email, webhook URL, instance name, and registration status.
 */

// ============================================================================
// USER CRUD OPERATIONS
// ============================================================================

/**
 * Registers a new user or updates existing registration.
 *
 * @param {Object} userData - User data
 * @param {string} userData.email - User email
 * @param {string} userData.sheetId - User's spreadsheet ID
 * @param {string} userData.instanceName - Instance identifier
 * @param {string} userData.webhookUrl - Webhook URL for callbacks
 * @returns {Object} Result with success status
 */
function registerUser(userData) {
  try {
    const sheet = getOrCreateRegistrySheet();
    const { email, sheetId, instanceName, webhookUrl } = userData;

    // Check if user already exists
    const existingRow = findUserRow(email, instanceName);

    if (existingRow) {
      // Update existing registration
      const rowNum = existingRow.row;
      sheet.getRange(rowNum, 1, 1, 6).setValues([[
        email,
        instanceName,
        sheetId,
        webhookUrl,
        'active',
        new Date().toISOString()
      ]]);

      logHub('USER_UPDATED', `${instanceName} (${email})`);

      return {
        success: true,
        message: 'Registration updated',
        instanceName: instanceName
      };
    }

    // New registration
    sheet.appendRow([
      email,
      instanceName,
      sheetId,
      webhookUrl,
      'active',
      new Date().toISOString()
    ]);

    logHub('USER_REGISTERED', `${instanceName} (${email})`);

    return {
      success: true,
      message: 'User registered successfully',
      instanceName: instanceName
    };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Unregisters a user.
 *
 * @param {string} identifier - Email or instance name
 * @returns {Object} Result with success status
 */
function unregisterUser(identifier) {
  try {
    const sheet = getOrCreateRegistrySheet();
    const existingRow = findUserRow(identifier, identifier);

    if (!existingRow) {
      return { success: false, error: 'User not found' };
    }

    // Set status to inactive instead of deleting
    sheet.getRange(existingRow.row, 5).setValue('inactive');

    logHub('USER_UNREGISTERED', identifier);

    return { success: true, message: 'User unregistered' };

  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Gets a user by email or instance name.
 *
 * @param {string} identifier - Email or instance name
 * @returns {Object|null} User data or null if not found
 */
function getUser(identifier) {
  const row = findUserRow(identifier, identifier);
  return row ? row.data : null;
}

/**
 * Gets a user by instance name only.
 *
 * @param {string} instanceName - Instance name
 * @returns {Object|null} User data or null if not found
 */
function getUserByInstance(instanceName) {
  const sheet = getOrCreateRegistrySheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === instanceName && data[i][4] === 'active') {
      return {
        email: data[i][0],
        instanceName: data[i][1],
        sheetId: data[i][2],
        webhookUrl: data[i][3],
        status: data[i][4],
        registeredAt: data[i][5]
      };
    }
  }

  return null;
}

/**
 * Gets all active users.
 *
 * @returns {Array} Array of user objects
 */
function getAllActiveUsers() {
  const sheet = getOrCreateRegistrySheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return [];

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const users = [];

  for (let i = 0; i < data.length; i++) {
    if (data[i][4] === 'active') {
      users.push({
        email: data[i][0],
        instanceName: data[i][1],
        sheetId: data[i][2],
        webhookUrl: data[i][3],
        status: data[i][4],
        registeredAt: data[i][5]
      });
    }
  }

  return users;
}

/**
 * Gets count of registered users.
 *
 * @returns {number} Number of active users
 */
function getRegisteredUserCount() {
  return getAllActiveUsers().length;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Finds a user row by email or instance name.
 *
 * @param {string} email - Email to search
 * @param {string} instanceName - Instance name to search
 * @returns {Object|null} Row data or null
 */
function findUserRow(email, instanceName) {
  const sheet = getOrCreateRegistrySheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) return null;

  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][0] === email || data[i][1] === instanceName) {
      return {
        row: i + 2,
        data: {
          email: data[i][0],
          instanceName: data[i][1],
          sheetId: data[i][2],
          webhookUrl: data[i][3],
          status: data[i][4],
          registeredAt: data[i][5]
        }
      };
    }
  }

  return null;
}

/**
 * Gets or creates the Registry sheet.
 *
 * @returns {Sheet} The Registry sheet
 */
function getOrCreateRegistrySheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName('Registry');

  if (!sheet) {
    sheet = ss.insertSheet('Registry');
    sheet.getRange(1, 1, 1, 6).setValues([[
      'Email', 'Instance Name', 'Sheet ID', 'Webhook URL', 'Status', 'Registered At'
    ]]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  }

  return sheet;
}
