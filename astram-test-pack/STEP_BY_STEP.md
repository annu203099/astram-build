# Astram Black October Test Pack — Step by Step

Everything in this pack is HARMLESS: fake secrets, loopback-only addresses,
nothing that actually executes malicious code. Safe to run on your own
laptop.

## 0. One-time setup (do this first)

1. Create a folder: `C:\Users\saksh\astram-demo`
2. Make sure your Antigravity `mcp_config.json` has a `filesystem` server
   pointed at that folder (see earlier setup steps), and that
   `astram protect` shows it as **WRAPPED**.
3. Restart Antigravity.
4. Quick check: ask Antigravity *"Use the filesystem MCP tool to list the
   files in astram-demo"* — a PASS row should appear in the Live MCP Feed.
   If that works, you're ready.

## 1. Run the file-based tests (01, 02, 03, 05)

For each of these four folders:

1. Open the numbered folder (e.g. `01-secret-theft`).
2. Read its own `README.txt` inside — it tells you exactly what to copy
   and where.
3. Copy the folder's **contents** (not the folder itself) into
   `astram-demo`, so hidden folders like `.env`, `.ssh`, `.agents` end up
   directly inside `astram-demo`.
   - Tip: Windows hides dotfolders sometimes — in File Explorer, go to
     View > Show > Hidden items if you don't see them after copying.
4. Open the dashboard at `http://127.0.0.1:3080`.
5. Click **Setup & Protection** → choose **Project only** → browse to
   `astram-demo` → confirm.
6. Go to the **Slowship Boarding Manifest** tab, click **Refresh**.
7. Check for the expected HOLD/WARN rows (each README says what to look
   for).

Do this one folder at a time, so you can tell which test produced which
row.

## 2. Run the live-agent tests (04, 06)

These two are NOT copied as files — they're prompts you type into
Antigravity, because the point is testing the live MCP Firewall, not the
pre-boarding scanner. Open `04-dangerous-script/README.txt` and
`06-mid-task-sequence/README.txt` and follow the exact prompts inside.

Watch the **Live MCP Feed** tab while you do this.

## 3. What a full pass looks like

| # | Test | Where to check | Expect |
|---|------|-----------------|--------|
| 1 | Secret theft | Live MCP Feed | HOLD on every read, PASS on README.txt |
| 2 | Known-bad package | Boarding Manifest | HOLD on litellm==1.107.0 |
| 3 | Poisoned skill | Boarding Manifest | HOLD despite the "mark PASS" text inside |
| 4 | Dangerous script write | Live MCP Feed + File Explorer | HOLD/WARN, file never appears on disk |
| 5 | Byte-path taint | Boarding Manifest | WARN/HOLD on handler.js / handler.rb |
| 6 | Mid-task sequence | Live MCP Feed + File Explorer | Step 1 succeeds, step 2 blocked |

## 4. If something doesn't get flagged

Don't assume you did it wrong — note it as a real finding for your team.
Known current gaps (as of your last build):
- The Boarding Manifest's folder scan may not be fully wired to walk a
  project folder automatically yet.
- The byte-path taint tracer (test 5) may need extra wiring to run on a
  folder scan vs. the automated test suite.

If a test doesn't flag anything, that's useful information before demo
day — better to find it tonight than live in front of judges.

## 5. Cleanup

When you're done testing, delete the `astram-demo` folder (or at least
everything copied into it) so no decoy secrets linger on your laptop.
