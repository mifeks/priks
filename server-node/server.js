"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const smtp = require("./smtp");

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
const OWNER_NICKS = String(process.env.OWNER_NICKS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const FILES_DIR = path.join(DATA_DIR, "files");
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10) || 465;
const SMTP_SECURE = String(process.env.SMTP_SECURE || "1") !== "0";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER).trim();
const SMTP_INSECURE_TLS = String(process.env.SMTP_INSECURE_TLS || "") === "1";
const MAIL_ENABLED = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_TRIES = 6;

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
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

let store = {
  users: {},
  tokens: {},
  friends: {},
  bans: {},
  blocks: {},
  channels: {},
  channelMembers: {},
  groups: {},
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
    store.blocks = parsed.blocks && typeof parsed.blocks === "object" ? parsed.blocks : {};
    store.channels = parsed.channels && typeof parsed.channels === "object" ? parsed.channels : {};
    store.groups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {};
    store.channelMembers = parsed.channelMembers && typeof parsed.channelMembers === "object" ? parsed.channelMembers : {};
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

function phoneKeyOf(value) {
  let digits = String(value == null ? "" : value).replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "8") digits = "7" + digits.slice(1);
  if (digits.length === 11 && digits.charAt(0) === "7") digits = digits.slice(1);
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length < 5 || email.length > 120) return "";
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return "";
  return email;
}

const MIN_AGE = 14;

function validBirth(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const ts = Date.parse(raw + "T00:00:00Z");
  if (!Number.isFinite(ts)) return "";
  const when = new Date(ts);
  if (when.toISOString().slice(0, 10) !== raw) return "";
  const years = (Date.now() - ts) / (365.25 * 24 * 3600 * 1000);
  if (years < MIN_AGE || years > 110) return "";
  return raw;
}

function makeCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashCode(code, salt) {
  return crypto.createHash("sha256").update("code:" + salt + ":" + code, "utf8").digest("hex");
}

function userByPhone(phone) {
  const key = phoneKeyOf(phone);
  if (!key) return null;
  for (const k of Object.keys(store.users)) {
    if (String(store.users[k].phone || "") === key) return k;
  }
  return null;
}

function userByEmail(email) {
  const mail = validEmail(email);
  if (!mail) return null;
  for (const k of Object.keys(store.users)) {
    if (String(store.users[k].email || "") === mail) return k;
  }
  return null;
}

function findKeyByLogin(query) {
  const raw = String(query == null ? "" : query).trim();
  if (!raw) return null;
  if (raw.indexOf("@") > 0) {
    const byMail = userByEmail(raw);
    if (byMail) return byMail;
  }
  const key = raw.toLowerCase();
  if (store.users[key]) return key;
  const byPhone = userByPhone(raw);
  if (byPhone) return byPhone;
  return null;
}

function emailTaken(email, exceptKey) {
  const key = userByEmail(email);
  return !!(key && key !== exceptKey && store.users[key].emailVerified);
}

function channelMembersOf(id) {
  const list = store.channelMembers[id];
  return Array.isArray(list) ? list : [];
}

function isChannelMember(id, key) {
  return channelMembersOf(id).indexOf(key) >= 0;
}

function channelOf(id) {
  const ch = store.channels[String(id || "")];
  return ch || null;
}

function channelIdOfTarget(to) {
  const raw = String(to || "");
  if (raw.indexOf("ch:") !== 0) return "";
  const id = raw.slice(3).trim();
  return store.channels[id] ? id : "";
}

function publicChannel(ch, myKey) {
  const members = channelMembersOf(ch.id);
  return {
    id: ch.id,
    title: ch.title,
    about: ch.about || "",
    owner: ch.owner,
    members: members.length,
    joined: myKey ? members.indexOf(myKey) >= 0 : false,
    mine: myKey ? ch.owner === myKey : false,
    verified: !!ch.verified,
    created: ch.created || 0
  };
}

function myChannels(key) {
  const out = [];
  for (const id of Object.keys(store.channels)) {
    if (!isChannelMember(id, key)) continue;
    out.push(publicChannel(store.channels[id], key));
  }
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out;
}

function selfProfileOf(user) {
  const base = profileOf(user);
  base.phone = user.phone || "";
  base.email = user.email || "";
  base.emailVerified = !!user.emailVerified;
  base.hasPassword = !!user.hash;
  base.birth = user.birth || "";
  base.privacy = privacyOf(user);
  base.blocked = blockListOf(user.nick.toLowerCase(), "");
  return base;
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

function imageRefOf(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.indexOf("/files/") !== 0) return "";
  const name = raw.slice(7);
  if (!/^[a-z0-9]+\.[a-z]{2,5}$/i.test(name)) return "";
  return fs.existsSync(path.join(FILES_DIR, name)) ? raw : "";
}

const PRIVACY_LEVELS = ["all", "contacts", "nobody"];
const PRIVACY_DEFAULTS = { online: "all", phone: "nobody", find: "all", write: "all", content: "all" };

function privacyOf(user) {
  const raw = user && user.privacy && typeof user.privacy === "object" ? user.privacy : {};
  const out = {};
  for (const k of Object.keys(PRIVACY_DEFAULTS)) {
    out[k] = PRIVACY_LEVELS.indexOf(raw[k]) >= 0 ? raw[k] : PRIVACY_DEFAULTS[k];
  }
  return out;
}

function isContact(aKey, bKey) {
  if (!aKey || !bKey) return false;
  if (aKey === bKey) return true;
  const mine = store.friends[aKey] || [];
  if (mine.some((n) => String(n).toLowerCase() === bKey)) return true;
  const back = store.friends[bKey] || [];
  return back.some((n) => String(n).toLowerCase() === aKey);
}

function allowedBy(level, ownerKey, viewerKey) {
  if (!ownerKey) return true;
  if (viewerKey && ownerKey === viewerKey) return true;
  if (level === "all") return true;
  if (!viewerKey) return false;
  if (level === "contacts") return isContact(ownerKey, viewerKey);
  return false;
}

function blocksOf(key) {
  const list = store.blocks[key];
  return Array.isArray(list) ? list : [];
}

function isBlockedBy(ownerKey, viewerKey) {
  if (!ownerKey || !viewerKey) return false;
  return blocksOf(ownerKey).some((n) => String(n).toLowerCase() === viewerKey);
}

function blockListOf(ownerKey, viewerKey) {
  const out = [];
  for (const nick of blocksOf(ownerKey)) {
    if (viewerKey && String(nick).toLowerCase() === viewerKey) continue;
    const user = store.users[String(nick).toLowerCase()];
    out.push({ nick: user ? user.nick : String(nick), exists: !!user });
  }
  return out;
}


function isAdminKey(key) {
  if (!key) return false;
  if (ADMIN_NICKS.indexOf(key) >= 0) return true;
  const user = store.users[key];
  return !!(user && user.admin);
}

function isOwnerKey(key) {
  if (!key) return false;
  if (OWNER_NICKS.indexOf(key) >= 0) return true;
  const user = store.users[key];
  return !!(user && user.owner);
}

function groupOf(id) {
  const g = store.groups[String(id || "")];
  return g || null;
}

function groupMembersOf(id) {
  const g = groupOf(id);
  return g && Array.isArray(g.members) ? g.members : [];
}

function isGroupMember(id, key) {
  return groupMembersOf(id).indexOf(key) >= 0;
}

function groupIdOfTarget(to) {
  const raw = String(to || "");
  if (raw.indexOf("g:") !== 0) return "";
  const id = raw.slice(2).trim();
  return groupOf(id) ? id : "";
}

function publicGroup(g, myKey) {
  const members = groupMembersOf(g.id);
  const out = {
    id: g.id,
    title: g.title,
    owner: g.owner,
    members: members.length,
    joined: myKey ? members.indexOf(myKey) >= 0 : false,
    mine: myKey ? g.owner === myKey : false,
    created: g.created || 0,
    people: []
  };
  for (const key of members) {
    const user = store.users[key];
    if (!user) continue;
    out.people.push({ nick: user.nick, displayName: user.displayName || user.nick, avatar: user.avatar || 1, photo: user.photo || "", owner: isOwnerKey(key) });
  }
  return out;
}

function myGroups(key) {
  const out = [];
  for (const id of Object.keys(store.groups)) {
    if (!isGroupMember(id, key)) continue;
    out.push(publicGroup(store.groups[id], key));
  }
  out.sort((a, b) => (b.created || 0) - (a.created || 0));
  return out;
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
  const key = String(user.nick || "").toLowerCase();
  return {
    nick: user.nick,
    displayName: user.displayName || user.nick,
    status: user.status || "on",
    customStatus: user.customStatus || "",
    avatar: user.avatar || 1,
    photo: user.photo || "",
    hideOnline: !!user.hideOnline,
    oauth: user.oauth || "",
    bio: user.bio || "",
    owner: isOwnerKey(key),
    admin: isAdminKey(key)
  };
}

function publicUsers(viewerKey) {
  const out = [];
  for (const key of Object.keys(store.users)) {
    const user = store.users[key];
    const priv = privacyOf(user);
    const seeOnline = allowedBy(priv.online, key, viewerKey) && !user.hideOnline;
    const seeContent = allowedBy(priv.content, key, viewerKey);
    out.push({
      nick: user.nick,
      displayName: user.displayName || user.nick,
      avatar: seeContent ? user.avatar || 0 : 0,
      photo: seeContent ? user.photo || "" : "",
      bio: seeContent ? user.bio || "" : "",
      status: seeContent ? user.status || "on" : "on",
      customStatus: seeContent ? user.customStatus || "" : "",
      online: seeOnline && isOnline(user),
      phone: allowedBy(priv.phone, key, viewerKey) ? user.phone || "" : "",
      owner: isOwnerKey(key),
      admin: isAdminKey(key),
      blocked: isBlockedBy(viewerKey, key)
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

function maskEmail(email) {
  const raw = String(email || "");
  const at = raw.indexOf("@");
  if (at < 1) return raw;
  const name = raw.slice(0, at);
  const domain = raw.slice(at);
  const head = name.slice(0, 1);
  return head + new Array(Math.max(2, Math.min(6, name.length))).join("*") + domain;
}

async function sendCodeMail(to, subject, code) {
  if (!MAIL_ENABLED) return { sent: false, reason: "почта не настроена на сервере" };
  const text = [
    subject,
    "",
    "Код: " + code,
    "",
    "Код действует 15 минут и подходит только один раз.",
    "Если вы ничего не запрашивали — просто проигнорируйте это письмо.",
    "",
    "Прикс — мессенджер"
  ].join("\r\n");
  try {
    await smtp.sendMail({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      insecureTLS: SMTP_INSECURE_TLS,
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: SMTP_FROM,
      fromName: "Прикс",
      to: to,
      subject: subject,
      text: text
    });
    log("письмо отправлено: " + maskEmail(to) + " (" + subject + ")");
    return { sent: true, reason: "" };
  } catch (err) {
    log("письмо не ушло: " + err.message);
    return { sent: false, reason: err.message };
  }
}

function codeReply(mail, email, code) {
  const payload = {
    ok: true,
    sent: !!mail.sent,
    email: maskEmail(email),
    code: ""
  };
  if (!mail.sent) {
    payload.code = code;
    payload.hint = "Почта на сервере не настроена — код показан прямо здесь (демо-режим).";
  }
  return payload;
}

async function requestPasswordReset(data) {
  const login = String(data.login == null ? "" : data.login).trim();
  if (!login) return fail("введите ник, номер или почту");
  const key = findKeyByLogin(login);
  if (!key) return fail("аккаунт не найден");
  const user = store.users[key];
  if (banOf(key)) return fail("аккаунт заблокирован");
  if (!user.email || !user.emailVerified) {
    return fail("к этому аккаунту не привязана подтверждённая почта");
  }
  const code = makeCode();
  user.resetCode = hashCode(code, key + ":reset");
  user.resetCodeTs = Date.now();
  user.resetTries = 0;
  saveStore();
  const mail = await sendCodeMail(user.email, "Прикс: восстановление пароля", code);
  log("сброс пароля запрошен: " + user.nick);
  return codeReply(mail, user.email, code);
}

function applyPasswordReset(data) {
  const login = String(data.login == null ? "" : data.login).trim();
  const code = String(data.code || "").trim();
  const password = String(data.password || "");
  if (!login) return fail("введите ник, номер или почту");
  if (password.length < 4) return fail("пароль минимум 4 символа");
  const key = findKeyByLogin(login);
  if (!key) return fail("аккаунт не найден");
  const user = store.users[key];
  if (!user.resetCode || !user.resetCodeTs) return fail("код не запрашивали — нажми «Забыли пароль?»");
  if (Date.now() - user.resetCodeTs > CODE_TTL_MS) {
    user.resetCode = "";
    user.resetCodeTs = 0;
    saveStore();
    return fail("код устарел, запросите новый");
  }
  if ((user.resetTries || 0) >= CODE_MAX_TRIES) return fail("слишком много попыток — запросите новый код");
  if (hashCode(code, key + ":reset") !== user.resetCode) {
    user.resetTries = (user.resetTries || 0) + 1;
    saveStore();
    return fail("код неверный");
  }
  const salt = crypto.randomBytes(12).toString("hex");
  user.salt = salt;
  user.hash = hashPassword(password, salt);
  user.resetCode = "";
  user.resetCodeTs = 0;
  user.resetTries = 0;
  dropSessions(key);
  saveStore();
  log("пароль сброшен: " + user.nick);
  return { ok: true, nick: user.nick };
}

async function requestEmailCode(session, data) {
  const email = validEmail(data.email);
  if (!email) return fail("похоже, это не почта — нужен вид name@mail.ru");
  if (emailTaken(email, session.key)) return fail("эта почта уже привязана к другому нику");
  const user = session.user;
  const code = makeCode();
  user.emailPending = email;
  user.emailCode = hashCode(code, session.key + ":email");
  user.emailCodeTs = Date.now();
  user.emailTries = 0;
  saveStore();
  const mail = await sendCodeMail(email, "Прикс: подтверждение почты", code);
  log("запрошено подтверждение почты: " + user.nick + " -> " + maskEmail(email));
  const payload = codeReply(mail, email, code);
  payload.profile = selfProfileOf(user);
  return payload;
}

function verifyEmailCode(session, data) {
  const code = String(data.code || "").trim();
  const user = session.user;
  if (!user.emailPending || !user.emailCodeTs) return fail("сначала укажи почту и запроси код");
  if (Date.now() - user.emailCodeTs > CODE_TTL_MS) {
    user.emailCode = "";
    user.emailCodeTs = 0;
    saveStore();
    return fail("код устарел, запросите новый");
  }
  if ((user.emailTries || 0) >= CODE_MAX_TRIES) return fail("слишком много попыток — запросите новый код");
  if (hashCode(code, session.key + ":email") !== user.emailCode) {
    user.emailTries = (user.emailTries || 0) + 1;
    saveStore();
    return fail("код неверный");
  }
  user.email = user.emailPending;
  user.emailVerified = true;
  user.emailPending = "";
  user.emailCode = "";
  user.emailCodeTs = 0;
  user.emailTries = 0;
  saveStore();
  log("почта подтверждена: " + user.nick + " -> " + maskEmail(user.email));
  return { ok: true, profile: selfProfileOf(user) };
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
    const phone = phoneKeyOf(data.phone);
    if (phone) {
      const busy = userByPhone(phone);
      if (busy) return fail("этот номер уже занят другим ником");
    }
    const email = validEmail(data.email);
    if (email && emailTaken(email, key)) return fail("эта почта уже привязана к другому нику");
    const birth = validBirth(data.birth);
    if (!birth) return fail("укажи дату рождения — регистрация по паролю без неё невозможна, возраст от " + MIN_AGE + " лет");
    const salt = crypto.randomBytes(12).toString("hex");
    const displayName = String(data.displayName || "").trim().slice(0, 40) || nick;
    const avatar = parseInt(data.avatar, 10);
    store.users[key] = {
      nick: nick,
      displayName: displayName,
      avatar: Number.isFinite(avatar) && avatar >= 1 && avatar <= 6 ? avatar : 1,
      photo: "",
      birth: birth,
      status: "on",
      customStatus: "",
      hideOnline: false,
      privacy: Object.assign({}, PRIVACY_DEFAULTS),
      phone: phone,
      email: email,
      emailVerified: false,
      salt: salt,
      hash: hashPassword(password, salt),
      created: Date.now(),
      lastSeen: Date.now()
    };
    const token = newToken();
    store.tokens[token] = nick;
    saveStore();
    log("регистрация: " + nick + (phone ? " (телефон " + phone + ")" : ""));
    return { ok: true, nick: nick, token: token, profile: selfProfileOf(store.users[key]), admin: isAdminKey(key) };
  }

  if (action === "lookup") {
    const query = String(data.query == null ? "" : data.query).trim();
    if (!query) return fail("введите ник или номер");
    const key = findKeyByLogin(query);
    if (!key) return fail("ник или номер не найден");
    if (banOf(key)) return fail("этот пользователь заблокирован");
    const user = store.users[key];
    const viewerSession = userOf(data.token);
    const viewerKey = viewerSession ? viewerSession.key : "";
    const priv = privacyOf(user);
    const byPhone = !!phoneKeyOf(query) && !store.users[query.toLowerCase()];
    if (byPhone && !allowedBy(priv.find, key, viewerKey)) return fail("ник или номер не найден");
    if (isBlockedBy(key, viewerKey)) return fail("ник или номер не найден");
    const seeContent = allowedBy(priv.content, key, viewerKey);
    return {
      ok: true,
      found: true,
      user: {
        nick: user.nick,
        displayName: seeContent ? user.displayName || user.nick : user.nick,
        avatar: seeContent ? user.avatar || 1 : 0,
        photo: seeContent ? user.photo || "" : "",
        bio: seeContent ? user.bio || "" : "",
        status: seeContent ? user.status || "on" : "on",
        customStatus: seeContent ? user.customStatus || "" : "",
        online: allowedBy(priv.online, key, viewerKey) && !user.hideOnline && isOnline(user),
        byPhone: byPhone
      }
    };
  }

  if (action === "login") {
    const raw = String(data.nick == null ? "" : data.nick).trim();
    const password = String(data.password || "");
    const key = raw.indexOf("@") > 0 ? userByEmail(raw) : (store.users[raw.toLowerCase()] ? raw.toLowerCase() : userByPhone(raw));
    if (!key) return fail("нет такого ника");
    const user = store.users[key];
    const ban = banOf(key);
    if (ban) return fail(banText(ban));
    if (!user.hash) return fail("этот ник входит через Яндекс — нажми «Войти через Яндекс»");
    if (hashPassword(password, user.salt) !== user.hash) return fail("неверный пароль");
    const token = newToken();
    store.tokens[token] = user.nick;
    user.lastSeen = Date.now();
    saveStore();
    log("вход: " + user.nick);
    return { ok: true, nick: user.nick, token: token, profile: selfProfileOf(user), admin: isAdminKey(key) };
  }

  if (action === "password-reset-request") {
    return requestPasswordReset(data);
  }

  if (action === "password-reset") {
    return applyPasswordReset(data);
  }

  const session = userOf(data.token);
  if (!session) return fail("сессия истекла, войди заново");

  if (action === "whoami") {
    return { ok: true, nick: session.nick, profile: selfProfileOf(session.user), admin: isAdminKey(session.key) };
  }

  if (action === "email-request") {
    return requestEmailCode(session, data);
  }

  if (action === "email-verify") {
    return verifyEmailCode(session, data);
  }

  if (action === "email-remove") {
    session.user.email = "";
    session.user.emailVerified = false;
    session.user.emailPending = "";
    session.user.emailCode = "";
    session.user.emailCodeTs = 0;
    saveStore();
    return { ok: true, profile: selfProfileOf(session.user) };
  }

  if (action === "password-change") {
    const oldPass = String(data.oldPassword || "");
    const newPass = String(data.password || "");
    if (newPass.length < 4) return fail("новый пароль минимум 4 символа");
    if (session.user.hash && hashPassword(oldPass, session.user.salt) !== session.user.hash) {
      return fail("текущий пароль неверный");
    }
    const salt = crypto.randomBytes(12).toString("hex");
    session.user.salt = salt;
    session.user.hash = hashPassword(newPass, salt);
    saveStore();
    log("пароль изменён: " + session.user.nick);
    return { ok: true, profile: selfProfileOf(session.user) };
  }

  if (action === "send") {
    const to = normalizeNick(data.to);
    const text = String(data.text || "").trim();
    const img = imageRefOf(data.img);
    if (!text && !img) return fail("пустое сообщение");
    if (text.length > MAX_MESSAGE) return fail("слишком длинное сообщение");
    let target = "";
    const chId = channelIdOfTarget(to);
    const grId = groupIdOfTarget(to);
    if (to.indexOf("ch:") === 0) {
      if (!chId) return fail("канал не найден");
      if (!isChannelMember(chId, session.key)) return fail("сначала вступи в канал");
      target = "ch:" + chId;
    } else if (to.indexOf("g:") === 0) {
      if (!grId) return fail("группа не найдена");
      if (!isGroupMember(grId, session.key)) return fail("вы не в этой группе");
      target = "g:" + grId;
    } else if (to) {
      const peer = store.users[to.toLowerCase()];
      if (!peer) return fail("нет такого пользователя");
      if (to.toLowerCase() === session.key) return fail("нельзя писать самому себе");
      if (blocksOf(to.toLowerCase()).some((n) => String(n).toLowerCase() === session.key)) {
        return fail("получатель ограничил приём сообщений");
      }
      const peerPriv = privacyOf(peer);
      const started = messagesFor(session.key, peer.nick).length > 0;
      if (!started && !allowedBy(peerPriv.write, to.toLowerCase(), session.key)) {
        return fail("этот пользователь принимает сообщения только от контактов");
      }
      target = peer.nick;
    }
    const flood = floodCheck(session.key);
    if (flood) return fail(flood);
    const message = {
      id: store.nextId++,
      from: session.nick,
      to: target,
      text: text,
      ts: Date.now()
    };
    if (img) message.img = img;
    store.messages.push(message);
    if (store.messages.length > 20000) store.messages = store.messages.slice(-15000);
    saveStore();
    return { ok: true, message: message };
  }

  if (action === "channels") {
    return { ok: true, channels: myChannels(session.key) };
  }

  if (action === "channel-create") {
    const title = String(data.title || "").trim().slice(0, 60);
    if (title.length < 2) return fail("название канала: минимум 2 символа");
    const about = String(data.about || "").trim().slice(0, 200);
    let id = "c" + crypto.randomBytes(4).toString("hex");
    while (store.channels[id]) id = "c" + crypto.randomBytes(4).toString("hex");
    store.channels[id] = {
      id: id,
      title: title,
      about: about,
      owner: session.key,
      created: Date.now()
    };
    store.channelMembers[id] = [session.key];
    saveStore();
    log("канал создан: " + title + " (" + id + ") от " + session.nick);
    return { ok: true, channel: publicChannel(store.channels[id], session.key) };
  }

  if (action === "channel-join") {
    const id = String(data.id || "").trim();
    const ch = channelOf(id);
    if (!ch) return fail("канал не найден");
    if (!store.channelMembers[id]) store.channelMembers[id] = [];
    if (!isChannelMember(id, session.key)) {
      store.channelMembers[id].push(session.key);
      saveStore();
      log("в канал " + id + " вступил " + session.nick);
    }
    return { ok: true, channel: publicChannel(ch, session.key), channels: myChannels(session.key) };
  }

  if (action === "channel-leave") {
    const id = String(data.id || "").trim();
    const ch = channelOf(id);
    if (!ch) return fail("канал не найден");
    store.channelMembers[id] = channelMembersOf(id).filter((k) => k !== session.key);
    saveStore();
    return { ok: true, channels: myChannels(session.key) };
  }

  if (action === "channel-delete") {
    const id = String(data.id || "").trim();
    const ch = channelOf(id);
    if (!ch) return fail("канал не найден");
    if (ch.owner !== session.key && !isAdminKey(session.key)) return fail("удалять канал может только владелец");
    delete store.channels[id];
    delete store.channelMembers[id];
    store.messages = store.messages.filter((m) => String(m.to || "") !== "ch:" + id);
    saveStore();
    log("канал удалён: " + id);
    return { ok: true, channels: myChannels(session.key) };
  }

  if (action === "poll") {
    const since = Number(data.since) || 0;
    const joined = Object.keys(store.channels).filter((id) => isChannelMember(id, session.key));
    const joinedSet = {};
    for (const id of joined) joinedSet["ch:" + id] = true;
    for (const id of Object.keys(store.groups)) {
      if (isGroupMember(id, session.key)) joinedSet["g:" + id] = true;
    }
    const blockedSet = {};
    for (const nick of blocksOf(session.key)) blockedSet[String(nick).toLowerCase()] = true;
    const fresh = store.messages.filter((m) => m.id > since);
    const visible = fresh.filter((m) => {
      const addr = String(m.to || "");
      if (addr.indexOf("ch:") === 0) return !!joinedSet[addr];
      if (addr.indexOf("g:") === 0) return !!joinedSet[addr];
      if (!m.to) return true;
      if (blockedSet[m.from.toLowerCase()]) return false;
      return m.to.toLowerCase() === session.key || m.from.toLowerCase() === session.key;
    });
    return {
      ok: true,
      messages: visible,
      users: publicUsers(session.key),
      channels: myChannels(session.key),
      groups: myGroups(session.key),
      time: Date.now()
    };
  }

  if (action === "history") {
    const limit = Math.min(Number(data.limit) || 200, 500);
    const withRaw = String(data.with == null ? "" : data.with).trim();
    const chId = channelIdOfTarget(withRaw);
    const grId = groupIdOfTarget(withRaw);
    if (withRaw.indexOf("ch:") === 0) {
      if (!chId) return fail("канал не найден");
      if (!isChannelMember(chId, session.key)) return fail("сначала вступи в канал");
      const list = store.messages.filter((m) => String(m.to || "") === "ch:" + chId);
      return { ok: true, messages: list.slice(-limit), users: publicUsers(session.key), channels: myChannels(session.key), groups: myGroups(session.key) };
    }
    if (withRaw.indexOf("g:") === 0) {
      if (!grId) return fail("группа не найдена");
      if (!isGroupMember(grId, session.key)) return fail("вы не в этой группе");
      const list = store.messages.filter((m) => String(m.to || "") === "g:" + grId);
      return { ok: true, messages: list.slice(-limit), users: publicUsers(session.key), channels: myChannels(session.key), groups: myGroups(session.key) };
    }
    const list = messagesFor(session.key, withRaw);
    return { ok: true, messages: list.slice(-limit), users: publicUsers(session.key), channels: myChannels(session.key), groups: myGroups(session.key) };
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
    if (data.photo !== undefined) {
      const raw = String(data.photo || "").trim();
      if (!raw) {
        user.photo = "";
      } else {
        const ref = imageRefOf(raw);
        if (!ref) return fail("картинка не нашлась — загрузи фото заново");
        user.photo = ref;
      }
    }
    if (data.birth !== undefined) {
      const raw = String(data.birth || "").trim();
      if (raw) {
        const birth = validBirth(raw);
        if (!birth) return fail("дата рождения странная — нужен вид 2005-05-17, возраст от " + MIN_AGE + " лет");
        user.birth = birth;
      } else {
        user.birth = "";
      }
    }
    if (data.hideOnline !== undefined) user.hideOnline = !!data.hideOnline;
    if (data.bio !== undefined) user.bio = String(data.bio || "").trim().slice(0, 140);
    if (data.phone !== undefined) {
      const asked = String(data.phone || "").trim();
      const phone = phoneKeyOf(asked);
      if (asked && !phone) return fail("неверный номер — нужно 10-11 цифр");
      if (phone) {
        const busy = userByPhone(phone);
        if (busy && busy !== session.key) return fail("этот номер уже занят другим ником");
        user.phone = phone;
      } else {
        user.phone = "";
      }
    }
    saveStore();
    return { ok: true, profile: selfProfileOf(user) };

  }

  if (action === "privacy") {
    const priv = privacyOf(session.user);
    if (data.privacy && typeof data.privacy === "object") {
      for (const k of Object.keys(PRIVACY_DEFAULTS)) {
        const value = data.privacy[k];
        if (value === undefined) continue;
        if (PRIVACY_LEVELS.indexOf(value) < 0) return fail("неизвестный уровень доступа: " + String(value));
        priv[k] = value;
      }
      session.user.privacy = priv;
      saveStore();
      log("приватность: " + session.nick + " " + JSON.stringify(priv));
    }
    return { ok: true, privacy: priv, profile: selfProfileOf(session.user) };
  }

  if (action === "blocks") {
    return { ok: true, blocked: blockListOf(session.key, "") };
  }

  if (action === "block") {
    const nick = normalizeNick(data.nick);
    const key = nick.toLowerCase();
    if (!key) return fail("укажите ник");
    if (key === session.key) return fail("себя заблокировать нельзя");
    const target = store.users[key];
    if (!target) return fail("нет такого пользователя");
    const list = blocksOf(session.key).filter((n) => String(n).toLowerCase() !== key);
    list.push(target.nick);
    store.blocks[session.key] = list;
    saveStore();
    log("чёрный список: " + session.nick + " заблокировал " + target.nick);
    return { ok: true, blocked: blockListOf(session.key, ""), nick: target.nick };
  }

  if (action === "unblock") {
    const nick = normalizeNick(data.nick).toLowerCase();
    if (!nick) return fail("укажите ник");
    store.blocks[session.key] = blocksOf(session.key).filter((n) => String(n).toLowerCase() !== nick);
    saveStore();
    log("чёрный список: " + session.nick + " разблокировал " + nick);
    return { ok: true, blocked: blockListOf(session.key, ""), nick: nick };
  }

  if (action === "upload") {
    const kind = String(data.type || "jpeg").toLowerCase().replace(/^image\//, "");
    const ext = kind === "png" ? "png" : kind === "webp" ? "webp" : kind === "gif" ? "gif" : "jpg";
    const raw = String(data.image || "");
    if (!raw) return fail("нет картинки");
    let buf;
    try { buf = Buffer.from(raw, "base64"); } catch (e) { return fail("битая картинка"); }
    if (!buf.length) return fail("пустая картинка");
    if (buf.length > MAX_IMAGE_BYTES) return fail("картинка больше 4 МБ");
    if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
    const name = crypto.randomBytes(8).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(FILES_DIR, name), buf);
    log("файл: " + name + " (" + Math.round(buf.length / 1024) + " КБ) от " + session.nick);
    return { ok: true, url: "/files/" + name, size: buf.length };
  }

  if (action === "groups") {
    return { ok: true, groups: myGroups(session.key) };
  }

  if (action === "group-create") {
    const title = String(data.title || "").trim().slice(0, 60);
    if (title.length < 2) return fail("название группы: минимум 2 символа");
    const members = [session.key];
    const asked = Array.isArray(data.members) ? data.members : [];
    for (const raw of asked) {
      const nick = normalizeNick(raw);
      const key = nick.toLowerCase();
      if (!key || key === session.key) continue;
      if (!store.users[key]) return fail("нет такого пользователя: " + nick);
      if (members.indexOf(key) < 0) members.push(key);
    }
    let id = "g" + crypto.randomBytes(4).toString("hex");
    while (store.groups[id]) id = "g" + crypto.randomBytes(4).toString("hex");
    store.groups[id] = {
      id: id,
      title: title,
      owner: session.key,
      members: members,
      created: Date.now()
    };
    saveStore();
    log("группа создана: " + title + " (" + id + ", участников " + members.length + ") от " + session.nick);
    return { ok: true, group: publicGroup(store.groups[id], session.key), groups: myGroups(session.key) };
  }

  if (action === "group-add") {
    const id = String(data.id || "").trim();
    const g = groupOf(id);
    if (!g) return fail("группа не найдена");
    if (!isGroupMember(id, session.key)) return fail("вы не в этой группе");
    const nick = normalizeNick(data.nick);
    const key = nick.toLowerCase();
    const target = store.users[key];
    if (!target) return fail("нет такого пользователя");
    if (!Array.isArray(g.members)) g.members = [];
    if (g.members.indexOf(key) < 0) {
      g.members.push(key);
      saveStore();
      log("группа " + id + ": добавлен " + target.nick);
    }
    return { ok: true, group: publicGroup(g, session.key), groups: myGroups(session.key) };
  }

  if (action === "group-remove") {
    const id = String(data.id || "").trim();
    const g = groupOf(id);
    if (!g) return fail("группа не найдена");
    const nick = normalizeNick(data.nick).toLowerCase();
    const allowed = g.owner === session.key || isOwnerKey(session.key) || nick === session.key;
    if (!allowed) return fail("удалять участников может только владелец группы");
    g.members = groupMembersOf(id).filter((k) => k !== nick);
    saveStore();
    log("группа " + id + ": удалён " + nick);
    return { ok: true, group: publicGroup(g, session.key), groups: myGroups(session.key) };
  }

  if (action === "group-leave") {
    const id = String(data.id || "").trim();
    const g = groupOf(id);
    if (!g) return fail("группа не найдена");
    g.members = groupMembersOf(id).filter((k) => k !== session.key);
    if (!g.members.length) delete store.groups[id];
    else if (g.owner === session.key) g.owner = g.members[0];
    saveStore();
    return { ok: true, groups: myGroups(session.key) };
  }

  if (action === "group-delete") {
    const id = String(data.id || "").trim();
    const g = groupOf(id);
    if (!g) return fail("группа не найдена");
    if (g.owner !== session.key && !isOwnerKey(session.key) && !isAdminKey(session.key)) {
      return fail("удалять группу может только её владелец");
    }
    delete store.groups[id];
    store.messages = store.messages.filter((m) => String(m.to || "") !== "g:" + id);
    saveStore();
    log("группа удалена: " + id);
    return { ok: true, groups: myGroups(session.key) };
  }

  if (action === "channels-all") {
    if (!isOwnerKey(session.key) && !isAdminKey(session.key)) return fail("доступно только владельцу");
    const out = [];
    for (const id of Object.keys(store.channels)) out.push(publicChannel(store.channels[id], session.key));
    out.sort((a, b) => (b.created || 0) - (a.created || 0));
    return { ok: true, channels: out };
  }

  if (action === "channel-verify") {
    if (!isOwnerKey(session.key) && !isAdminKey(session.key)) return fail("верифицировать каналы может только владелец");
    const id = String(data.id || "").trim();
    const ch = channelOf(id);
    if (!ch) return fail("канал не найден");
    ch.verified = data.verified === false ? false : true;
    ch.verifiedBy = ch.verified ? session.nick : "";
    ch.verifiedTs = ch.verified ? Date.now() : 0;
    saveStore();
    log("канал " + id + (ch.verified ? " верифицирован" : " лишён верификации") + " — " + session.nick);
    return { ok: true, channel: publicChannel(ch, session.key), channels: myChannels(session.key) };
  }

  if (action === "logout-all") {
    let dropped = 0;
    for (const token of Object.keys(store.tokens)) {
      if (String(store.tokens[token]).toLowerCase() !== session.key) continue;
      if (token === data.token) continue;
      delete store.tokens[token];
      dropped++;
    }
    saveStore();
    log("сессии: " + session.nick + " завершил " + dropped + " других сессий");
    return { ok: true, dropped: dropped };
  }

  if (action === "sessions") {
    let count = 0;
    for (const token of Object.keys(store.tokens)) {
      if (String(store.tokens[token]).toLowerCase() === session.key) count++;
    }
    return { ok: true, sessions: count };
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
      privacy: Object.assign({}, PRIVACY_DEFAULTS),
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

function serveFile(req, res, pathname) {
  const name = decodeURIComponent(pathname.replace(/^\/files\//, ""));
  if (!/^[a-z0-9]+\.[a-z]{2,5}$/i.test(name)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("bad name");
    return;
  }
  const target = path.join(FILES_DIR, name);
  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(name).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
    fs.createReadStream(target).pipe(res);
  });
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
    const fresh = ext === ".html" || ext === ".js" || ext === ".css";
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": fresh ? "no-cache, must-revalidate" : "public, max-age=3600"
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
    const isUpload = pathname === "/api/upload";
    readBody(req, isUpload ? 8 * 1024 * 1024 : 256 * 1024, (err, text) => {
      if (err) { sendJson(res, 413, fail(err.message)); return; }
      let body = {};
      if (text) {
        try { body = JSON.parse(text); } catch (e) { sendJson(res, 400, fail("неверный JSON")); return; }
      }
      const action = pathname.slice(5);
      Promise.resolve()
        .then(() => handleApi(action, body))
        .then((result) => sendJson(res, 200, result || fail("пустой ответ")))
        .catch((e) => {
          log("ошибка в " + action + ": " + e.stack);
          sendJson(res, 200, fail("внутренняя ошибка сервера"));
        });
    });
    return;
  }

  if (pathname.startsWith("/files/")) {
    serveFile(req, res, pathname);
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
