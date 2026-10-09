'use strict';

// External CLI protocol fixture: a separate process, no plugin internals.
const http = require('http');
const crypto = require('crypto');
const connections = new Set();
const token = crypto.randomBytes(16).toString('hex');
const server = http.createServer(async (req, res) => {
    if (req.url === '/api/v1/acp/connect') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ connectionId: 'fixture', sessionToken: token }));
        return;
    }
    if (req.headers['acp-session-token'] !== token) { res.writeHead(401); res.end(); return; }
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n'); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let result;
    if (message.method === 'initialize') result = { protocolVersion: 1, agentCapabilities: {} };
    else if (message.method === 'session/new') result = { sessionId: 'fixture-owned' };
    else if (message.method === 'session/prompt') {
        const response = await fetch(process.env.CODEBUDDY_BASE_URL + '/chat/completions', {
            method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.CODEBUDDY_AUTH_TOKEN },
            body: JSON.stringify({ prompt: message.params.prompt }),
        });
        result = response.ok ? { stopReason: 'end_turn', reply: (await response.json()).text }
            : { stopReason: 'refusal', upstreamStatus: response.status };
    } else result = {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
});
server.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
server.listen(0, '127.0.0.1', () => process.stdout.write('  Endpoint    http://127.0.0.1:' + server.address().port + '\n'));
process.on('SIGTERM', () => { for (const socket of connections) socket.destroy(); server.close(() => process.exit(0)); });
