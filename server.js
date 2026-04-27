/**
 * Forgotten Society — backend
 * Раздаёт public/ на localhost:8000.
 * Web-agent хэш считается на клиенте — серверный прокси не нужен.
 */
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║   FORGOTTEN SOCIETY — Voice MITM     ║');
    console.log(`  ║   http://localhost:${PORT}              ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
});
