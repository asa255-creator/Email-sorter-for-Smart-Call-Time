'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSorter, claudeOk } = require('./fakes');

const ME = 'me@example.com';

test('every menu item runs on a fresh spreadsheet', () => {
  const w = loadSorter({
    me: ME,
    uiAnswers: ['sk-ant-new-key', '2'],
    claude: (payload) => {
      if (payload.output_config.format.schema.properties.labels) {
        return claudeOk({
          notes: 'Lots of receipts.',
          labels: [{ name: 'Receipts', description: 'Purchases', inbox_action: 'Archive', archive_after_days: 0, already_exists: false }],
          senders: [{ sender: 'shop@store.com', label: 'Receipts' }]
        });
      }
      return claudeOk({ reason: 'Sales pitch.', sender_type: 'cold_outreach', label: 'NONE', needs_attention: false, confidence: 'high' });
    }
  });
  const { ctx: S, ss, ui, triggers, gmail, userProps } = w;
  gmail.addThread('r1', [{ from: 'Shop <shop@store.com>', to: ME, subject: 'Your receipt', date: new Date(Date.now() - 3600e3) }]);

  S.onOpen();
  S.setupSorter();
  assert.equal(userProps.getProperty('claude_api_key'), 'sk-ant-new-key', 'setup asks for a key when none is set');
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), 'runSorter');
  ['Config', 'Labels', 'Rules', 'Senders', 'Log', 'Start Here'].forEach((n) => assert.ok(ss.getSheetByName(n), n));

  S.testClaudeFromMenu();
  assert.match(ui.alerts[ui.alerts.length - 1].message, /cold_outreach/);

  S.suggestLabels();
  assert.ok(ss.getSheetByName('Suggestions'));
  S.applySuggestions();
  assert.ok(gmail.getUserLabelByName('Receipts'));

  S.sortNowFromMenu();
  assert.match(ui.alerts[ui.alerts.length - 1].message, /Sorted 1 conversation/);
  assert.equal(gmail.thread('r1').inbox, false, 'suggested sender archived from memory');

  S.showStatus();
  assert.match(ui.alerts[ui.alerts.length - 1].message, /on, every 5 min/);

  S.chooseModelFromMenu();
  assert.equal(S.getConfig('claude_model'), 'claude-sonnet-5-5', 'option 2 is Sonnet');

  S.setConfig('run_every_minutes', '1');
  S.resumeSorting();
  assert.match(ui.alerts[ui.alerts.length - 1].message, /every 1 minute\./);
  S.setConfig('run_every_minutes', '7');
  assert.equal(S.runInterval_(), 5, 'rounded to an interval Apps Script allows');
  S.pauseSorting();
  assert.equal(triggers.length, 0);
  S.resumeSorting();
  assert.equal(triggers.length, 1);

  S.syncLabelsFromMenu();

  // Editing a sender's label by hand makes it your choice.
  const senders = ss.getSheetByName('Senders');
  const row = senders.data(11).findIndex((r) => r[0] === 'shop@store.com') + 2;
  S.onEdit({ range: senders.getRange(row, 2, 1, 1) });
  assert.equal(senders.get(row, 7), 'you');
  S.onEdit({ range: senders.getRange(row, 9, 1, 1) });
});
