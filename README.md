# Email Sorter

A Google Apps Script, attached to a Google Sheet, that keeps your Gmail inbox down to mail that needs you. It labels every new email and moves what you don't need to see out of the inbox.

It runs every few minutes (1 to 30, your choice) inside your own Google account. The only outside service it talks to is the Claude API.

## How it decides

Each new conversation goes through these steps. The first one with an answer wins.

| Step | What | Costs |
|---|---|---|
| 1. Your choices | Senders you marked yourself (Senders sheet, Source = `you`) | free |
| 2. Rules | Exact matches on the Rules sheet. GitHub notifications are handled here. | free |
| 3. Memory | Senders it has learned, or that you accepted from Suggestions | free |
| 4. Claude | Everything else. Claude picks one of your labels, says what kind of sender it is, and how sure it is. | a small fraction of a cent per email on Haiku 5.5 |

There is one rule on top of those steps: **mail from people you know is never archived.** That means anyone you have emailed, anyone at your own company's domain, any conversation you wrote in, and anything you sent. Only your own explicit choice (step 1) can override it.

Shared-document and similar notifications ("Jane (via Google Docs)") come from one Google address no matter who sent them, so the sorter judges them by the person in Reply-To and never learns the Google address as a sender.

Claude puts every sender into one of four types:

- **person**: a human writing to you. Always stays in the inbox.
- **cold_outreach**: a sales or marketing email made to look personal, such as a HubSpot, Apollo or Outreach sequence. It gets the `Cold Outreach` label and is archived and marked read. To catch these, Claude is told whether you have ever emailed the sender, whether the email has tracking links or a tracking pixel, and which sales tools' fingerprints appear in it.
- **automated**: notifications, receipts, alerts.
- **bulk**: newsletters and promotions.

For automated and bulk mail, what happens next is the **Inbox action** of the label Claude chose, which you set on the Labels sheet:

| Inbox action | Effect |
|---|---|
| Keep in inbox | Labelled, stays put (the default for every label) |
| Archive | Labelled and archived |
| Archive + mark read | Labelled, archived, marked read |
| Archive after days | Stays for N days, then archived |

Two things keep an email in the inbox whatever its label says: Claude marks it as needing your attention (a failed payment, an unexpected security alert, a direct question), or Claude isn't sure. Unsure emails also get the `Needs Review` label.

### Rules that come built in

The Rules sheet starts with these. The first rule that matches wins.

| Notification | What happens |
|---|---|
| Anything from Sentry | Your warnings label (an existing label starting with "Warnings" is used), kept in the inbox |
| A failed GitHub Actions run (`[org/repo] Run failed: …`) | Kept for a day, then archived |
| GitHub review request, @mention, team mention, assignment, security alert | Kept in the inbox |
| Successful CI runs, pushes, threads you only watch, merges/closes | Archived right away, left unread |
| Comments on your PRs and issues | Kept for 2 days, then archived |
| Anything else from `notifications@github.com` | Kept for 2 days, then archived |

GitHub rules use the reason address GitHub puts in Cc (for example `ci_activity@noreply.github.com`). If you reply to a notification, its scheduled archive is cancelled.

Gmail alerts your phone the moment an email arrives, before the sorter sees it, so you still get alerts for mail that is then filed. Set `run_every_minutes` to 1 on the Config sheet to file it within a minute (then choose **Resume automatic sorting**). Once filed, your phone may clear the notification.

## How it learns

There is no hidden model. Everything it learns is a row you can read and edit.

| You do this in Gmail | It learns |
|---|---|
| Change a label it chose (say Newsletters → Receipts) | Recorded on the **Corrections** sheet and shown to Claude as an example from then on. For automated and bulk senders (receipts, alerts, newsletters), that sender's future mail also goes straight to your label. People aren't locked to one label, since their mail varies. |
| Apply `Sorter/Always keep` | That sender is never archived again |
| Apply `Sorter/Always archive` | That sender is always archived and marked read, which is good for HubSpot-style mail that slips through |
| Move something from `Sorter/Archived` back to the inbox | That sender's mail stays in the inbox from now on |
| Nothing | After Claude sorts an automated sender the same way 3 times (`learn_after`), that sender is handled from memory, free |

Label changes are checked hourly, for conversations sorted in the last 7 days. Sender choices live on the **Senders** sheet, and editing a row there (Label, Inbox action or Type) makes it your choice. A row for `@example.com` covers everyone at that domain. Your choices and label changes are given to Claude as examples, so similar senders get the same treatment.

Everything the sorter archives carries the `Sorter/Archived` label, and every decision and its reason is on the Log sheet; each subject there links to the email.

## New labels and sub-labels

The sorter can create labels on its own. When no label fits, Claude may suggest one, preferring a sub-label of one you already have (for example `Finance/Receipts` under `Finance`). The sorter creates it once the same suggestion comes up for 3 different emails (`new_label_after`). It then files those emails under it, adds it to the Labels sheet with Claude's description, and uses it from then on.

New labels start as "Keep in inbox", so set their Inbox action when you see them; the Log says when one is created. **Status** lists suggestions still waiting for enough emails. Set `auto_create_labels` to `no` to only log the ideas.

## Choosing labels

For a whole set at once, **Email Sorter → Suggest labels from my mail…** looks at the sender and subject (never the body) of up to 400 conversations from the last 60 days. It asks Claude for 5–15 labels, using sub-labels under your existing ones where they fit, with descriptions and inbox actions, plus which frequent senders belong in each. It writes them to a Suggestions sheet. Untick what you don't want, edit anything, then choose **Apply checked suggestions**.

Claude only chooses labels ticked "Claude can choose it" on the Labels sheet. The description column is what Claude reads, so one clear sentence per label makes the biggest difference to accuracy. If you create labels in Gmail, run **Sync labels from Gmail** to add them.

`sorting_notes` on the Config sheet is for anything Claude should know about you, in plain English. For example: "I run a startup; investor and customer emails always need my attention."

## Installation

You need [Node.js](https://nodejs.org/) (v20 LTS) and clasp:

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

Then, from this folder:

```bash
./setup.sh
```

- **New sheet:** choose 1. The script creates the sheet and pushes the code.
- **Upgrading the old Hub version:** choose 2 and use your existing Script ID. It also offers to remove the old public web app deployment, which is no longer used.

Then open the sheet, refresh, and click **Email Sorter → Set up / upgrade**. It will:

- create or upgrade the sheets, keeping your label descriptions
- move your Claude API key out of the Config sheet into private script storage, or ask for one
- switch older models to Claude Haiku 5.5
- remove the old Queue and Instructions sheets
- create the Sorter labels in Gmail
- start sorting every 5 minutes (change `run_every_minutes`)

Next, set an Inbox action for each label, then **Sort now** and read the Log sheet.

An API key comes from [console.anthropic.com](https://console.anthropic.com) → API Keys.

## Models and cost

| Model | Price per million tokens (in / out) | Notes |
|---|---|---|
| Claude Haiku 5.5 (default) | $0.10 / $0.50 | Fast and very cheap |
| Claude Sonnet 5.5 | $2 / $10 | Switch to it if the Log shows Haiku mis-sorting |
| Claude Opus 5.5 | $4 / $20 | Rarely needed for sorting |

Change it with **Settings → Choose model**. **Status** shows today's estimated spend. Each email is a single request with the effort setting on `low`. Your labels and instructions are cached between emails, and repeat senders stop costing anything once learned.

Claude's answer is forced into a fixed format (structured outputs), so it can only name one of your labels. On Sonnet and Opus, if a safety filter declines an email, the API retries it on another model. If your key is rejected or your credits run out, rules and memory keep working and Claude is retried hourly.

## Sheets

| Sheet | What it holds |
|---|---|
| Start Here | How it works |
| Labels | Each label's description, inbox action, archive-after days, and whether Claude can choose it |
| Rules | Matches that run before Claude: a field (From, To, Cc, Subject, Body or any header name), text to look for (`a \| b` for either), and a label/action |
| Senders | Sender memory: label, action, type, source (`you`, `rescued`, `suggested`, `claude`), and whether you have emailed them |
| Corrections | Labels you changed in Gmail after the sorter chose them; shown to Claude as examples |
| Log | Newest first: who, subject (linked), what decided it, label, what happened, why |
| Config | Settings |

Gmail itself is the queue. A hidden `_sorted` label marks conversations already handled, and a conversation is sorted again only when a new message arrives.

## Troubleshooting

| Problem | Fix |
|---|---|
| Menu missing | Refresh the sheet |
| Nothing leaves the inbox | Labels start as "Keep in inbox". Set Inbox actions on the Labels sheet. |
| "No Claude API key" in Status | Settings → Set Claude API key |
| A label is never used | Tick "Claude can choose it" and give it a description; run Sync labels from Gmail if you created it in Gmail |
| Something was archived wrongly | Move it back to the inbox (it learns), or apply `Sorter/Always keep` |
| The old inbox is untouched | Only the last `backfill_days` (14) are sorted. Raise it on the Config sheet for a one-time cleanup. |
| Memory error during `clasp push` | `NODE_OPTIONS="--max-old-space-size=8192" clasp push` |

## Development

The script is in `src/`. The tests in `tests/` run every `.gs` file in Node against fake versions of Gmail, Sheets and the Claude API. That includes full runs: upgrading a v1 sheet, GitHub rules, known contacts, sales sequences, learning from corrections, and scheduled archiving.

```bash
npm test
```

Push changes to your script with:

```bash
cd src && clasp push
```

## License

MIT
