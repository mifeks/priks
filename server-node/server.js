"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "8777", 10);
const HOST = process.env.HOST || "0.0.0.0";
const WEB_DIR = path.resolve(process.env.WEB_DIR || path.join(__dirname, "..", "web"));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const DATA_FILE = path.join(DATA_DIR, "store.json");
const ONLINE_WINDOW_MS = 35000;
const MAX_MESSAGE = 4000;
const MIN_INTERVAL_MS = 700;
const BURST_LIMIT = 12;
const BURST_WINDOW_MS = 20000;
const ADMIN_NICKS = String(process.env.ADMIN_NICKS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const YANDEX_CLIENT_ID = String(process.env.YANDEX_CLIENT_ID || "").trim();
const YANDEX_CLIENT_SECRET = String(process.env.YANDEX_CLIENT_SECRET || "").trim();
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
const YANDEX_AUTHORIZE_URL = process.env.YANDEX_AUTHORIZE_URL || "https://oauth.yandex.ru/authorize";
const YANDEX_TOKEN_URL = process.env.YANDEX_TOKEN_URL || "https://oauth.yandex.ru/token";
const YANDEX_INFO_URL = process.env.YANDEX_INFO_URL || "https://login.yandex.ru/info";
const YANDEX_ENABLED = !!(YANDEX_CLIENT_ID && YANDEX_CLIENT_SECRET);
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

function originOf(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.origin;
  } catch (e) {
    return "";
  }
}

function originAllowed(origin) {
  const o = String(origin || "").replace(/\/+$/, "");
  if (!o) return false;
  if (!CORS_ORIGINS.length) return true;
  return CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(o);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  if (origin && originAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  } else if (!CORS_ORIGINS.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (CORS_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

let store = {
  users: {},
  tokens: {},
  friends: {},
  bans: {},
  messages: [],
  nextId: 1
};

function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) {
      log("новое хранилище: пользователей 0, сообщений 0, банов 0");
      return;
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store.users = parsed.users || {};
    store.tokens = parsed.tokens || {};
    store.friends = parsed.friends || {};
    store.bans = parsed.bans && typeof parsed.bans === "object" ? parsed.bans : {};
    store.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    store.nextId = parsed.nextId || (store.messages.length ? store.messages[store.messages.length - 1].id + 1 : 1);
    log("загружено: пользователей " + Object.keys(store.users).length + ", сообщений " + store.messages.length + ", банов " + Object.keys(store.bans).length);
  } catch (err) {
    log("не удалось прочитать хранилище: " + err.message);
  }
}

let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(store), "utf8");
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      log("ошибка записи хранилища: " + err.message);
    }
  }, 300);
}

function log(line) {
  console.log("[" + new Date().toISOString() + "] " + line);
}

function normalizeNick(value) {
  return String(value == null ? "" : value).trim();
}

function validNick(nick) {
  return /^[A-Za-z0-9_.-]{2,20}$/.test(nick);
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(salt + ":" + password, "utf8").digest("hex");
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function userOf(token) {
  if (!token) return null;
  const nick = store.tokens[token];
  if (!nick) return null;
  const key = nick.toLowerCase();
  const user = store.users[key];
  if (!user) return null;
  if (banOf(key)) {
    delete store.tokens[token];
    return null;
  }
  user.lastSeen = Date.now();
  return { key: key, nick: user.nick, user: user };
}

function isOnline(user) {
  return Date.now() - (user.lastSeen || 0) < ONLINE_WINDOW_MS;
}

function isAdminKey(key) {
  if (!key) return false;
  if (ADMIN_NICKS.indexOf(key) >= 0) return true;
  const user = store.users[key];
  return !!(user && user.admin);
}

function banOf(key) {
  const ban = store.bans[key];
  if (!ban) return null;
  if (ban.until && ban.until < Date.now()) {
    delete store.bans[key];
    saveStore();
    return null;
  }
  return ban;
}

function banText(ban) {
  let text = "ты заблокирован";
  if (ban.reason) text += ": " + ban.reason;
  if (ban.until) text += " (до " + new Date(ban.until).toLocaleString("ru-RU") + ")";
  return text;
}

function dropSessions(key) {
  for (const token of Object.keys(store.tokens)) {
    if (String(store.tokens[token]).toLowerCase() === key) delete store.tokens[token];
  }
}

const floodState = {};

function floodCheck(key) {
  const now = Date.now();
  const item = floodState[key] || { last: 0, stamps: [] };
  floodState[key] = item;
  item.stamps = item.stamps.filter((ts) => now - ts < BURST_WINDOW_MS);
  if (now - item.last < MIN_INTERVAL_MS) return "слишком быстро, подожди секунду";
  if (item.stamps.length >= BURST_LIMIT) return "слишком много сообщений подряд, передохни";
  item.last = now;
  item.stamps.push(now);
  return null;
}

function profileOf(user) {
  return {
    nick: user.nick,
    displayName: user.displayName || user.nick,
    status: user.status || "on",
    customStatus: user.customStatus || "",
    avatar: user.avatar || 1,
    hideOnline: !!user.hideOnline,
    oauth: user.oauth || ""
  };
}

function publicUsers() {
  const out = [];
  for (const key of Object.keys(store.users)) {
    const user = store.users[key];
    out.push({
      nick: user.nick,
      displayName: user.displayName || user.nick,
      avatar: user.avatar || 0,
      status: user.status || "on",
      customStatus: user.customStatus || "",
      online: user.hideOnline ? false : isOnline(user)
    });
  }
  out.sort((a, b) => a.nick.localeCompare(b.nick));
  return out;
}

function messagesFor(meKey, withNick) {
  const other = String(withNick || "").trim().toLowerCase();
  const result = [];
  for (const m of store.messages) {
    const from = m.from.toLowerCase();
    const to = (m.to || "").toLowerCase();
    if (!other) {
      if (!to) result.push(m);
      continue;
    }
    if ((from === meKey && to === other) || (from === other && to === meKey)) result.push(m);
  }
  return result;
}

function fail(message) {
  return { ok: false, error: message };
}

function handleApi(action, body) {
  const data = body && typeof body === "object" ? body : {};

  if (action === "auth-status") {
    return { ok: true, yandex: YANDEX_ENABLED };
  }

  if (action === "register") {
    const nick = normalizeNick(data.nick);
    const password = String(data.password || "");
    if (!validNick(nick)) return fail("ник: 2-20 символов, буквы, цифры, _ - .");
    if (password.length < 4) return fail("пароль минимум 4 символа");
    const key = nick.toLowerCase();
    if (store.users[key]) return fail("этот ник уже занят");
    const salt = crypto.randomBytes(12).toString("hex");
    const displayName = String(data.displayName || "").trim().slice(0, 40) || nick;
    const avatar = parseInt(data.avatar, 10);
    store.users[key] = {
      nick: nick,
      displayName: displayName,
      avatar: Number.isFinite(avatar) && avatar >= 1 && avatar <= 6 ? avatar : 1,
      status: "on",
      customStatus: "",
      hideOnline: false,
      salt: salt,
      hash: hashPassword(password, salt),
      created: Date.now(),
      lastSeen: Date.now()
    };
    const token = newToken();
    store.tokens[token] = nick;
    saveStore();
    log("регистрация: " + nick);
    return { ok: true, nick: nick, token: token, profile: profileOf(store.users[key]), admin: isAdminKey(key) };
  }

  if (action === "login") {
    const nick = normalizeNick(data.nick);
    const password = String(data.password || "");
    const user = store.users[nick.toLowerCase()];
    if (!user) return fail("нет такого ника");
    const ban = banOf(nick.toLowerCase());
    if (ban) return fail(banText(ban));
    if (user.oauth === "yandex") return fail("этот ник входит через Яндекс — нажми «Войти через Яндекс»");
    if (hashPassword(password, user.salt) !== user.hash) return fail("неверный пароль");
    const token = newToken();
    store.tokens[token] = user.nick;
    user.lastSeen = Date.now();
    saveStore();
    log("вход: " + user.nick);
    return { ok: true, nick: user.nick, token: token, profile: profileOf(user), admin: isAdminKey(nick.toLowerCase()) };
  }

  const session = userOf(data.token);
  if (!session) return fail("сессия истекла, войди заново");

  if (action === "whoami") {
    return { ok: true, nick: session.nick, profile: profileOf(session.user) };
  }

  if (action === "send") {
    const to = normalizeNick(data.to);
    const text = String(data.text || "").trim();
    if (!text) return fail("пустое сообщение");
    if (text.length > MAX_MESSAGE) return fail("слишком длинное сообщение");
    if (to) {
      const target = store.users[to.toLowerCase()];
      if (!target) return fail("нет такого пользователя");
      if (to.toLowerCase() === session.key) return fail("нельзя писать самому себе");
    }
    const flood = floodCheck(session.key);
    if (flood) return fail(flood);
    const message = {
      id: store.nextId++,
      from: session.nick,
      to: to ? store.users[to.toLowerCase()].nick : "",
      text: text,
      ts: Date.now()
    };
    store.messages.push(message);
    if (store.messages.length > 20000) store.messages = store.messages.slice(-15000);
    saveStore();
    return { ok: true, message: message };
  }

  if (action === "poll") {
    const since = Number(data.since) || 0;
    const fresh = store.messages.filter((m) => m.id > since);
    const visible = fresh.filter((m) => !m.to ||
      m.to.toLowerCase() === session.key ||
      m.from.toLowerCase() === session.key);
    return { ok: true, messages: visible, users: publicUsers(), time: Date.now() };
  }

  if (action === "history") {
    const limit = Math.min(Number(data.limit) || 200, 500);
    const list = messagesFor(session.key, data.with);
    return { ok: true, messages: list.slice(-limit), users: publicUsers() };
  }

  if (action === "friends") {
    const list = store.friends[session.key] || [];
    const out = [];
    for (const nick of list) {
      const user = store.users[nick.toLowerCase()];
      if (!user) continue;
      const entry = profileOf(user);
      entry.online = user.hideOnline ? false : isOnline(user);
      out.push(entry);
    }
    return { ok: true, friends: out };
  }

  if (action === "friend-add") {
    const nick = normalizeNick(data.nick);
    const target = store.users[nick.toLowerCase()];
    if (!target) return fail("нет такого пользователя");
    if (target.nick.toLowerCase() === session.key) return fail("это ты");
    if (banOf(target.nick.toLowerCase())) return fail("этот пользователь заблокирован");
    if (!store.friends[session.key]) store.friends[session.key] = [];
    if (!store.friends[session.key].includes(target.nick)) {
      store.friends[session.key].push(target.nick);
      saveStore();
      log("дружба: " + session.nick + " + " + target.nick);
    }
    return { ok: true, friends: store.friends[session.key] };
  }

  if (action === "friend-remove") {
    const nick = normalizeNick(data.nick).toLowerCase();
    const list = store.friends[session.key] || [];
    const idx = list.findIndex((n) => n.toLowerCase() === nick);
    if (idx < 0) return fail("его нет в друзьях");
    const removed = list.splice(idx, 1)[0];
    saveStore();
    log("из друзей убран: " + session.nick + " - " + removed);
    return { ok: true, friends: list };
  }

  if (action === "ban" || action === "unban" || action === "bans") {
    if (!isAdminKey(session.key)) return fail("нет прав: нужен админ");
  }

  if (action === "bans") {
    const now = Date.now();
    const out = [];
    for (const key of Object.keys(store.bans)) {
      const ban = store.bans[key];
      if (ban.until && ban.until < now) continue;
      out.push({
        nick: ban.nick || key,
        reason: ban.reason || "",
        by: ban.by || "",
        ts: ban.ts || 0,
        until: ban.until || 0
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return { ok: true, bans: out };
  }

  if (action === "ban") {
    const nick = normalizeNick(data.nick);
    const target = store.users[nick.toLowerCase()];
    if (!target) return fail("нет такого пользователя");
    if (isAdminKey(nick.toLowerCase())) return fail("админа банить нельзя");
    const hours = Number(data.hours);
    const until = Number.isFinite(hours) && hours > 0 ? Date.now() + hours * 3600 * 1000 : 0;
    store.bans[nick.toLowerCase()] = {
      nick: target.nick,
      reason: String(data.reason || "").trim().slice(0, 120),
      by: session.nick,
      ts: Date.now(),
      until: until
    };
    dropSessions(nick.toLowerCase());
    saveStore();
    log("бан: " + target.nick + " (" + (until ? "до " + new Date(until).toISOString() : "навсегда") + ") от " + session.nick);
    return { ok: true, nick: target.nick, until: until };
  }

  if (action === "unban") {
    const nick = normalizeNick(data.nick).toLowerCase();
    if (!store.bans[nick]) return fail("он не забанен");
    delete store.bans[nick];
    saveStore();
    log("разбан: " + nick + " от " + session.nick);
    return { ok: true, nick: nick };
  }

  if (action === "profile") {
    const user = session.user;
    if (data.displayName !== undefined) {
      const name = String(data.displayName || "").trim().slice(0, 40);
      user.displayName = name || user.nick;
    }
    if (data.status !== undefined) {
      const st = String(data.status || "on");
      user.status = st === "dnd" || st === "custom" ? st : "on";
    }
    if (data.customStatus !== undefined) {
      user.customStatus = String(data.customStatus || "").trim().slice(0, 60);
    }
    if (data.avatar !== undefined) {
      const av = parseInt(data.avatar, 10);
      user.avatar = Number.isFinite(av) && av >= 0 && av <= 6 ? av : 0;
    }
    if (data.hideOnline !== undefined) user.hideOnline = !!data.hideOnline;
    saveStore();
    return { ok: true, profile: profileOf(user) };

  }

  return fail("неизвестное действие: " + action);
}

function readBody(req, limit, callback) {
  let size = 0;
  const chunks = [];
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > limit) {
      callback(new Error("слишком большое тело запроса"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
  req.on("error", (err) => callback(err));
}

function sendJson(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

const oauthStates = new Map();

function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "http";
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").trim() || ("127.0.0.1:" + PORT);
  return proto + "://" + host;
}

function oauthRedirectUri(req) {
  return publicBase(req) + "/auth/yandex/callback";
}

function nickFromLogin(login) {
  let base = String(login || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "");
  if (base.length < 2) base = "user" + crypto.randomBytes(2).toString("hex");
  base = base.slice(0, 20);
  let nick = base;
  let n = 2;
  while (store.users[nick.toLowerCase()]) {
    const suffix = "-" + n;
    nick = base.slice(0, Math.max(2, 20 - suffix.length)) + suffix;
    n++;
    if (n > 5000) { nick = "user" + crypto.randomBytes(3).toString("hex"); break; }
  }
  return nick;
}

function findUserByYandexId(id) {
  const key = String(id);
  for (const k of Object.keys(store.users)) {
    if (String(store.users[k].yandexId || "") === key) return k;
  }
  return null;
}

async function handleYandexCallback(req, res, url) {
  let target = "/";
  const back = (msg) => sendRedirect(res, target + "#auth_error=" + encodeURIComponent(msg));
  try {
    if (!YANDEX_ENABLED) return back("вход через Яндекс не настроен на сервере");

    const state = String(url.searchParams.get("state") || "");
    const rec = oauthStates.get(state);
    oauthStates.delete(state);
    if (!rec || Date.now() - rec.ts > OAUTH_STATE_TTL_MS) {
      return back("страница входа устарела, попробуй ещё раз");
    }
    if (rec.ret) {
      const retUrl = new URL(rec.ret);
      target = retUrl.origin + retUrl.pathname + retUrl.search;
    }

    const yerr = url.searchParams.get("error");
    if (yerr) return back("Яндекс не пустил: " + yerr);

    const code = String(url.searchParams.get("code") || "");
    if (!code) return back("Яндекс не вернул код авторизации");

    const tokenRes = await fetch(YANDEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(YANDEX_CLIENT_ID + ":" + YANDEX_CLIENT_SECRET).toString("base64")
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
        redirect_uri: oauthRedirectUri(req)
      }).toString()
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenData && tokenData.access_token;
    if (!accessToken) {
      log("яндекс: не удалось получить токен: " + JSON.stringify(tokenData).slice(0, 200));
      return back("Яндекс не выдал токен, попробуй ещё раз");
    }

    const infoUrl = new URL(YANDEX_INFO_URL);
    infoUrl.searchParams.set("format", "json");
    const infoRes = await fetch(infoUrl.toString(), {
      headers: { "Authorization": "OAuth " + accessToken }
    });
    const info = await infoRes.json().catch(() => ({}));
    const yandexId = info && info.id ? String(info.id) : "";
    if (!yandexId) {
      log("яндекс: пустой профиль: " + JSON.stringify(info).slice(0, 200));
      return back("Яндекс не отдал профиль");
    }

    let key = findUserByYandexId(yandexId);
    if (!key) {
      const nick = nickFromLogin(info.login || info.display_name || "user");
      key = nick.toLowerCase();
      const avatar = 1 + Math.floor(Math.random() * 6);
      store.users[key] = {
        nick: nick,
        displayName: String(info.display_name || info.real_name || info.login || nick).slice(0, 40),
        avatar: avatar,
        status: "on",
        customStatus: "",
        hideOnline: false,
        oauth: "yandex",
        yandexId: yandexId,
        yandexLogin: String(info.login || ""),
        created: Date.now(),
        lastSeen: Date.now()
      };
      log("яндекс: новый аккаунт " + nick + " (id " + yandexId + ")");
    } else {
      const user = store.users[key];
      user.oauth = "yandex";
      user.yandexId = yandexId;
      user.yandexLogin = String(info.login || user.yandexLogin || "");
      if (info.display_name && !user.displayName) user.displayName = String(info.display_name).slice(0, 40);
      log("яндекс: вход " + user.nick + " (id " + yandexId + ")");
    }

    const ban = banOf(key);
    if (ban) return back(banText(ban));

    const user = store.users[key];
    const token = newToken();
    store.tokens[token] = user.nick;
    user.lastSeen = Date.now();
    saveStore();
    return sendRedirect(res, target + "#auth=" + token);
  } catch (err) {
    log("яндекс: ошибка входа: " + err.stack);
    return back("не получилось войти через Яндекс");
  }
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = path.resolve(path.join(WEB_DIR, rel));
  if (!target.startsWith(WEB_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403");
    return;
  }
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    fs.createReadStream(target).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
  }

  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, users: Object.keys(store.users).length, messages: store.messages.length });
    return;
  }

  if (pathname === "/auth/status") {
    sendJson(res, 200, { ok: true, yandex: YANDEX_ENABLED });
    return;
  }

  if (pathname === "/auth/yandex") {
    if (!YANDEX_ENABLED) {
      sendRedirect(res, "/#auth_error=" + encodeURIComponent("вход через Яндекс не настроен на сервере"));
      return;
    }
    const state = crypto.randomBytes(16).toString("hex");
    for (const [k, rec] of oauthStates) {
      if (Date.now() - rec.ts > OAUTH_STATE_TTL_MS) oauthStates.delete(k);
    }
    let ret = "";
    const asked = url.searchParams.get("return") || "";
    if (asked) {
      try {
        const ru = new URL(asked);
        if ((ru.protocol === "http:" || ru.protocol === "https:") && originAllowed(ru.origin)) {
          ret = ru.origin + ru.pathname + ru.search;
        } else {
          log("яндекс: отклонил возврат на " + asked);
        }
      } catch (e) {
        log("яндекс: кривой return " + asked.slice(0, 80));
      }
    }
    oauthStates.set(state, { ts: Date.now(), ret: ret });
    const target = new URL(YANDEX_AUTHORIZE_URL);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("client_id", YANDEX_CLIENT_ID);
    target.searchParams.set("redirect_uri", oauthRedirectUri(req));
    target.searchParams.set("state", state);
    target.searchParams.set("force_confirm", "yes");
    log("яндекс: отправляю на авторизацию");
    sendRedirect(res, target.toString());
    return;
  }

  if (pathname === "/auth/yandex/callback") {
    handleYandexCallback(req, res, url);
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (req.method !== "POST") {
      sendJson(res, 405, fail("только POST"));
      return;
    }
    readBody(req, 256 * 1024, (err, text) => {
      if (err) { sendJson(res, 413, fail(err.message)); return; }
      let body = {};
      if (text) {
        try { body = JSON.parse(text); } catch (e) { sendJson(res, 400, fail("неверный JSON")); return; }
      }
      const action = pathname.slice(5);
      let result;
      try {
        result = handleApi(action, body);
      } catch (e) {
        log("ошибка в " + action + ": " + e.stack);
        result = fail("внутренняя ошибка сервера");
      }
      sendJson(res, 200, result);
    });
    return;
  }

  serveStatic(req, res, pathname);
});

loadStore();
server.listen(PORT, HOST, () => {
  log("Прикс-сервер слушает " + HOST + ":" + PORT);
  log("веб-папка: " + WEB_DIR);
  log("данные: " + DATA_FILE);
});

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function shutdown() {
  log("остановка сервера");
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store), "utf8");
  } catch (err) {
    log("не удалось сохранить данные: " + err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
}
