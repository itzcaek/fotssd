/**
 * Forgotten Society — Audio MITM Client v2
 *
 * Топология:
 *   Собеседник 1 ↔ Клиент 1 (Leader) ↔ ВЫ (оператор/микшер) ↔ Клиент 2 (Follower) ↔ Собеседник 2
 *
 * Протокол (из nekto-audio-ref, проверенный):
 *   - socket.io 2.x к wss://audio.nekto.me, path /websocket/
 *   - Все сообщения идут через event name "event" с полем type в data
 *   - Авторизация: register → registered → web-agent (alarm hash) → scan-for-peer
 *   - WebRTC: peer-connect → offer/answer → ice-candidate → peer-connection
 *
 * Alarm hash (web-agent):
 *   base64(sha256hex(userId + "BYdKPTYYGZ7ALwA" + "8oNm2" + internalId))
 */

// ═══════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════

const NEKTO_WS_URL  = 'wss://audio.nekto.me';
const NEKTO_WS_PATH = '/websocket/';
const ALARM_SALT_1  = 'BYdKPTYYGZ7ALwA';
const ALARM_SALT_2  = '8oNm2';

// ═══════════════════════════════════════════════════════════════
// Crypto: web-agent (alarm) hash
// ═══════════════════════════════════════════════════════════════

async function computeWebAgent(userId, internalId) {
    const raw = userId + ALARM_SALT_1 + ALARM_SALT_2 + String(internalId);
    const encoded = new TextEncoder().encode(raw);
    const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
    const hashHex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return btoa(hashHex);
}

// ═══════════════════════════════════════════════════════════════
// DOM refs (заполняются после DOMContentLoaded)
// ═══════════════════════════════════════════════════════════════

let screens, buttons, inputs, switches, timerEl, callContainer;

function initDOMRefs() {
    screens = {
        welcome:        document.getElementById('welcome-screen'),
        options:        document.getElementById('options-screen'),
        call:           document.getElementById('call-screen'),
        end:            document.getElementById('end-screen'),
        waiting:        document.getElementById('waiting-screen'),
        warning:        document.getElementById('warning-screen'),
        microphoneError:document.getElementById('microphone-error-screen'),
        token:          document.getElementById('token-screen'),
        tokenFail:      document.getElementById('token-fail-screen')
    };
    buttons = {
        start:          document.querySelector('.start-button'),
        init:           document.querySelector('.init-button'),
        saveDialog:     document.getElementById('save-dialog'),
        back:           document.querySelectorAll('.back-button'),
        backToOptions:  document.querySelectorAll('.back-to-options-btn'),
        backAutoRestart:document.getElementById('back-auto-restart'),
        mute:           document.getElementById('mute-btn'),
        restart:        document.getElementById('restart-btn'),
        saveAudio:      document.getElementById('save-audio-btn'),
        saveTokens:     document.getElementById('save-btn'),
        restartDialog:  document.querySelector('.restart-button')
    };
    inputs = {
        firstTokenInput:  document.getElementById('first-token-input'),
        secondTokenInput: document.getElementById('second-token-input')
    };
    switches = {
        autorestart: document.getElementById('switch-autorestart'),
        refind:      document.getElementById('switch-refind')
    };
    timerEl       = document.querySelector('.timer');
    callContainer = document.querySelector('.call-container');
}

// ═══════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════

class Timer {
    constructor(el) {
        this.el = el;
        this.interval = null;
        this.tsp = null;
        this.reset();
    }
    start() {
        if (this.interval) return;
        this.tsp = new Date();
        this.el.textContent = '00:00';
        this.interval = setInterval(() => {
            const d = Math.floor((new Date() - this.tsp) / 1000);
            const m = String(Math.floor(d / 60)).padStart(2, '0');
            const s = String(d % 60).padStart(2, '0');
            this.el.textContent = `${m}:${s}`;
        }, 1000);
    }
    stop()  { if (this.interval) { clearInterval(this.interval); this.interval = null; } }
    reset() { this.stop(); this.tsp = null; if (this.el) this.el.textContent = '00:00'; }
}

// ═══════════════════════════════════════════════════════════════
// Mini event emitter
// ═══════════════════════════════════════════════════════════════

class Emitter {
    constructor() { this._h = {}; }
    on(t, cb) { (this._h[t] = this._h[t] || []).push(cb); }
    off(t, cb) { if (this._h[t]) this._h[t] = this._h[t].filter(x => x !== cb); }
    emit(t, d) { (this._h[t] || []).forEach(cb => cb(d)); }
}

// ═══════════════════════════════════════════════════════════════
// AudioMixer — AudioContext + GainNode + MediaStreamDestination
// ═══════════════════════════════════════════════════════════════

class AudioMixer {
    constructor(ctx) {
        this.ctx    = ctx || new (window.AudioContext || window.webkitAudioContext)();
        this.gain   = this.ctx.createGain();
        this.dest   = this.ctx.createMediaStreamDestination();
        this.gain.connect(this.dest);
    }
    /** Подключить входящий поток к этому микшеру */
    addSource(stream) {
        if (!stream) return;
        try {
            const src = this.ctx.createMediaStreamSource(stream);
            src.connect(this.gain);
        } catch (e) { console.warn('[AudioMixer] addSource fail:', e.message); }
    }
    /** Получить выходной MediaStream (для addTrack или MediaRecorder) */
    get outputStream() { return this.dest.stream; }
}

// ═══════════════════════════════════════════════════════════════
// CallElement — UI-карточка одного клиента
// ═══════════════════════════════════════════════════════════════

class CallElement {
    constructor(label) {
        this.mainEl = document.createElement('div');
        this.mainEl.className = 'call-element';

        this.avatar = document.createElement('img');
        this.avatar.className = 'avatar';
        const idx = Math.floor(Math.random() * 3);
        this.avatar.src = `assets/avatars/avatar-${idx}.png`;
        this.avatar.onerror = () => {
            this.avatar.src = `https://placehold.co/80x80/00ff88/000000?text=${label || idx}`;
        };

        this.statusEl = document.createElement('div');
        this.statusEl.className = 'status';
        this.statusEl.textContent = 'Ожидание...';

        this.muteIcon = document.createElement('i');
        this.muteIcon.className = 'mute-icon hidden';
        this.muteIcon.textContent = '🔇';

        this.mainEl.append(this.avatar, this.statusEl, this.muteIcon);
        this._buildMenu();
    }

    _buildMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu hidden';
        const mk = (text, evt, danger) => {
            const b = document.createElement('button');
            b.textContent = text;
            if (danger) b.className = 'danger';
            b.onclick = () => this.mainEl.dispatchEvent(new CustomEvent(evt));
            return b;
        };
        this.menu.append(
            mk('🔇 Mute', 'mute'),
            mk('🔊 Unmute', 'sound'),
            document.createElement('hr'),
            mk('❌ Отключить', 'disconnect', true)
        );
        document.body.appendChild(this.menu);
        this.mainEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.menu.classList.remove('hidden');
            this.menu.style.left = e.pageX + 'px';
            this.menu.style.top = e.pageY + 'px';
        });
        document.addEventListener('click', () => this.menu.classList.add('hidden'));
    }

    setState(text)       { this.statusEl.textContent = text; }
    showMute(show)       { this.muteIcon.classList.toggle('hidden', !show); }
    setConnected(state)  { this.mainEl.classList.toggle('connected', !!state); }
    addEventListener(t, cb) { this.mainEl.addEventListener(t, cb); }
}

// ═══════════════════════════════════════════════════════════════
// Client — один socket.io клиент к nekto.me audio
// ═══════════════════════════════════════════════════════════════

class Client extends Emitter {
    constructor(userId, label) {
        super();
        this.userId       = userId;
        this.label        = label || userId.slice(0, 8);
        this.callEl       = new CallElement(label);
        this.connectionId = null;
        this.searching    = false;
        this.peer         = null;
        this.initiator    = false;
        this.remoteStream = null;   // голос собеседника (входящий)
        this.outgoingMixer = null;  // AudioMixer — что мы отправляем собеседнику (MITM)
        this.io           = null;

        this._initSocket();
    }

    log(msg, ...args) { console.log(`[${this.label}] ${msg}`, ...args); }

    // ── Socket.io ──────────────────────────────────────────────

    _initSocket() {
        this.io = io(NEKTO_WS_URL, {
            path: NEKTO_WS_PATH,
            transports: ['websocket'],
            forceNew: true,
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10
        });

        this.io.on('connect', () => {
            this.log('✅ socket connected');
            this._sendRegister();
        });

        // nekto audio gateway отправляет все сообщения через event name "event"
        // но на всякий случай слушаем и "message" (в деобфусцированном Forgotten было так)
        this.io.on('event',   data => this._dispatch(data));
        this.io.on('message', data => this._dispatch(data));

        this.io.on('connect_error', err => this.log('❌ connect_error:', err.message));
        this.io.on('error',         err => this.log('❌ error:', err));
        this.io.on('disconnect', reason => {
            this.log('🔌 disconnect:', reason);
            this.emit('disconnected');
        });

        setTimeout(() => {
            if (!this.connectionId) this.log('⏰ нет peer-connect — проверь токен');
        }, 15000);
    }

    _dispatch(data) {
        if (!data || !data.type) return;
        this.log('← ' + data.type, data);
        this.emit(data.type, data);
    }

    /** Отправить сообщение на nekto.me через socket.io event "event" */
    _send(payload) {
        this.log('→ ' + payload.type, payload);
        this.io.emit('event', payload);
    }

    // ── Протокол nekto.me audio ─────────────────────────────

    _sendRegister() {
        this._send({
            type:     'register',
            android:  false,
            version:  23,
            userId:   this.userId,
            isTouch:  false,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale:   navigator.language.split('-')[0]
        });
    }

    async handleRegistered(data) {
        const internalId = data.internal_id ?? data.internalId ?? data.connectionId ?? '';
        this.log('✅ registered, internal_id=' + internalId);

        // Вычисляем web-agent hash (alarm) прямо в браузере — бэкенд не нужен
        const webAgent = await computeWebAgent(this.userId, internalId);
        this.log('🔑 web-agent computed');

        this._send({ type: 'web-agent', data: webAgent });

        this.emit('auth-done', data);
    }

    search(criteria) {
        if (this.searching) return;
        this.searching = true;
        this.callEl.setState('Поиск...');
        this._send({
            type: 'scan-for-peer',
            peerToPeer: true,
            token: null,
            searchCriteria: criteria
        });
    }

    stopSearch() {
        this.searching = false;
        this._send({ type: 'stop-scan' });
    }

    disconnectPeer() {
        if (this.connectionId) {
            this._send({ type: 'peer-disconnect', connectionId: this.connectionId });
        } else {
            this.stopSearch();
        }
        this.connectionId = null;
        this.searching = false;
        if (this.peer) {
            try { this.peer.close(); } catch (_) {}
            this.peer = null;
        }
        this.callEl.setConnected(false);
    }

    // ── WebRTC ──────────────────────────────────────────────

    async handlePeerConnect(data) {
        this.connectionId = data.connectionId;
        this.initiator = !!data.initiator;
        this.callEl.setState('Соединение...');

        // TURN/STUN серверы
        let iceServers = [];
        try {
            const raw = data.turnParams || data.params || '[]';
            const parsed = JSON.parse(raw);
            iceServers = parsed.map(s => ({
                urls:       s.url || s.urls,
                username:   s.username || undefined,
                credential: s.credential || undefined
            }));
        } catch (e) { this.log('⚠️ TURN parse error:', e.message); }

        this.peer = new RTCPeerConnection({ iceServers });

        // Добавляем ИСХОДЯЩИЙ поток (голос другого клиента — MITM ретрансляция)
        if (this.outgoingMixer) {
            const outTrack = this.outgoingMixer.outputStream.getAudioTracks()[0];
            if (outTrack) {
                this.peer.addTrack(outTrack, this.outgoingMixer.outputStream);
                this.log('🎵 outgoing track added to PeerConnection');
            } else {
                this.log('⚠️ нет outgoing audio track');
            }
        } else {
            this.log('⚠️ нет outgoingMixer — MITM не сработает');
        }

        this._setupPeerEvents();

        if (this.initiator) {
            this._send({
                type: 'peer-mute',
                connectionId: this.connectionId,
                muted: false
            });
            const offer = await this.peer.createOffer();
            await this.peer.setLocalDescription(offer);
            this._send({
                type: 'offer',
                offer: JSON.stringify({ sdp: offer.sdp, type: offer.type }),
                connectionId: this.connectionId
            });
        }
    }

    async handleOffer(data) {
        if (!this.peer) return;
        this.log('📩 received offer');
        const offer = JSON.parse(data.offer);
        await this.peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        this._send({
            type: 'answer',
            answer: JSON.stringify({ sdp: answer.sdp, type: answer.type }),
            connectionId: this.connectionId
        });
    }

    async handleAnswer(data) {
        if (!this.peer) return;
        this.log('📩 received answer');
        const answer = JSON.parse(data.answer);
        await this.peer.setRemoteDescription(new RTCSessionDescription(answer));
    }

    async handleIceCandidate(data) {
        if (!this.peer) return;
        try {
            const parsed = JSON.parse(data.candidate);
            const candidate = parsed.candidate || parsed;
            if (typeof candidate === 'string') {
                await this.peer.addIceCandidate(new RTCIceCandidate({
                    candidate: candidate,
                    sdpMid: String(parsed.sdpMid ?? '0'),
                    sdpMLineIndex: parsed.sdpMLineIndex ?? 0
                }));
            } else if (candidate.candidate) {
                await this.peer.addIceCandidate(new RTCIceCandidate({
                    candidate: candidate.candidate,
                    sdpMid: String(candidate.sdpMid ?? '0'),
                    sdpMLineIndex: candidate.sdpMLineIndex ?? 0
                }));
            }
        } catch (e) { this.log('⚠️ addIceCandidate fail:', e.message); }
    }

    _setupPeerEvents() {
        this.peer.ontrack = (ev) => {
            this.log('🎧 received remote track');
            this.remoteStream = new MediaStream([ev.track]);
            this.callEl.setConnected(true);
            this.callEl.setState('В эфире');

            this._send({
                type: 'stream-received',
                connectionId: this.connectionId
            });

            this.emit('remote-track', this.remoteStream);
        };

        this.peer.onicecandidate = (ev) => {
            if (!ev.candidate || !this.connectionId) return;
            this._send({
                type: 'ice-candidate',
                candidate: JSON.stringify({
                    candidate: ev.candidate.candidate,
                    sdpMid: ev.candidate.sdpMid || '0',
                    sdpMLineIndex: ev.candidate.sdpMLineIndex || 0
                }),
                connectionId: this.connectionId
            });
        };

        this.peer.onconnectionstatechange = () => {
            const st = this.peer?.connectionState;
            this.log('🔗 RTC state: ' + st);
            if (st === 'connected') {
                this._send({
                    type: 'peer-connection',
                    connectionId: this.connectionId,
                    connection: true
                });
            } else if (st === 'disconnected' || st === 'failed' || st === 'closed') {
                this.callEl.setConnected(false);
                this.connectionId = null;
                this.emit('peer-lost');
            }
        };
    }

    toggleMute() {
        if (!this.outgoingMixer) return;
        const track = this.outgoingMixer.outputStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            this.callEl.showMute(!track.enabled);
        }
    }

    destroy() {
        this.disconnectPeer();
        if (this.io) { this.io.disconnect(); this.io = null; }
    }
}

// ═══════════════════════════════════════════════════════════════
// Room — связывает двух клиентов в MITM-цепочку
// ═══════════════════════════════════════════════════════════════

class Room {
    constructor(timer) {
        this.timer   = timer;
        this.members = [];           // [Client, Client]
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        // Микшер для мониторинга/записи (оператор слышит обоих)
        this.monitorMixer = new AudioMixer(this.audioCtx);

        this.recorder    = null;
        this.chunks      = [];
        this.autorestart = false;
        this.refind      = false;
    }

    addMember(client) {
        if (this.members.length >= 2) return;
        this.members.push(client);
        if (callContainer) callContainer.appendChild(client.callEl.mainEl);
    }

    /**
     * Ключ MITM — перекрёстная маршрутизация аудио:
     *   Голос собеседника клиента A → отправляется клиентом B (и наоборот)
     */
    setupMITM() {
        if (this.members.length < 2) return;
        const [c1, c2] = this.members;

        // Персональный AudioMixer для каждого клиента:
        //   c1.outgoingMixer = то, что c1 отправляет СВОЕМУ собеседнику = голос собеседника c2
        //   c2.outgoingMixer = то, что c2 отправляет СВОЕМУ собеседнику = голос собеседника c1
        c1.outgoingMixer = new AudioMixer(this.audioCtx);
        c2.outgoingMixer = new AudioMixer(this.audioCtx);

        // Когда c1 получает голос от своего собеседника → маршрутизируем в c2 (и в монитор)
        c1.on('remote-track', stream => {
            c2.outgoingMixer.addSource(stream);    // c2 отправит этот голос своему собеседнику
            this.monitorMixer.addSource(stream);   // оператор слышит
            this.log('🔀 c1 remote → c2 outgoing + monitor');
        });

        // Когда c2 получает голос от своего собеседника → маршрутизируем в c1 (и в монитор)
        c2.on('remote-track', stream => {
            c1.outgoingMixer.addSource(stream);    // c1 отправит этот голос своему собеседнику
            this.monitorMixer.addSource(stream);   // оператор слышит
            this.log('🔀 c2 remote → c1 outgoing + monitor');
        });
    }

    log(msg, ...args) { console.log('[Room] ' + msg, ...args); }

    /** Формирует searchCriteria для nekto.me audio */
    buildCriteria() {
        const sexEl     = document.getElementById('search-sex');
        const wishSexEl = document.getElementById('search-wish-sex');
        const ageEl     = document.getElementById('search-age');

        const sexMap = { M: 'MALE', F: 'FEMALE' };
        const userSex = sexMap[sexEl?.value] || 'MALE';

        let peerSex = 'ANY';
        if (wishSexEl?.value === 'M') peerSex = 'MALE';
        else if (wishSexEl?.value === 'F') peerSex = 'FEMALE';

        // Парсим возраст "18,25" → { from: 18, to: 25 }
        let userAge = { from: 18, to: 44 };
        let peerAges = [{ from: 18, to: 44 }];
        if (ageEl?.value) {
            const parts = ageEl.value.split(',').map(Number);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                userAge  = { from: parts[0], to: parts[1] };
                peerAges = [{ from: parts[0], to: parts[1] }];
            }
        }

        return {
            group:    0,
            userSex:  userSex,
            peerSex:  peerSex,
            userAge:  userAge,
            peerAges: peerAges
        };
    }

    search() {
        const criteria = this.buildCriteria();
        this.log('🚀 search', criteria);
        this.members.forEach(m => {
            m.searching = false;
            m.search(criteria);
        });
    }

    restart() {
        this.members.forEach(m => {
            m.callEl.setState('Поиск...');
            m.disconnectPeer();
        });
        setTimeout(() => this.search(), 800);
    }

    /** Инициализация MITM-связки, обработчики событий */
    init(micStream) {
        if (this.members.length < 2) return;

        this.setupMITM();

        // Подключаем микрофон оператора в монитор (для записи)
        this.monitorMixer.addSource(micStream);

        // Регистрация обработчиков для каждого клиента
        let authCount = 0;
        this.members.forEach((m, idx) => {

            // После auth → ждём пока оба зарегистрируются, потом search
            m.on('registered', data => m.handleRegistered(data));
            m.on('auth-done', () => {
                authCount++;
                if (authCount === this.members.length) {
                    this.log('✅ оба клиента авторизованы — запускаем поиск');
                    setTimeout(() => this.search(), 500);
                }
            });

            // WebRTC события
            m.on('peer-connect',   data => m.handlePeerConnect(data));
            m.on('offer',          data => m.handleOffer(data));
            m.on('answer',         data => m.handleAnswer(data));
            m.on('ice-candidate',  data => m.handleIceCandidate(data));
            m.on('peer-disconnect',() => {
                m.connectionId = null;
                m.callEl.setConnected(false);
                m.emit('peer-lost');
            });

            // Когда оба подключены — запускаем таймер
            m.on('remote-track', () => {
                if (this.areAllConnected()) {
                    if (!this.timer.interval) this.timer.start();
                    if (screens && !screens.call.classList.contains('active')) toggleScreen('call');
                }
            });

            // Потеря соединения
            m.on('peer-lost', () => {
                if (this.areAllDisconnected()) {
                    this.timer.stop();
                    this.timer.reset();
                    if (this.autorestart) {
                        toggleScreen('waiting');
                        setTimeout(() => {
                            this.downloadLastDialog();
                            this.search();
                        }, 1000 + Math.random() * 2000);
                    } else {
                        toggleScreen('end');
                    }
                } else if (this.refind) {
                    setTimeout(() => {
                        m.searching = false;
                        m.search(this.buildCriteria());
                    }, 800);
                }
            });

            // UI: context menu
            m.callEl.addEventListener('disconnect', () => m.disconnectPeer());
            m.callEl.addEventListener('mute', () => m.toggleMute());
        });

        // Запись
        this.createRecorder();
        this.recorder.start(1000);

        // Воспроизведение мониторинга (оператор слышит обоих)
        this._playMonitor();
    }

    _playMonitor() {
        const audio = new Audio();
        audio.srcObject = this.monitorMixer.outputStream;
        audio.play().catch(e => this.log('monitor autoplay blocked:', e.message));
    }

    createRecorder() {
        try {
            this.recorder = new MediaRecorder(this.monitorMixer.outputStream, {
                mimeType: 'audio/webm;codecs=opus'
            });
        } catch (e) {
            this.log('MediaRecorder fallback mimeType');
            this.recorder = new MediaRecorder(this.monitorMixer.outputStream);
        }
        this.chunks = [];
        this.recorder.ondataavailable = e => {
            if (e.data && e.data.size) this.chunks.push(e.data);
        };
    }

    downloadLastDialog() {
        if (!this.chunks.length) { alert('Нет записи'); return; }
        const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dialog-${Date.now()}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    areAllConnected()    { return this.members.length === 2 && this.members.every(m => m.connectionId); }
    areAllDisconnected() { return this.members.every(m => !m.connectionId); }
}

// ═══════════════════════════════════════════════════════════════
// UI helpers
// ═══════════════════════════════════════════════════════════════

function toggleScreen(name) {
    if (!screens) return;
    Object.values(screens).forEach(s => s && s.classList.remove('active'));
    if (screens[name]) screens[name].classList.add('active');
    document.querySelectorAll('header a').forEach(a =>
        a.classList.toggle('active', a.dataset.screen === name)
    );
}

function setTokens(t) { localStorage.setItem('tokens', JSON.stringify(t)); }
function getTokens()  { const t = localStorage.getItem('tokens'); return t ? JSON.parse(t) : null; }

function toggleLoading(button) {
    if (!button) return;
    if (!button.disabled) {
        button.dataset.text = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '⏳';
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.text || button.innerHTML;
    }
}

// ═══════════════════════════════════════════════════════════════
// startApp — основной запуск
// ═══════════════════════════════════════════════════════════════

async function startApp(button, room) {
    toggleLoading(button);

    room.autorestart = !!switches?.autorestart?.checked;
    room.refind      = !!switches?.refind?.checked;

    const tokens = getTokens();
    if (!tokens || tokens.length < 2) {
        toggleLoading(button);
        toggleScreen('token');
        return;
    }

    try {
        if (!navigator.mediaDevices?.getUserMedia)
            throw new Error('mediaDevices недоступен — используй localhost или HTTPS');

        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });

        if (room.members.length < 2) {
            room.addMember(new Client(tokens[0], 'C1'));
            room.addMember(new Client(tokens[1], 'C2'));
            room.init(mic);

            // Микрофон оператора по умолчанию выключен
            const micTrack = mic.getAudioTracks()[0];
            if (micTrack) micTrack.enabled = false;

            if (buttons.mute) {
                buttons.mute.textContent = 'Mic OFF';
                buttons.mute.onclick = () => {
                    micTrack.enabled = !micTrack.enabled;
                    buttons.mute.textContent = micTrack.enabled ? 'Mic ON' : 'Mic OFF';
                };
            }
        }

        toggleLoading(button);
    } catch (err) {
        console.error('[startApp]', err);
        toggleLoading(button);
        toggleScreen('microphoneError');
    }
}

// ═══════════════════════════════════════════════════════════════
// DOMContentLoaded — связываем всё вместе
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initDOMRefs();

    const timer = new Timer(timerEl);
    const room  = new Room(timer);
    window.room = room;  // для дебага из консоли

    // Warning splash
    const warningBtn = screens.warning?.querySelector('.back-button');
    if (warningBtn) {
        let cd = 2500;
        warningBtn.disabled = true;
        const orig = warningBtn.textContent;
        const iv = setInterval(() => {
            if (cd <= 0) { clearInterval(iv); warningBtn.disabled = false; warningBtn.textContent = orig; }
            else { warningBtn.textContent = (cd / 1000).toFixed(1) + ' с.'; cd -= 100; }
        }, 100);
        warningBtn.onclick = () => toggleScreen('welcome');
    }
    setTimeout(() => toggleScreen('warning'), 300);

    // Header nav
    document.querySelectorAll('header a').forEach(link => {
        link.onclick = e => {
            e.preventDefault();
            const s = link.dataset.screen;
            if (s === 'logs') { alert('Логи — открой DevTools (F12) → Console'); return; }
            if (s) toggleScreen(s);
        };
    });

    // Start buttons
    if (buttons.start) buttons.start.onclick = () => startApp(buttons.start, room);
    if (buttons.init)  buttons.init.onclick  = () => startApp(buttons.init, room);

    // Back buttons
    buttons.back?.forEach(b => { if (b) b.onclick = () => toggleScreen('welcome'); });
    buttons.backToOptions?.forEach(b => { if (b) b.onclick = () => toggleScreen('options'); });

    // Token save
    const saveTokensFn = () => {
        const t1 = inputs.firstTokenInput?.value.trim();
        const t2 = inputs.secondTokenInput?.value.trim();
        if (t1 && t2 && t1 !== t2) {
            setTokens([t1, t2]);
            alert('Токены сохранены');
            location.reload();
        } else {
            alert('Нужны два РАЗНЫХ токена');
        }
    };
    if (buttons.saveTokens) buttons.saveTokens.onclick = saveTokensFn;
    if (buttons.saveDialog) buttons.saveDialog.onclick = saveTokensFn;

    [inputs.firstTokenInput, inputs.secondTokenInput].forEach(i => {
        if (!i) return;
        i.oninput = () => {
            const t1 = inputs.firstTokenInput?.value.trim();
            const t2 = inputs.secondTokenInput?.value.trim();
            if (buttons.saveTokens) buttons.saveTokens.disabled = !(t1 && t2 && t1 !== t2);
        };
    });

    // Audio controls
    if (buttons.saveAudio) buttons.saveAudio.onclick = () => room.downloadLastDialog();
    if (buttons.restart)   buttons.restart.onclick   = () => room.restart();

    // Switches
    if (switches.autorestart) switches.autorestart.onchange = () => { room.autorestart = switches.autorestart.checked; };
    if (switches.refind)      switches.refind.onchange      = () => { room.refind = switches.refind.checked; };

    // Restore tokens
    const tk = getTokens();
    if (tk) {
        if (inputs.firstTokenInput)  inputs.firstTokenInput.value  = tk[0] || '';
        if (inputs.secondTokenInput) inputs.secondTokenInput.value = tk[1] || '';
    }
});
