TEST 5 — Byte-path taint: untrusted input into a dangerous sink
====================================================================
These recreate TEST-03 (Brotli / Ruby byte-path bugs): a value that
comes from outside the program (req.body, user_input) flows directly
into a function known to be dangerous with untrusted input
(brotliDecompressSync, Regexp.new).

Copy this whole 05-byte-path-taint folder's CONTENTS into astram-demo.

Then refresh the Boarding Manifest.

Expected: WARN or HOLD on handler.js and/or handler.rb, flagging the
untrusted-input-to-dangerous-sink pattern.

Note: this one depends on your byte-path taint tracer being wired
into the folder scan. If nothing is flagged, this is worth checking
with your team before the demo — it's one of the five official
Black October tests, so judges may ask about it specifically.
