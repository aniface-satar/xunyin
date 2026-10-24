/*!
 * @name 落雪云更新音源(实测)
 * @description 启动自动拉取服务器最新实测音源配置，桌面端云端换源即时生效，移动端内置兜底+更新提醒
 * @version 2026.10.20
 * @author ql-lx-source
 * @homepage https://github.com/moxi5445/lx-music-cloud
 *
 * 固定导入地址（永久有效）：https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js
 * 运行时配置通道（按序回退）：raw.githubusercontent / cdn.jsdelivr / fastly.jsdelivr / gh-proxy / ghproxy
 *
 * 由 ql-lx-source 1.3.2 于 2026-10-20 13:00:02 自动生成
 * 成员仅收录当轮五平台真实取链成功者（平台:实测最高音质）：
 *   1. 𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ（实测 酷我:flac24bit/酷狗:flac24bit/QQ音乐:flac24bit/网易云:flac24bit/咪咕:flac，47分）
 *   2. stellarwave-v3.2.0（实测 酷我:flac24bit/酷狗:flac24bit/QQ音乐:flac24bit/网易云:flac，39.3分）
 *   3. K×H测试（实测 酷我:flac24bit/酷狗:flac24bit/网易云:flac24bit/咪咕:flac，39分）
 *   4. 稳定版音源 v1.0.2-debug（实测 QQ音乐:128k，6.6分）
 */
'use strict';
(function () {
  var LX = globalThis.lx;
  if (!LX || !LX.EVENT_NAMES || typeof LX.on !== 'function' || typeof LX.send !== 'function') return;
  var E = LX.EVENT_NAMES;
  var QORDER = ['128k', '320k', 'flac', 'flac24bit'];
  var QRANK = { '128k': 1, '320k': 2, 'flac': 3, 'flac24bit': 4 };
  var P_ALIAS = { git: 'kg', kgdb: 'kg' };
  var Q_ALIAS = { hires: 'flac24bit', master: 'flac24bit', zida: 'flac', atmos: 'flac', dolby: 'flac' };
  var PNAME = { kw: '酷我音乐', kg: '酷狗音乐', tx: 'QQ音乐', wy: '网易云音乐', mg: '咪咕音乐' };
  var URL_RE = new RegExp('^https?://', 'i');
  var MEMBERS = [{"n":"𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ","v":"260925","a":"hello world","s":47.04,"caps":{"kw":4,"kg":4,"tx":4,"wy":4,"mg":3}},{"n":"stellarwave-v3.2.0","v":"","a":"","s":39.28,"caps":{"kw":4,"kg":4,"tx":4,"wy":3}},{"n":"K×H测试","v":"1.7.17","a":"HYW & Koneko","s":39.02,"caps":{"kw":4,"kg":4,"wy":4,"mg":3}},{"n":"稳定版音源 v1.0.2-debug","v":"1.0.2-debug","a":"LX","s":6.61,"caps":{"tx":1}}];
  var REAL_GLOBAL = globalThis;
  var states = [];

  // 成员脚本产生的未处理异常不得影响聚合本体（typeof 探测，避免宿主无此 API 时引用报错）
  if (typeof addEventListener === 'function') {
    try {
      addEventListener('unhandledrejection', function (ev) { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {} });
      addEventListener('error', function (ev) { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {} }, true);
    } catch (e) {}
  }

  function canonQ(q) {
    if (QRANK[q]) return q;
    var c = Q_ALIAS[String(q).toLowerCase()];
    return c || null;
  }
  function canonP(k) {
    if (k === 'kw' || k === 'kg' || k === 'tx' || k === 'wy' || k === 'mg') return k;
    return P_ALIAS[k] || null;
  }

  var NOOP = function () {};
  var CONSOLE_KEYS = ['log', 'info', 'warn', 'error', 'debug', 'group', 'groupEnd', 'groupCollapsed', 'time', 'timeEnd', 'table', 'trace', 'count', 'assert', 'dir'];

  // 注入给成员的 lx 外观：事件与请求全部走真实宿主，但 on/send 被成员私用拦截
  function makeFacade(st) {
    return {
      EVENT_NAMES: E,
      version: LX.version,
      env: LX.env,
      currentScriptInfo: { name: st.m.n, description: '', version: st.m.v, author: st.m.a, homepage: '', rawScript: '' },
      request: function () { return LX.request.apply(LX, arguments); },
      on: function (ev, cb) { if (ev === E.request && typeof cb === 'function') st.handler = cb; },
      send: function (ev, data) {
        if (ev === E.inited && data) st.sources = data.sources || data;
        return Promise.resolve();
      },
      utils: LX.utils,
    };
  }

  // 成员私有沙箱：原型委托真实全局（setTimeout/Promise 等照常可用），
  // 自有属性注入 lx/globalThis/window/self/global/console，隔离污染与反调试改写
  function makeSandbox(lx) {
    var sb;
    try { sb = Object.create(REAL_GLOBAL); } catch (e) { sb = {}; }
    var quiet = {};
    for (var i = 0; i < CONSOLE_KEYS.length; i++) quiet[CONSOLE_KEYS[i]] = NOOP;
    function def(name, value) {
      try {
        Object.defineProperty(sb, name, { value: value, writable: true, configurable: true, enumerable: true });
      } catch (e) { try { sb[name] = value; } catch (e2) {} }
    }
    def('console', quiet);
    def('lx', lx);
    def('globalThis', sb);
    def('window', sb);
    def('self', sb);
    def('global', sb);
    sb.console = quiet;
    return sb;
  }

    (function () {
    var st = { m: MEMBERS[0], handler: null, sources: null };
    states.push(st);
    var lx = makeFacade(st);
    var sb = makeSandbox(lx);
    try {
      (function (lx, window, self, global, globalThis, console) {
/*!
 * @name 𝖧౿ᥣᥣ𝗈 Ԝ𝗈𝗋ᥣᑯ
 * @author hello world
 * @version 260925
 * @description 每天都要开心哦,无论如何...
 * 1004342496←有bug就说(应该没有🤓)或者催更
 */

const ENABLE_CACHE = true;
const CACHE_TTL = 20 * 60 * 1000;
const TIMEOUT = 10000;
const RACE_APIS = false;
const CONFIG = {
  kw: {
    name: '酷我音乐',
    apis: [
      {
        api: 'https://musicserver.haitangw.cc/v1/music/resolve-url',
        idField: ['hash', 'songmid', 'rid', 'id'],
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0'
        },
        body: { source: 'kw', rid: '{id}', level: '{quality}' },
        urlField: ['data.url'],
        quality: {
          atmos: 'atmos',
          atmos_plus: 'atmos_plus',
          master: 'master'
        }
      },
{
  api: 'http://nmobi.kuwo.cn/mobi.s?f=web&user=0&source=kwplayerhd_ar_6.6.6.6_tianbao_T1A_qirui.apk&type=convert_url_with_sign&rid={id}&br={quality}',
  idField: ['rid', 'hash', 'songId', 'id', 'songmid'],
  urlField: ['data.url'],
  quality: {
    '128k': '128kmp3',
    '320k': '320kmp3',
    flac: '2000kflac',
    flac24bit: '4000kflac',
    hires: '4000kflac',
    atmos: '20201kmflac',
    atmos_plus: '20501kmflac',
    master: '20900kmflac'
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Linux; Android) AppleWebKit/537.36'
        }
      }
    ]
  },
  kg: {
    name: '酷狗音乐',
    apis: [
      {
        api: 'http://103.79.184.97/api/music/url?source=kg&songId={id}&quality={quality}&key=6C1F-53W0-GRKI-EVFG',
        idField: ['hash', 'songmid', 'id', 'rid'],
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'X-Card-Key': '6C1F-53W0-GRKI-EVFG'
        },
        urlField: ['url', 'data.url'],
        quality: {
          '128k': '128k',
          '320k': '320k',
          flac: 'flac'
        }
      },
      {
        api: 'https://yy.zddyr.top/lx/api/?source=kg&quality={quality}&mainHash={id}',
        idField: ['hash', 'songmid', 'id', 'rid'],
        urlField: ['url'],
        quality: {
          '128k': '128k',
          '320k': '320k',
          flac: 'flac',
          hires: 'hires'
        },
        before: (() => {
          let deviceId = '', token = '', tokenTs = 0;
          const SCRIPT = 'YYMusicSource', VER = 'v1.0.0';
          return (params) => {
            if (!deviceId) deviceId = 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
            if (!token || Date.now() - tokenTs > 5 * 60 * 1000) {
              const payload = { device_id: deviceId, ip: '0.0.0.0', timestamp: Math.floor(Date.now() / 1000), random: Math.random().toString(36).substring(2, 12) };
              try {
                if (globalThis.lx?.utils?.buffer?.from) {
                  const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
                  token = globalThis.lx.utils.buffer.bufToString(buf, 'base64');
                } else { token = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); }
              } catch (e) { token = ''; }
              tokenTs = Date.now();
            }
            params.headers = params.headers || {};
            params.headers['X-Token'] = token;
            params.headers['X-Client'] = `${SCRIPT}/${VER} (Android)`;
            return params;
          };
        })()
      },
      {
        api: 'https://musicserver.haitangw.cc/v1/music/resolve-url',
        idField: ['hash', 'songmid', 'id', 'rid'],
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: { source: 'kg', rid: '{id}', level: '{quality}' },
        urlField: ['data.url'],
        quality: {
          '128k': 'standard',
          '320k': 'exhigh',
          flac: 'lossless',
          hires: 'hires',
          atmos: 'atmos',
          master: 'clear'
        }
      }
    ]
  },
  tx: {
    name: 'QQ音乐',
    apis: [
      {
        api: 'http://103.79.184.97/api/music/url?source=tx&songId={id}&quality={quality}&key=6C1F-53W0-GRKI-EVFG',
        idField: ['songmid', 'id', 'hash'],
        headers: { 'User-Agent': 'Mozilla/5.0', 'X-Card-Key': '6C1F-53W0-GRKI-EVFG' },
        urlField: ['url', 'data.url'],
        quality: { '128k': '128k', '320k': '320k', flac: 'flac', flac24bit: 'flac24bit' }
      },
      {
        api: 'https://yy.zddyr.top/lx/api/?source=tx&songmid={id}&quality={quality}',
        idField: ['songmid', 'id', 'hash'],
        urlField: ['url'],
        quality: { '128k': '128k', '320k': '320k', flac: 'flac', hires: 'hires' },
        before: (() => {
          let deviceId = '', token = '', tokenTs = 0;
          const SCRIPT = 'YYMusicSource', VER = 'v1.0.0';
          return (params) => {
            if (!deviceId) deviceId = 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
            if (!token || Date.now() - tokenTs > 5 * 60 * 1000) {
              const payload = { device_id: deviceId, ip: '0.0.0.0', timestamp: Math.floor(Date.now() / 1000), random: Math.random().toString(36).substring(2, 12) };
              try {
                if (globalThis.lx?.utils?.buffer?.from) {
                  const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
                  token = globalThis.lx.utils.buffer.bufToString(buf, 'base64');
                } else { token = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); }
              } catch (e) { token = ''; }
              tokenTs = Date.now();
            }
            params.headers = params.headers || {};
            params.headers['X-Token'] = token;
            params.headers['X-Client'] = `${SCRIPT}/${VER} (Android)`;
            return params;
          };
        })()
      },
{
  api: 'https://tang.api.s01s.cn/music_open_api.php?mid={id}',
  idField: ['songmid', 'id', 'hash'],
  urlField: ['song_play_url_pq', 'song_play_url_sq', 'song_play_url_hq', 'song_play_url_standard', 'song_play_url', 'song_play_url_fq'],
  quality: {
    '128k': 'song_play_url_standard',
    '320k': 'song_play_url_hq',
    flac: 'song_play_url_sq',
    flac24bit: 'song_play_url_pq',
    atmos: 'song_play_url_pq'
  },
  after: (data) => {
    if (!data) throw new Error('tang 无响应');
    const fields = ['song_play_url_pq', 'song_play_url_sq', 'song_play_url_hq', 'song_play_url_standard', 'song_play_url', 'song_play_url_fq'];
    for (const f of fields) {
      if (typeof data[f] === 'string' && data[f].trim()) return data[f].trim();
    }
    throw new Error('tang 无链接');
  }
},
      {
        api: 'https://musicserver.haitangw.cc/v1/music/resolve-url',
        idField: ['songmid', 'id', 'hash'],
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: { source: 'tx', rid: '{id}', level: '{quality}' },
        urlField: ['data.url'],
        quality: {
          '128k': 'standard',
          '320k': 'exhigh',
          flac: 'lossless',
          flac24bit: 'hires',
          hires: 'hires',
          atmos: '1999',
          atmos_plus: '2999',
          master: 'jymaster'
          }
        },
      {
        api: 'https://a.aa.cab/qq.music?msg={keyword}&n=1&type={quality}',
        idField: ['songmid', 'id', 'hash'],
        urlField: ['data.music', 'playUrl', 'url', 'data.url'],
        quality: { '128k': '0', '320k': '1', flac: '4', master: '5' }
      }
    ]
  },
wy: {
  name: '网易云音乐',
  apis: [
    {
      api: 'https://c.wwwweb.top/music/url',
      idField: ['hash', 'songmid'],
      urlField: ['url'],
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'lx-music-desktop/2.10.1'
      },
      body: { source: 'wy', musicId: '{id}', quality: '{quality}' },
      quality: {
        '128k': '128k',
        '320k': '320k',
        flac: 'flac',
        flac24bit: 'flac24bit',
        hires: 'hires',
        atmos: 'atmos',
        master: 'master'
      },
      after: (data) => {
        if (data.code === 200 && data.url) return data.url;
        throw new Error(data.message || '无数据');
        }
      },
    {
  api: 'https://musicserver.haitangw.cc/v1/music/resolve-url',
  idField: ['songmid', 'id', 'hash'],
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body: { source: 'wy', rid: '{id}', level: '{quality}' },
  urlField: ['data.url'],
  quality: {
    '128k': 'standard',
    '320k': 'exhigh',
    flac: 'lossless',
    flac24bit: 'hires',
    hires: 'hires',
    atmos: 'jyeffect',
    master: 'jymaster'
        }
      },
    {
      api: 'https://yy.zddyr.top/lx/api/?source=wy&songmid={id}&quality={quality}',
      idField: ['hash', 'songmid', 'id'],
      urlField: ['url', 'data.url'],
      quality: {
        '128k': '128k',
        '320k': '320k',
        flac: 'flac',
        hires: 'hires'
      },
      before: (() => {
        let deviceId = '', token = '', tokenTs = 0;
        const SCRIPT = 'YYMusicSource', VER = 'v1.0.0';
        return (params) => {
          if (!deviceId) deviceId = 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
          if (!token || Date.now() - tokenTs > 5 * 60 * 1000) {
            const payload = { device_id: deviceId, ip: '0.0.0.0', timestamp: Math.floor(Date.now() / 1000), random: Math.random().toString(36).substring(2, 12) };
            try {
              if (globalThis.lx?.utils?.buffer?.from) {
                const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
                token = globalThis.lx.utils.buffer.bufToString(buf, 'base64');
              } else { token = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); }
            } catch (e) { token = ''; }
            tokenTs = Date.now();
          }
          params.headers = params.headers || {};
          params.headers['X-Token'] = token;
          params.headers['X-Client'] = `${SCRIPT}/${VER} (Android)`;
          return params;
        };
      })()
    },
    {
      api: 'https://mcp.nianxinxz.com/share/ceshi/wy.php?id={id}&level={quality}',
      idField: ['hash', 'songmid', 'id'],
      urlField: ['url'],
      quality: {
        '128k': 'standard',
        '320k': 'exhigh',
        flac: 'lossless',
        flac24bit: 'hires',
        hires: 'hires',
        master: 'jymaster',
        atmos: 'jyeffect'
      },
      after: (data) => {
        if (data.code === 200 && data.url) return data.url;
        throw new Error(data.message || 'mcp 无数据');
      }
    },
   {
  api: 'http://103.79.184.97/api/music/url?platform=wy&songId={id}&quality={quality}&key=6C1F-53W0-GRKI-EVFG',
  idField: ['songmid', 'songId', 'id', 'hash'],
  urlField: ['url', 'data.url', 'data'],
  quality: {
    '128k': '128k',
    '320k': '320k',
    flac: 'flac',
    flac24bit: 'flac24bit',
    hires: 'hires'
  },
  headers: {
    'User-Agent': 'lx-music-mobile/2.0.0',
    'X-Card-Key': '6C1F-53W0-GRKI-EVFG'
  }
}
  ]
},
  mg: {
    name: '咪咕音乐',
    apis: [
      {
        api: 'https://yy.zddyr.top/lx/api/?source=migu&songmid={id}&quality={quality}',
        idField: ['songmid', 'id', 'hash'],
        urlField: ['url', 'data.url'],
        quality: { '128k': '128k', '320k': '320k', flac: 'flac', hires: 'hires' },
        before: (() => {
          let deviceId = '', token = '', tokenTs = 0;
          const SCRIPT = 'YYMusicSource', VER = 'v1.0.0';
          return (params) => {
            if (!deviceId) deviceId = 'lx-online-' + Math.random().toString(36).substring(2, 8) + Date.now().toString(36).slice(-4);
            if (!token || Date.now() - tokenTs > 5 * 60 * 1000) {
              const payload = { device_id: deviceId, ip: '0.0.0.0', timestamp: Math.floor(Date.now() / 1000), random: Math.random().toString(36).substring(2, 12) };
              try {
                if (globalThis.lx?.utils?.buffer?.from) {
                  const buf = globalThis.lx.utils.buffer.from(JSON.stringify(payload), 'utf-8');
                  token = globalThis.lx.utils.buffer.bufToString(buf, 'base64');
                } else { token = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); }
              } catch (e) { token = ''; }
              tokenTs = Date.now();
            }
            params.headers = params.headers || {};
            params.headers['X-Token'] = token;
            params.headers['X-Client'] = `${SCRIPT}/${VER} (Android)`;
            return params;
          };
        })()
      },
      {
        api: 'https://oiapi.net/api/MiGu_Music?msg={keyword}&br={quality}&n=1',
        idField: ['songmid', 'id', 'hash'],
        urlField: ['data.url', 'url'],
        quality: { '128k': 'LQ', '320k': 'HQ', flac: 'SQ', hires: 'SQ' }
      }
    ]
  }
}
const { EVENT_NAMES, request, on, send } = globalThis.lx;
const cache = Object.create(null);
const sourceKeys = Object.keys(CONFIG);

const getCache = k => ENABLE_CACHE && cache[k]?.expire > Date.now() ? cache[k].data : (delete cache[k], null);
const setCache = (k, d) => ENABLE_CACHE && (cache[k] = { data: d, expire: Date.now() + CACHE_TTL });

const httpRequest = (url, options = {}) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('请求超时')), options.timeout || TIMEOUT);
  request(url, {
    method: options.method || 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', ...options.headers },
    ...(options.body !== undefined ? { body: options.body } : {})
  }, (err, resp) => {
    clearTimeout(timer);
    if (err) return reject(err instanceof Error ? err : new Error(String(err)));
    if (!resp) return reject(new Error('空响应'));
    resolve({ body: resp.body, statusCode: resp.statusCode || resp.status || 200, url: resp.url });
  });
});

const getField = (obj, path) => path.split('.').reduce((val, p) => val == null ? undefined
  : Array.isArray(val) ? (/^\d+$/.test(p) ? val[+p] : val.map(v => v?.[p]).find(v => v != null && v !== ''))
  : val[p], obj);

const asUrl = v => typeof v === 'string' && /^(https?:)?\/\//.test(v.trim())
  ? (v.trim().startsWith('//') ? 'https:' + v.trim() : v.trim())
  : null;

const findUrl = (data, fields) => data == null ? null : asUrl(data) || fields.map(f => asUrl(getField(data, f))).find(Boolean) || null;

const getSongId = (info, fields) => fields.map(f => getField(info, f)).find(v => v !== undefined && v !== null && v !== '')?.toString() ?? '';

const qualitys = Object.create(null);
const sources = Object.create(null);
const idFieldsBySource = Object.create(null);
sourceKeys.forEach(s => {
  const apiList = CONFIG[s].apis || [];
  const qs = [...new Set(apiList.flatMap(a => Object.keys(a.quality || {})))];
  qualitys[s] = qs.reduce((acc, q) => (acc[q] = q, acc), {});
  sources[s] = { name: CONFIG[s].name, type: 'music', actions: ['musicUrl'], qualitys: qs };
  idFieldsBySource[s] = [...new Set(apiList.flatMap(a => a.idField || []))];
});
qualitys.local = {};
sources.local = { name: '本地音乐', type: 'music', actions: ['musicUrl', 'lyric', 'pic'], qualitys: [] };

const FALLBACK = {
  master: ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'],
  atmos_plus: ['atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'],
  atmos: ['atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'],
  hires: ['hires', 'flac24bit', 'flac', '320k', '128k'],
  flac24bit: ['flac24bit', 'flac', '320k', '128k'],
  flac: ['flac', '320k', '128k'],
  '320k': ['320k', '128k'],
  '128k': ['128k'],
};

const substitute = (val, map) => typeof val === 'string'
  ? val.replace(/\{(id|quality|keyword)\}/g, (_, k) => map[k] ?? '')
  : Array.isArray(val) ? val.map(v => substitute(v, map))
  : val && typeof val === 'object' ? Object.fromEntries(Object.entries(val).map(([k, v]) => [k, substitute(v, map)]))
  : val;

const hasPlaceholder = (api, name) => [api.api, api.body, api.headers].some(v => v && JSON.stringify(v).includes(`{${name}}`));

const resolveRedirectUrl = (resp, baseUrl) => resp.url
  ? asUrl(resp.url) || (() => { try { return new URL(resp.url, baseUrl).href; } catch { return null; } })()
  : null;

const buildParams = (api, info, quality, keyword) => {
  const needsId = hasPlaceholder(api, 'id');
  const needsKeyword = hasPlaceholder(api, 'keyword');
  const id = needsId ? getSongId(info, api.idField) : '';
  if (needsId && !id) throw new Error('缺少id字段');
  if (needsKeyword && !keyword) throw new Error('缺少歌曲名');

  const map = { id, keyword, quality: api.quality ? api.quality[quality] : quality };
  let params = {
    url: substitute(api.api, map),
    headers: api.headers ? substitute(api.headers, map) : undefined,
    body: api.body ? substitute(api.body, map) : undefined
  };
  if (typeof api.before === 'function') params = api.before(params) || params;
  if (!params.url || /\{[^}]*\}/.test(params.url)) throw new Error('URL模板未配置');
  return params;
};

const runRaw = async (api, params) => {
  if (api.followRedirect === false) return params.url;
  const tryMethod = async method => {
    const r = await httpRequest(params.url, { method, headers: params.headers, timeout: api.timeout });
    if (r.statusCode >= 400) { const err = new Error(`状态码${r.statusCode}`); err.statusCode = r.statusCode; throw err; }
    return r;
  };
  const firstMethod = api.method || 'HEAD';
  let resp;
  try { resp = await tryMethod(firstMethod); }
  catch (e) { if (firstMethod === 'GET' || e.statusCode !== 405) throw e; resp = await tryMethod('GET'); }
  if ([301, 302, 303, 307, 308].includes(resp.statusCode)) {
    const abs = resolveRedirectUrl(resp, params.url);
    if (abs) return abs;
  }
  return params.url;
};

const runStandard = async (api, params) => {
  const resp = await httpRequest(params.url, {
    method: api.method || 'GET',
    headers: params.headers,
    body: params.body,
    timeout: api.timeout
  });
  if (api.followRedirect !== false && [301, 302, 303, 307, 308].includes(resp.statusCode)) {
    const abs = resolveRedirectUrl(resp, params.url);
    if (abs) return abs;
  }
  const direct = asUrl(resp.body);
  if (direct) return direct;
  const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body;
  const parsed = typeof api.after === 'function' ? api.after(data) : data;
  if (typeof parsed === 'string') { const u = asUrl(parsed); if (u) return u; }
  const result = findUrl(parsed, api.urlField || ['url', 'data.url', 'playUrl']);
  if (result) return result;
  throw new Error('响应中未找到有效链接');
};

const tryApi = async (s, info, quality) => {
  const apiList = CONFIG[s].apis;
  if (!apiList?.length) throw new Error('无API配置');
  const keyword = encodeURIComponent(info.name || info.songname || '');

  const run = async api => {
    const tag = api.api.split('?')[0].split('/').pop() || 'api';
    if (api.quality && !api.quality[quality]) throw new Error(`${tag}:不支持${quality}`);
    try {
      const params = buildParams(api, info, quality, keyword);
      return await (api.raw ? runRaw(api, params) : runStandard(api, params));
    } catch (e) {
      throw new Error(`${tag}:${e.message}`);
    }
  };

  if (RACE_APIS) {
    try { return await Promise.any(apiList.map(run)); }
    catch (agg) { throw new Error(`所有API均失败(${quality}) [${(agg.errors || [agg]).map(e => e.message || String(e)).join(' | ')}]`); }
  }

  const fails = [];
  for (const api of apiList) {
    try { return await run(api); } catch (e) { fails.push(e.message || String(e)); }
  }
  throw new Error(`所有API均失败(${quality}) [${fails.join(' | ')}]`);
};

const inflight = Object.create(null);

const apis = sourceKeys.reduce((acc, s) => {
  acc[s] = {
    async musicUrl(info, quality) {
      if (!info) throw new Error('缺少musicInfo');
      const identity = getSongId(info, idFieldsBySource[s]) || [info.name, info.singer || info.artist].filter(Boolean).join('-');
      const key = `${s}_${identity || `anon${Math.random().toString(36).slice(2)}`}_${quality}`;
      const cached = getCache(key);
      if (cached) return cached;
      if (inflight[key]) return inflight[key];

      const run = (async () => {
        const fails = [];
        for (const q of FALLBACK[quality] || [quality]) {
          if (!qualitys[s].hasOwnProperty(q)) continue;
          try {
            const result = await tryApi(s, info, q);
            if (result) { setCache(key, result); return result; }
          } catch (e) { fails.push(e.message || String(e)); }
        }
        throw new Error(fails.length ? fails.join(' || ') : '所有音质均失败');
      })();

      inflight[key] = run;
      try { return await run; } finally { delete inflight[key]; }
    }
  };
  return acc;
}, {});

on(EVENT_NAMES.request, ({ source, action, info } = {}) => {
  if (!apis[source] || action !== 'musicUrl') return Promise.reject('不支持');
  if (!qualitys[source]?.[info?.type]) return Promise.reject(`不支持的音质: ${info?.type}`);
  return apis[source].musicUrl(info.musicInfo, info.type).catch(e => Promise.reject(e.message));
});

send(EVENT_NAMES.inited, { openDevTools: false, sources });
      }).call(sb, lx, sb, sb, sb, sb, sb.console);
    } catch (e) { st.handler = null; }
  })();
  (function () {
    var st = { m: MEMBERS[1], handler: null, sources: null };
    states.push(st);
    var lx = makeFacade(st);
    var sb = makeSandbox(lx);
    try {
      (function (lx, window, self, global, globalThis, console) {


const { EVENT_NAMES, request, on, send, utils, env, version, currentScriptInfo } = globalThis.lx


const _u = (str) => str.split('').map(c => String.fromCharCode(c.charCodeAt(0) + 5)).join('');



const currentScript = currentScriptInfo
  ? currentScriptInfo.rawScript
  : (typeof document !== 'undefined' ? document.currentScript?.textContent || '' : '')

const parseHeader = (str) => {
  const comment = /^\/\*!(?:.|\n)+?\*\//.exec(str)?.[0]
  if (!comment) return {}
  const result = {}
  const pairs = [
    { key: 'tx_cookie', regex: /\*\s*@tx_cookie\s+(.+)/ },
    { key: 'wy_cookie', regex: /\*\s*@wy_cookie\s+(.+)/ },
  ]
  for (const { key, regex } of pairs) {
    const match = regex.exec(comment)
    const val = match?.[1]?.trim()
    result[key] = (!val || val === 'null') ? '' : val
  }
  return result
}

const config = parseHeader(currentScript)
const TX_COOKIE = config.tx_cookie
const WY_COOKIE = config.wy_cookie
const HAS_TX_COOKIE = !!TX_COOKIE
const HAS_WY_COOKIE = !!WY_COOKIE



const MUSIC_QUALITY = JSON.parse(HAS_TX_COOKIE && HAS_WY_COOKIE
  ? '{"tx":["128k","320k","flac","flac24bit","hires","atmos","atmos_plus","master"],"wy":["128k","320k","flac","flac24bit","hires","atmos","master"],"kw":["128k","192k","320k","flac","flac24bit"],"kg":["128k","320k","flac","hires","atmos","master"],"mg":["128k","320k","flac"]}'
  : HAS_TX_COOKIE
    ? '{"tx":["128k","320k","flac","flac24bit","hires","atmos","atmos_plus","master"],"wy":["128k","320k","flac"],"kw":["128k","192k","320k","flac","flac24bit"],"kg":["128k","320k","flac","hires","atmos","master"],"mg":["128k","320k","flac"]}'
    : HAS_WY_COOKIE
      ? '{"tx":["128k","320k","flac"],"wy":["128k","320k","flac","flac24bit","hires","atmos","master"],"kw":["128k","192k","320k","flac","flac24bit"],"kg":["128k","320k","flac","hires","atmos","master"],"mg":["128k","320k","flac"]}'
      : '{"tx":["128k","320k","flac"],"wy":["128k","320k","flac"],"kw":["128k","192k","320k","flac","flac24bit"],"kg":["128k","320k","flac","hires","atmos","master"],"mg":["128k","320k","flac"]}'
)

const MUSIC_SOURCE = Object.keys(MUSIC_QUALITY)



const httpFetch = (url, options = { method: 'GET' }) => new Promise((resolve, reject) => {
  const timeout = options.timeout || 10000
  const finalOptions = { ...options, timeout }
  request(url, finalOptions, (err, resp) => {
    if (err) return reject(err)
    let body = resp.body
    if (typeof body === 'string') {
      const trimmed = body.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
        try { body = JSON.parse(trimmed) } catch (e) {}
      }
    }
    resolve({ body, statusCode: resp.statusCode, headers: resp.headers || {} })
  })
})

const md5 = (str) => utils.crypto.md5(str)

const randomGuid = () => {
  const hex = '0123456789abcdef'
  let guid = ''
  for (let i = 0; i < 32; i++) guid += hex[Math.floor(Math.random() * 16)]
  return guid
}

const aesEncrypt = (data, key, iv, mode) => {
  if (!version) mode = mode.split('-').pop()
  return utils.crypto.aesEncrypt(data, mode, key, iv)
}

const buf2hex = (buffer) => {
  return version
    ? utils.buffer.bufToString(buffer, 'hex')
    : [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('')
}

const wyEapi = (url, object) => {
  const eapiKey = 'e82ckenh8dichen8'
  const text = typeof object === 'object' ? JSON.stringify(object) : object
  const digest = md5('nobody' + url + 'use' + text + 'md5forencrypt')
  const data = url + '-36cd479b6b5-' + text + '-36cd479b6b5-' + digest
  return { params: buf2hex(aesEncrypt(data, eapiKey, '', 'aes-128-ecb')).toUpperCase() }
}

const objToForm = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&')

const extractUrl = (obj, paths) => {
  for (const path of paths) {
    let val = obj
    for (const key of path) {
      if (val == null) { val = undefined; break }
      val = val[key]
    }
    if (Array.isArray(val)) val = val[0]
    if (typeof val === 'string' && (val.startsWith(_u('cook5**')) || val.startsWith(_u('cookn5**')))) return val
    if (typeof val === 'string' && val.startsWith('//')) return 'https:' + val
  }
  return ''
}

const cleanUrl = (url) => {
  if (!url) return ''
  const s = String(url).replace(/\\?u0026/gi, '&').replace(/\\&/g, '&').replace(/\$/g, '&')
  const idx = s.indexOf('?')
  return idx > 0 ? s.substring(0, idx) : s
}



const qualityToLevel = (quality) => {
  const map = {
    '128k': 'standard',
    '192k': 'standard',
    '320k': 'exhigh',
    'flac': 'lossless',
    'flac24bit': 'lossless',
    'hires': 'lossless',
    'atmos': 'lossless',
    'atmos_plus': 'lossless',
    'master': 'lossless',
  }
  return map[quality] || 'standard'
}



const sha256 = (function() {
  var HEX_CHARS = '0123456789abcdef'.split('');
  function Sha256() {
    this.blocks = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
    this.h0 = 0x6a09e667;
    this.h1 = 0xbb67ae85;
    this.h2 = 0x3c6ef372;
    this.h3 = 0xa54ff53a;
    this.h4 = 0x510e527f;
    this.h5 = 0x9b05688c;
    this.h6 = 0x1f83d9ab;
    this.h7 = 0x5be0cd19;
    this.block = this.start = this.bytes = this.hBytes = 0;
    this.finalized = this.hashed = false;
    this.first = true;
  }
  Sha256.prototype.update = function(message) {
    if (this.finalized) return;
    var notString = typeof message !== 'string';
    var blocks = this.blocks;
    for (var i = 0; i < message.length; i++) {
      if (this.hashed) {
        this.hashed = false;
        blocks[0] = this.block;
        blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
      }
      var code = notString ? message[i] : message.charCodeAt(i);
      blocks[this.start >> 2] |= code << (24 - (this.start % 4) * 8);
      this.start++;
      if (this.start === 64) {
        this.block = blocks[16];
        this.start = 0;
        this.hash();
        this.hashed = true;
      }
    }
    this.bytes += message.length;
    if (this.bytes > 4294967295) {
      this.hBytes += this.bytes / 4294967296 << 0;
      this.bytes = this.bytes % 4294967296;
    }
    return this;
  };
  Sha256.prototype.finalize = function() {
    if (this.finalized) return;
    this.finalized = true;
    var blocks = this.blocks;
    var i = this.start;
    blocks[16] = this.block;
    blocks[i >> 2] |= 0x80 << (24 - (i % 4) * 8);
    this.block = blocks[16];
    if (i >= 56) {
      if (!this.hashed) this.hash();
      blocks[0] = this.block;
      blocks[16] = blocks[1] = blocks[2] = blocks[3] = blocks[4] = blocks[5] = blocks[6] = blocks[7] = blocks[8] = blocks[9] = blocks[10] = blocks[11] = blocks[12] = blocks[13] = blocks[14] = blocks[15] = 0;
    }
    blocks[14] = this.hBytes << 3 | this.bytes >>> 29;
    blocks[15] = this.bytes << 3;
    this.hash();
  };
  Sha256.prototype.hash = function() {
    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    var a = this.h0, b = this.h1, c = this.h2, d = this.h3, e = this.h4, f = this.h5, g = this.h6, h = this.h7, blocks = this.blocks;
    for (var j = 0; j < 64; j++) {
      if (j >= 16) {
        var w0 = blocks[j - 15];
        var w1 = blocks[j - 2];
        var s0 = ((w0 >>> 7) | (w0 << 25)) ^ ((w0 >>> 18) | (w0 << 14)) ^ (w0 >>> 3);
        var s1 = ((w1 >>> 17) | (w1 << 15)) ^ ((w1 >>> 19) | (w1 << 13)) ^ (w1 >>> 10);
        blocks[j] = blocks[j - 16] + s0 + blocks[j - 7] + s1;
      }
      var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = h + S1 + ch + K[j] + (blocks[j] >>> 0);
      var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = S0 + maj;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    this.h0 = (this.h0 + a) >>> 0;
    this.h1 = (this.h1 + b) >>> 0;
    this.h2 = (this.h2 + c) >>> 0;
    this.h3 = (this.h3 + d) >>> 0;
    this.h4 = (this.h4 + e) >>> 0;
    this.h5 = (this.h5 + f) >>> 0;
    this.h6 = (this.h6 + g) >>> 0;
    this.h7 = (this.h7 + h) >>> 0;
  };
  Sha256.prototype.hex = function() {
    this.finalize();
    var h0 = this.h0, h1 = this.h1, h2 = this.h2, h3 = this.h3, h4 = this.h4, h5 = this.h5, h6 = this.h6, h7 = this.h7;
    return HEX_CHARS[(h0 >> 28) & 0x0F] + HEX_CHARS[(h0 >> 24) & 0x0F] + HEX_CHARS[(h0 >> 20) & 0x0F] + HEX_CHARS[(h0 >> 16) & 0x0F] + HEX_CHARS[(h0 >> 12) & 0x0F] + HEX_CHARS[(h0 >> 8) & 0x0F] + HEX_CHARS[(h0 >> 4) & 0x0F] + HEX_CHARS[h0 & 0x0F] + HEX_CHARS[(h1 >> 28) & 0x0F] + HEX_CHARS[(h1 >> 24) & 0x0F] + HEX_CHARS[(h1 >> 20) & 0x0F] + HEX_CHARS[(h1 >> 16) & 0x0F] + HEX_CHARS[(h1 >> 12) & 0x0F] + HEX_CHARS[(h1 >> 8) & 0x0F] + HEX_CHARS[(h1 >> 4) & 0x0F] + HEX_CHARS[h1 & 0x0F] + HEX_CHARS[(h2 >> 28) & 0x0F] + HEX_CHARS[(h2 >> 24) & 0x0F] + HEX_CHARS[(h2 >> 20) & 0x0F] + HEX_CHARS[(h2 >> 16) & 0x0F] + HEX_CHARS[(h2 >> 12) & 0x0F] + HEX_CHARS[(h2 >> 8) & 0x0F] + HEX_CHARS[(h2 >> 4) & 0x0F] + HEX_CHARS[h2 & 0x0F] + HEX_CHARS[(h3 >> 28) & 0x0F] + HEX_CHARS[(h3 >> 24) & 0x0F] + HEX_CHARS[(h3 >> 20) & 0x0F] + HEX_CHARS[(h3 >> 16) & 0x0F] + HEX_CHARS[(h3 >> 12) & 0x0F] + HEX_CHARS[(h3 >> 8) & 0x0F] + HEX_CHARS[(h3 >> 4) & 0x0F] + HEX_CHARS[h3 & 0x0F] + HEX_CHARS[(h4 >> 28) & 0x0F] + HEX_CHARS[(h4 >> 24) & 0x0F] + HEX_CHARS[(h4 >> 20) & 0x0F] + HEX_CHARS[(h4 >> 16) & 0x0F] + HEX_CHARS[(h4 >> 12) & 0x0F] + HEX_CHARS[(h4 >> 8) & 0x0F] + HEX_CHARS[(h4 >> 4) & 0x0F] + HEX_CHARS[h4 & 0x0F] + HEX_CHARS[(h5 >> 28) & 0x0F] + HEX_CHARS[(h5 >> 24) & 0x0F] + HEX_CHARS[(h5 >> 20) & 0x0F] + HEX_CHARS[(h5 >> 16) & 0x0F] + HEX_CHARS[(h5 >> 12) & 0x0F] + HEX_CHARS[(h5 >> 8) & 0x0F] + HEX_CHARS[(h5 >> 4) & 0x0F] + HEX_CHARS[h5 & 0x0F] + HEX_CHARS[(h6 >> 28) & 0x0F] + HEX_CHARS[(h6 >> 24) & 0x0F] + HEX_CHARS[(h6 >> 20) & 0x0F] + HEX_CHARS[(h6 >> 16) & 0x0F] + HEX_CHARS[(h6 >> 12) & 0x0F] + HEX_CHARS[(h6 >> 8) & 0x0F] + HEX_CHARS[(h6 >> 4) & 0x0F] + HEX_CHARS[h6 & 0x0F] + HEX_CHARS[(h7 >> 28) & 0x0F] + HEX_CHARS[(h7 >> 24) & 0x0F] + HEX_CHARS[(h7 >> 20) & 0x0F] + HEX_CHARS[(h7 >> 16) & 0x0F] + HEX_CHARS[(h7 >> 12) & 0x0F] + HEX_CHARS[(h7 >> 8) & 0x0F] + HEX_CHARS[(h7 >> 4) & 0x0F] + HEX_CHARS[h7 & 0x0F];
  };
  return function(message) {
    return new Sha256().update(message).hex();
  };
})();

const HELLO_WORLD_API_KEY = 'lxmusic';
const HELLO_WORLD_SECRET_KEY = 'JaJ?a7Nwk_Fgj?2o:znAkst';
const HELLO_WORLD_SCRIPT_MD5 = '1888f9865338afe6d5534b35171c61a4';
const HELLO_WORLD_API_URL = _u('cookn5**33)gshpnd^)si((adln3n');

const helloWorldSign = (requestPath) => sha256(requestPath + HELLO_WORLD_SCRIPT_MD5 + HELLO_WORLD_SECRET_KEY);

const HYW_API_BASE = _u('cook5**,+.)24),3/)42');
const HYW_CARD_KEY = 'MOLAN-BAIJI';



const TX_FILE_CONFIG = {
  '128k': { s: 'M500', e: '.mp3', br: '128k' },
  '320k': { s: 'M800', e: '.mp3', br: '320k' },
  flac: { s: 'F000', e: '.flac', br: 'flac' },
  flac24bit: { s: 'AI00', e: '.flac', br: 'flac24bit' },
  hires: { s: 'AI00', e: '.flac', br: 'hires' },
  atmos: { s: 'AI00', e: '.flac', br: 'atmos' },
  atmos_plus: { s: 'AI00', e: '.flac', br: 'atmos' },
  master: { s: 'AI00', e: '.flac', br: 'master' },
}



const WY_LEVEL_MAP = {
  '128k': 'standard',
  '320k': 'exhigh',
  flac: 'lossless',
  flac24bit: 'hires',
  hires: 'hires',
  atmos: 'sky',
  master: 'jymaster',
}

const WY_BR_MAP = {
  '128k': 128000,
  '320k': 320000,
  flac: 999000,
  flac24bit: 999000,
  hires: 999001,
  atmos: 999002,
  master: 999003,
}



const KW_LEVEL_MAP = {
  '128k': '128k',
  '192k': '128k',
  '320k': '320k',
  flac: 'lossless',
  flac24bit: 'lossless',
}



const KG_LEVEL_MAP = {
  '128k': 'standard',
  '192k': 'standard',
  '320k': 'exhigh',
  flac: 'lossless',
  flac24bit: 'hires',
  hires: 'hires',
  atmos: 'atmos',
  atmos_plus: 'atmos',
  master: 'clear',
}



const KW_STREAM_LEVEL_MAP = {
  '128k': '128k',
  '192k': '128k',
  '320k': '320k',
  flac: 'flac',
  flac24bit: 'flac',
  hires: 'hires',
  atmos: 'atmos',
  atmos_plus: 'atmos_plus',
  master: 'master',
}



const FISH_DOMAIN = 'music.gdstudio.xyz'
const FISH_VERSION = '20260510'

const fishSign = async (secret) => {
  const timeRes = await httpFetch(_u('cookn5**') + FISH_DOMAIN + '/time', { method: 'GET', timeout: 10000 })
  const timeStr = String(Number(timeRes.body) || Date.now()).slice(0, 9)
  const signInput = FISH_DOMAIN + '|' + FISH_VERSION + '|' + timeStr + '|' + secret
  return md5(signInput).slice(-8).toUpperCase()
}

const fishPost = async (params, secret) => {
  const sign = await fishSign(secret)
  params.s = sign
  const body = objToForm(params)
  const res = await httpFetch(_u('cookn5**') + FISH_DOMAIN + '/api.php', {
    method: 'POST',
    timeout: 15000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: _u('cookn5**') + FISH_DOMAIN,
      Referer: _u('cookn5**') + FISH_DOMAIN + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body,
  })
  return res.body
}



const CACHE_TTL_MS = 21600000 
const CACHE_MAX_SIZE = 300
const urlCache = new Map()

const getCachedUrl = (key) => {
  const entry = urlCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    urlCache.delete(key)
    return null
  }
  return entry.url
}

const setCachedUrl = (key, url) => {
  urlCache.set(key, { url, timestamp: Date.now() })
  if (urlCache.size > CACHE_MAX_SIZE) {
    const oldest = urlCache.keys().next().value
    if (oldest) urlCache.delete(oldest)
  }
}

const buildCacheKey = (source, songId, quality) => `${source}_${songId}_${quality}`



const getQQExploit = async (songId, quality, musicInfo) => {
  const songmid = songId || musicInfo?.songmid || musicInfo?.id
  if (!songmid) throw new Error('QQ越权: 缺少 songmid')
  const mediaMid = musicInfo?.mediaMid || musicInfo?.strMediaMid || musicInfo?.media_mid || ''
  const prefixMap = { '128k':'M500','192k':'M800','320k':'M800','flac':'F000','flac24bit':'RS01','hires':'RS01','atmos':'atmosphere','atmos_plus':'atmosphere','master':'AIM00' }
  const prefix = prefixMap[quality] || 'M800'
  const extMap = { 'M500':'mp3','M800':'mp3','F000':'flac','RS01':'flac','AIM00':'mflac','atmosphere':'flac' }
  const ext = extMap[prefix] || 'mp3'
  const midForFile = mediaMid || songmid
  const qqKey = '1984LZXvCR'
  const qqUin = '1234567890'
  const pgv_pvid = Math.floor(Math.random() * 10000000000).toString()
  const qqCookie = `qm_keyst=${qqKey}; uin=o${qqUin}; pgv_pvid=${pgv_pvid}; qqmusic_key=${qqKey}; qqmusic_uin=o${qqUin}; psrf_qqaccess_token=${qqKey}; ts_uid=${pgv_pvid}; psi=${pgv_pvid}`

  
  const filename = `${prefix}${midForFile}.${ext}`
  const bodyA = {
    comm: { ct: 19, cv: 0, guid: pgv_pvid, tmeAppID: 'qqmusic', qq: qqUin },
    hot: { method: 'CgiGetHotVkey', module: 'music.vkey.GetEVkey', param: { filename: [filename], songmid: [songmid] } },
    ekey: { method: 'GetEkey', module: 'music.vkey.GetEVkey', param: { finfo: [{ filename, mid: midForFile || '0' }] } }
  }
  try {
    const resp = await httpFetch(_u('cookn5**po)t)ll)^jh*^bd(]di*hpnd^p)a^b'), {
      method: 'POST', timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': qqCookie },
      body: JSON.stringify(bodyA)
    })
    const d = resp.body
    if (d?.hot?.data?.urls?.[0]?.purl) {
      return _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*') + d.hot.data.urls[0].purl
    }
  } catch (e) {}

  
  const variants = [
    { name: '双songmid', filename: `${prefix}${songmid}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
    { name: '单songmid', filename: `${prefix}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
    { name: '双空uin', filename: `${prefix}${songmid}${songmid}.${ext}`, uin: '', loginflag: 1 },
    { name: '单空uin', filename: `${prefix}${songmid}.${ext}`, uin: '', loginflag: 1 }
  ]
  for (const v of variants) {
    try {
      const param = { filename: [v.filename], songmid: [songmid], songtype: [0], uin: v.uin, loginflag: v.loginflag, platform: '23', firstlogin: 1, newver: 1, nohash: 0, cms: 0 }
      const apiData = JSON.stringify({
        comm: { uin: v.uin ? parseInt(v.uin) : 0, format: 'json', ct: 23, cv: 0, ...(v.uin ? { qq: v.uin } : {}) },
        req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param }
      })
      const url = _u('cookn5**p)t)ll)^jh*^bd(]di*hpnd^p)a^b:ajmh\\o8enji!_\\o\\8') + encodeURIComponent(apiData)
      const resp = await httpFetch(url, {
        method: 'GET', timeout: 8000,
        headers: { 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': qqCookie }
      })
      const d = resp.body
      if (d?.code === 0 && d?.req_0?.data?.midurlinfo?.[0]?.purl) {
        const sip = d.req_0.data.sip?.[0] || _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*')
        return sip + d.req_0.data.midurlinfo[0].purl
      }
    } catch (e) {}
  }

  
  try {
    const bodyC = {
      comm: { ct: 19, cv: 0, guid: pgv_pvid, tmeAppID: 'qqmusic', qq: qqUin },
      hot: { method: 'CgiGetHotVkey', module: 'music.vkey.GetEVkey', param: { filename: [filename], songmid: [songmid] } }
    }
    const resp = await httpFetch(_u('cookn5**po)t)ll)^jh*^bd(]di*hpnd^p)a^b'), {
      method: 'POST', timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Referer': _u('cookn5**t)ll)^jh*'), 'User-Agent': 'Mozilla/5.0 QQMusic/2201', 'Cookie': qqCookie },
      body: JSON.stringify(bodyC)
    })
    const d = resp.body
    if (d?.hot?.data?.urls?.[0]?.purl) {
      return _u('cookn5**_g)nom`\\h)llhpnd^)ll)^jh*') + d.hot.data.urls[0].purl
    }
  } catch (e) {}

  throw new Error('QQ越权全部失败')
}


const getYgkingTx = async (songId, quality, musicInfo) => {
  const mid = musicInfo?.songmid || musicInfo?.strMediaMid || musicInfo?.mediaMid || songId
  if (!mid) throw new Error('ygking: 缺少 mid')
  const qMap = { '128k':'128','192k':'320','320k':'320','flac':'flac','flac24bit':'hires','hires':'hires','master':'master','atmos':'master','atmos_plus':'master' }
  const q = qMap[quality] || '320'
  const url = _u('cookn5**\\kd)tbfdib)^i*\\kd*njib*pmg:hd_8') + encodeURIComponent(mid) + _u('!lp\\gdot8') + q
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 })
  const d = resp.body
  if (d?.code === 0 && d?.data?.[mid]) {
    return d.data[mid]
  }
  throw new Error('ygking 失败')
}


const getCanxiang = async (songId, quality, musicInfo) => {
  const id = musicInfo?.songId || musicInfo?.id || songId
  const name = musicInfo?.songName || musicInfo?.name || ''
  const singer = musicInfo?.singer || ''
  const qMap = { '128k':'128k','192k':'320k','320k':'320k','flac':'flac','flac24bit':'hires','hires':'hires','master':'jymaster','atmos':'jymaster','atmos_plus':'jymaster' }
  const type = qMap[quality] || '320k'
  const token = 'canxiang_token_2026'
  let params = { token, type }
  if (id) params.id = String(id)
  else if (name) { params.msg = name + (singer ? ' ' + singer : ''); params.n = 1 }
  else throw new Error('残像: 缺少 id 或歌名')
  const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&')
  const url = _u('cookn5**\\kd)^\\isd\\ib)^i*\\kd*rtthpnd^:') + query
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 })
  const d = resp.body
  if (d?.code === 200 && d?.data?.url) {
    return d.data.url
  }
  throw new Error('残像 失败')
}


const getXinghai = async (platform, songId, quality, musicInfo) => {
  const sourceMap = { kw: 'kw', kg: 'kg', mg: 'migu' }
  const source = sourceMap[platform]
  if (!source) throw new Error('星海聚合: 不支持平台 ' + platform)
  const id = platform === 'kg' ? (musicInfo?.hash || songId) : (musicInfo?.songmid || musicInfo?.rid || songId)
  if (!id) throw new Error('星海聚合: 缺少 id')
  const name = musicInfo?.name || musicInfo?.songName || ''
  const singer = musicInfo?.singer || ''
  const qMap = { '128k':'128kmp3','192k':'320kmp3','320k':'320kmp3','flac':'flac','flac24bit':'hires','hires':'hires','master':'flac','atmos':'flac','atmos_plus':'flac' }
  const qualityParam = qMap[quality] || '320kmp3'
  const url = _u('cookn5**\\kd)sdibc\\d)^jh*gs*\\kd*:njpm^`8') + source + _u('!i\\h`8') + encodeURIComponent(name + ' ' + singer) + _u('!njibhd_8') + encodeURIComponent(id) + _u('!lp\\gdot8') + qualityParam
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 })
  const d = resp.body
  if (d?.code === 200 && d?.url) return d.url
  throw new Error('星海聚合 失败')
}
const getXinghaiKw = (songId, quality, musicInfo) => getXinghai('kw', songId, quality, musicInfo)
const getXinghaiKg = (songId, quality, musicInfo) => getXinghai('kg', songId, quality, musicInfo)
const getXinghaiMg = (songId, quality, musicInfo) => getXinghai('mg', songId, quality, musicInfo)


const getYunmgeKw = async (songId, quality, musicInfo) => {
  const id = musicInfo?.rid || musicInfo?.songmid || songId
  if (!id) throw new Error('yunmge: 缺少 id')
  const brMap = { '128k':128, '192k':192, '320k':320, 'flac':2000, 'flac24bit':2000, 'hires':4000, 'master':4000 }
  const wantBr = brMap[quality] || 320
  const url = _u('cookn5**\\kd)tpihb`)^jh*fprj:f`t8tpihb`Zf`t!ojf`i8tpihb`Zojf`i!d_8') + encodeURIComponent(id)
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 })
  const d = resp.body
  if (d?.code === 200 && d?.data?.all_bitrates) {
    const list = d.data.all_bitrates
    const brOrder = [4000, 2000, 320, 192, 128]
    for (const br of brOrder) {
      if (br < wantBr) continue
      const item = list.find(b => b.bitrate === br || String(b.bitrate) === String(br))
      if (item && item.play_url) return item.play_url
    }
    const fallback = list.find(b => b.play_url)
    if (fallback) return fallback.play_url
  }
  throw new Error('yunmge 失败')
}


const getNianxinKg = async (songId, quality, musicInfo) => {
  const hash = musicInfo?.hash || musicInfo?.songmid || songId
  if (!hash) throw new Error('念心: 缺少 hash')
  const levelMap = { '128k':'128kmp3','192k':'320kmp3','320k':'320kmp3','flac':'2000kflac','flac24bit':'4000kflac','hires':'hires','master':'4000kflac','atmos':'4000kflac','atmos_plus':'4000kflac' }
  const level = levelMap[quality] || '320kmp3'
  const url = _u('cookn5**h^k)id\\isdisu)^jh*fbll*fb)kck:d_8') + encodeURIComponent(hash) + _u('!g`q`g8') + level + _u('!otk`8hk.')
  const resp = await httpFetch(url, { method: 'GET', timeout: 8000 })
  const d = resp.body
  if (d?.code === 200 && d?.url) return d.url
  if (typeof d === 'string' && d.startsWith('http')) return d
  throw new Error('念心 失败')
}






const extractFFURL = (d) => {
  if (!d || typeof d !== 'object') return ''
  if (typeof d.url === 'string' && d.url.startsWith('http')) return d.url
  if (d.data) {
    if (typeof d.data === 'string' && d.data.startsWith('http')) return d.data
    if (typeof d.data.url === 'string' && d.data.url.startsWith('http')) return d.data.url
    if (typeof d.data.play_url === 'string' && d.data.play_url.startsWith('http')) return d.data.play_url
    if (d.data.vipmusic && typeof d.data.vipmusic.url === 'string' && d.data.vipmusic.url.startsWith('http')) return d.data.vipmusic.url
    if (Array.isArray(d.data) && d.data[0]) {
      if (typeof d.data[0].url === 'string' && d.data[0].url.startsWith('http')) return d.data[0].url
      if (typeof d.data[0] === 'string' && d.data[0].startsWith('http')) return d.data[0]
    }
  }
  return ''
}
const getFFAPI = async (songmid, quality, musicInfo) => {
  const src = (musicInfo && musicInfo.source) || ''
  const id = songmid || ''
  if (!id) return ''
  let page = ''
  if (src === 'tx') page = 'https://y.qq.com/n/ryqq/songDetail/' + id
  else if (src === 'wy') page = 'https://music.163.com/song?id=' + id
  else if (src === 'kw') page = 'https://www.kuwo.cn/play_detail/' + id
  else if (src === 'kg') page = 'https://www.kugou.com/song/#hash=' + id
  else if (src === 'mg') page = 'https://music.migu.cn/v3/music/song/' + id
  else return ''
  const res = await httpFetch('https://ffapi.cn/int/v2/songurl?url=' + encodeURIComponent(page), { method: 'GET', timeout: 10000 })
  const d = res && res.body
  if (typeof d === 'string') {
    try { const j = JSON.parse(d); return extractFFURL(j) } catch (e) { return '' }
  }
  return extractFFURL(d)
}
const TX_BACKENDS = [

  
  
  {
    name: 'QQ官方',
    fetch: async (songmid, quality) => {
      const fileInfo = TX_FILE_CONFIG[quality]
      if (!fileInfo) throw new Error('不支持的音质')
      const guid = randomGuid()
      const file = fileInfo.s + songmid + fileInfo.e
      const reqData = {
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: { filename: [file], guid, songmid: [songmid], songtype: [0], uin: '0', loginflag: HAS_TX_COOKIE ? 1 : 0, platform: '20' },
        },
        loginUin: '0',
        comm: { uin: '0', format: 'json', ct: 24, cv: 0 },
      }
      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Referer: _u('cookn5**t)ll)^jh*') }
      if (HAS_TX_COOKIE) headers.Cookie = TX_COOKIE
      const res = await httpFetch(_u('cookn5**p)t)ll)^jh*^bd(]di*hpnd^p)a^b'), { method: 'POST', headers, body: JSON.stringify(reqData) })
      const d = res.body
      if (d && d.req_0 && d.req_0.data && d.req_0.data.midurlinfo && d.req_0.data.midurlinfo[0] && d.req_0.data.midurlinfo[0].purl) {
        const sip = d.req_0.data.sip || [_u('cookn5**dnpm`)nom`\\h)llhpnd^)ll)^jh*')]
        return sip[Math.floor(Math.random() * sip.length)] + d.req_0.data.midurlinfo[0].purl
      }
      throw new Error('QQ官方: 无数据')
    },
  },
  {
    name: '星海主后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8ll!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海主后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '星海备后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8ll!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海备后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: 'HelloWorld QQ',
    fetch: async (songmid, quality, musicInfo) => {
      const keyword = encodeURIComponent(musicInfo?.name || musicInfo?.songName || '')
      if (!keyword) throw new Error('HelloWorld QQ: 缺少歌曲名')
      const qMap = { '128k': '0', '320k': '1', 'flac': '4', 'master': '5' }
      const type = qMap[quality] || '1'
      const url = _u('cookn5**\\)\\\\)^\\]*ll)hpnd^:hnb8') + keyword + _u('!i8,!otk`8') + type
      const res = await httpFetch(url, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      })
      const d = res.body
      if (d) {
        if (d.data?.music && typeof d.data.music === 'string' && d.data.music.startsWith('http')) return d.data.music
        if (d.playUrl && typeof d.playUrl === 'string' && d.playUrl.startsWith('http')) return d.playUrl
        if (d.url && typeof d.url === 'string' && d.url.startsWith('http')) return d.url
        if (d.data?.url && typeof d.data.url === 'string' && d.data.url.startsWith('http')) return d.data.url
      }
      throw new Error('HelloWorld QQ: 无有效链接')
    },
  },
  {
    name: '溯音QQ',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': '7', '320k': '5', flac: '4', flac24bit: '1', hires: '1', atmos: '1', master: '1' }
      const br = brMap[quality] || '7'
      const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*LLZHpnd^:f`t8jd\\kd(`a1,..]2(\\^-a(_^2_(323^(_.`-+2\\3-020!otk`8enji!]m8') + br + '&n=1&mid=' + songmid, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['data', 'music'], ['data', 'url'], ['url']])
      if (url) return url
      throw new Error('溯音QQ: 无数据')
    },
  },
  {
    name: 'xcvts',
    fetch: async (songmid, quality) => {
      const apiKeys = ['78993344b9bf1105655599009cdba3d2', 'ce778eb0d1858edfb4b2071a115f1edf']
      const qualityMap = { '128k': 'standard', '320k': 'exhigh', flac: 'lossless', flac24bit: 'hires' }
      const q = qualityMap[quality] || 'standard'
      const errors = []
      for (const key of apiKeys) {
        try {
          const res = await httpFetch(_u('cookn5**\\kd)s^qon)^i*\\kd*hpnd^*ll:\\kdF`t8') + key + '&mid=' + songmid + '&type=' + q, {
            method: 'GET', timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          })
          const d = res.body
          const url = extractUrl(d, [['data', 'music'], ['data', 'url'], ['url']])
          if (url) return url
        } catch (e) { errors.push(e.message) }
      }
      throw new Error('xcvts: ' + errors.join(' | '))
    },
  },
  {
    name: 'vkeys',
    fetch: async (songmid, quality) => {
      const qualityMap = { '128k': '8', '320k': '9', flac: '10', flac24bit: '16', hires: '14', atmos: '13', atmos_plus: '12', master: '11' }
      const q = qualityMap[quality]
      if (!q) throw new Error('vkeys 不支持的音质')
      const res = await httpFetch(_u('cookn5**\\kd)qf`tn)^i*q-*hpnd^*o`i^`io*b`opmg:hd_8') + songmid + '&quality=' + q, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.data && d.data.url) return d.data.url
      if (d && d.url) return d.url
      throw new Error('vkeys: 无数据')
    },
  },
  {
    name: 'vkeys旧版',
    fetch: async (songmid, quality) => {
      const qualityMap = { '128k': '8', '320k': '9', flac: '10', flac24bit: '16', hires: '14', atmos: '13', atmos_plus: '12', master: '11' }
      const q = qualityMap[quality]
      if (!q) throw new Error('vkeys旧版 不支持的音质')
      const res = await httpFetch(_u('cookn5**\\kd)qf`tn)^i*hpnd^*o`i^`io*njib*gdif:hd_8') + songmid + '&quality=' + q, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['data', 'url'], ['url']])
      if (url) return url
      throw new Error('vkeys旧版: 无数据')
    },
  },
  {
    name: '柳云API',
    fetch: async (songmid, quality) => {
      const qualityMap = { '128k': '128k', '320k': '320k', flac: 'flac', flac24bit: 'master', hires: 'atmos', atmos: 'atmos', atmos_plus: 'atmos', master: 'master' }
      const q = qualityMap[quality] || '128k'
      let card = ''
      try {
        const cardRes = await httpFetch(_u('cookn5**bdocp])^jh*>c\\mg`nKdf\\^cp*hpnd^_g*m`g`\\n`n*_jrigj\\_*f`tn*]\\dhpnd^)oso'), { method: 'GET', timeout: 5000 })
        card = String(cardRes.body || '').trim()
      } catch (e) {}
      const res = await httpFetch(_u('cookn5**\\kd)gdptpid_^)^i*]\\dhpnd^*hpnd^pmg)kck:njpm^`8os!hpnd^D_8') + songmid + '&quality=' + q + (card ? '&card=' + encodeURIComponent(card) : ''), {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: _u('cook5**\\kd)gdptpid_^)^i*]\\dhpnd^*') },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('柳云API: 无数据')
    },
  },
  {
    name: '317ak',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': '5', '320k': '6', flac: '8', flac24bit: '7', hires: '9', atmos: '10', atmos_plus: '10', master: '10' }
      const br = brMap[quality] || '5'
      const res = await httpFetch(_u('cookn5**\\kd).,2\\f)^i*\\kd*tditp`*lltditp`:^f`t8UF21LE>DC0KKD>EJJSPC!d8') + songmid + '&br=' + br + '&type=json&lrc=1', {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('317ak: 无数据')
    },
  },
  {
    name: '玉宁熙',
    fetch: async (songmid, quality) => {
      const qualityMap = { '128k': '标准', '320k': 'HQ', flac: 'SQ', flac24bit: '母带', hires: '母带', atmos: '母带', master: '母带' }
      const q = qualityMap[quality] || '标准'
      const res = await httpFetch(_u('cookn5**\\kd(q-)tp\\a`ib)^i*<KD*llhpnd^)kck:otk`8') + encodeURIComponent(q) + '&mid=' + songmid + '&apikey=3ff23523e47465224a3f48579acf41f241540ce04b6cc0b94164f37a5b6299d5', {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.data && d.data.music) return d.data.music
      throw new Error('玉宁熙: 无数据')
    },
  },
  {
    name: '收集聚合',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**^t\\kd)ojk*<KD*llZhpnd^)kck:\\kdf`t8,aa_a02..a0_0.321+`1._2`/1]\\,2/.3_4a2]4_a^,3^0,]`,,+4.31a_2/^.\\,!otk`8enji!hd_8') + songmid, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.url) return d.url
      throw new Error('收集聚合: 无数据')
    },
  },
  {
    name: 'lxmusic88',
    fetch: async (songmid, quality) => {
      try {
        const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q/*pmg*os*') + songmid + '/' + quality, {
          method: 'GET', timeout: 8000,
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'x-request-key': 'lxmusic' },
        })
        const d = res.body
        if (d && (d.code === 0 || d.code === 200) && d.data) return d.data
        if (d && d.url) return d.url
      } catch (e) {}
      
      const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q.*pmg*os*') + songmid + '/' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.data) return d.data
      throw new Error('lxmusic88: 无数据')
    },
  },
  {
    name: '念心直链',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**hpnd^)isdisu)^jh*fbll*os)kck:d_8') + songmid + '&level=' + quality + '&type=mp3', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      throw new Error('念心直链: 无数据')
    },
  },
  {
    name: '妖狐',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*llZkgpn:d_8') + songmid + '&level=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('妖狐: 无数据')
    },
  },
  {
    name: 'ChKsZ',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd'), {
        method: 'POST', timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ source: 'qq', songmid, quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('ChKsZ: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: 'Huibq',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**gshpnd^\\kd)jim`i_`m)^jh*pmg*os*') + songmid + '/' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Request-Key': 'share-v3' },
      })
      const d = res.body
      if (d && d.code === 0) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('Huibq: 无数据')
    },
  },
  {
    name: '聚合API',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*os'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ musicInfo: { songmid }, type: quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('聚合API: 无数据')
    },
  },
  {
    name: 'FishAPI',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': 128, '320k': 320, flac: 740, flac24bit: 999 }
      const br = brMap[quality]
      if (!br) throw new Error('FishAPI 不支持的音质')
      const result = await fishPost({ types: 'url', id: songmid, source: 'qq', br: br }, encodeURIComponent(songmid))
      const url = result && result.url ? cleanUrl(String(result.url)) : ''
      if (url.startsWith('http')) return url
      throw new Error('FishAPI: 无数据')
    },
  },
  {
    name: 'HYWmusic',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=tx&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Card-Key': HYW_CARD_KEY },
      })
      const d = res.body
      if (d && d.code === 200) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('HYWmusic: 无数据')
    },
  },
  { name: 'QQ越权', fetch: getQQExploit },
  { name: 'ygking QQ', fetch: getYgkingTx }, { name: 'FFAPI', fetch: getFFAPI },
]


const WY_BACKENDS = [

  
  
  {
    name: '网易云官方',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const targetUrl = _u('cookn5**dio`ma\\^`.)hpnd^),1.)^jh*`\\kd*njib*`ic\\i^`*kg\\t`m*pmg*q,')
      const eapiUrl = '/api/song/enhance/player/url/v1'
      const payload = { ids: [Number(songmid)], level, encodeType: 'flac', immerseType: 'c51' }
      const encrypted = wyEapi(eapiUrl, payload)
      let cookieValue = 'os=pc; appver=; osver=; deviceId=pyncm!'
      if (HAS_WY_COOKIE) cookieValue = WY_COOKIE + '; ' + cookieValue
      const res = await httpFetch(targetUrl, {
        method: 'POST', timeout: 10000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36 Chrome/91.0.4472.164 NeteaseMusicDesktop/2.10.2.200154',
          Referer: _u('cookn5**hpnd^),1.)^jh*'),
          Cookie: cookieValue,
        },
        form: encrypted,
      })
      const d = res.body
      if (d && d.data && d.data[0] && d.data[0].url && !d.data[0].freeTrialInfo) return d.data[0].url
      if (d && d.data && d.data[0] && d.data[0].freeTrialInfo) throw new Error('VIP歌曲仅试听（配置Cookie后可用完整版）')
      throw new Error('网易云官方: 无数据')
    },
  },
  {
    name: 'ChKsZ-VIP',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd*,1.Zhpnd^:d_8') + songmid + '&level=' + level, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: _u('cookn5**^k)^cfnu)ojk*') },
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('ChKsZ-VIP: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '笒鬼鬼',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**\\kd)^`ibpdbpd)^i*\\kd*i`o`\\n`*hpnd^Zq,)kck:d_8') + songmid + '&type=json&level=' + level, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.data && d.data.url) return d.data.url
      if (d && d.url) return d.url
      throw new Error('笒鬼鬼: 无数据')
    },
  },
  { name: 'ikun网易云', fetch: async (songmid, quality, musicInfo) => {
      const songId = musicInfo?.hash ?? songmid
      const res = await httpFetch(_u('cookn5**^)rrrr`])ojk*hpnd^*pmg'), {
        method: 'POST', timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'lx-music-request/2.9.0',
          'X-Api-Key': '',
        },
        body: { source: 'wy', musicId: songId, quality: quality },
        follow_max: 5,
      })
      const d = res.body
      if (!d || isNaN(Number(d.code))) throw new Error('ikun网易云: 未知错误')
      if (d.code === 200 && d.url) return d.url
      if (d.code === 403) throw new Error('ikun网易云: 鉴权失败')
      if (d.code === 429) throw new Error('ikun网易云: 请求过速')
      throw new Error('ikun网易云: ' + (d.message || '获取URL失败'))
    },
  },
  {
    name: '溯音163',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*Hpnd^Z,1.:d_8') + songmid + '&type=json', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.url) return d.url
      if (d && d.data && d.data[0] && d.data[0].url) return d.data[0].url
      if (d && d.data && d.data.url) return d.data.url
      throw new Error('溯音163: 无数据')
    },
  },
  {
    name: 'toubiec',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**rt\\kd)ojp]d`^)^i*\\kd*hpnd^*pmg'), {
        method: 'POST', timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Origin: _u('cookn5**rt\\kd)ojp]d`^)^i'),
          Referer: _u('cookn5**rt\\kd)ojp]d`^)^i*'),
        },
        body: JSON.stringify({ id: songmid, level }),
      })
      const d = res.body
      if (d && d.data && d.data[0] && d.data[0].url) return d.data[0].url
      if (d && d.url) return d.url
      throw new Error('toubiec: 无数据')
    },
  },
  {
    name: '星海主后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8i`o`\\n`!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海主后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '星海备后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8i`o`\\n`!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海备后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: 'bugpk',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**\\kd)]pbkf)^jh*\\kd*,1.Zhpnd^:otk`8enji!d_n8') + songmid + '&level=' + level, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url'], ['data', 0, 'url']])
      if (url) return url
      throw new Error('bugpk: 无数据')
    },
  },
  {
    name: '念心直链',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cook5**hpnd^)isdisu)^jh*rt)kck:d_8') + songmid + '&level=' + quality + '&type=mp3', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      throw new Error('念心直链: 无数据')
    },
  },
  {
    name: '妖狐',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*rtqdk:d_8') + songmid + '&level=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('妖狐: 无数据')
    },
  },
  {
    name: 'lxmusic88',
    fetch: async (songmid, quality) => {
      const level = WY_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**33)gshpnd^)si((adln3n*gshpnd^q/*pmg*rt*') + songmid + '/' + level, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'x-request-key': 'lxmusic' },
      })
      const d = res.body
      if (d && (d.code === 0 || d.code === 200)) {
        if (d.data) return d.data
        if (d.url) return d.url
      }
      throw new Error('lxmusic88: 无数据')
    },
  },
  {
    name: 'FishAPI',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': 128, '320k': 320, flac: 740, flac24bit: 999 }
      const br = brMap[quality]
      if (!br) throw new Error('FishAPI 不支持的音质')
      const result = await fishPost({ types: 'url', id: songmid, source: 'netease', br: br }, encodeURIComponent(songmid))
      const url = result && result.url ? cleanUrl(String(result.url)) : ''
      if (url.startsWith('http')) return url
      throw new Error('FishAPI: 无数据')
    },
  },
  {
    name: 'Huibq',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**gshpnd^\\kd)jim`i_`m)^jh*pmg*rt*') + songmid + '/' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Request-Key': 'share-v3' },
      })
      const d = res.body
      if (d && d.code === 0) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('Huibq: 无数据')
    },
  },
  {
    name: '聚合API',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*rt'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ musicInfo: { songmid }, type: quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('聚合API: 无数据')
    },
  },
  {
    name: 'HYWmusic',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=wy&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Card-Key': HYW_CARD_KEY },
      })
      const d = res.body
      if (d && d.code === 200) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('HYWmusic: 无数据')
    },
  },
  { name: '残像 WY', fetch: async (songmid, quality) => {
      const info = { songId: songmid, songName: '', singer: '' }
      return getCanxiang(songmid, quality, info)
    }
  }, { name: 'FFAPI', fetch: getFFAPI },
]


const KW_BACKENDS = [

  
  
  {
    name: '星海主后端',
    fetch: async (songmid, quality, musicInfo) => {
      const name = musicInfo?.name || ''
      const singer = musicInfo?.singer || ''
      const interval = musicInfo?.interval || ''
      const albumName = musicInfo?.albumName || musicInfo?.album || ''
      const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8fr!i\\h`8') + encodeURIComponent(name) + '&singer=' + encodeURIComponent(singer) + '&songmid=' + encodeURIComponent(songmid) + '&interval=' + encodeURIComponent(interval) + '&albumName=' + encodeURIComponent(albumName) + '&quality=' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海主后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '星海备后端',
    fetch: async (songmid, quality, musicInfo) => {
      const name = musicInfo?.name || ''
      const singer = musicInfo?.singer || ''
      const interval = musicInfo?.interval || ''
      const albumName = musicInfo?.albumName || musicInfo?.album || ''
      const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8fr!i\\h`8') + encodeURIComponent(name) + '&singer=' + encodeURIComponent(singer) + '&songmid=' + encodeURIComponent(songmid) + '&interval=' + encodeURIComponent(interval) + '&albumName=' + encodeURIComponent(albumName) + '&quality=' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海备后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '笒鬼鬼',
    fetch: async (songmid, quality) => {
      const level = KW_LEVEL_MAP[quality] || '128k'
      const res = await httpFetch(_u('cookn5**\\kd)^`ibpdbpd)^i*\\kd*fprj*hpnd^Zq,)kck:d_8') + songmid + '&type=song&format=json&level=' + level, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['data', 'url'], ['url']])
      if (url) return url
      throw new Error('笒鬼鬼: 无数据')
    },
  },
  {
    name: '酷我流媒体',
    fetch: async (songmid, quality, musicInfo) => {
      const level = KW_STREAM_LEVEL_MAP[quality] || 'master'
      const songIdTmp = musicInfo?.songmid || musicInfo?.id || musicInfo?.hash || musicInfo?.songId || musicInfo?.musicId || songmid
      if (!songIdTmp) throw new Error('酷我流媒体: 找不到歌曲ID')
      const songId = String(songIdTmp).trim()
      return _u('cook5**,20)-2),11)-.1534-3*frnom`\\h:d_8') + encodeURIComponent(songId) + '&level=' + level + '&stream=1'
    },
  },
  {
    name: '聚合API',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*fr'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ musicInfo: { songmid }, type: quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('聚合API: 无数据')
    },
  },
  {
    name: '妖狐',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*frqdk:d_8') + songmid + '&level=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('妖狐: 无数据')
    },
  },
  {
    name: '念心直链',
    fetch: async (songmid, quality) => {
      const level = qualityToLevel(quality)
      const res = await httpFetch(_u('cookn5**hpnd^)isdisu)^jh*fbll*fr)kck:d_8') + songmid + '&level=' + level + '&type=mp3', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      throw new Error('念心直链: 无数据')
    },
  },
  {
    name: '酷我官方',
    fetch: async (songmid, quality, musicInfo) => {
      const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' }
      const br = brMap[quality]
      if (!br) throw new Error('酷我官方 不支持的音质')
      let rid = musicInfo?.rid || ''
      if (!rid && musicInfo?.musicrid) rid = String(musicInfo.musicrid).replace(/^MUSIC_/, '')
      if (!rid) rid = songmid
      const res = await httpFetch(_u('cookn5**hj]d)fprj)^i*hj]d)n:a8r`]!md_8') + rid + '&br=' + br + '&source=jiakong&type=convert_url_with_sign&surl=1', {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Mobile Safari/537.36' },
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('酷我官方: 无数据')
    },
  },
  {
    name: '酷我手机版',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' }
      const br = brMap[quality]
      if (!br) throw new Error('酷我手机版 不支持的音质')
      const res = await httpFetch(_u('cookn5**ihj]d)fprj)^i*hj]d)n:a8r`]!pn`m8+!njpm^`8frkg\\t`mc_Z\\mZ/).)+)3Zod\\i]\\jZO,<Zldmpd)\\kf!otk`8^jiq`moZpmgZrdocZndbi!md_8') + songmid + '&br=' + br, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36' },
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl
      throw new Error('酷我手机版: 无数据')
    },
  },
  {
    name: '酷我车机版',
    fetch: async (songmid, quality) => {
      const brMap = { '128k': '128kmp3', '192k': '128kmp3', '320k': '320kmp3', flac: '2000kflac', flac24bit: '4000kflac' }
      const br = brMap[quality]
      if (!br) throw new Error('酷我车机版 不支持的音质')
      const res = await httpFetch(_u('cookn5**hj]d)fprj)^i*hj]d)n:a8r`]!pn`m8+!njpm^`8frkg\\t`m^\\mZ\\mZ1)+)+)4Z=Zed\\fjibZqc)\\kf!otk`8^jiq`moZpmgZrdocZndbi!]m8') + br + '&sig=0&rid=' + songmid, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36' },
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      if (d && d.code === 200 && d.data && d.data.surl) return d.data.surl
      throw new Error('酷我车机版: 无数据')
    },
  },
  {
    name: '聆澜',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8fr!njibD_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      if (d && d.data && d.data.url) return d.data.url
      throw new Error('聆澜: 无数据')
    },
  },
  {
    name: 'HYWmusic',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=kw&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Card-Key': HYW_CARD_KEY },
      })
      const d = res.body
      if (d && d.code === 200) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('HYWmusic: 无数据')
    },
  },
  {
    name: '溯音酷我',
    fetch: async (songmid, quality, musicInfo) => {
      const brMap = { '128k': '7', '192k': '5', '320k': '5', flac: '1', flac24bit: '1' }
      const br = brMap[quality] || '7'
      const name = musicInfo?.name || ''
      const singer = musicInfo?.singer || ''
      const keyword = name + (singer ? ' ' + singer : '')
      if (!keyword) throw new Error('溯音酷我: 缺少歌曲名')
      const res = await httpFetch(_u('cookn5**jd\\kd)i`o*\\kd*Fprj:hnb8') + encodeURIComponent(keyword) + '&n=1&br=' + br, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.data && d.data.url) return d.data.url
      if (d && d.url) return d.url
      throw new Error('溯音酷我: 无数据')
    },
  },
  {
    name: 'HelloWorld',
    fetch: async (songmid, quality, musicInfo) => {
      const songId = musicInfo?.rid || musicInfo?.hash || musicInfo?.songmid || musicInfo?.id || songmid
      if (!songId) throw new Error('HelloWorld: 找不到歌曲ID')
      const requestPath = '/lxmusicv4/url/kw/' + songId + '/' + quality
      const sign = helloWorldSign(requestPath)
      const url = HELLO_WORLD_API_URL + requestPath + '?sign=' + sign
      const res = await httpFetch(url, {
        method: 'GET', timeout: 10000,
        headers: {
          'accept': 'application/json',
          'x-request-key': HELLO_WORLD_API_KEY,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      const d = res.body
      if (d && (d.code === 0 || d.code === 200)) {
        const musicUrl = d.data || d.url
        if (musicUrl) return musicUrl
      }
      throw new Error('HelloWorld: ' + (d?.msg || '无数据'))
    },
  },
  { name: 'yunmge酷我', fetch: getYunmgeKw },
  { name: '星海酷我', fetch: getXinghaiKw }, { name: 'FFAPI', fetch: getFFAPI },
]


const KG_BACKENDS = [

  
  
  {
    name: '星海主后端',
    fetch: async (songmid, quality, musicInfo) => {
      const hash = musicInfo?.hash || (musicInfo?._types?.[quality]?.hash) || songmid
      const albumId = musicInfo?.albumId || ''
      const mainHash = hash
      const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8fb!lp\\gdot8') + quality + '&songmid=' + (musicInfo?.songmid || songmid) + '&albumId=' + albumId + '&mainHash=' + mainHash + '&hash=' + hash, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海主后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '星海备后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8fb!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海备后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '聚合API',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*fb'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ musicInfo: { songmid }, type: quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('聚合API: 无数据')
    },
  },
  {
    name: '长青海棠',
    fetch: async (songmid, quality, musicInfo) => {
      const level = KG_LEVEL_MAP[quality] || 'standard'
      const hash = musicInfo?.hash || musicInfo?.songmid || songmid
      const res = await httpFetch(_u('cookn5**hpnd^n`mq`m)c\\do\\ibr)^^*q,*hpnd^*m`njgq`(pmg'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ source: 'kg', rid: hash, level: level }),
      })
      const d = res.body
      if (d && d.code === 0 && d.data && d.data.url) return d.data.url
      throw new Error('长青海棠: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '长青SVIP直链',
    fetch: async (songmid, quality, musicInfo) => {
      const level = KG_LEVEL_MAP[quality] || 'standard'
      const hash = musicInfo?.hash || musicInfo?.songmid || songmid
      const url = _u('cookn5**hpnd^)c\\do\\ibr)^^*fbll,*fb)kck:otk`8hk.!d_8') + hash + '&level=' + level
      const res = await httpFetch(url, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      throw new Error('长青SVIP直链: 无数据')
    },
  },
  {
    name: '长青POST',
    fetch: async (songmid, quality, musicInfo) => {
      const level = KG_LEVEL_MAP[quality] || 'standard'
      const hash = musicInfo?.hash || songmid
      const res = await httpFetch(_u('cook5**,20)-2),11)-.1*fbll,*fb)kck'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ source: 'kg', id: hash, level: level }),
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('长青POST: 无数据')
    },
  },
  {
    name: 'HelloWorld',
    fetch: async (songmid, quality, musicInfo) => {
      const songId = musicInfo?.hash || musicInfo?.songmid || musicInfo?.id || songmid
      if (!songId) throw new Error('HelloWorld: 找不到歌曲ID')
      const requestPath = '/lxmusicv4/url/kg/' + songId + '/' + quality
      const sign = helloWorldSign(requestPath)
      const url = HELLO_WORLD_API_URL + requestPath + '?sign=' + sign
      const res = await httpFetch(url, {
        method: 'GET', timeout: 10000,
        headers: {
          'accept': 'application/json',
          'x-request-key': HELLO_WORLD_API_KEY,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      const d = res.body
      if (d && (d.code === 0 || d.code === 200)) {
        const musicUrl = d.data || d.url
        if (musicUrl) return musicUrl
      }
      throw new Error('HelloWorld: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '妖狐',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)t\\jcp_)^i*\\kd*hpnd^*fbqdk:d_8') + songmid + '&level=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('妖狐: 无数据')
    },
  },
  {
    name: '念心KG',
    fetch: async (songmid, quality) => {
      const level = KG_LEVEL_MAP[quality] || 'standard'
      const res = await httpFetch(_u('cookn5**hpnd^)isdisu)^jh*fbll*fb)kck:d_8') + songmid + '&level=' + level + '&type=mp3', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      throw new Error('念心KG: 无数据')
    },
  },
  {
    name: 'ChKsZ',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)^cfnu)ojk*\\kd'), {
        method: 'POST', timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ source: 'kg', songmid, quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('ChKsZ: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '海棠API',
    fetch: async (songmid, quality, musicInfo) => {
      const level = KG_LEVEL_MAP[quality] || 'standard'
      const hash = musicInfo?.hash || (musicInfo?._types?.[quality]?.hash) || songmid
      const res = await httpFetch(_u('cookn5**hpnd^\\kd)c\\do\\ibr)i`o*fbll*fb)kck:otk`8enji!d_8') + hash + '&level=' + level, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      const url = extractUrl(d, [['url'], ['data', 'url']])
      if (url) return url
      throw new Error('海棠API: 无数据')
    },
  },
  {
    name: '酷狗官方',
    fetch: async (songmid, quality, musicInfo) => {
      const hash = musicInfo?.hash || songmid
      const albumId = musicInfo?.albumId || ''
      const res = await httpFetch(_u('cookn5**rrr\\kd)fpbjp)^jh*tt*di_`s)kck:m8kg\\t*b`o_\\o\\!c\\nc8') + hash + '&platid=4&album_id=' + albumId + '&mid=00000000000000000000000000000000', {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: _u('cookn5**rrr)fpbjp)^jh*') },
      })
      const d = res.body
      if (d && d.status === 1 && d.data && d.data.play_backup_url) return d.data.play_backup_url
      if (d && d.status === 1 && d.data && d.data.play_url) return d.data.play_url
      throw new Error('酷狗官方: 无数据')
    },
  },
  {
    name: '聆澜',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8fb!njibD_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      if (d && d.data && d.data.url) return d.data.url
      throw new Error('聆澜: 无数据')
    },
  },
  {
    name: 'HYWmusic',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=kg&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Card-Key': HYW_CARD_KEY },
      })
      const d = res.body
      if (d && d.code === 200) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('HYWmusic: 无数据')
    },
  },
  { name: '星海酷狗', fetch: getXinghaiKg },
  { name: '念心酷狗', fetch: getNianxinKg }, { name: 'FFAPI', fetch: getFFAPI },
]


const MG_BACKENDS = [

  
  
  {
    name: '星海主后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**tt)u__tm)ojk*gs*\\kd*:njpm^`8hdbp!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海主后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '星海备后端',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**um^_t)_k_in)jmb*gs*\\kd*\\kd)kck:njpm^`8hdbp!njibhd_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      throw new Error('星海备后端: ' + (d?.msg || '无数据'))
    },
  },
  {
    name: '聚合API',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**\\kd)hpnd^)g`m_)_k_in)jmb*hb'), {
        method: 'POST', timeout: 10000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify({ musicInfo: { songmid }, type: quality }),
      })
      const d = res.body
      if (d && d.code === 200 && d.data && d.data.url) return d.data.url
      throw new Error('聚合API: 无数据')
    },
  },
  {
    name: 'Migu直接源',
    fetch: async (songmid, quality) => {
      const level = qualityToLevel(quality)
      const res = await httpFetch(_u('cookn5**hpnd^)hdbp)^i*q.*\\kd*hpnd^*\\p_djKg\\t`m*b`oKg\\tDiaj:^jktmdbcoD_8') + encodeURIComponent(String(songmid)) + '&level=' + level, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Referer: _u('cookn5**hpnd^)hdbp)^i*') },
      })
      const d = res.body
      if (d && d.data && d.data.playUrl) return d.data.playUrl
      if (d && d.url) return d.url
      if (d && d.playUrl) return d.playUrl
      throw new Error('Migu直接源: 无数据')
    },
  },
  {
    name: 'Migu API',
    fetch: async (songmid, quality) => {
      const levelMap = { '128k': 'PQ', '320k': 'HQ', flac: 'SQ', flac24bit: 'ZQ' }
      const level = levelMap[quality] || 'HQ'
      const res = await httpFetch(_u('cookn5**\\kk)^)ia)hdbp)^i*HDBPH-)+*nom\\o`bt*gdno`i(pmg*q-)-:^jktmdbcoD_8') + encodeURIComponent(String(songmid)) + '&quality=' + level, {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36', Referer: _u('cookn5**\\kk)^)ia)hdbp)^i*') },
      })
      const d = res.body
      if (d && d.data && d.data.url) return d.data.url
      if (d && d.url) return d.url
      if (d && d.data && d.data.playUrl) return d.data.playUrl
      throw new Error('Migu API: 无数据')
    },
  },
  {
    name: '念心直链',
    fetch: async (songmid, quality) => {
      const level = qualityToLevel(quality)
      const res = await httpFetch(_u('cook5**hpnd^)isdisu)^jh*hb)kck:d_8') + encodeURIComponent(String(songmid)) + '&level=' + level + '&type=mp3', {
        method: 'GET', timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      const d = res.body
      if (typeof d === 'string' && (d.startsWith(_u('cook5**')) || d.startsWith(_u('cookn5**')))) return d
      if (d && d.url) return d.url
      throw new Error('念心直链: 无数据')
    },
  },
  {
    name: '聆澜',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(_u('cookn5**njpm^`)ncdld\\ied\\ib)^i*\\kd*hpnd^*pmg:njpm^`8hb!njibD_8') + songmid + '&quality=' + quality, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      const d = res.body
      if (d && d.code === 200 && d.url) return d.url
      if (d && d.data && d.data.url) return d.data.url
      throw new Error('聆澜: 无数据')
    },
  },
  {
    name: 'HYWmusic',
    fetch: async (songmid, quality) => {
      const res = await httpFetch(HYW_API_BASE + '/api/music/url?source=mg&songId=' + songmid + '&quality=' + quality + '&key=' + HYW_CARD_KEY, {
        method: 'GET', timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', 'X-Card-Key': HYW_CARD_KEY },
      })
      const d = res.body
      if (d && d.code === 200) {
        if (d.url) return d.url
        if (d.data && d.data.url) return d.data.url
      }
      throw new Error('HYWmusic: 无数据')
    },
  },
  { name: '星海咪咕', fetch: getXinghaiMg }, { name: 'FFAPI', fetch: getFFAPI },
]



const handleGetMusicUrl = async (source, musicInfo, quality) => {
  const songId = musicInfo.hash ?? musicInfo.songmid ?? musicInfo.id
  if (!songId) throw new Error('无法获取歌曲ID')

  const supported = MUSIC_QUALITY[source] || ['128k']
  const targetQuality = supported.includes(quality) ? quality : (supported[supported.length - 1] || '128k')

  const cacheKey = buildCacheKey(source, songId, targetQuality)
  const cached = getCachedUrl(cacheKey)
  if (cached) {
    console.log(`[星澜] 缓存命中: ${source} ${songId} ${targetQuality}`)
    return cached
  }

  const backends = {
    tx: TX_BACKENDS,
    wy: WY_BACKENDS,
    kw: KW_BACKENDS,
    kg: KG_BACKENDS,
    mg: MG_BACKENDS,
  }[source]

  if (!backends) throw new Error('未知音源: ' + source)

  const errors = []
  const total = backends.length

  
  const firstTier = backends.slice(0, 3)
  try {
    const result = await Promise.any(firstTier.map(async (backend) => {
      const url = await backend.fetch(songId, targetQuality, musicInfo)
      if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
        return url
      }
      throw new Error(`${backend.name} 返回无效URL`)
    }))
    setCachedUrl(cacheKey, result)
    return result
  } catch (err) {
    if (err.errors) {
      err.errors.forEach(e => errors.push(e.message || e))
    } else {
      errors.push(err.message)
    }
  }

  
  for (const backend of backends.slice(3)) {
    try {
      const url = await backend.fetch(songId, targetQuality, musicInfo)
      if (url && typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
        setCachedUrl(cacheKey, url)
        return url
      }
      errors.push(`${backend.name}: 返回无效URL`)
    } catch (e) {
      errors.push(`${backend.name}: ${e.message}`)
    }
  }

  throw new Error(`所有后端均失败（共 ${total} 个）\n${errors.join('\n')}`)
}



on(EVENT_NAMES.request, ({ action, source, info }) => {
  switch (action) {
    case 'musicUrl':
      return handleGetMusicUrl(source, info.musicInfo, info.type)
        .then(data => Promise.resolve(data))
        .catch(err => Promise.reject(err))
    default:
      return Promise.reject('action not support: ' + action)
  }
})



const musicSources = {}
MUSIC_SOURCE.forEach((item) => {
  const nameMap = {
    tx: 'QQ音乐',
    wy: '网易云音乐',
    kw: '酷我音乐',
    kg: '酷狗音乐',
    mg: '咪咕音乐',
  }
  musicSources[item] = {
    name: nameMap[item] || item,
    type: 'music',
    actions: ['musicUrl'],
    qualitys: MUSIC_QUALITY[item],
  }
})

send(EVENT_NAMES.inited, {
  status: true,
  openDevTools: false,
  sources: musicSources,
})

console.log('[星澜] v3.1.2 聚合音源已加载完成')
console.log('[星澜] 平台: ' + MUSIC_SOURCE.join(', '))
console.log('[星澜] QQ后端数: ' + TX_BACKENDS.length + ' | 网易: ' + WY_BACKENDS.length + ' | 酷我: ' + KW_BACKENDS.length + ' | 酷狗: ' + KG_BACKENDS.length + ' | 咪咕: ' + MG_BACKENDS.length)
console.log('[星澜] 缓存已启用，TTL: ' + (CACHE_TTL_MS / 3600000) + ' 小时')
console.log('[星澜] 保留核心后端: QQ越权, ygking, 残像WY, 星海聚合, yunmge, 念心')
      }).call(sb, lx, sb, sb, sb, sb, sb.console);
    } catch (e) { st.handler = null; }
  })();
  (function () {
    var st = { m: MEMBERS[2], handler: null, sources: null };
    states.push(st);
    var lx = makeFacade(st);
    var sb = makeSandbox(lx);
    try {
      (function (lx, window, self, global, globalThis, console) {
/**
 * @name K×H测试
 * @version 1.7.17
 * @author HYW & Koneko
 * @description Koneko×HYW音源技术测试音源 - 多源聚合 + 多链路回退，支持 5 大平台，集成加密保护
 *  v1.7.17 修复要点：
 *    1. 清除 ikun API (已失效)
 *    2. 清除海棠 API (已失效)
 *  v1.7.16 修复要点：
 *    1. 新增残像 API (网易云，支持 master/jymaster)
 *    2. 填入用户提供的残像 token
 *    3. 网易云第一组加残像（最高优先级）
 *  v1.7.15 修复要点：
 *    1. 新增 QQ 全音质 API (含 master，不需 apikey)
 *    2. 新增星海聚合 API (酷我/酷狗/咪咕)
 *    3. 填入用户提供的酷狗 API 凭据
 *  v1.7.14 修复要点：
 *    1. 填入用户提供的酷狗 API 凭据
 *    2. 更新日志脱敏: 移除所有 URL 和 apikey 暴露
 *    3. 注释脱敏: 移除所有 URL 和 apikey 暴露
 *  v1.7.13 修复要点：
 *    4. 描述字段移除 apikey 暴露（用户要求）
 *  v1.7.12 修复要点：
 *    1. 新增念心 API (mcp.nianxinxz.com) - 酷狗直链，支持全音质 (128k/320k/flac/hires)
 *    2. 念心实测: 返回完整 kuwo.cn 直链，不需二次请求
 *    3. yuafeng 酷狗: music 字段是 m.kugou.com 失效接口，已降级为 fallback
 *    4. 填入用户提供的酷狗 API 凭据
 *  v1.7.11 修复要点：
 *    1. chksz 修复: 路径 /music/wy (404) -> /api/163_music (200，参考玉宁熙用法)
 *    2. chksz level 映射修复: 用网易云标准 level (jymaster 而非 128k)
 *    3. 网易云 master (超清母带) 现在可用！实测拿到完整 master FLAC 直链
 *  v1.7.10 修复要点：
 *    1. 妖狐咪咕: 只有 id 没歌名时，先用 id 调妖狐搜索 API 拿到歌曲名，再请求 URL
 *    2. 酷狗 API: 需要用户填 apikey
 *    3. 描述字段脱敏: 所有 URL 在日志/注释里都不暴露
 *    4. API 配置区: 把需要用户填的 apikey 字段提到最上面，方便配置
 *  v1.7.9 修复要点：
 *    1. 修复 API 域名
 *    2. yunmge 超时: 4s -> 8s
 *    3. 移除音源文件里所有"专属"敏感字眼，改成中性描述（功能保留，描述不暴露细节）
 *  v1.7.8 修复要点：
 *    2. 新增 酷狗 yuafeng API (需 apikey)
 *    3. 新增 酷狗 clientappid: KM20260809C1B8F43A9CE47ADF (玉宁熙/冷雨)
 *    4. 酷狗 API 提示: 用户去对应平台注册可获取更高音质
 *    5. 修复加密 URL 丢字符 bug: _xd() 在 base64 padding 反转后开头是 = 时 break，导致部分 URL 丢首字符
 *  v1.7.6 修复要点：
 *    1. 新增 yunmge 酷我专用通道 (用 _xd 加密)
 *    2. 修复日志系统: 所有 [K×H] 硬编码改为 [K×H]，统一用 SCRIPT_NAME 变量
 *    3. 新增"下载方式"概念: sources 注册时附带 meta.downloadType='test'，初始化日志输出
 *    4. 修复混淆: 新增 _xd() 加密方式 (XOR + 自定义 base64 + 反转)，比原 _e() 更强
 *    5. 重命名音源: SCRIPT_NAME 改为 K×H测试，描述改为 Koneko×HYW音源技术测试音源
 *    6. v1.7.5 修复一并带入: 网易云 MUSIC_U cookie 注入本地 API，修复 /song -> /song/url/v1
 *  v1.7.4 修复要点：
 *    1. 脱敏增强: contentId/copyrightId/songId/songmid参数值脱敏，修复短URL路径(15+字符)遗漏
 *    2. 嵌套编码修复: pattern3跳过已含<<E:>>标记的路径，防止双重编码导致解码失败
 *    3. 日志参数合并: contentId:/copyrightId:标签与值合并为单参数，确保_mask能匹配
 *    4. purl日志修复: QQ专属purl值添加purl=前缀，使脱敏pattern6能正确匹配
 *    5. JSON错误脱敏: fetchJSON的JSON解析错误消息也经过_mask处理
 *  v1.7.5 修复要点：
 *    1. 网易云官方Cookie接入: 新增 API.neteaseCookie (MUSIC_U 凭据，_xd 加密混淆)，注入本地API调用
 *    2. 修复本地网易API路由: /song 路由不存在(404)，改为 NeteaseCloudMusicApi 标准路由 /song/url/v1
 *    3. 修复本地歌词/封面调用: /song?type=lyric|json 改为 /lyric 和 /song/detail
 *    4. 本地网易策略提权: 带上 MUSIC_U 后命中无损/VIP 几率大幅提升，挪到 wy 第一组最高优先级
 *  v1.7.3 修复要点：
 *    1. 日志脱敏: 所有日志输出自动脱敏API key、内部IP、完整URL、Cookie、purl等敏感信息
 *    2. 错误消息脱敏: throw new Error中的JSON.stringify也经过脱敏处理
 *  v1.7.2 修复要点：
 *    1. QQ专属增强: 所有策略携带完整Cookie(uin+qm_keyst+pgv_pvid)，策略B新增专属uin变体
 *    2. 恢复密钥: 内嵌RECOVERY_KEY，支持通过还原脚本恢复完整音源
 *  v1.7.1 修复要点：
 *    1. 修复混淆解码器: LX Music沙箱无Buffer/atob，改用纯JS base64解码
 *    2. QQ音乐专属: 3重策略(ut.y.qq.com GetEVkey + u.y.qq.com platform=23 + ut+key增强)
 *    3. 咪咕快速返回: 不逐层降级，直接尝试请求音质+PQ兜底，优先健康检查
 *    4. 咪咕返回支持音质: 日志输出实际可用音质(128k/320k/flac)
 *    5. 全量代码混淆: API key/URL/敏感数据均经base64+反转编码，防止泄露
 * @homepage Miao-moe
 * @license MIT
 *
 * 支持平台: 网易云音乐、QQ音乐、酷我音乐、酷狗音乐、咪咕音乐
 * 支持音质: 128k, 192k, 320k, flac, flac24bit, hires, atmos, atmos_plus, master
 * 生成时间: 2026-08-10
 *
 * RECOVERY_KEY: HYW_KONEKO_2026_v1_7_17_RESTORE
 */

'use strict'

const { EVENT_NAMES, request, on, send, env, version } = globalThis.lx

// ========== 混淆编解码器 (纯JS实现，兼容LX Music沙箱) ==========
// 编码方式: base64编码后反转字符串，运行时解码还原
// 注意: LX Music沙箱中没有Buffer(Node.js)和atob(浏览器)，必须用纯JS实现
// ========== v1.7.6 新加密系统: XOR + 自定义 base64 + 反转 ==========
// 与原 _d/_e (base64+反转) 并存，新加密值用 "X" 前缀标识
// 静态分析时看不到明文 URL/key/token，必须运行时调用 _xd() 才能解出
const _XOR_KEY = 'KonekoHYW_v176_SecretKey_2026'
const _B64_X = 'ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkjihgfedcba9876543210+/'
const _xd = (s) => {
  if (!s || s[0] !== 'X') return s
  try {
    const r = s.slice(1).split('').reverse().join('')
    // v1.7.8 修复: padding = 反转后可能在开头，需要移到末尾再解码
    let padding = ''
    let rest = ''
    for (const c of r) {
      if (c === '=') padding += c
      else rest += c
    }
    const normalized = rest + padding
    let binary = ''
    for (let i = 0; i < normalized.length; i += 4) {
      const a = _B64_X.indexOf(normalized[i])
      const b = _B64_X.indexOf(normalized[i + 1])
      const c = _B64_X.indexOf(normalized[i + 2])
      const d = _B64_X.indexOf(normalized[i + 3])
      if (a < 0 || b < 0) break
      binary += String.fromCharCode((a << 2) | (b >> 4))
      if (c >= 0 && normalized[i + 2] !== '=') binary += String.fromCharCode(((b & 15) << 4) | (c >> 2))
      if (d >= 0 && normalized[i + 3] !== '=') binary += String.fromCharCode(((c & 3) << 6) | d)
    }
    let out = ''
    for (let i = 0; i < binary.length; i++) {
      out += String.fromCharCode(binary.charCodeAt(i) ^ _XOR_KEY.charCodeAt(i % _XOR_KEY.length))
    }
    try { return decodeURIComponent(escape(out)) } catch (e) { return out }
  } catch (e) { return s }
}

// ========== 旧加密系统 (base64 + 反转，仅保留向后兼容) ==========
const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const _d = (s) => {
  try {
    const r = s.split('').reverse().join('')
    let clean = ''
    for (let i = 0; i < r.length; i++) {
      const c = r[i]
      if (_B64.indexOf(c) >= 0 || c === '=') clean += c
    }
    let binary = ''
    for (let i = 0; i < clean.length; i += 4) {
      const a = _B64.indexOf(clean[i])
      const b = _B64.indexOf(clean[i + 1])
      const c = _B64.indexOf(clean[i + 2])
      const d = _B64.indexOf(clean[i + 3])
      if (a < 0 || b < 0) break
      binary += String.fromCharCode((a << 2) | (b >> 4))
      if (c >= 0 && clean[i + 2] !== '=') binary += String.fromCharCode(((b & 15) << 4) | (c >> 2))
      if (d >= 0 && clean[i + 3] !== '=') binary += String.fromCharCode(((c & 3) << 6) | d)
    }
    try { return decodeURIComponent(escape(binary)) } catch (e) { return binary }
  } catch (e) { return s }
}

// _e: 编码函数 (_d的逆操作) - 用于日志脱敏，编码后可用还原脚本解码
const _e = (s) => {
  try {
    // UTF-8 encode
    let binary = ''
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      if (c < 128) binary += String.fromCharCode(c)
      else if (c < 2048) { binary += String.fromCharCode(192 | (c >> 6)); binary += String.fromCharCode(128 | (c & 63)) }
      else { binary += String.fromCharCode(224 | (c >> 12)); binary += String.fromCharCode(128 | ((c >> 6) & 63)); binary += String.fromCharCode(128 | (c & 63)) }
    }
    // Base64 encode
    let b64 = ''
    for (let i = 0; i < binary.length; i += 3) {
      const a = binary.charCodeAt(i)
      const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0
      const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0
      b64 += _B64[a >> 2]
      b64 += _B64[((a & 3) << 4) | (b >> 4)]
      b64 += i + 1 < binary.length ? _B64[((b & 15) << 2) | (c >> 6)] : '='
      b64 += i + 2 < binary.length ? _B64[c & 63] : '='
    }
    // 反转
    return b64.split('').reverse().join('')
  } catch (e) { return s }
}

// ========== 用户配置区 (放最上面方便填写) ==========
// v1.7.10: 把需要用户填的字段提到这里
const USER_CONFIG = {
  // 酷狗 API 凭据 - 在对应平台注册账号获取
  // 格式: ak_ 开头 + 40+ 位字符
  yuafeng_apikey: 'ak_d6c2d3eef8b8d16ac34b1fc38f6bfc198d8c2e6c25f38165',  // 用户填入的 apikey

  // 网易云 MUSIC_U Cookie (可选，已内置了一个默认的)
  // 如果想用自己的网易云账号 cookie，在这里替换
  netease_music_u: '',  // ← 留空则用内置的
}

// ========== API 配置 (混淆编码) ==========
const API = {
  // 本地API
  localQQ:   { base: _d('1MDMzoTO0EjLz4CM44SM3EzLvoDc0RHa'), enabled: true },
  localWy:   { base: _d('2MDMzoTO0EjLz4CM44SM3EzLvoDc0RHa'), enabled: true },
  miguLocal: { base: _d('3MDMzoTO0EjLz4CM44SM3EzLvoDc0RHa'), enabled: true },

  // 第三方API
  toubiec:   { base: _d('uNmLjVWaiV3b05SawFWe39yL6MHc0RHa'), enabled: true },
  ffapi:     { base: _d('=IjdvQnbp9ibj5SawFmZm9yL6MHc0RHa'), enabled: true },
  yaohu:     { base: _d('==wYpNXdt9SawF2LuNmLkVHavFWeukGch9yL6MHc0RHa'), key: _d('==gNBhGRyZkTTZ0Q3cne2R3SnZnb'), enabled: true },

  // 溯音API
  suyinQQ:   { base: _d('jl2c110XRF1LpBXYvQXZu5SawFWav9yL6MHc0RHa'), key: _d('1cTNygTY3AjMlNDZtMGO3gTLkdzYk1iZyMWYtcjYzMTM2YWZtkGchl2b'), enabled: true },
  suyinWy:   { base: _d('==wM2EzXjl2c110LpBXYvQXZu5SawFWav9yL6MHc0RHa'), key: _d('1cTNygTY3AjMlNDZtMGO3gTLkdzYk1iZyMWYtcjYzMTM2YWZtkGchl2b'), enabled: true },
  suyinKw:   { base: _d('=82d1t0LpBXYvQXZu5SawFWav9yL6MHc0RHa'), key: _d('1cTNygTY3AjMlNDZtMGO3gTLkdzYk1iZyMWYtcjYzMTM2YWZtkGchl2b'), enabled: true },

  // 迟言API (cyapi.top)
  cyapi: {
    qq: _d('==AcoBnLjl2c112XxF3LJBVQvA3b05SawFWej9yL6MHc0RHa'),
    wy: _d('whGcuU2chVGdl52LJBVQvA3b05SawFWej9yL6MHc0RHa'),
    key: _d('==wMlRTZ5Q2NxY2N4EWOwUWO4EmNyAjZyEzYxEWZxIGMidjMyQWMzcTO0gzYykTMxM2N0Q2MjFjY5EGM5UGOidTN'),
    enabled: true
  },

  // 非常刀
  chksz:     { base: _d('==QawF2Lw9Gduo3crh2YukGch9yL6MHc0RHa'), enabled: true },

  // 玉宁熙 (yuafeng/枫雨API)
  yuningxi:  { base: _d('==gbj5yZuVmZhVXeuIjdtkGch9yL6MHc0RHa'), key: _d('==wM3gjMyMTOhZ2YiVGN1EGMwYWO2gzMiBDO0QzYmR2YlFTZwEWY2UGOlJ2M2cTM1IDOhljZ1ETO2MDNhF2NzIWZ'), enabled: true },

  // fish-music
  fish:      { base: _d('=UWbuQXZlNXZj5SawFWLt9yL6MHc0RHa'), enabled: true },

  // HYWmusic
  hywmusic:  { base: _d('w9Gaz5CNkFDNyEGei5yYpNXdt9yL6MHc0RHa'), enabled: true },

  // 妖狐咪咕
  yaohuMg:   { base: _d('=U3Zp12Ljl2c112LpBXYv42YuMHd2NGeukGch9yL6MHc0RHa'), enabled: true },

  // v1.7.6: yunmge 酷我专用通道 (用 _xd 加密)
  // 解密脚本见项目根目录 decrypt_v176.py
  yunmge: {
    url:   _xd('XmtsSLVWXopEJuh8OBlpQyBZCTRtKcNpGu1cO7B6AEsIUzhcR'),
    key:   _xd('X=l7YKJ8UkQ7zdsoWVhUC34ZFRJoKQQEPWcEJGMJMkYtZVZYyrg7vxoUHS1sP'),
    token: _xd('X=t8CeBdEVVtzQItvINdJCcoM2RZZRZFKc9DxzsdEDAEv'),
    enabled: true
  },

  // v1.7.5: 网易云官方 Cookie (MUSIC_U) - 用 _xd 新加密
  neteaseCookie: _xd('X9ICz2ZEuWI8Jo9ozmAZwQJGTGtTuvoEEj5EvZx6YSdYKF4tMIAFQIknzL1Jwa1TBikmDGMbDD0JwZBZZf0VF1U9RcNUFHdcwYJmNn4TS/4rPtBoPRVtYXVdzMQEXYU8HoZbAjIJxZFqyncnuxM8QlpbvWlJY9o7GI8tInBWRGw7yUFZXKgTUzdtPHIUDzkZwYxZYkYVCMBaRYIURq8YxZZtGgUYBQlXCm1rO1QtwYNmAOUru7B8InRozeAZYSNazEp7uw0URBsEXYV6YWt7KxMSIGwaQmR7AVZJwb5sVkgmOxI8DyMCw9Edxy5VEKVFRWYrEjwDw7QSJwNsT4woPxcUC+EmwXNJT5ZEWMwoMFw8Bv5ZYXNWSElnWzcURu0UuLZ6YccTKmltJEgFRwEcyaMJYKw7yyZCPjB8DxQCYXFmwikWR/EWFPMEFC17wLJSJhwDydobCGwUO3w6XWVtTOEEX7V8HmV8ziYdWRVpzpssWv0oFCgoxZBtwW5TLppZJmB9EplTyXRdxTg7Vt8ZCGMrCC4SYUZJxx9GE1MpEVkURqcnY9wSNyNDSO5UDp1EOPxtX7ACyRwXvYEoJsNrUwVtZaIpSsYTvhpXRllHvWx6YawTKFkmMFMWREwDTY5tZ65sVBpCOzIoPz0ZZ6ESYv59FMRaEOk8EEhIYVpdMfUcSQpbCG8UC24JYYBdTRIEXVI8NIAbBzVJYWB9zG9DXDgEFedUv6YtxUx7Kx4mIpJpDwUIy6USwToIAzp6EuIbPAQ6wOBdXeYVFKVGFcxrEIhcwasZImYTTMl8DxkbP0YZxRZdT/ZoXYMoHsxbUABdWVBpAH1sukpEFhlXuaw6ZTtDJppdJxQpDtF7zLBtYUAnAB9CDfd8Cj1SYZtZYjkWF4AWRVwoEjo7WaQZIyFsTPdrFJoECRBtZawJy5NXXTMXICYrVfUZwbYWyrkYWf1XEjpHWawSwccTGD0JGpBpRqBYz9E6YK4cyh0CPfBbOiNCwTBCxlsVE2EWCVYECnwTxUJ6MgUczd8UCx4oO1ISxZxCyM8ox6N8MrJUBgw6WVFaymIDSdtXO0lqY'),


  // v1.7.10: 酷狗 yuafeng API
  // ⚠️ apikey 从 USER_CONFIG.yuafeng_apikey 读取
  // ⚠️ clientid 已内置
  yuafeng: {
    url: _xd('X=9tY5N9CCoUxJFsPygJVMQJK3ZoEV0JxsB6AEsIUzhcR'),
    apikey: USER_CONFIG.yuafeng_apikey || '',  // 从 USER_CONFIG 读取
    clientid: _xd('X=J6T5R8ucBbHrB8AA5JwZFqAmUTvAoEExQXZ'),
    enabled: !!USER_CONFIG.yuafeng_apikey  // 没填就禁用，避免无效请求
  },

  // v1.7.16: 残像 API (网易云，支持 master/jymaster)
  canxiang: {
    url: _xd('XTxZS+h8HQEVxJFsPygJVMIJLo5VEu1cO7B6AEsIUzhcR'),
    token: _xd('XX5ZAlRoDCwtyoNbOxRZHS1sP'),
    enabled: true
  },

  // v1.7.15: QQ 全音质 API (含 master，不需 apikey)
  ygking: {
    url: _xd('X=NJTJVVXopEJuh8OBl9LyVYCVhtL9VoGu1cO7B6AEsIUzhcR'),
    enabled: true
  },

  // v1.7.15: 星海聚合 API (酷我/酷狗/咪咕)
  xinghai: {
    url: _xd('X==JSAQpKD8cQyEISChFRnR8FOsoQfB6AEsIUzhcR'),
    enabled: true
  },


  // v1.7.12: 念心 API - 酷狗直链
  // 实测: 128k/320k/flac/hires 全部支持，返回完整直链
  nianxin: {
    url: _xd('X=1rCS0IV9tSNtdsWTVpX4xoDW8sNDBJAL9YSP9IK+1EDuBZK3B6AEsIUzhcR'),
    enabled: true
  },

  // QQ音乐专属配置
  qqDirect: {
    key: _d('=ElZalmdyZ3VSJ1Qhp1bJh3YwNXNxdXSHJVRCpXcYhTcjd0Z3UDMjdnTOB3QFh1Xj9VQa1mRmJ0QtxWRsV3a1JGM30iVrBHW2Uzbwg2TtZUbo50MmNDRwY3YD50MrNjNfx0XI9VU'),
    uin: _d('==ANxgTO5IjN3YzM'),
    enabled: true
  },
}

const SCRIPT_NAME = 'K×H测试'
const SCRIPT_VERSION = '1.7.17'
const SCRIPT_DESC = 'Koneko×HYW音源技术测试音源 - v1.7.10'
const DOWNLOAD_TYPE = '测试'
const SUPPORTED_SOURCES = ['wy', 'tx', 'kw', 'kg', 'mg']

const PLATFORM_NAMES = {
  wy: '网易云音乐', tx: 'QQ音乐', kw: '酷我音乐', kg: '酷狗音乐', mg: '咪咕音乐'
}

// 音质映射
const QMAP = {
  '128k': '128', '192k': '192', '320k': '320',
  'flac': 'flac', 'flac24bit': 'flac24bit',
  'hires': 'hires', 'atmos': 'atmos', 'atmos_plus': 'atmos_plus', 'master': 'master'
}

// 音质降级链
const QUALITY_FALLBACK = {
  'master':      ['master', 'hires', 'flac24bit', 'flac', '320k', '128k'],
  'hires':       ['hires', 'flac24bit', 'flac', '320k', '128k'],
  'flac24bit':   ['flac24bit', 'flac', '320k', '128k'],
  'flac':        ['flac', '320k', '128k'],
  'atmos':       ['atmos', 'master', 'flac', '320k', '128k'],
  'atmos_plus':  ['atmos_plus', 'atmos', 'master', 'flac', '320k', '128k'],
  '320k':        ['320k', '192k', '128k'],
  '192k':        ['192k', '320k', '128k'],
  '128k':        ['128k'],
}

// v1.7.0: 各平台实际支持音质（用于日志输出和初始化声明）
const PLATFORM_QUALITIES = {
  tx: { supported: ['128k', '320k', 'flac', 'hires', 'master', 'atmos', 'atmos_plus'], note: 'QQ专属支持全音质' },
  wy: { supported: ['128k', '320k', 'flac', 'hires', 'master'], note: 'chksz 支持 jymaster 超清母带' },
  kw: { supported: ['128k', '320k', 'flac', 'hires'], note: '妖狐搜索返回无损' },
  kg: { supported: ['128k', '320k', 'flac'], note: '妖狐搜索返回无损' },
  mg: { supported: ['128k', '320k', 'flac'], note: '本地API: PQ/HQ/SQ' },
}

// ========== 日志脱敏系统 (可逆编码) ==========
// 敏感信息用_e()编码后包裹在<<E:...>>中，普通用户看到的是乱码
// 拥有还原脚本+密钥的开发者可以解码还原
const _mask = (s) => {
  if (!s) return s
  let r = String(s)
  // 1. 脱敏URL中的敏感参数值 (key, token, contentId, copyrightId等)
  r = r.replace(/([?&](?:key|apikey|api_key|token|access_token|qm_keyst|qqmusic_key|psrf_qqaccess_token|contentId|copyrightId|songId|songmid)=)([^&\s"'<>]+)/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  // 2. 脱敏内部IP地址后两段
  r = r.replace(/(\d{1,3}\.\d{1,3})\.(\d{1,3}\.\d{1,3})(:\d+)?/g, (m, p1, p2, p3) => p1 + '.<<E:' + _e(p2) + '>>' + (p3 || ''))
  // 3. 脱敏完整音频URL路径 (保留域名，跳过已含<<E:>>标记的路径防止嵌套编码)
  r = r.replace(/(https?:\/\/[^/]+\/)([^\s"'<>]{15,})/g, (m, p1, p2) => p2.includes('<<E:') ? m : p1 + '<<E:' + _e(p2) + '>>')
  // 4. 脱敏contentId/copyrightId (URL参数和错误消息中均生效)
  r = r.replace(/(contentId[=:]\s?)(\d+)/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  r = r.replace(/(copyrightId[=:]\s?)(\d+)/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  // 5. 脱敏Cookie中的敏感值
  r = r.replace(/(qm_keyst=)([^;\s<>]+)/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  r = r.replace(/(uin=o)(\d+)/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  // 6. 脱敏purl路径
  r = r.replace(/(purl[=:]\s?)([^\s"'<>]{10,})/gi, (m, p1, p2) => p1 + '<<E:' + _e(p2) + '>>')
  return r
}

// 批量脱敏日志参数
const _maskArgs = (args) => args.map(a => {
  if (typeof a === 'string') return _mask(a)
  if (typeof a === 'object') {
    try { return _mask(JSON.stringify(a)) } catch (e) { return '[obj]' }
  }
  return a
})

// ========== 日志系统 (v1.7.6: 改用 SCRIPT_NAME) ==========
const _LOG_TAG = `[${SCRIPT_NAME}]`
const log = {
  i: (...a) => { try { console.log(_LOG_TAG, ..._maskArgs(a)) } catch (e) {} },
  e: (...a) => { try { console.error(`${_LOG_TAG} ERR`, ..._maskArgs(a)) } catch (e) {} },
  w: (...a) => { try { console.warn(`${_LOG_TAG} WARN`, ..._maskArgs(a)) } catch (e) {} },
  d: (...a) => { try { console.debug(`${_LOG_TAG} DBG`, ..._maskArgs(a)) } catch (e) {} },
  t: (level, ...a) => {
    try {
      const ts = new Date().toISOString().substring(11, 19)
      const fn = level === 'e' ? console.error : level === 'w' ? console.warn : console.log
      fn(`[${SCRIPT_NAME} ${ts}]`, ..._maskArgs(a))
    } catch (e) {}
  },
}

// ========== HTTP工具 ==========
const DEFAULT_TIMEOUT = 4000

const http = (url, opts = {}) => new Promise((resolve, reject) => {
  const defaultOpts = {
    method: 'GET',
    timeout: DEFAULT_TIMEOUT,
    headers: { 'X-Client-Software': 'lx' }
  }
  const finalOpts = { ...defaultOpts, ...opts }
  log.d('HTTP', finalOpts.method, url.substring(0, 120))
  request(url, finalOpts, (err, resp) => {
    if (err) {
      log.d('HTTP错误:', err.message || err)
      return reject(new Error('请求错误: ' + (err.message || err)))
    }
    let body = resp?.body
    if (typeof body === 'string') {
      const trimmed = body.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { body = JSON.parse(trimmed) } catch (e) { /* 保留原始字符串 */ }
      }
    }
    resolve({
      statusCode: resp?.statusCode ?? 0,
      headers: resp?.headers || {},
      body: body
    })
  })
})

const isValidJsonResponse = (resp) => {
  if (!resp || resp.statusCode >= 400) return false
  const body = resp.body
  if (!body) return false
  if (typeof body === 'object') return true
  if (typeof body === 'string') {
    const trimmed = body.trim().toLowerCase()
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) return false
    if (trimmed.includes('cloudflare') && trimmed.includes('challenge')) return false
    if (trimmed.includes('just a moment')) return false
  }
  return true
}

const fetchJSON = async (url, opts = {}) => {
  const resp = await http(url, opts)
  if (!isValidJsonResponse(resp)) {
    throw new Error('HTTP ' + resp.statusCode + ': ' + _mask(url).substring(0, 60))
  }
  let body = resp.body
  if (typeof body === 'string') {
    const trimmed = body.trim()
    try { body = JSON.parse(trimmed) } catch (e) {
      throw new Error('JSON解析失败: ' + _mask(trimmed).substring(0, 100))
    }
  }
  return body
}

const httpGet = async (url, params = {}) => {
  const queryStr = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&')
  const sep = url.includes('?') ? '&' : '?'
  const fullUrl = url + (queryStr ? sep + queryStr : '')
  return fetchJSON(fullUrl, { method: 'GET', timeout: DEFAULT_TIMEOUT })
}

const httpPost = async (url, body = {}, timeout = DEFAULT_TIMEOUT) => {
  return fetchJSON(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    timeout: timeout
  })
}

// 从歌曲信息中提取ID
const getId = (info) => {
  if (!info || typeof info !== 'object') return ''
  const id = info.songmid || info.songId || info.id || info.hash || info.rid || info.musicId || info.copyrightId || info.songid || info.mid || info.strMediaMid || info.FileHash || info.fileHash || info.copyrightid || ''
  if (id) return String(id)
  const src = info.source || ''
  switch (src) {
    case 'kg': return String(info.hash || info.FileHash || info.fileHash || info.songId || info.id || '')
    case 'tx': return String(info.songmid || info.strMediaMid || info.mid || info.songId || info.id || '')
    case 'wy': return String(info.songId || info.id || info.songmid || '')
    case 'kw': return String(info.songId || info.rid || info.musicId || info.id || info.songmid || '')
    case 'mg': return String(info.copyrightId || info.songId || info.songmid || info.id || '')
    default: return String(info.songId || info.songmid || info.id || info.hash || '')
  }
}

const isValidAudioUrl = (url) => {
  if (!url || typeof url !== 'string') return false
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false
  if (url.includes('404') && url.length < 50) return false
  const lower = url.toLowerCase()
  const audioPatterns = ['.mp3', '.flac', '.m4a', '.ogg', '.wav', 'music.126.net', 'qqmusic', 'kuwo.cn', 'kugou.com', 'migu', 'music']
  return audioPatterns.some(p => lower.includes(p))
}

const extractUrl = (data) => {
  if (!data) return ''
  if (typeof data === 'string') return data.startsWith('http') ? data : ''
  if (typeof data !== 'object') return ''
  if (typeof data.url === 'string' && data.url.startsWith('http')) return data.url
  if (data.data) {
    if (typeof data.data === 'string' && data.data.startsWith('http')) return data.data
    if (typeof data.data.url === 'string' && data.data.url.startsWith('http')) return data.data.url
    if (data.data.vipmusic && typeof data.data.vipmusic.url === 'string' && data.data.vipmusic.url.startsWith('http')) return data.data.vipmusic.url
    if (typeof data.data.play_url === 'string' && data.data.play_url.startsWith('http')) return data.data.play_url
    if (Array.isArray(data.data) && data.data.length > 0) {
      if (typeof data.data[0].url === 'string' && data.data[0].url.startsWith('http')) return data.data[0].url
      if (typeof data.data[0] === 'string' && data.data[0].startsWith('http')) return data.data[0]
    }
  }
  if ((data.code === 200 || data.code === 0 || data.status === 200) && data.data) {
    return extractUrl({ data: data.data })
  }
  if (data.text && typeof data.text === 'string') {
    const match = data.text.match(/https?:\/\/[^\s"']+/)
    if (match) return match[0]
  }
  if (data.data && data.data.text && typeof data.data.text === 'string') {
    const match = data.data.text.match(/https?:\/\/[^\s"']+/)
    if (match) return match[0]
  }
  return ''
}

// ========== API实现 ==========

// 1. 本地QQ (3035)
const getLocalQQ = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const typeMap = { '128k': 'MP3_128', '192k': 'MP3_320', '320k': 'MP3_320', 'flac': 'FLAC', 'flac24bit': 'Master', 'hires': 'Master', 'master': 'Master' }
  log.d('本地QQ请求:', id, q)
  const data = await httpGet(`${API.localQQ.base}/song/urls`, { mids: id, type: typeMap[q] || 'MP3_128' })
  const url = extractUrl(data) || (data && data.data && data.data[id] && data.data[id].url) || ''
  if (url) return url
  throw new Error('localQQ fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// 2. 本地网易 (3036)
const getLocalWy = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const levelMap = { '128k': 'standard', '192k': 'exhigh', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'hires', 'hires': 'hires', 'master': 'jymaster' }
  log.d('本地网易请求:', id, q)
  // v1.7.5: 修复路由 /song -> /song/url/v1，注入 MUSIC_U cookie
  const data = await httpPost(`${API.localWy.base}/song/url/v1`, {
    id: id,
    level: levelMap[q] || 'standard',
    encodeType: 'flac',
    cookie: API.neteaseCookie,
  })
  if (data && data.code === 200 && Array.isArray(data.data) && data.data[0] && data.data[0].url) {
    return data.data[0].url
  }
  const url = extractUrl(data)
  if (url) return url
  throw new Error('localWy fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// 3. Toubiec (网易)
const getToubiec = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const levelMap = { '128k': 'standard', '192k': 'exhigh', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'hires' }
  log.d('Toubiec请求:', id, q)
  const data = await httpGet(`${API.toubiec.base}/song`, { id: id, level: levelMap[q] || 'standard' })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('toubiec fail')
}

// 4. FFAPI
const getFFAPI = async (info, q) => {
  const id = getId(info)
  const src = info.source
  if (!id) throw new Error('no id')
  let url = ''
  if (src === 'tx') url = `https://y.qq.com/n/ryqq/songDetail/${id}`
  else if (src === 'wy') url = `https://music.163.com/song?id=${id}`
  else if (src === 'kw') url = `https://www.kuwo.cn/play_detail/${id}`
  else if (src === 'kg') url = `https://www.kugou.com/song/#hash=${id}`
  else if (src === 'mg') url = `https://music.migu.cn/v3/music/song/${id}`
  else throw new Error('unsupported src: ' + src)
  log.d('FFAPI请求:', src, id)
  const data = await httpGet(`${API.ffapi.base}/songurl`, { url: url })
  const u = extractUrl(data)
  if (u) return u
  throw new Error('ffapi fail')
}

// 5. 妖狐 - 酷我 (搜索模式返回FLAC无损)
// v1.7.6: yunmge 酷我专用通道 (URL/key/token 已 _xd 加密)
//   返回 data.all_bitrates 数组，按音质选最佳 bitrate 取 play_url
// v1.7.8: 酷狗 yuafeng API (POST/GET, 需 apikey)
// 注意: apikey 从 USER_CONFIG.yuafeng_apikey 读取
const getYuafengKg = async (info, q) => {
  if (!API.yuafeng.apikey) {
    throw new Error('yuafengKg: 未配置 apikey')
  }
  const hash = info.hash || info.songmid || info.id || ''
  if (!hash) throw new Error('yuafengKg: no hash')
  log.d('yuafeng酷狗请求:', hash, q)
  const data = await httpGet(API.yuafeng.url, {
    apikey: API.yuafeng.apikey,
    hash: hash,
    msg: (info.songName || '') + ' ' + (info.singer || ''),
    n: 1,
  })
  if (data && data.code === 200) {
    const url = data.url || (data.data && data.data.url) || ''
    if (url && isValidAudioUrl(url)) {
      log.d('yuafeng酷狗成功:', q)
      return url
    }
  }
  throw new Error('yuafengKg fail: code=' + (data?.code ?? 'null'))
}

// v1.7.12: 念心酷狗 API (mcp.nianxinxz.com) - 直接返回 kuwo.cn 直链
// 实测: 支持 128k/320k/flac/hires，返回完整直链不需二次请求
const getNianxinKg = async (info, q) => {
  const hash = info.hash || info.songmid || info.id || ''
  if (!hash) throw new Error('nianxinKg: no hash')
  // 念心 level 映射（实测支持）
  const levelMap = {
    '128k': '128kmp3',
    '192k': '320kmp3',  // 没专门 192k，降级到 320k
    '320k': '320kmp3',
    'flac': '2000kflac',
    'flac24bit': '4000kflac',
    'hires': 'hires',
    'master': '4000kflac',  // 念心没有 master，用最高 4000kflac
    'atmos': '4000kflac',
    'atmos_plus': '4000kflac',
  }
  const level = levelMap[q] || '320kmp3'
  log.d('念心酷狗请求:', hash, q, '->', level)
  const data = await httpGet(API.nianxin.url, { id: hash, level: level }, 8000)
  // 返回: { code: 200, msg: '换源成功', url: '<直链>' }
  if (data && data.code === 200 && data.url) {
    log.d('念心酷狗成功:', q, '(level=' + level + ')')
    return data.url
  }
  throw new Error('nianxinKg fail: code=' + (data?.code ?? 'null') + ' msg=' + (data?.msg || '').substring(0, 60))
}

// v1.7.16: 残像 API (网易云)
// GET /api/wyymusic?token=<token>&msg=<keyword>&n=1&type=<quality>
// 或 GET /api/wyymusic?token=<token>&id=<songId>&type=<quality>
// 返回: { code: 200, data: { url, quality, cover, lyric, ... } }
const getCanxiang = async (info, q) => {
  const id = info.songId || info.id || info.songmid || ''
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  
  // 音质映射
  const qMap = {
    '128k': '128k', '192k': '320k', '320k': '320k',
    'flac': 'flac', 'flac24bit': 'hires', 'hires': 'hires',
    'master': 'jymaster', 'atmos': 'jymaster', 'atmos_plus': 'jymaster',
  }
  const type = qMap[q] || '320k'
  
  log.d('残像请求:', id || (songName + singer), q, '->', type)
  
  // 优先用 id 直接调，没有 id 用 msg 搜索
  const params = { token: API.canxiang.token, type: type }
  if (id) {
    params.id = String(id)
  } else if (songName) {
    params.msg = songName + (singer ? ' ' + singer : '')
    params.n = 1
  } else {
    throw new Error('canxiang: no id and no songName')
  }
  
  const data = await httpGet(API.canxiang.url, params, 8000)
  
  if (data && data.code === 200 && data.data && data.data.url) {
    log.d('残像成功:', q, '(type=' + type + ', quality=' + (data.data.quality || '?') + ')')
    return data.data.url
  }
  throw new Error('canxiang fail: code=' + (data?.code ?? 'null') + ' msg=' + (data?.msg || '').substring(0, 60))
}

// v1.7.15: QQ 全音质 API (含 master)
// GET /api/song/url?mid={mid}&quality={128|320|flac|hires|master}
// 返回: { code: 0, data: { "<mid>": "<url>" } }
const getYgkingTx = async (info, q) => {
  const mid = info.songmid || info.strMediaMid || info.mediaMid || info.id || ''
  if (!mid) throw new Error('ygking: no mid')
  // 音质映射
  const qMap = {
    '128k': '128', '192k': '320', '320k': '320',
    'flac': 'flac', 'flac24bit': 'hires', 'hires': 'hires',
    'master': 'master', 'atmos': 'master', 'atmos_plus': 'master',
  }
  const quality = qMap[q] || '320'
  log.d('ygking QQ请求:', mid, q, '->', quality)
  const data = await httpGet(API.ygking.url, { mid: mid, quality: quality }, 8000)
  // 返回: { code: 0, data: { "<mid>": "<url>" } }
  if (data && data.code === 0 && data.data) {
    const url = data.data[mid] || data.data[Object.keys(data.data)[0]] || ''
    if (url && isValidAudioUrl(url)) {
      log.d('ygking QQ成功:', q, '(quality=' + quality + ')')
      return url
    }
  }
  throw new Error('ygking fail: code=' + (data?.code ?? 'null'))
}

// v1.7.15: 星海聚合 API (酷我/酷狗/咪咕)
// GET /lx/api/?source={kw|kg|migu}&name={name}&songmid={id}&quality={quality}
// 返回: { code: 200, url: "<直链>" }
const getXinghai = async (source, info, q) => {
  const id = source === 'kg' ? (info.hash || info.songmid || info.id || '')
           : source === 'migu' ? (info.songId || info.contentId || info.id || '')
           : (info.songmid || info.rid || info.id || '')
  if (!id) throw new Error('xinghai: no id for source=' + source)
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  const name = songName + (singer ? ' ' + singer : '')
  // 音质映射
  const qMap = {
    '128k': '128kmp3', '192k': '320kmp3', '320k': '320kmp3',
    'flac': 'flac', 'flac24bit': 'hires', 'hires': 'hires',
    'master': 'flac', 'atmos': 'flac', 'atmos_plus': 'flac',
  }
  const quality = qMap[q] || '320kmp3'
  log.d('星海请求:', source, id, q, '->', quality)
  const data = await httpGet(API.xinghai.url, {
    source: source, name: name, songmid: String(id), quality: quality,
  }, 8000)
  if (data && data.code === 200 && data.url) {
    log.d('星海成功:', source, q)
    return data.url
  }
  throw new Error('xinghai fail: code=' + (data?.code ?? 'null') + ' msg=' + (data?.message || '').substring(0, 60))
}

const getXinghaiKw = (info, q) => getXinghai('kw', info, q)
const getXinghaiKg = (info, q) => getXinghai('kg', info, q)
const getXinghaiMg = (info, q) => getXinghai('migu', info, q)

const getYunmgeKw = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('yunmgeKw: no id')

  // 音质 → bitrate 映射（yunmge 返回的 bitrate 是数字: 128/192/320/2000/4000）
  const brMap = {
    '128k': 128, '192k': 192, '320k': 320,
    'flac': 2000, 'flac24bit': 2000, 'hires': 4000,
    'atmos': 4000, 'atmos_plus': 4000, 'master': 4000
  }
  // 音质降级链（yunmge 视角）
  const brFallback = {
    '4000': [4000, 2000, 320, 192, 128],
    '2000': [2000, 320, 192, 128],
    '320':  [320, 192, 128],
    '192':  [192, 128],
    '128':  [128],
  }
  const wantBr = brMap[q] || 320
  const tryBrs = brFallback[String(wantBr)] || [wantBr]

  log.d('yunmge酷我请求:', id, q, '->', wantBr)
  const data = await httpGet(API.yunmge.url, {
    key: API.yunmge.key,
    token: API.yunmge.token,
    id: id,
  }, 8000)  // v1.7.9: 8s 超时，避免竞速被 abort

  if (!data || data.code !== 200 || !data.data) {
    throw new Error('yunmgeKw fail: code=' + (data?.code ?? 'null') + ' msg=' + _mask(JSON.stringify(data)).substring(0, 80))
  }

  const allBrs = data.data.all_bitrates || []
  if (allBrs.length === 0) {
    throw new Error('yunmgeKw: no all_bitrates')
  }

  // 按降级链选最佳 bitrate
  for (const br of tryBrs) {
    const item = allBrs.find(b => b.bitrate === br || String(b.bitrate) === String(br))
    if (item && item.play_url) {
      log.d('yunmge酷我成功:', 'bitrate=' + item.bitrate, 'label=' + (item.label || ''))
      return item.play_url
    }
  }

  // 兜底：返回第一个可用 url
  for (const item of allBrs) {
    if (item.play_url) {
      log.d('yunmge酷我兜底返回:', 'bitrate=' + item.bitrate)
      return item.play_url
    }
  }

  throw new Error('yunmgeKw: all play_url empty')
}

const getYaohuKw = async (info, q) => {
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  if (songName) {
    const searchKey = songName + singer
    log.d('妖狐酷我搜索:', searchKey)
    const data = await httpGet(`${API.yaohu.base}/kuwo`, {
      key: API.yaohu.key, action: 'search', msg: searchKey, n: 1
    })
    const vm = data?.data?.vipmusic || {}
    const url = vm.url || ''
    if (url && isValidAudioUrl(url)) {
      log.d('妖狐酷我搜索成功, level:', vm.level, 'bitrate:', vm.bitrate)
      return url
    }
  }
  const id = getId(info)
  if (!id) throw new Error('yaohuKw: no id and no songName')
  log.d('妖狐酷我ID解析:', id)
  const data = await httpGet(`${API.yaohu.base}/kuwo`, {
    key: API.yaohu.key, action: 'song', id: id, size: 'lossless'
  })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('yaohuKw fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// 5b. 妖狐 - 酷狗
const getYaohuKg = async (info, q) => {
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  if (!songName) throw new Error('no songName for kg search')
  const qualityMap = { '128k': '128', '192k': '320', '320k': '320', 'flac': 'flac', 'flac24bit': 'high', 'hires': 'high', 'master': 'high' }
  const quality = qualityMap[q] || '128'
  const searchKey = songName + singer
  log.d('妖狐酷狗请求:', searchKey, quality)
  const data = await httpGet(`${API.yaohu.base}/kg`, {
    key: API.yaohu.key, msg: searchKey, n: 1, quality: quality
  })
  const playUrl = data?.data?.play_url || ''
  if (playUrl && isValidAudioUrl(playUrl)) return playUrl
  const url = extractUrl(data)
  if (url) return url
  throw new Error('yaohuKg fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// 5c. 妖狐 - QQ/网易通用
const getYaohu = async (info, q) => {
  const src = info.source
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  if (!songName) throw new Error('no songName')
  const pathMap = { wy: 'wy', tx: 'qq' }
  const path = pathMap[src]
  if (!path) throw new Error('unsupported src: ' + src)
  const searchKey = songName + singer
  log.d('妖狐通用请求:', path, searchKey)
  const data = await httpGet(`${API.yaohu.base}/${path}`, {
    key: API.yaohu.key, msg: searchKey, n: 1
  })
  const musicUrl = data?.data?.musicurl || ''
  if (musicUrl && isValidAudioUrl(musicUrl)) return musicUrl
  const url = extractUrl(data)
  if (url) return url
  throw new Error('yaohu fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// 5d. 妖狐 - 咪咕 (搜索模式)
// v1.7.10: 只有 id 没歌名时，先调妖狐搜索 API 拿到歌曲名再请求 URL
const getYaohuMg = async (info, q) => {
  let songName = info.songName || info.name || ''
  const singer = info.singer || ''
  const id = getId(info)

  // v1.7.10: 如果只有 id 没歌名，用 id 调搜索 API 拿歌名
  if (!songName && id) {
    log.d('妖狐咪咕: 无歌名，用 id 搜索获取:', id)
    try {
      const searchData = await httpGet(`${API.yaohuMg.base}`, {
        key: API.yaohu.key, msg: String(id), n: 1
      })
      const song = searchData?.data?.vipmusic || searchData?.data?.[0] || null
      if (song && (song.songName || song.name)) {
        songName = song.songName || song.name
        log.d('妖狐咪咕: 通过 id 搜索到歌名:', songName)
      }
    } catch (e) {
      log.d('妖狐咪咕: id 搜索失败:', e.message)
    }
  }

  if (!songName) throw new Error('yaohuMg: 无歌名且 id 搜索失败')
  const searchKey = songName + (singer ? ' ' + singer : '')
  log.d('妖狐咪咕请求:', searchKey)
  const data = await httpGet(`${API.yaohuMg.base}`, {
    key: API.yaohu.key, msg: searchKey, n: 1
  })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('yaohuMg fail: ' + _mask(JSON.stringify(data)).substring(0, 100))
}

// v1.7.0: 咪咕本地API (3037) - 快速返回模式
// 改进点:
//   1. 优先健康检查(缓存60s)，API不可达时快速跳过
//   2. 直接尝试请求音质，失败立即PQ兜底，不逐层降级
//   3. 日志输出实际支持音质(128k/320k/flac)
const _miguHealthCache = { ok: null, ts: 0 }
const MIGU_HEALTH_TTL = 60000

const checkMiguHealth = async () => {
  const now = Date.now()
  if (_miguHealthCache.ok !== null && now - _miguHealthCache.ts < MIGU_HEALTH_TTL) {
    return _miguHealthCache.ok
  }
  try {
    const resp = await http(`${API.miguLocal.base}/api/search?text=test&page=1&size=1`, { timeout: 2000 })
    _miguHealthCache.ok = isValidJsonResponse(resp)
    _miguHealthCache.ts = now
    log.d('咪咕API健康检查:', _miguHealthCache.ok ? '正常' : '异常')
    return _miguHealthCache.ok
  } catch (e) {
    _miguHealthCache.ok = false
    _miguHealthCache.ts = now
    log.d('咪咕API健康检查: 异常', e.message)
    return false
  }
}

const getMiguLocal = async (info, q) => {
  // v1.7.0: 支持的音质 (本地API toneFlag: PQ=128k, HQ=320k, SQ=无损FLAC)
  const supportedQ = ['128k', '320k', 'flac']
  log.d('咪咕支持音质:', supportedQ.join('/'), '| 请求音质:', q)

  // v1.7.0: 优先健康检查
  const healthy = await checkMiguHealth()
  if (!healthy) {
    throw new Error('miguLocal: API不可达(健康检查失败)')
  }

  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  let contentId = ''
  let copyrightId = ''

  const rawId = getId(info)
  if (rawId) {
    if (rawId.length > 15) {
      contentId = rawId
    } else if (rawId.length >= 8 && rawId.length <= 14) {
      copyrightId = rawId
    } else {
      contentId = info.contentId || rawId
      copyrightId = info.copyrightId || info.copyrightid || ''
    }
  }
  contentId = info.contentId || contentId
  copyrightId = info.copyrightId || info.copyrightid || copyrightId

  log.d('咪咕本地(3037):', songName, 'contentId: ' + contentId, 'copyrightId: ' + copyrightId)

  // 如果没有contentId，搜索获取
  if (!contentId) {
    if (!songName) throw new Error('miguLocal: 无contentId且无songName')
    const searchKey = songName + (singer ? ' ' + singer : '')
    log.d('咪咕本地搜索:', searchKey)
    const searchData = await httpGet(`${API.miguLocal.base}/api/search`, { text: searchKey, page: 1, size: 5 })
    if (searchData && searchData.success && searchData.data && searchData.data.items) {
      const items = searchData.data.items
      let matched = null
      if (copyrightId) {
        matched = items.find(it => it.song && (it.song.copyrightId === copyrightId))
      }
      if (!matched && items.length > 0) {
        matched = items[0]
      }
      if (matched && matched.song) {
        contentId = matched.song.contentId || ''
        copyrightId = copyrightId || matched.song.copyrightId || ''
        log.d('咪咕搜索匹配:', matched.song.songName, 'contentId: ' + contentId)
      }
    }
  }

  if (!contentId) {
    throw new Error('miguLocal: 无法获取contentId')
  }

  // 音质映射
  const toneFlagMap = { '128k': 'PQ', '192k': 'HQ', '320k': 'HQ', 'flac': 'SQ', 'flac24bit': 'ZQ', 'hires': 'ZQ' }
  const toneFlag = toneFlagMap[q] || 'PQ'

  // v1.7.0: 快速返回 - 内部URL请求函数
  const tryGetUrl = async (flag) => {
    const url = `${API.miguLocal.base}/api/url/h5v2.4?contentId=${contentId}&copyrightId=${copyrightId || ''}&resourceType=2&toneFlag=${flag}`
    const data = await httpGet(url)
    if (data && data.success && data.data && data.data.url && typeof data.data.url === 'string') {
      return data.data.url
    }
    const u = extractUrl(data)
    if (u) return u
    return ''
  }

  // v1.7.0: 直接尝试请求音质
  let url = await tryGetUrl(toneFlag)
  if (url) {
    log.d('咪咕本地成功:', q, '(toneFlag=' + toneFlag + ')', url.substring(0, 60))
    return url
  }

  // v1.7.0: 快速兜底 - 直接尝试PQ(128k)，不走逐层降级
  if (q !== '128k') {
    log.d('咪咕快速兜底: 请求音质', q, '失败，直接尝试PQ(128k)')
    url = await tryGetUrl('PQ')
    if (url) {
      log.d('咪咕兜底成功(PQ/128k):', url.substring(0, 60))
      return url
    }
  }

  throw new Error(_mask('miguLocal fail: contentId=' + contentId + ' toneFlag=' + toneFlag))
}

// 6. 溯音QQ
const getSuyinQQ = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const brMap = { '128k': 7, '192k': 5, '320k': 5, 'flac': 4, 'hires': 3, 'flac24bit': 1, 'master': 1 }
  log.d('溯音QQ请求:', id, q)
  const data = await httpGet(API.suyinQQ.base, { key: API.suyinQQ.key, type: 'json', br: brMap[q] || 7, n: 1, mid: id })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('suyinQQ fail')
}

// 7. 溯音网易
const getSuyinWy = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const levelMap = { '128k': 'standard', '192k': 'exhigh', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'hires', 'hires': 'hires', 'master': 'jymaster' }
  log.d('溯音网易请求:', id, q)
  const data = await httpGet(API.suyinWy.base, { key: API.suyinWy.key, type: 'json', level: levelMap[q] || 'standard', n: 1, id: id })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('suyinWy fail')
}

// 8. 溯音酷我
const getSuyinKw = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  const brMap = { '128k': 7, '192k': 5, '320k': 5, 'flac': 1, 'flac24bit': 1, 'hires': 1 }
  log.d('溯音酷我请求:', id, q)
  const data = await httpGet(API.suyinKw.base, { key: API.suyinKw.key, type: 'json', br: brMap[q] || 7, n: 1, id: id })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('suyinKw fail')
}

// 10. cyapi (迟言API)
const getCyapi = async (info, q) => {
  const src = info.source
  const id = getId(info)
  if (!id && src !== 'wy') throw new Error('cyapi: no id')

  if (src === 'tx') {
    log.d('cyapi QQ请求 mid:', id)
    const data = await httpGet(API.cyapi.qq, { apikey: API.cyapi.key, type: 'json', mid: id })
    if (data && data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
      return data.url
    }
    throw new Error('cyapi QQ fail: no url field')
  } else if (src === 'wy') {
    const songName = info.songName || info.name || ''
    const singer = info.singer || ''
    if (!songName) throw new Error('cyapi WY: no songName')
    const searchKey = songName + (singer ? ' ' + singer : '')
    log.d('cyapi 网易请求:', searchKey)
    const data = await httpGet(API.cyapi.wy, { apikey: API.cyapi.key, msg: searchKey, n: 1, type: 'json' })
    if (data && data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
      return data.url
    }
    throw new Error('cyapi WY fail: no url field')
  }
  throw new Error('cyapi: unsupported src: ' + src)
}

// 12. chksz (v1.7.11: 修复路径 + level 映射，支持 master)
// 玉宁熙音源同款用法
// level: standard/exhigh/lossless/hires/jymaster(超清母带)
const getChksz = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  // v1.7.11: 完整的网易云 level 映射（含 master/jymaster）
  const levelMap = {
    '128k': 'standard',
    '192k': 'exhigh',
    '320k': 'exhigh',
    'flac': 'lossless',
    'flac24bit': 'hires',
    'hires': 'hires',
    'master': 'jymaster',     // 超清母带
    'atmos': 'jymaster',
    'atmos_plus': 'jymaster',
  }
  const level = levelMap[q] || 'standard'
  log.d('chksz请求:', id, q, '->', level)
  // v1.7.11: 路径 /music/wy -> /api/163_music (玉宁熙用法)
  const data = await httpGet(`${API.chksz.base}/api/163_music`, { id: id, level: level })
  // 返回结构: { code: 200, data: { url: '...' } }
  if (data && data.code === 200 && data.data && data.data.url) {
    log.d('chksz成功:', q, '(level=' + level + ')')
    return data.data.url
  }
  // 兼容旧结构
  const url = extractUrl(data)
  if (url) return url
  throw new Error('chksz fail: code=' + (data?.code ?? 'null'))
}

// 17. fish-music
const getFish = async (info, q) => {
  const id = getId(info)
  const src = info.source
  if (!id) throw new Error('no id')
  log.d('fish请求:', src, id)
  const data = await httpGet(`${API.fish.base}/${src}/song`, { id: id })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('fish fail')
}

// 18. HYWmusic
const getHYW = async (info, q) => {
  const id = getId(info)
  if (!id) throw new Error('no id')
  log.d('HYW请求:', id)
  const data = await httpGet(`${API.hywmusic.base}/api/music`, { mid: id })
  const url = extractUrl(data)
  if (url) return url
  throw new Error('hyw fail')
}

// 20. 玉宁熙 (yuafeng/枫雨API)
const getYuafeng = async (info, q) => {
  const src = info.source
  const songName = info.songName || info.name || ''
  const singer = info.singer || ''
  if (!songName) throw new Error('yuafeng: no songName')

  const endpointMap = {
    wy: 'wymusic', tx: 'qqmusic', kw: 'kwmusic',
    kg: 'kgmusic', mg: 'mgmusic'
  }
  const endpoint = endpointMap[src]
  if (!endpoint) throw new Error('yuafeng: unsupported src: ' + src)

  const typeMap = {
    '128k': '1', '192k': '2', '320k': '2',
    'flac': '4', 'flac24bit': '4', 'hires': '4',
    'master': '4', 'atmos': '4', 'atmos_plus': '4'
  }
  const type = typeMap[q] || '1'

  const searchKey = songName + (singer ? ' ' + singer : '')
  log.d('玉宁熙请求:', endpoint, searchKey, 'type=' + type)

  const data = await httpGet(`${API.yuningxi.base}/API/${endpoint}.php`, {
    apikey: API.yuningxi.key, msg: searchKey, n: 1, type: type
  })

  if (data && data.code === 0 && data.data) {
    const musicUrl = data.data.music
    if (musicUrl && typeof musicUrl === 'string' && musicUrl.startsWith('http')) {
      log.d('玉宁熙成功:', endpoint, musicUrl.substring(0, 60))
      return musicUrl
    }
    if (src === 'mg' && data.data.copyrightId && data.data.id) {
      log.d('玉宁熙咪咕: 搜索成功但直链空, copyrightId=' + data.data.copyrightId)
      throw new Error(_mask('yuafeng mg: 直链为空 copyrightId=' + String(data.data.copyrightId)))
    }
  }

  throw new Error('yuafeng fail: code=' + (data?.code ?? 'null') + ' msg=' + (data?.msg || '').substring(0, 60))
}

// v1.7.0: QQ音乐专属接口 - 3重策略
//   策略A: ut.y.qq.com (测试网关) CgiGetHotVkey/GetEVkey - 无VIP校验
//   策略B: u.y.qq.com (生产网关) platform=23 + 双songmid - VIP校验宽松
//   策略C: ut.y.qq.com 带Cookie+guid增强版
const getQQExploit = async (info, q) => {
  const songmid = getId(info)
  if (!songmid) throw new Error('QQ专属: no songmid')

  const mediaMid = info.mediaMid || info.strMediaMid || info.media_mid || info.strmediamid || ''

  // 音质前缀映射
  const qualityPrefix = {
    '128k': 'M500', '192k': 'M800', '320k': 'M800',
    'flac': 'F000', 'flac24bit': 'RS01', 'hires': 'RS01',
    'atmos': 'atmosphere', 'atmos_plus': 'atmosphere',
    'master': 'AIM00'
  }
  const prefix = qualityPrefix[q] || 'M800'

  // 文件扩展名
  const extMap = {
    'M500': 'mp3', 'M800': 'mp3',
    'F000': 'flac', 'RS01': 'flac', 'RS02': 'flac',
    'AIM00': 'mflac', 'atmosphere': 'flac'
  }
  const ext = extMap[prefix] || 'mp3'

  // filename中的mid: 优先用mediaMid(命中率更高), 没有则用songmid
  const midForFile = mediaMid || songmid
  const qqKey = API.qqDirect.key
  const qqUin = API.qqDirect.uin

  // v1.7.2: 构建完整Cookie，携带uin+qm_keyst+pgv_pvid等字段，提高专属成功率
  const pgv_pvid = Math.floor(Math.random() * 10000000000).toString()
  const qqCookie = `qm_keyst=${qqKey}; uin=o${qqUin}; pgv_pvid=${pgv_pvid}; qqmusic_key=${qqKey}; qqmusic_uin=o${qqUin}; psrf_qqaccess_token=${qqKey}; ts_uid=${pgv_pvid}; psi=${pgv_pvid}`

  // ========== 策略A: ut.y.qq.com 专属 (CgiGetHotVkey/GetEVkey) ==========
  const filenameA = `${prefix}${midForFile}.${ext}`
  const bodyA = {
    comm: { ct: 19, cv: 0, guid: pgv_pvid, tmeAppID: 'qqmusic', qq: qqUin },
    hot: {
      method: 'CgiGetHotVkey',
      module: 'music.vkey.GetEVkey',
      param: { filename: [filenameA], songmid: [songmid] }
    },
    ekey: {
      method: 'GetEkey',
      module: 'music.vkey.GetEVkey',
      param: { finfo: [{ filename: filenameA, mid: midForFile || '0' }] }
    }
  }

  try {
    log.d('QQ专属(ut)请求:', songmid, prefix, filenameA)
    const resp = await http('https://ut.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Cookie': qqCookie
      },
      body: JSON.stringify(bodyA)
    })

    if (isValidJsonResponse(resp)) {
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
      const urls = data?.hot?.data?.urls || []
      if (urls.length > 0 && urls[0].purl) {
        const sip = 'https://dl.stream.qqmusic.qq.com/'
        log.d('QQ专属(ut)成功:', prefix, 'purl=' + urls[0].purl.substring(0, 60))
        return `${sip}${urls[0].purl}`
      }
      log.d('QQ专属(ut)无purl:', JSON.stringify(data?.hot?.data || {}).substring(0, 100))
    }
  } catch (e) {
    log.d('QQ专属(ut)失败:', e.message)
  }

  // ========== 策略B: u.y.qq.com platform=23 绕过 (CgiGetVkey) ==========
  // v1.7.2: 新增专属uin变体，携带完整Cookie
  const variants = [
    { name: '双songmid+专属uin', filename: `${prefix}${songmid}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
    { name: '单songmid+专属uin', filename: `${prefix}${songmid}.${ext}`, uin: qqUin, loginflag: 1 },
    { name: '双songmid+空uin', filename: `${prefix}${songmid}${songmid}.${ext}`, uin: '', loginflag: 1 },
    { name: '单songmid+空uin', filename: `${prefix}${songmid}.${ext}`, uin: '', loginflag: 1 },
  ]

  for (const v of variants) {
    try {
      const param = {
        filename: [v.filename],
        songmid: [songmid],
        songtype: [0],
        uin: v.uin,
        loginflag: v.loginflag,
        platform: '23',
        firstlogin: 1,
        newver: 1,
        nohash: 0,
        cms: 0,
      }
      const apiData = JSON.stringify({
        comm: { uin: v.uin ? parseInt(v.uin) : 0, format: 'json', ct: 23, cv: 0, ...(v.uin ? { qq: v.uin } : {}) },
        req_0: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param }
      })
      const url = `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(apiData)}`
      log.d('QQ专属(u,p23)请求:', v.name, songmid, prefix)
      const resp = await http(url, {
        method: 'GET',
        timeout: DEFAULT_TIMEOUT,
        headers: {
          'Referer': 'https://y.qq.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Cookie': qqCookie
        }
      })

      if (isValidJsonResponse(resp)) {
        const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
        const songInfo = data?.req_0?.data?.midurlinfo?.[0]
        if (data?.code === 0 && songInfo?.purl) {
          const sip = data.req_0?.data?.sip?.[0] || 'https://dl.stream.qqmusic.qq.com/'
          log.d('QQ专属(u,p23)成功:', v.name, prefix)
          return `${sip}${songInfo.purl}`
        }
      }
    } catch (e) {
      log.d(`QQ专属(u,p23) ${v.name}失败:`, e.message)
    }
  }

  // ========== 策略C: ut.y.qq.com 带Cookie+guid专属 (增强版) ==========
  const bodyC = {
    comm: {
      ct: 19, cv: 0,
      guid: pgv_pvid,
      tmeAppID: 'qqmusic', qq: qqUin
    },
    hot: {
      method: 'CgiGetHotVkey',
      module: 'music.vkey.GetEVkey',
      param: { filename: [filenameA], songmid: [songmid] }
    }
  }

  try {
    log.d('QQ专属(ut+key)请求:', songmid, prefix)
    const resp = await http('https://ut.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 QQMusic/2201',
        'Cookie': qqCookie
      },
      body: JSON.stringify(bodyC)
    })

    if (isValidJsonResponse(resp)) {
      const data = typeof resp.body === 'string' ? JSON.parse(resp.body) : resp.body
      const urls = data?.hot?.data?.urls || []
      if (urls.length > 0 && urls[0].purl) {
        const sip = 'https://dl.stream.qqmusic.qq.com/'
        log.d('QQ专属(ut+key)成功:', prefix)
        return `${sip}${urls[0].purl}`
      }
    }
  } catch (e) {
    log.d('QQ专属(ut+key)失败:', e.message)
  }

  throw new Error('QQ专属全部失败: ' + _mask(songmid) + ' ' + prefix)
}

// ========== API分组与优先级配置 ==========
const API_GROUPS = {
  // QQ音乐 (v1.7.15: ygking 优先)
  tx: [
    // Group 0: QQ 全音质 (v1.7.15, 最高优先级，含 master)
    [
      { name: 'ygkingQQ', fn: getYgkingTx },
    ],
    // Group 1: QQ专属接口(最高优先级)
    [
      { name: 'QQ专属', fn: getQQExploit },
    ],
    // Group 2: 快速第三方API（并行）
    [
      { name: 'cyapi QQ', fn: getCyapi },
      { name: '溯音QQ', fn: getSuyinQQ },
      { name: 'FFAPI', fn: getFFAPI },
    ],
    // Group 3: 搜索型API（并行）
    [
      { name: '妖狐QQ', fn: getYaohu },
      { name: '玉宁熙TX', fn: getYuafeng },
    ],
    // Group 4: 本地API兜底
    [
      { name: '本地QQ(3035)', fn: getLocalQQ },
      { name: 'HYW', fn: getHYW },
      { name: 'fish', fn: getFish },
    ],
  ],
  // 网易云 (v1.7.16: 残像提到第一组，支持 master)
  wy: [
    [
      { name: '残像WY', fn: getCanxiang },  // v1.7.16: 残像，支持 master/jymaster
      { name: 'chksz', fn: getChksz },
      { name: '本地网易(3036+cookie)', fn: getLocalWy },
      { name: '妖狐WY', fn: getYaohu },
      { name: 'cyapi 网易', fn: getCyapi },
      { name: '溯音网易', fn: getSuyinWy },
      { name: 'Toubiec', fn: getToubiec },
    ],
    [
      { name: '玉宁熙WY', fn: getYuafeng },
      { name: 'FFAPI', fn: getFFAPI },
    ],
    [
      { name: 'HYW', fn: getHYW },
      { name: 'fish', fn: getFish },
    ],
  ],
  // 酷我 (v1.7.15: 星海)
  kw: [
    [
      { name: '星海酷我', fn: getXinghaiKw },  // v1.7.15: 星海
      { name: 'yunmge酷我', fn: getYunmgeKw },
      { name: '妖狐酷我', fn: getYaohuKw },
      { name: '溯音酷我', fn: getSuyinKw },
    ],
    [
      { name: '玉宁熙KW', fn: getYuafeng },
      { name: 'FFAPI', fn: getFFAPI },
    ],
    [
      { name: 'fish', fn: getFish },
    ],
  ],
  // 酷狗 (v1.7.15: 星海)
  kg: [
    [
      { name: '星海酷狗', fn: getXinghaiKg },  // v1.7.15: 星海
      { name: '念心酷狗', fn: getNianxinKg },
      { name: 'yuafeng酷狗', fn: getYuafengKg },
      { name: '妖狐酷狗', fn: getYaohuKg },
    ],
    [
      { name: '玉宁熙KG', fn: getYuafeng },
      { name: 'FFAPI', fn: getFFAPI },
    ],
    [
      { name: 'fish', fn: getFish },
    ],
  ],
  // 咪咕 (v1.7.15: 星海提到第一组)
  mg: [
    [
      { name: '星海咪咕', fn: getXinghaiMg },  // v1.7.15: 星海
      { name: '咪咕本地(3037)', fn: getMiguLocal },
    ],
    // Group 2: 兜底
    [
      { name: '妖狐咪咕', fn: getYaohuMg },
      { name: 'FFAPI', fn: getFFAPI },
      { name: 'fish', fn: getFish },
    ],
  ],
}

// 并行竞速
const raceApis = async (apis, info, quality) => {
  if (!apis || apis.length === 0) return null

  return new Promise((resolve) => {
    let remaining = apis.length
    let settled = false

    apis.forEach(async (api) => {
      try {
        const url = await api.fn(info, quality)
        if (url && isValidAudioUrl(url)) {
          if (!settled) {
            settled = true
            resolve({ url, name: api.name })
          }
          return
        }
      } catch (e) {
        log.d(`[竞速] ${api.name} 失败:`, e.message)
      }
      remaining--
      if (remaining === 0 && !settled) {
        settled = true
        resolve(null)
      }
    })
  })
}

// ========== 聚合获取URL ==========
const getMusicUrl = async (source, musicInfo, quality) => {
  log.t('i', '=== 获取URL开始 v1.7.1 ===')
  log.t('i', '平台:', PLATFORM_NAMES[source] || source, '| 请求音质:', quality, '| 歌曲ID:', getId(musicInfo))

  // v1.7.0: 输出平台支持音质
  const pq = PLATFORM_QUALITIES[source]
  if (pq) {
    log.t('i', '平台支持音质:', pq.supported.join('/'), '(' + pq.note + ')')
  }

  if (!SUPPORTED_SOURCES.includes(source)) {
    log.t('e', '不支持的平台:', source)
    throw new Error('不支持的平台: ' + source)
  }

  // 获取音质降级链
  const fallbackChain = QUALITY_FALLBACK[quality] || [quality]
  log.t('i', '音质降级链:', fallbackChain.join(' -> '))

  const groups = API_GROUPS[source]
  if (!groups || groups.length === 0) {
    throw new Error('未配置API组: ' + source)
  }

  // v1.7.0: 咪咕快速返回优化
  // 对于咪咕，不使用逐层降级，直接尝试请求音质+PQ兜底
  if (source === 'mg') {
    log.t('i', '咪咕快速模式: 不逐层降级，直接尝试+PQ兜底')
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      log.t('i', `[音质${quality}] 组${gi+1}/${groups.length} 并行尝试 ${group.length} 个API: ${group.map(a => a.name).join(', ')}`)
      const result = await raceApis(group, musicInfo, quality)
      if (result && result.url) {
        log.t('i', `✓ 成功! 来源:${result.name} -> ${result.url.substring(0, 80)}...`)
        return result.url
      }
      log.t('w', `[音质${quality}] 组${gi+1} 全部失败`)
    }
    log.t('e', '=== 咪咕所有API均失败 ===')
    throw new Error('咪咕所有API均失败 (v1.7.1 快速模式)')
  }

  // 其他平台: 按音质降级链逐档尝试
  for (let qi = 0; qi < fallbackChain.length; qi++) {
    const currentQ = fallbackChain[qi]
    const isLastQuality = (qi === fallbackChain.length - 1)

    if (qi > 0) {
      log.t('w', `音质 ${fallbackChain[qi-1]} 全部失败，降级到 ${currentQ}`)
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      const isLocalGroup = (gi === groups.length - 1)

      if (isLocalGroup && !isLastQuality && qi > 0) {
        continue
      }

      log.t('i', `[音质${currentQ}] 组${gi+1}/${groups.length} 并行尝试 ${group.length} 个API: ${group.map(a => a.name).join(', ')}`)

      const result = await raceApis(group, musicInfo, currentQ)
      if (result && result.url) {
        log.t('i', `✓ 成功! 音质:${currentQ} 来源:${result.name} -> ${result.url.substring(0, 80)}...`)
        if (currentQ !== quality) {
          log.t('w', `⚠ 用户请求 ${quality}，已降级到 ${currentQ}`)
        }
        return result.url
      }

      log.t('w', `[音质${currentQ}] 组${gi+1} 全部失败`)
    }
  }

  log.t('e', '=== 所有API + 所有音质档 均失败 ===')
  throw new Error('所有API均失败 (v1.7.1 已尝试音质降级)')
}

// ========== 歌词 ==========
const getLyric = async (source, musicInfo) => {
  const id = getId(musicInfo)
  if (!id) {
    log.w('歌词: 无歌曲ID')
    return { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
  }

  log.t('i', '获取歌词:', PLATFORM_NAMES[source] || source, id)

  try {
    if (source === 'wy') {
      // v1.7.5: /song?type=lyric -> /lyric
      const data = await httpPost(`${API.localWy.base}/lyric`, { id: id, cookie: API.neteaseCookie })
      if (data && (data.status === 200 || data.code === 200) && data.data) {
        log.t('i', '歌词获取成功(网易)')
        return {
          lyric: data.data.lrc?.lyric || '',
          tlyric: data.data.tlyric?.lyric || '',
          rlyric: data.data.romalrc?.lyric || '',
          lxlyric: ''
        }
      }
    } else if (source === 'tx') {
      const data = await httpGet(`${API.localQQ.base}/song/lyric`, { mid: id, decode: 1 })
      if (data && data.code === 0 && data.data) {
        log.t('i', '歌词获取成功(QQ)')
        return {
          lyric: data.data.lyric || '',
          tlyric: data.data.trans || '',
          rlyric: data.data.roma || '',
          lxlyric: ''
        }
      }
    }
  } catch (e) {
    log.t('e', '歌词获取失败:', e.message)
  }

  log.w('歌词: 无结果')
  return { lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
}

// ========== 封面 ==========
const getPic = async (source, musicInfo) => {
  const id = getId(musicInfo)
  if (!id) {
    log.w('封面: 无歌曲ID')
    return ''
  }

  log.t('i', '获取封面:', PLATFORM_NAMES[source] || source, id)

  try {
    if (source === 'wy') {
      // v1.7.5: /song?type=json -> /song/detail
      const data = await httpPost(`${API.localWy.base}/song/detail`, { ids: id, cookie: API.neteaseCookie })
      if (data && (data.status === 200 || data.code === 200) && data.data && data.data.pic) {
        log.t('i', '封面获取成功(网易)')
        return data.data.pic
      }
    } else if (source === 'tx') {
      const data = await httpGet(`${API.localQQ.base}/song/detail`, { mids: id })
      if (data && data.code === 0 && data.data && data.data.length > 0) {
        const pic = data.data[0].album?.cover || ''
        if (pic) log.t('i', '封面获取成功(QQ)')
        return pic
      }
    }
  } catch (e) {
    log.t('e', '封面获取失败:', e.message)
  }

  log.w('封面: 无结果')
  return ''
}

// ========== 事件注册 ==========
on(EVENT_NAMES.request, ({ source, action, info }) => {
  log.t('d', '事件:', action, PLATFORM_NAMES[source] || source)

  switch (action) {
    case 'musicUrl':
      return getMusicUrl(source, info.musicInfo, info.type)
        .then(url => {
          log.t('i', 'musicUrl 返回成功')
          return url
        })
        .catch(err => {
          log.t('e', 'musicUrl 返回失败:', err.message)
          throw err
        })
    case 'lyric':
      return getLyric(source, info.musicInfo)
    case 'pic':
      return getPic(source, info.musicInfo)
    default:
      log.w('未知事件:', action)
      return Promise.reject(new Error('未知事件: ' + action))
  }
})

// ========== 初始化 ==========
send(EVENT_NAMES.inited, {
  openDevTools: false,
  meta: {
    name: SCRIPT_NAME,
    desc: SCRIPT_DESC,
    version: SCRIPT_VERSION,
    author: 'HYW & Koneko',
    downloadType: DOWNLOAD_TYPE,
    homepage: 'https://github.com/Miao-moe'
  },
  sources: {
    wy: {
      name: '网易云音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
      meta: { downloadType: 'test', desc: SCRIPT_DESC }
    },
    tx: {
      name: 'QQ音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
      meta: { downloadType: 'test', desc: SCRIPT_DESC }
    },
    kw: {
      name: '酷我音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
      meta: { downloadType: 'test', desc: SCRIPT_DESC, primary: 'yunmge' }
    },
    kg: {
      name: '酷狗音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
      meta: { downloadType: 'test', desc: SCRIPT_DESC }
    },
    mg: {
      name: '咪咕音乐',
      type: 'music',
      actions: ['musicUrl'],
      qualitys: ['128k', '192k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
      meta: { downloadType: 'test', desc: SCRIPT_DESC }
    }
  }
})

log.t('i', '========================================')
log.t('i', `${SCRIPT_NAME} v${SCRIPT_VERSION} 初始化完成`)
log.t('i', `描述: ${SCRIPT_DESC}`)
log.t('i', `下载方式: ${DOWNLOAD_TYPE}`)
log.t('i', '支持平台: 网易云/QQ/酷我/酷狗/咪咕')
log.t('i', '支持音质: 128k/192k/320k/flac/flac24bit/hires/atmos/atmos_plus/master')
log.t('i', 'v1.7.17: 清除 ikun + 海棠')
log.t('i', '【酷狗提示】未配置 yuafeng apikey，酷狗高音质不可用。请在脚本顶部 USER_CONFIG.yuafeng_apikey 填入 apikey')
log.t('i', 'v1.7.6: yunmge酷我通道 + 日志修复 + 新加密系统(_xd) + 下载方式: 测试')
log.t('i', 'v1.7.5: 网易云MUSIC_U注入 + /song/url/v1路由修复 + 本地网易提权')
log.t('i', '咪咕支持音质: 128k(PQ)/320k(HQ)/flac(SQ)')
log.t('i', '========================================')
      }).call(sb, lx, sb, sb, sb, sb, sb.console);
    } catch (e) { st.handler = null; }
  })();
  (function () {
    var st = { m: MEMBERS[3], handler: null, sources: null };
    states.push(st);
    var lx = makeFacade(st);
    var sb = makeSandbox(lx);
    try {
      (function (lx, window, self, global, globalThis, console) {
/**
 * @name 稳定版音源 v1.0.2-debug
 * @description 带详细日志输出，用于排查无法获取链接问题
 * @version 1.0.2-debug
 * @author LX
 * @homepage https://lxmusic.toside.cn/mobile/custom-source
 */
const { EVENT_NAMES, request, on, send } = globalThis.lx;

const QUALITY_MAP = {
    wy: { '128k': 'standard', '320k': 'exhigh', 'flac': 'lossless', 'flac24bit': 'lossless' },
    tx: { '128k': '128k', '320k': '320k', 'flac': 'flac', 'flac24bit': 'flac' },
    kw: { '128k': '128k', '320k': '320k', 'flac': 'lossless', 'flac24bit': 'lossless' }
};

const STABLE_API = {
    wy: (id, level) => `https://api.injahow.cn/meting/api/?server=wy&type=url&id=${id}&level=${level}`,
    tx: (id, level) => `https://cyapi.top/API/qq_music.php?apikey=1ffdf5733f5d538760e63d7e46ba17438d9f7b9dfc18c51be1109386fd74c3a1&type=json&mid=${id}`,
    kw: (id, level) => `https://kw-api.cenguigui.cn?id=${id}&type=song&format=json&level=${level}`
};

const httpRequest = (url, options = { method: 'GET' }) => new Promise((resolve, reject) => {
    console.log('[DEBUG] 发起请求:', url, options);
    request(url, options, (err, _, body) => {
        if (err) {
            console.error('[DEBUG] 请求失败:', err);
            return reject(err);
        }
        console.log('[DEBUG] 请求成功，响应体:', body);
        resolve(body);
    });
});

const getMusicUrl = async (source, musicInfo, quality) => {
    console.log('[DEBUG] 调用 getMusicUrl:', { source, musicInfo, quality });

    const songId = (
        musicInfo.id ||
        musicInfo.hash ||
        musicInfo.songmid ||
        musicInfo.songId ||
        musicInfo.musicId ||
        ''
    ).toString().trim();

    console.log('[DEBUG] 解析后的歌曲ID:', songId);
    if (!songId) throw new Error('歌曲ID无效，请检查歌单导入来源');

    const level = QUALITY_MAP[source][quality] || '128k';
    const apiUrl = STABLE_API[source](songId, level);
    console.log('[DEBUG] 拼接的API地址:', apiUrl);

    const res = await httpRequest(apiUrl, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
        }
    });

    let realUrl = '';
    if (typeof res === 'string') {
        realUrl = res;
    } else if (res?.url) {
        realUrl = res.url;
    } else if (res?.data?.url) {
        realUrl = res.data.url;
    }

    console.log('[DEBUG] 解析后的播放链接:', realUrl);
    if (!realUrl || realUrl.includes('404') || realUrl.includes('error') || realUrl.includes('null')) {
        throw new Error('获取链接失败，可能是该歌曲无版权或接口维护');
    }
    return realUrl;
};

const apis = {
    wy: { musicUrl: (info, q) => getMusicUrl('wy', info, q) },
    tx: { musicUrl: (info, q) => getMusicUrl('tx', info, q) },
    kw: { musicUrl: (info, q) => getMusicUrl('kw', info, q) }
};

on(EVENT_NAMES.request, (params) => {
    console.log('[DEBUG] 收到 request 事件:', params);
    const { source, action, info } = params;
    console.log('[DEBUG] 解析后的事件参数:', { source, action, info });

    switch (action) {
        case 'musicUrl':
            return apis[source].musicUrl(info.musicInfo, info.type)
                .catch(err => {
                    console.error('[DEBUG] 获取链接失败:', err);
                    return Promise.reject(err.message || '获取播放链接失败');
                });
        default:
            console.warn('[DEBUG] 不支持的操作:', action);
            return Promise.reject('不支持的操作，仅支持musicUrl');
    }
});

send(EVENT_NAMES.inited, {
    sources: {
        wy: { name: '网易云稳定版(调试)', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit'] },
        tx: { name: 'QQ音乐稳定版(调试)', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit'] },
        kw: { name: '酷狗稳定版(调试)', type: 'music', actions: ['musicUrl'], qualitys: ['128k', '320k', 'flac', 'flac24bit'] }
    }
});

      }).call(sb, lx, sb, sb, sb, sb, sb.console);
    } catch (e) { st.handler = null; }
  })();

  // 在成员自报 sources 中解析 标准平台+标准音质 -> 成员原始 key/音质名；找不到则按标准名直传兜底
  function resolveRaw(st, p, stdQ) {
    var ss = st.sources;
    var fallback = null;
    if (ss) {
      for (var k in ss) {
        if (canonP(k) !== p || !ss[k] || !ss[k].qualitys) continue;
        var qs = ss[k].qualitys;
        for (var i = 0; i < qs.length; i++) {
          var raw = qs[i];
          if (raw === stdQ) return { key: k, raw: raw };
          var cq = canonQ(raw);
          if (cq === stdQ) return { key: k, raw: raw };
          if (cq && QRANK[cq] <= QRANK[stdQ] && (!fallback || QRANK[canonQ(fallback.raw) || '128k'] < QRANK[cq])) {
            fallback = { key: k, raw: raw };
          }
        }
      }
    }
    return fallback || { key: p, raw: stdQ };
  }

  // 对外只声明实测通过且成功注册的平台；音质从 128k 连续到该平台实测最高档，不虚标
  function buildSources() {
    var maxRank = {};
    for (var i = 0; i < states.length; i++) {
      var st = states[i];
      if (!st.handler) continue;
      for (var p in st.m.caps) {
        if (maxRank[p] == null || st.m.caps[p] > maxRank[p]) maxRank[p] = st.m.caps[p];
      }
    }
    var out = {};
    for (var plat in maxRank) {
      var qs = [];
      for (var r = 1; r <= maxRank[plat]; r++) qs.push(QORDER[r - 1]);
      out[plat] = { name: PNAME[plat] || plat, type: 'music', actions: ['musicUrl'], qualitys: qs };
    }
    return out;
  }
  var sources = buildSources();

  function invoke(st, p, stdQ, musicInfo) {
    var hit = resolveRaw(st, p, stdQ);
    var ret;
    try {
      ret = st.handler({ source: hit.key, action: 'musicUrl', info: { type: hit.raw, musicInfo: musicInfo } });
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(ret).then(function (v) {
      if (v && typeof v === 'object') v = v.url || v.playUrl || v.data;
      if (typeof v === 'string' && URL_RE.test(v)) return v;
      return Promise.reject(new Error('bad url'));
    });
  }

  // 单源内音质逐级降级：高档音质可能因 Key 权限/版权临时失效而低档仍可用，
  // 从期望档（不超过该源实测档）向下重试，确保能拿到可播放地址
  function invokeCascade(st, p, startRank, musicInfo) {
    var rank = startRank;
    function step() {
      if (rank < 1) return Promise.reject(new Error('quality exhausted'));
      return invoke(st, p, QORDER[rank - 1], musicInfo).catch(function (e) {
        rank--;
        return step();
      });
    }
    return step();
  }

  // 竞速：最强源立即发起，1.5s 未决依次放行；任一成功即采用，全部落定失败才判负
  LX.on(E.request, function (req) {
    return new Promise(function (resolve, reject) {
      if (!req || !req.info || req.action !== 'musicUrl') return reject(new Error('unsupported action'));
      var p = req.source;
      var pool = states.filter(function (st) { return !!st.handler && !!st.m.caps[p]; })
        .sort(function (a, b) { return (b.m.s || 0) - (a.m.s || 0); });
      if (!pool.length) return reject(new Error('source unavailable'));
      var wantRank = QRANK[req.info.type] || 4;
      var done = false, launched = 0, failures = 0;
      var timers = [];
      function clearTimers() { for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]); timers = []; }
      function failAll() { if (done) return; done = true; clearTimers(); reject(new Error('all sources failed')); }
      function launch() {
        if (done || launched >= pool.length) return;
        var st = pool[launched++];
        var rank = Math.min(wantRank, st.m.caps[p]);
        invokeCascade(st, p, rank, req.info.musicInfo).then(function (url) {
          if (done) return;
          done = true; clearTimers(); resolve(url);
        }, function () {
          failures++;
          if (done) return;
          if (launched < pool.length) launch();
          else if (failures >= pool.length) failAll();
        });
      }
      launch();
      // 阶梯放行：每 1.5s 多放一个源，数量按候选池动态生成
      for (var i = 1; i < pool.length; i++) timers.push(setTimeout(launch, i * 1500));
    });
  });

  // 成员的 on(request) 均为同步注册，执行完毕即可上报；用 setTimeout(0) 兼容要求异步初始化的宿主
  setTimeout(function () {
    try { LX.send(E.inited, { status: true, openDevTools: false, sources: sources }); } catch (e) {}
  }, 0);

  // ==================== 云更新（构建期注入） ====================
  var CLOUD_CHANNELS = ["https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/","https://cdn.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/","https://fastly.jsdelivr.net/gh/moxi5445/lx-music-cloud@main/","https://gh-proxy.com/https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/","https://ghproxy.net/https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/"];
  var CLOUD_VERSION = 202610201300;
  var CLOUD_VERSION_TEXT = "2026-10-20 13:00:02";
  var CLOUD_UPDATE_URL = "https://raw.githubusercontent.com/moxi5445/lx-music-cloud/main/lx-cloud.js";

  function cloudHttpGet(u, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('timeout')); }
      }, ms);
      try {
        LX.request(u, { method: 'GET' }, function (err, resp, body) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          if (err) return reject(err);
          var sc = resp && (resp.statusCode != null ? resp.statusCode : resp.status);
          if (sc !== 200) return reject(new Error('http ' + sc));
          resolve(body);
        });
      } catch (e) {
        if (!settled) { settled = true; clearTimeout(timer); reject(e); }
      }
    });
  }
  // 多通道按序回退：任一通道成功且内容合法即返回，HTTP 失败/内容非法均尝试下一通道
  function cloudFetch(rel, isJson, ms) {
    var i = 0;
    function handle(b) {
      if (!isJson) return typeof b === 'string' ? b : (b && b.toString ? b.toString() : '');
      var j = typeof b === 'string' ? JSON.parse(b) : b;
      if (!j || typeof j !== 'object') throw new Error('bad manifest');
      return j;
    }
    function attempt() {
      if (i >= CLOUD_CHANNELS.length) return Promise.reject(new Error('all channels failed'));
      var u = CLOUD_CHANNELS[i++] + rel;
      return cloudHttpGet(u, ms).then(handle).catch(attempt);
    }
    return attempt();
  }
  // 宿主动态执行能力探测：桌面 Electron 为 true；移动端 Hermes 等精简引擎为 false
  function cloudCanDyn() {
    try { return (new Function('return true'))() === true; } catch (e) { return false; }
  }
  function cloudMd5(s) {
    try {
      return LX.utils && LX.utils.crypto && LX.utils.crypto.md5 ? LX.utils.crypto.md5(s) : '';
    } catch (e) { return ''; }
  }
  // 动态执行单个远程成员：加载瞬间用成员专属 facade 替换全局 lx/window/self/global，执行完恢复
  function cloudBoot(code, m) {
    var st = { m: m, handler: null, sources: null };
    var facade = makeFacade(st);
    var sb = makeSandbox(facade);
    var g = REAL_GLOBAL;
    var saved = {};
    function swap(name, val) { try { saved[name] = g[name]; g[name] = val; } catch (e) {} }
    function restore(name) { try { g[name] = saved[name]; } catch (e) {} }
    swap('lx', facade); swap('window', sb); swap('self', sb); swap('global', sb);
    try { (new Function('"use strict";\n' + code))(); } catch (e) { st.handler = null; }
    restore('lx'); restore('window'); restore('self'); restore('global');
    return st;
  }
  function cloudCover(list) {
    var o = {};
    for (var i = 0; i < list.length; i++) {
      var st = list[i];
      if (!st.handler) continue;
      for (var p in st.m.caps) {
        if (o[p] == null || st.m.caps[p] > o[p]) o[p] = st.m.caps[p];
      }
    }
    return o;
  }
  function cloudSourcesEqual(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      var p = ka[i];
      if (!b[p] || (a[p].qualitys || []).join(',') !== (b[p].qualitys || []).join(',')) return false;
    }
    return true;
  }
  function cloudRefresh() {
    var bust = Date.now ? Date.now() : new Date().getTime();
    cloudFetch('manifest.json?t=' + bust, true, 6000).then(function (manifest) {
      if (!manifest || !manifest.sources || !manifest.sources.length) return;
      if (!cloudCanDyn()) {
        // 移动端：无法动态执行远程脚本，版本不一致时走官方 updateAlert 引导重新导入固定地址
        if (String(manifest.v) !== String(CLOUD_VERSION) && E.updateAlert) {
          try {
            LX.send(E.updateAlert, {
              log: '云更新音源发现新版本\n服务器构建：' + (manifest.updated || manifest.v)
                + '\n当前内置：' + CLOUD_VERSION_TEXT
                + '\n点击「更新」获取最新实测音源（导入地址永久有效）',
              updateUrl: CLOUD_UPDATE_URL,
            });
          } catch (e) {}
        }
        return;
      }
      // 桌面端：并发拉取成员（按通道回退），md5 防损坏/劫持，启动串行化在下载完成后顺序执行
      var jobs = manifest.sources.map(function (s) {
        return cloudFetch(s.f + '?svn=' + encodeURIComponent(manifest.v), false, 12000).then(function (code) {
          if (!code || code.length < 32) throw new Error('empty');
          if (s.md5 && cloudMd5(code) !== s.md5) throw new Error('md5 mismatch');
          var st = cloudBoot(code, { n: s.n, v: s.v || '', a: s.a || '', s: s.s || 0, caps: s.caps || {} });
          if (!st.handler) throw new Error('no handler');
          return st;
        }).catch(function () { return null; });
      });
      Promise.all(jobs).then(function (rs) {
        var ok = [];
        for (var i = 0; i < rs.length; i++) if (rs[i]) ok.push(rs[i]);
        if (!ok.length) return; // 远程全部失败：内联成员继续服务
        var oldC = cloudCover(states), newC = cloudCover(ok);
        // 远程平台覆盖窄于内置（部分失败/接口漂移）时保留内置，等待下轮
        if (Object.keys(newC).length < Object.keys(oldC).length) return;
        var oldSources = buildSources();
        states.splice(0, states.length);
        for (var j = 0; j < ok.length; j++) states.push(ok[j]);
        var newSources = buildSources();
        if (!cloudSourcesEqual(oldSources, newSources)) {
          try { LX.send(E.inited, { status: true, openDevTools: false, sources: newSources }); } catch (e) {}
        }
      });
    }).catch(function () { /* 配置不可达时静默：内置成员为最近一轮实测快照，可独立服务 */ });
  }
  setTimeout(cloudRefresh, 250);
})();
