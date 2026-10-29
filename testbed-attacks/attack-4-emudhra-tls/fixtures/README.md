# attack-4-emudhra-tls — fixtures note

No certificates are committed to this directory. The mock "revoked eMudhra
intermediate" PEM (a CERTIFICATE block with deterministic base64 payload) and
the CA bundle PEM that still contains it are **generated at test time** inside
`src/test-04-emudhra-tls.test.ts` when Tier 2 / Phase 2 activates the test.

This keeps the fixture tree free of any data that could be mistaken for a real
trust anchor, and lets `fingerprintPemCert` derive the expected sha256 from a
deterministic payload so the assertions never depend on machine state.

See docs/CONTRACTS.md §3 (`tls-windows-probe` API) and §10 (TEST-04).
