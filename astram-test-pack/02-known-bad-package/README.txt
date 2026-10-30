TEST 2 — Known-bad package / startup-hook stealer (LiteLLM TEST-01 style)
============================================================================
This recreates the LiteLLM 1.107.0 pattern: a requirements.txt pinning the
vulnerable version, plus a .pth file that runs code automatically the
moment Python starts (the real attack read env vars and sent them out;
this one only touches a loopback address, nothing leaves your machine).

Copy this whole 02-known-bad-package folder's CONTENTS into astram-demo
(so requirements.txt and site-packages/ end up directly inside astram-demo).

Then:
  1. Open the dashboard -> "Setup & Protection"
  2. Choose "Project only", browse to your astram-demo folder, confirm
  3. Go to the "Slowship Boarding Manifest" tab, click Refresh

Expected: a HOLD row for "litellm==1.107.0" (known-bad package rule),
and ideally a flag on evil_init.pth for the startup-hook behaviour.

If no new rows appear at all: this means the Setup & Protection scan
in your current build doesn't yet walk project folders automatically
(a known gap) — note it as a to-do, don't worry it's "not working".
