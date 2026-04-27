/**
 * Получает гостевые userId через WS аудио-гейтвея nekto.me.
 * Подключаемся без токена → шлём register без userId → сервер отдаёт сгенерированный userId в `registered`.
 *
 * Usage: node tools/get-tokens.js [count]
 */
const io = require('socket.io-client');

const URL  = 'wss://audio.nekto.me';
const PATH = '/websocket/';
const ORIGIN = 'https://nekto.me';

function fetchOne(){
    return new Promise((resolve, reject) => {
        const sock = io(URL, {
            path: PATH,
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
            extraHeaders: { Origin: ORIGIN, 'User-Agent': 'Mozilla/5.0 Chrome/124' },
            transportOptions: {
                websocket: { extraHeaders: { Origin: ORIGIN, 'User-Agent': 'Mozilla/5.0 Chrome/124' } }
            }
        });

        const t = setTimeout(() => { try{sock.close();}catch(_){ } reject(new Error('timeout')); }, 12000);

        sock.on('connect', () => {
            sock.emit('register', {
                type: 'register',
                android: false,
                version: 23,
                isTouch: false,
                messengerNeedAuth: true,
                timeZone: 'Europe/Moscow',
                locale: 'ru'
            });
        });

        sock.on('message', data => {
            if (!data) return;
            if (data.type === 'registered' || data.userId || data.user_id){
                const id = data.userId || data.user_id || data.connectionId;
                if (id){
                    clearTimeout(t);
                    try{ sock.close(); }catch(_){ }
                    resolve(id);
                }
            }
        });

        sock.on('connect_error', e => { clearTimeout(t); reject(new Error('connect_error: '+e.message)); });
        sock.on('error',         e => { clearTimeout(t); reject(new Error('error: '+(e.message||e))); });
    });
}

(async () => {
    const n = Math.max(2, parseInt(process.argv[2] || '2', 10));
    const out = [];
    for (let i = 0; i < n; i++){
        try {
            const id = await fetchOne();
            console.log(`Token #${i+1}: ${id}`);
            out.push(id);
        } catch (e){
            console.error(`Token #${i+1} FAIL:`, e.message);
        }
        await new Promise(r => setTimeout(r, 400 + Math.random()*800));
    }
    console.log('\nJSON:', JSON.stringify(out));
})();
