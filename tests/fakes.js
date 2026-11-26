/**
 * In-memory stand-ins for the Apps Script services the sorter uses, and a
 * loader that runs every src/*.gs file in one shared context, the way Apps
 * Script does.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

class FormatRange {
  constructor() {
    const self = this;
    ['setFontWeight', 'setBackground', 'setFontColor', 'setFontSize', 'setWrap', 'setNumberFormat',
      'setNote', 'setDataValidation', 'clearDataValidations', 'insertCheckboxes', 'setBackgrounds'].forEach((m) => {
      self[m] = () => self;
    });
  }
}

class FakeRange extends FormatRange {
  constructor(sheet, row, col, numRows, numCols) {
    super();
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValues(values) {
    if (values.length !== this.numRows || values.some((v) => v.length !== this.numCols)) {
      throw new Error(`setValues size mismatch on ${this.sheet.name}: range ${this.numRows}x${this.numCols}, ` +
        `got ${values.length}x${values[0] && values[0].length}`);
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, v);
    return this;
  }
  setRichTextValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => {
      this.sheet.set(this.row + r, this.col + c, v.getText());
      this.sheet.links[`${this.row + r},${this.col + c}`] = v.getLinkUrl();
    }));
    return this;
  }
  clearContent() { return this.setValue(''); }
  clear() { return this.setValue(''); }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
  getSheet() { return this.sheet; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.links = {};
    this.hidden = false;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  get(r, c) {
    const line = this.rows[r - 1];
    const v = line ? line[c - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) {
      if ((this.rows[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((line) => line.forEach((v, i) => { if (v !== '' && v !== undefined) max = Math.max(max, i + 1); }));
    return max;
  }
  getRange(row, col, numRows, numCols) {
    if (typeof row === 'string') return new FormatRange();
    return new FakeRange(this, row, col, numRows || 1, numCols || 1);
  }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  clear() { this.rows = []; this.links = {}; return this; }
  appendRow(values) { const r = this.getLastRow() + 1; values.forEach((v, i) => this.set(r, i + 1, v)); return this; }
  insertRowsAfter(after, n) {
    while (this.rows.length < after) this.rows.push([]);
    this.rows.splice(after, 0, ...Array.from({ length: n }, () => []));
    return this;
  }
  deleteRows(start, n) { this.rows.splice(start - 1, n); return this; }
  deleteRow(r) { return this.deleteRows(r, 1); }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  isSheetHidden() { return this.hidden; }
  showSheet() { this.hidden = false; return this; }
  hideSheet() { this.hidden = true; return this; }
  /** Rows below the header as arrays, trimmed to n columns. */
  data(n) {
    const out = [];
    for (let r = 2; r <= this.getLastRow(); r++) {
      const line = [];
      for (let c = 1; c <= n; c++) line.push(this.get(r, c));
      out.push(line);
    }
    return out;
  }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; this.active = null; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name, index) {
    const s = new FakeSheet(name);
    if (typeof index === 'number') this.sheets.splice(index, 0, s); else this.sheets.push(s);
    return s;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
  getSheets() { return this.sheets.slice(); }
  setActiveSheet(s) { this.active = s; return s; }
  getName() { return 'Test spreadsheet'; }
  toast() {}
}

function makeUi(answers) {
  const alerts = [];
  return {
    alerts,
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    alert(title, message) { alerts.push({ title, message }); return 'OK'; },
    prompt(title) {
      const text = (answers && answers.shift()) || '';
      alerts.push({ title, prompt: true });
      return { getSelectedButton: () => (text === null ? 'CANCEL' : 'OK'), getResponseText: () => text || '' };
    },
    createMenu() {
      const menu = { addItem: () => menu, addSeparator: () => menu, addSubMenu: () => menu, addToUi: () => menu };
      return menu;
    }
  };
}

// ---------------------------------------------------------------------------
// Gmail
// ---------------------------------------------------------------------------

class FakeLabel {
  constructor(name, gmail) { this.name = name; this.gmail = gmail; }
  getName() { return this.name; }
  getThreads(start, max) {
    return this.gmail.threads.filter((t) => t.labels.has(this.name)).slice(start, start + max);
  }
  removeFromThreads(threads) { threads.forEach((t) => t.labels.delete(this.name)); return this; }
  deleteLabel() {
    delete this.gmail.labels[this.name.toLowerCase()];
    this.gmail.threads.forEach((t) => t.labels.delete(this.name));
  }
}

class FakeMessage {
  constructor(o) {
    this.o = Object.assign({ to: '', cc: '', bcc: '', replyTo: '', subject: '(no subject)', plain: '', html: '', headers: {} }, o);
    this.o.headers = Object.fromEntries(Object.entries(this.o.headers).map(([k, v]) => [k.toLowerCase(), v]));
  }
  getFrom() { return this.o.from; }
  getTo() { return this.o.to; }
  getCc() { return this.o.cc; }
  getBcc() { return this.o.bcc; }
  getReplyTo() { return this.o.replyTo; }
  getSubject() { return this.o.subject; }
  getDate() { return this.o.date; }
  getPlainBody() { return this.o.plain; }
  getBody() { return this.o.html; }
  getHeader(name) { return this.o.headers[name.toLowerCase()] || ''; }
}

class FakeThread {
  constructor(id, messages, opts) {
    opts = opts || {};
    this.id = id;
    this.messages = messages.map((m) => new FakeMessage(m));
    this.labels = new Set(opts.labels || []);
    this.inbox = opts.inbox !== false;
    this.unread = true;
  }
  getId() { return this.id; }
  getMessages() { return this.messages; }
  getLastMessageDate() { return this.messages[this.messages.length - 1].getDate(); }
  getFirstMessageSubject() { return this.messages[0].getSubject(); }
  getLabels() { return [...this.labels].map((n) => this.gmail.label(n)); }
  addLabel(l) { this.labels.add(l.getName()); return this; }
  removeLabel(l) { this.labels.delete(l.getName()); return this; }
  moveToArchive() { this.inbox = false; return this; }
  moveToInbox() { this.inbox = true; return this; }
  markRead() { this.unread = false; return this; }
  isInInbox() { return this.inbox; }
}

class FakeGmail {
  constructor(me) {
    this.me = me;
    this.threads = [];
    this.labels = {};
    this.searches = [];
    this.hiddenLabels = [];
  }
  label(name) {
    if (!this.labels[name.toLowerCase()]) this.labels[name.toLowerCase()] = new FakeLabel(name, this);
    return this.labels[name.toLowerCase()];
  }
  addThread(id, messages, opts) {
    const t = new FakeThread(id, messages, opts);
    t.gmail = this;
    (opts && opts.labels || []).forEach((n) => this.label(n));
    this.threads.push(t);
    return t;
  }
  thread(id) { return this.threads.find((t) => t.id === id); }

  // GmailApp surface
  getUserLabels() { return Object.values(this.labels); }
  getUserLabelByName(name) { return this.labels[name.toLowerCase()] || null; }
  createLabel(name) { return this.label(name); }
  getAliases() { return []; }
  getThreadById(id) { return this.thread(id) || null; }
  markThreadsRead(threads) { threads.forEach((t) => t.markRead()); return this; }
  search(query, start, max) {
    this.searches.push(query);
    const matches = this.threads.filter((t) => this.matches(t, query))
      .sort((a, b) => b.getLastMessageDate() - a.getLastMessageDate());
    return matches.slice(start || 0, (start || 0) + (max || 500));
  }
  matches(thread, query) {
    const term = (name) => 'label:' + name.toLowerCase().replace(/[\s/]+/g, '-');
    let q = query;
    const sent = /(^|\s)in:sent\b/.test(q);
    if (/(^|\s)in:inbox\b/.test(q) && !thread.inbox) return false;
    if (/-in:sent\b/.test(q) && thread.messages.every((m) => m.getFrom().toLowerCase().includes(this.me))) return false;
    const newer = q.match(/newer_than:(\d+)d/);
    if (newer && Date.now() - thread.getLastMessageDate().getTime() > Number(newer[1]) * DAY) return false;
    if (/(^|\s)is:unread\b/.test(q) && !thread.unread) return false;
    const older = q.match(/older_than:(\d+)d/);
    if (older && !thread.messages.some((m) => Date.now() - m.getDate().getTime() > Number(older[1]) * DAY)) return false;
    const after = q.match(/after:(\d+)/);
    if (after && thread.getLastMessageDate().getTime() < Number(after[1]) * 1000) return false;
    for (const m of q.matchAll(/(-?)label:([^\s)]+)/g)) {
      const has = [...thread.labels].some((n) => term(n) === 'label:' + m[2]);
      if (m[1] === '-' ? has : !has) return false;
    }
    if (sent) {
      const fromMe = thread.messages.filter((m) => m.getFrom().toLowerCase().includes(this.me));
      if (!fromMe.length) return false;
      const to = q.match(/to:([^\s)]+)/);
      if (to) {
        const who = to[1].toLowerCase();
        if (!fromMe.some((m) => (m.getTo() + ' ' + m.getCc() + ' ' + m.getBcc()).toLowerCase().includes(who))) return false;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Other services
// ---------------------------------------------------------------------------

function makeProperties() {
  const data = {};
  return {
    data,
    getProperty: (k) => (k in data ? data[k] : null),
    setProperty: (k, v) => { data[k] = String(v); },
    setProperties: (obj) => { Object.keys(obj).forEach((k) => { data[k] = String(obj[k]); }); },
    getProperties: () => Object.assign({}, data),
    deleteProperty: (k) => { delete data[k]; }
  };
}

function makeCache() {
  const data = {};
  return { get: (k) => (k in data ? data[k] : null), put: (k, v) => { data[k] = v; }, remove: (k) => { delete data[k]; } };
}

/**
 * Loads src/*.gs into a fresh context.
 * @param {Object} opts { me, claude(payload) -> {code, body}, uiAnswers }
 */
function loadSorter(opts) {
  opts = opts || {};
  const me = opts.me || 'me@example.com';
  const ss = new FakeSpreadsheet();
  const gmail = new FakeGmail(me);
  const ui = makeUi(opts.uiAnswers || []);
  const scriptProps = makeProperties();
  const userProps = makeProperties();
  const triggers = [];
  const fetches = [];

  const builder = () => {
    const b = { requireValueInList: () => b, requireCheckbox: () => b, setAllowInvalid: () => b, build: () => ({}) };
    return b;
  };

  const context = {
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      flush: () => {},
      getActive: () => ss,
      getUi: () => ui,
      newDataValidation: builder,
      newRichTextValue: () => {
        const v = { text: '', url: null };
        const b = {
          setText: (t) => { v.text = t; return b; },
          setLinkUrl: (u) => { v.url = u; return b; },
          build: () => ({ getText: () => v.text, getLinkUrl: () => v.url })
        };
        return b;
      }
    },
    GmailApp: gmail,
    Gmail: {
      Users: {
        Labels: {
          create: (resource) => {
            gmail.hiddenLabels.push(resource);
            gmail.label(resource.name).listVisibility = resource.labelListVisibility;
            return resource;
          },
          list: () => ({ labels: Object.values(gmail.labels).map((l) => ({
            id: 'id:' + l.name, name: l.name, labelListVisibility: l.listVisibility || 'labelShow' })) }),
          patch: (resource, user, id) => { gmail.label(id.substring(3)).listVisibility = resource.labelListVisibility; }
        }
      }
    },
    PropertiesService: { getScriptProperties: () => scriptProps, getUserProperties: () => userProps },
    CacheService: { getScriptCache: (() => { const c = makeCache(); return () => c; })() },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Session: {
      getEffectiveUser: () => ({ getEmail: () => me }),
      getScriptTimeZone: () => 'UTC'
    },
    Utilities: {
      formatDate: (d) => new Date(d).toISOString().replace('T', ' ').substring(0, 16)
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (fn) => {
        const t = { getHandlerFunction: () => fn };
        const chain = { timeBased: () => chain, everyMinutes: () => chain, create: () => { triggers.push(t); return t; } };
        return chain;
      }
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        const payload = JSON.parse(params.payload);
        fetches.push({ url, params, payload });
        const res = opts.claude ? opts.claude(payload, params) : { code: 500, body: '{}' };
        return { getResponseCode: () => res.code, getContentText: () => res.body };
      }
    }
  };
  vm.createContext(context);
  fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), context, { filename: f });
  });
  return { ctx: context, ss, gmail, ui, scriptProps, userProps, triggers, fetches, me };
}

/** A successful Messages API response carrying structured output. */
function claudeOk(obj, extra) {
  return {
    code: 200,
    body: JSON.stringify(Object.assign({
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(obj) }],
      usage: { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 1200, cache_creation_input_tokens: 0 }
    }, extra || {}))
  };
}

module.exports = { loadSorter, claudeOk, DAY, FakeSheet };
