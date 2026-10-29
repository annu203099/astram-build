const express = require('express');
const zlib = require('zlib');

const app = express();

// Upload endpoint: streams the raw request body through brotli decompression
// straight back to the response (CVE-2026-111497 shape).
app.post('/upload', (req, res) => { const d = zlib.createBrotliDecompress(); req.pipe(d).pipe(res); });

app.listen(3000, () => {
  console.log('mock upload service listening');
});
