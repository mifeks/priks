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
  messages: [],
  nextId: 1
};

function loadStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    store.users = parsed.users || {};
    store.tokens = parsed.tokens || {};
    store.friends = parsed.friends || {};
    store.messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    store.nextId = parsed.nextId || (store.messages.length ? store.messages[store.messages.length - 1].id + 1 : 1);
    log("загружено: пользователей " + Object.keys(store.users).length + ", сообщений " + store.messages.length);
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
  user.lastSeen = Date.now();
  return { key: key, nick: user.nick, user: user };
}

function isOnline(user) {
  return Date.now() - (user.lastSeen || 0) < ONLINE_WINDOW_MS;
}

function profileOf(user) {
  return {
    nick: user.nick,
    displayName: user.displayName || user.nick,
    status: user.status || "on",
    customStatus: user.customStatus || "",
    avatar: user.avatar || 1,
    hideOnline: !!user.hideOnline
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
    return { ok: true, nick: nick, token: token, profile: profileOf(store.users[key]) };
  }

  if (action === "login") {
    const nick = normalizeNick(data.nick);
    const password = String(data.password || "");
    const user = store.users[nick.toLowerCase()];
    if (!user) return fail("нет такого ника");
    if (hashPassword(password, user.salt) !== user.hash) return fail("неверный пароль");
    const token = newToken();
    store.tokens[token] = user.nick;
    user.lastSeen = Date.now();
    saveStore();
    log("вход: " + user.nick);
    return { ok: true, nick: user.nick, token: token, profile: profileOf(user) };
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
      if (user) out.push({ nick: user.nick, online: isOnline(user) });
    }
    return { ok: true, friends: out };
  }

  if (action === "friend-add") {
    const nick = normalizeNick(data.nick);
    const target = store.users[nick.toLowerCase()];
    if (!target) return fail("нет такого пользователя");
    if (target.nick.toLowerCase() === session.key) return fail("это ты");
    if (!store.friends[session.key]) store.friends[session.key] = [];
    if (!store.friends[session.key].includes(target.nick)) {
      store.friends[session.key].push(target.nick);
      saveStore();
    }
    return { ok: true, friends: store.friends[session.key] };
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

  if (pathname === "/health") {
    sendJson(res, 200, { ok: true, users: Object.keys(store.users).length, messages: store.messages.length });
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
