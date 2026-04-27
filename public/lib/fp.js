/**
 * FingerprintJS wrapper — экспортирует объект с .load() как ожидает index.js.
 * Используем OSS-сборку fingerprintjs v4 с CDN, оборачиваем в совместимый интерфейс.
 */
const FP_CDN = 'https://openfpcdn.io/fingerprintjs/v4/iife.min.js';

let _loadedPromise = null;
function injectScript() {
    if (_loadedPromise) return _loadedPromise;
    _loadedPromise = new Promise((resolve, reject) => {
        if (window.FingerprintJS) return resolve(window.FingerprintJS);
        const s = document.createElement('script');
        s.src = FP_CDN;
        s.onload = () => resolve(window.FingerprintJS);
        s.onerror = () => reject(new Error('FP CDN load failed'));
        document.head.appendChild(s);
    });
    return _loadedPromise;
}

const Wrapper = {
    async load(opts = {}) {
        const FP = await injectScript();
        const agent = await FP.load(opts);
        // имитируем pro-формат ответа get(): { components: {...}, visitorId }
        return {
            async get() {
                const r = await agent.get();
                // OSS возвращает { visitorId, components }, components — flat-объект
                // pro-style (как ждёт сервер) — components: { deviceInfo:{ua,...}, ...}
                return {
                    visitorId: r.visitorId,
                    components: r.components || r
                };
            }
        };
    }
};

export default Wrapper;
