const zlib = require('zlib');
const http = require('http');

function handleRequest(req, res) {
  // Untrusted request body piped straight into Brotli decompression
  const decompressed = zlib.brotliDecompressSync(req.body);
  res.end(decompressed);
}

module.exports = { handleRequest };
