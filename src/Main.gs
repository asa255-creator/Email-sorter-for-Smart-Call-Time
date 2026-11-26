/**
 * Email Sorter — menu, setup and settings.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Email Sorter')
    .addItem('Sort now', 'sortNowFromMenu')
    .addItem('Status', 'showStatus')
    .addSeparator()
    .addItem('Suggest labels from my mail…', 'suggestLabels')
    .addItem('Apply checked suggestions', 'applySuggestions')
    .addItem('Sync labels from Gmail', 'syncLabelsFromMenu')
    .addSeparator()
    .addSubMenu(ui.createMenu('Settings')
      .addItem('Set Claude API key…', 'setApiKeyFromMenu')
      .addItem('Choose model…', 'chooseModelFromMenu')
      .addItem('Test Claude connection', 'testClaudeFromMenu'))
    .addSeparator()
    .addItem('Pause automatic sorting', 'pauseSorting')
    .addItem('Resume automatic sorting', 'resumeSorting')
    .addItem('Set up / upgrade', 'setupSorter')
    .addToUi();
}

/**
 * Simple trigger: when you edit a sender's Label, Inbox action or Type on
 * the Senders sheet, that row becomes your choice.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== 'Senders' || e.range.getRow() < 2) return;
  var first = e.range.getColumn();
  var last = first + e.range.getNumColumns() - 1;
  if (last < 2 || first > 4) return;
  sheet.getRange(e.range.getRow(), 7, e.range.getNumRows(), 1)
    .setValues(Array(e.range.getNumRows()).fill(['you']));
}

// ============================================================================
// SETUP / UPGRADE
// ============================================================================

function setupSorter() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var go = ui.alert('Set up Email Sorter ' + SORTER_VERSION,
    'This will:\n' +
    '• create or upgrade the Config, Labels, Rules, Senders and Log sheets (your label descriptions are kept)\n' +
    '• store your Claude API key privately instead of in the sheet\n' +
    '• use Claude Haiku 5.5 (change it in Settings > Choose model)\n' +
    '• remove the old Queue and Instructions sheets\n' +
    '• add Sorter labels to Gmail\n' +
    '• sort your inbox every ' + runInterval_() + ' minute' + (runInterval_() === 1 ? '' : 's') + '\n\n' +
    'Nothing is archived until you choose an Inbox action for a label, apart from GitHub noise ' +
    '(see the Rules sheet) and cold sales email.', ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;

  var notes = [];
  var oldDescriptions = {};
  // Each step can be run again safely, so if Google times out part way,
  // running Set up / upgrade again carries on without losing anything.
  var steps = [
    ['removing the old Queue, Instructions and Log sheets', function() {
      var removed = removeV1Sheets(ss);
      if (removed.length) notes.push('Removed ' + removed.join(', ') + '.');
    }],
    ['upgrading the Config sheet', function() { notes = notes.concat(ensureConfigSheet(ss)); }],
    ['upgrading the Labels sheet', function() { oldDescriptions = ensureLabelsSheet(ss, notes); }],
    ['adding the Rules, Senders, Corrections and Log sheets', function() {
      if (ensureRulesSheet(ss)) notes.push('Added the Rules sheet (Sentry and GitHub rules).');
      if (ensureSendersSheet(ss)) notes.push('Added the Senders sheet (sender memory).');
      if (ensureCorrectionsSheet(ss)) notes.push('Added the Corrections sheet (labels you change in Gmail).');
      ensureLogSheet(ss);
    }],
    ['adding the Sorter labels in Gmail', function() { ensureSorterLabels(); }],
    ['filling in the Labels sheet', function() {
      syncLabelsToSheet(oldDescriptions);
      removeLabelsBackup(ss);
    }],
    ['adding the Start Here sheet', function() { ensureStartHereSheet(ss); }]
  ];
  for (var i = 0; i < steps.length; i++) {
    try {
      steps[i][1]();
      SpreadsheetApp.flush();
    } catch (e) {
      ui.alert('Setup paused',
        'Google stopped responding while ' + steps[i][0] + ':\n' + e.message + '\n\n' +
        'Nothing has been lost. Wait a minute, then run Email Sorter > Set up / upgrade again; ' +
        'it carries on from where it stopped.', ui.ButtonSet.OK);
      return;
    }
  }

  if (!getApiKey()) setApiKeyFromMenu();
  installTrigger_();
  clearClaudeBlock();
  ss.setActiveSheet(ss.getSheetByName('Labels'));

  ui.alert('Email Sorter is set up',
    (notes.length ? notes.map(function(n) { return '• ' + n; }).join('\n') + '\n\n' : '') +
    'Next:\n' +
    '1. On the Labels sheet, set an Inbox action for each label and describe what belongs in it. ' +
    'Or run Email Sorter > Suggest labels from my mail.\n' +
    '2. Add anything Claude should know about you to sorting_notes on the Config sheet.\n' +
    '3. Run Email Sorter > Sort now, then read the Log sheet.\n\n' +
    'If you used the old Hub version: in Apps Script, open Deploy > Manage deployments and archive the old ' +
    'web app. It is no longer used and should not stay online.',
    ui.ButtonSet.OK);
}

/** run_every_minutes rounded to an interval Apps Script allows (1, 5, 10, 15 or 30). */
function runInterval_() {
  var wanted = getConfigNumber('run_every_minutes');
  var allowed = [1, 5, 10, 15, 30];
  return allowed.reduce(function(best, n) { return Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best; }, 5);
}

function installTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runSorter').timeBased().everyMinutes(runInterval_()).create();
}

function pauseSorting() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'runSorter') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getUi().alert('Paused', 'Automatic sorting is off. Use Resume automatic sorting to turn it back on.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function resumeSorting() {
  installTrigger_();
  SpreadsheetApp.getUi().alert('Resumed', 'Your inbox is sorted every ' + runInterval_() + ' minute' +
    (runInterval_() === 1 ? '' : 's') + '.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function isScheduled_() {
  return ScriptApp.getProjectTriggers().some(function(t) { return t.getHandlerFunction() === 'runSorter'; });
}

// ============================================================================
// MENU ACTIONS
// ============================================================================

function sortNowFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var stats = runSorter_({ forceSweep: true });
  if (stats.busy) {
    ui.alert('Already sorting', 'A run is in progress. Try again in a minute.', ui.ButtonSet.OK);
    return;
  }
  var problem = getStatus('last_error');
  ui.alert('Sorted',
    'Sorted ' + (stats.sorted || 0) + ' conversation' + (stats.sorted === 1 ? '' : 's') + ': ' +
    (stats.rules || 0) + ' by rules, ' + (stats.memory || 0) + ' from memory, ' + (stats.claude || 0) + ' by Claude.\n' +
    'Archived ' + (stats.archived || 0) + '. Learned from ' + (stats.learned || 0) + ' of your corrections.' +
    (stats.labelsCreated ? ' Created ' + stats.labelsCreated + ' new label' + (stats.labelsCreated === 1 ? '' : 's') + '.' : '') +
    (problem ? '\n\nProblem: ' + problem : '') + '\n\nDetails are on the Log sheet.', ui.ButtonSet.OK);
}

function syncLabelsFromMenu() {
  var n = syncLabelsToSheet();
  SpreadsheetApp.getUi().alert('Labels synced', n + ' labels on the Labels sheet.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function showStatus() {
  var ui = SpreadsheetApp.getUi();
  var stats = {};
  try { stats = JSON.parse(getStatus('stats') || '{}'); } catch (e) { stats = {}; }
  if (stats.day !== todayKey_()) stats = {};
  var lastRun = Number(getStatus('last_run') || 0);
  var state = loadState();
  var senders = loadSenders();
  var learned = senders.rows.filter(function(r) { return isTrustedSender(r, getConfigNumber('learn_after')); }).length;
  var problem = getStatus('last_error') || claudeBlockedReason_();

  ui.alert('Email Sorter status',
    'Automatic sorting: ' + (isScheduled_() ? 'on, every ' + runInterval_() + ' min' : 'PAUSED') + '\n' +
    'Last run: ' + (lastRun ? formatDate_(new Date(lastRun)) : 'never') + '\n' +
    'Model: ' + getConfig('claude_model') + ' (effort ' + getConfig('claude_effort') + ')\n' +
    'API key: ' + (getApiKey() ? 'set' : 'NOT SET') + '\n' +
    (problem ? 'Problem: ' + problem + '\n' : '') +
    '\nToday: ' + (stats.sorted || 0) + ' sorted (' + (stats.rules || 0) + ' rules, ' + (stats.memory || 0) +
    ' memory, ' + (stats.claude || 0) + ' Claude), ' + (stats.archived || 0) + ' archived.\n' +
    'Claude cost today: about $' + (stats.cost || 0).toFixed(2) + '\n' +
    '\nSenders known: ' + senders.rows.length + ' (' + learned + ' sorted without Claude)\n' +
    'Waiting to be archived later: ' + Object.keys(state.due).length + '\n' +
    describeIdeas_(),
    ui.ButtonSet.OK);
}

function describeIdeas_() {
  var ideas = loadIdeas();
  var keys = Object.keys(ideas).sort(function(a, b) { return ideas[b].count - ideas[a].count; });
  if (!keys.length) return 'Label ideas: none yet';
  return 'Label ideas Claude has suggested (created at ' + getConfigNumber('new_label_after') + '):\n' +
    keys.slice(0, 8).map(function(k) { return '  ' + ideas[k].name + ' (' + ideas[k].count + ')'; }).join('\n');
}

function setApiKeyFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var current = getApiKey();
  var response = ui.prompt('Claude API key',
    (current ? 'A key is set (' + current.substring(0, 10) + '…). Paste a new one to replace it.\n\n' : '') +
    'Create a key at console.anthropic.com > API Keys. It starts with sk-ant-.\n' +
    'It is stored privately for your Google account, not in this spreadsheet.',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var key = response.getResponseText().trim();
  if (!key) return;
  if (key.indexOf('sk-ant-') !== 0) {
    ui.alert('That does not look like a key', 'Claude API keys start with sk-ant-.', ui.ButtonSet.OK);
    return;
  }
  setApiKey(key);
  clearClaudeBlock();
  ui.alert('Saved', 'API key saved.', ui.ButtonSet.OK);
}

function chooseModelFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfig('claude_model');
  var list = CLAUDE_MODELS.map(function(m, i) {
    return (i + 1) + '. ' + m.name + (m.id === current ? '  ← current' : '') + '\n   ' + m.price + '\n   ' + m.note;
  }).join('\n\n');
  var response = ui.prompt('Choose model', list + '\n\nEnter 1-' + CLAUDE_MODELS.length + ':', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var n = parseInt(response.getResponseText(), 10);
  if (!(n >= 1 && n <= CLAUDE_MODELS.length)) return;
  setConfig('claude_model', CLAUDE_MODELS[n - 1].id);
  clearClaudeBlock();
  ui.alert('Model set', CLAUDE_MODELS[n - 1].name + ' will sort new mail.', ui.ButtonSet.OK);
}

function testClaudeFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var labels = readLabels();
  var names = labels.aiList.map(function(l) { return l.name; });
  var prompt = {
    labelNames: names,
    schema: buildClassifierSchema(names),
    system: buildClassifierSystemPrompt(labels.aiList, getConfig('sorting_notes'), [])
  };
  var sample = {
    fromHeader: 'Jordan Blake <jordan@growthly-example.com>', recipientCount: 1, yourPosition: 'To',
    youWroteInThread: false, messageCount: 1, automatedAddress: false,
    bulkHeaders: ['has an unsubscribe header'], outreachSignals: ['hubspot'], trackingPixel: true,
    linkHosts: ['growthly-example.com', 'hubspotlinks.com', 'meetings.hubspot.com'],
    subject: 'Quick question', date: new Date(),
    body: 'Hi there, I noticed your team is growing fast. We help companies like yours cut onboarding time ' +
      'in half. Worth a quick 15-minute chat next week? [link: meetings.hubspot.com]\n\nNot interested? Let me know.'
  };
  try {
    var answer = classifyWithClaude(sample, false, prompt);
    clearClaudeBlock();
    ui.alert('Claude is working',
      'Model: ' + (answer.model || getConfig('claude_model')) + '\n' +
      'Test email (a HubSpot-style sales pitch) was read as: ' + answer.ai.sender_type +
      ', label ' + answer.ai.label + ', confidence ' + answer.ai.confidence + '.\n' +
      'Reason: ' + answer.ai.reason + '\n\nCost: about $' + (answer.cost || 0).toFixed(4),
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Claude test failed', e.message, ui.ButtonSet.OK);
  }
}

/** Run once from the Apps Script editor (or setup.sh) to grant every permission. */
function authorize() {
  GmailApp.getUserLabels();
  SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers();
  PropertiesService.getUserProperties();
  try { Session.getEffectiveUser().getEmail(); } catch (e) { /* optional */ }
  try { UrlFetchApp.fetch('https://api.anthropic.com', { muteHttpExceptions: true }); } catch (e) { /* only to request permission */ }
  return 'authorized';
}
