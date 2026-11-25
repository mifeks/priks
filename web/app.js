(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var API_BASE = resolveApiBase();

  function normalizeBase(v) {
    var s = String(v || "").trim();
    if (!s) return "";
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    return s.replace(/\/+$/, "");
  }

  function resolveApiBase() {
    var fromQuery = "";
    try {
      fromQuery = new URLSearchParams(location.search).get("api") || "";
    } catch (e) { }
    if (fromQuery) {
      var q = normalizeBase(fromQuery);
      try { localStorage.setItem("priks.api", q); } catch (e) { }
      return q;
    }
    var saved = "";
    try { saved = localStorage.getItem("priks.api") || ""; } catch (e) { }
    if (saved) return normalizeBase(saved);
    if (typeof window.PRIKS_API === "string" && window.PRIKS_API) return normalizeBase(window.PRIKS_API);
    return "";
  }

  function apiPath(action) {
    return (API_BASE || "") + "/api/" + action;
  }

  function statusPath() {
    return (API_BASE || "") + "/auth/status";
  }

  function needsServerPicker() {
    if (API_BASE) return false;
    if (location.protocol === "file:") return true;
    var h = String(location.hostname || "");
    return /(^|\.)github\.io$/.test(h) || h === "";
  }

  var el = {};
  var state = {
    nick: "",
    token: "",
    chat: "",
    since: 0,
    messages: [],
    users: [],
    friends: [],
    channels: [],
    groups: [],
    found: null,
    account: null,
    unread: {},
    query: "",
    tab: "all",
    folders: [],
    folder: "",
    editingFolder: "",
    polling: false,
    alive: false,
    yandexReady: null,
    step: 1,
    reg: { phone: "", name: "", nick: "", avatar: 1, password: "", email: "" },
    toastTimer: 0
  };

  var ACCENTS = ["#b78d4a", "#4d8bff", "#2bd4c2", "#a78bfa", "#e0574d", "#3ba55d", "#e08a3c", "#c2557a"];
  var FS_STEPS = [14, 16, 18];
  var FS_LABELS = ["S", "M", "L"];
  var FONTS = {
    inter: { ui: "'Inter', system-ui, sans-serif", display: "'Playfair Display', Georgia, serif" },
    manrope: { ui: "'Manrope', system-ui, sans-serif", display: "'Manrope', system-ui, sans-serif" },
    playfair: { ui: "'Playfair Display', Georgia, serif", display: "'Playfair Display', Georgia, serif" }
  };

  var defaults = {
    theme: "light",
    accent: "#b78d4a",
    font: "inter",
    fsIndex: 1,
    radius: 14,
    compact: false,
    enterSend: true,
    titleUnread: true,
    sound: true,
    vibe: false,
    preview: true,
    photoAuto: true,
    photoSize: "high",
    photoShowBtn: true,
    volume: 60,
    privacy: { hideOnline: false, inviteOnly: false, vanish: false }
  };

  var settings = {};
  var profile = { name: "", status: "on", custom: "", avatar: 1, photo: "" };

  function cloneDefaults() {
    var out = {};
    for (var k in defaults) {
      out[k] = defaults[k];
      if (k === "privacy") {
        out[k] = {};
        for (var p in defaults.privacy) out[k][p] = defaults.privacy[p];
      }
    }
    return out;
  }

  function loadSettings() {
    settings = cloneDefaults();
    try {
      var raw = localStorage.getItem("priks.settings");
      if (!raw) return;
      var saved = JSON.parse(raw);
      for (var k in defaults) {
        if (saved[k] === undefined || saved[k] === null) continue;
        if (k === "privacy" && typeof saved[k] === "object") {
          for (var p in defaults.privacy) {
            if (saved[k][p] !== undefined) settings.privacy[p] = !!saved[k][p];
          }
        } else {
          settings[k] = saved[k];
        }
      }
    } catch (e) { }
  }

  function saveSettings() {
    try { localStorage.setItem("priks.settings", JSON.stringify(settings)); } catch (e) { }
  }

  function loadProfile() {
    try {
      var raw = localStorage.getItem("priks.profile");
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved.name) profile.name = saved.name;
      if (saved.status) profile.status = saved.status;
      if (typeof saved.custom === "string") profile.custom = saved.custom;
      if (saved.avatar) profile.avatar = saved.avatar;
      if (saved.photo) profile.photo = saved.photo;
    } catch (e) { }
  }

  function saveProfile() {
    try { localStorage.setItem("priks.profile", JSON.stringify(profile)); } catch (e) { }
  }

  function resolveTheme() {
    if (settings.theme === "system") {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return settings.theme === "dark" ? "dark" : "light";
  }

  function applySettings() {
    var theme = resolveTheme();
    document.documentElement.setAttribute("data-theme", theme);
    var font = FONTS[settings.font] || FONTS.inter;
    document.documentElement.style.setProperty("--font-ui", font.ui);
    document.documentElement.style.setProperty("--font-display", font.display);
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.style.setProperty("--fs", FS_STEPS[settings.fsIndex] + "px");
    document.documentElement.style.setProperty("--radius", settings.radius + "px");
    if (el.app) el.app.classList.toggle("compact", !!settings.compact);
    applyMediaUi();
  }

  function avatarClass(index) {
    return "g" + (index >= 1 && index <= 6 ? index : 1);
  }

  function applyAvatar(node, nick, avatar, photo) {
    if (!node) return;
    node.className = node.className.replace(/\bg[1-6]\b/g, "").trim();
    if (photo) {
      node.style.backgroundImage = "url(" + photo + ")";
      node.style.backgroundSize = "cover";
      node.style.backgroundPosition = "center";
      node.style.color = "transparent";
      return;
    }
    node.style.backgroundImage = "";
    node.style.color = "";
    node.classList.add(avatarClass(avatar));
    node.textContent = (nick || "?").charAt(0).toUpperCase();
  }

  function statusLabel() {
    if (profile.status === "dnd") return "не беспокоить";
    if (profile.status === "custom" && profile.custom) return profile.custom;
    if (profile.status === "custom") return "свой статус";
    return "на связи";
  }

  function api(action, data) {
    return fetch(apiPath(action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {})
    }).then(function (r) { return r.json(); });
  }

  function saveSession() {
    try {
      localStorage.setItem("priks.nick", state.nick);
      localStorage.setItem("priks.token", state.token);
    } catch (e) { }
  }

  function clearSession() {
    try {
      localStorage.removeItem("priks.nick");
      localStorage.removeItem("priks.token");
    } catch (e) { }
  }

  function timeText(ts) {
    var d = new Date(ts);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function toast(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.toast.classList.add("hidden"); }, 2600);
  }

  function beep() {
    if (settings.vibe && navigator.vibrate) navigator.vibrate(60);
    if (!settings.sound || settings.volume <= 0) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var gain = ctx.createGain();
      var osc = ctx.createOscillator();
      gain.gain.value = Math.min(1, settings.volume / 100) * 0.26;
      osc.type = "sine";
      osc.frequency.value = 660;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(function () { try { ctx.close(); } catch (e) { } }, 400);
    } catch (e) { }
  }

  function showStep(step) {
    state.step = step;
    ["p1", "p2", "p3", "loginBox", "srvBox", "resetBox"].forEach(function (id) { $(id).classList.add("hidden"); });
    if (step === "login") {
      $("loginBox").classList.remove("hidden");
      $("onbStep").textContent = "вход";
      setDots(0);
      return;
    }
    if (step === "reset") {
      $("resetBox").classList.remove("hidden");
      $("onbStep").textContent = "сброс пароля";
      $("resetStep2").classList.add("hidden");
      setDots(0);
      return;
    }
    if (step === "srv") {
      $("srvBox").classList.remove("hidden");
      $("onbStep").textContent = "подключение";
      setDots(0);
      return;
    }
    $("p" + step).classList.remove("hidden");
    $("onbStep").textContent = "шаг " + step + " из 3";
    setDots(step);
  }

  function setDots(n) {
    var dots = el.onbDots.querySelectorAll("i");
    for (var i = 0; i < dots.length; i++) {
      dots[i].className = i < n ? "on" : "";
    }
  }

  function normPhone(value) {
    var digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length === 11 && digits.charAt(0) === "8") digits = "7" + digits.slice(1);
    return digits;
  }

  function phoneNext() {
    var digits = normPhone(el.phone.value);
    if (digits.length < 10) {
      el.phoneErr.textContent = "введите номер полностью";
      return;
    }
    el.phoneErr.textContent = "";
    state.reg.phone = digits;
    showStep(2);
    el.fName.focus();
  }

  function nickNext() {
    var name = el.fName.value.trim();
    var nick = el.fNick.value.trim();
    el.nameErr.textContent = "";
    el.nickErr.textContent = "";
    if (name.length < 1) { el.nameErr.textContent = "как вас называть?"; return; }
    if (!/^[A-Za-z0-9_.-]{2,20}$/.test(nick)) {
      el.nickErr.textContent = "ник: 2-20 символов, латиница, цифры, _ - .";
      return;
    }
    state.reg.name = name;
    state.reg.nick = nick;
    showStep(3);
  }

  function finishAuth() {
    var password = el.password.value;
    var email = el.regEmail ? el.regEmail.value.trim() : "";
    el.passErr.textContent = "";
    el.userErr.textContent = "";
    el.emailErr.textContent = "";
    if (password.length < 4) { el.passErr.textContent = "пароль минимум 4 символа"; return; }
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
      el.emailErr.textContent = "почта выглядит странно — нужен вид name@mail.ru";
      return;
    }
    state.reg.password = password;
    state.reg.email = email;
    var payload = {
      nick: state.reg.nick,
      password: password,
      displayName: state.reg.name,
      avatar: state.reg.avatar,
      phone: state.reg.phone,
      email: email
    };
    el.finishBtn.disabled = true;
    api("register", payload).then(function (res) {
      el.finishBtn.disabled = false;
      if (!res || !res.ok) { el.userErr.textContent = (res && res.error) || "не получилось"; return; }
      profile.name = state.reg.name;
      profile.avatar = state.reg.avatar;
      if (res.profile) mergeProfile(res.profile);
      saveProfile();
      enter(res.nick, res.token);
      toast("аккаунт создан: " + res.nick);
    }).catch(function () {
      el.finishBtn.disabled = false;
      el.userErr.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function doLogin() {
    el.loginError.textContent = "";
    api("login", { nick: el.loginNick.value, password: el.loginPass.value }).then(function (res) {
      if (!res || !res.ok) { el.loginError.textContent = (res && res.error) || "не вышло"; return; }
      if (res.profile) mergeProfile(res.profile);
      enter(res.nick, res.token);
    }).catch(function () { el.loginError.textContent = "нет связи, попробуйте ещё раз"; });
  }

  function resetSend() {
    var login = el.resetLogin.value.trim();
    el.resetErr.textContent = "";
    el.resetErr2.textContent = "";
    if (!login) { el.resetErr.textContent = "введите ник, телефон или почту"; return; }
    el.btnResetSend.disabled = true;
    el.btnResetSend.textContent = "отправляю…";
    api("password-reset-request", { login: login }).then(function (res) {
      el.btnResetSend.disabled = false;
      el.btnResetSend.textContent = "Получить код";
      if (!res || !res.ok) { el.resetErr.textContent = (res && res.error) || "не получилось"; return; }
      $("resetStep2").classList.remove("hidden");
      if (res.sent) {
        el.resetHint.textContent = "Код отправлен на " + res.email + ". Введите его и новый пароль.";
      } else {
        el.resetHint.textContent = "Почта пока не подключена, поэтому код показан тут: " + res.code;
        el.resetCode.value = res.code;
      }
      el.resetCode.focus();
    }).catch(function () {
      el.btnResetSend.disabled = false;
      el.btnResetSend.textContent = "Получить код";
      el.resetErr.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function resetApply() {
    var login = el.resetLogin.value.trim();
    var code = el.resetCode.value.trim();
    var password = el.resetPass.value;
    el.resetErr2.textContent = "";
    if (!code) { el.resetErr2.textContent = "введите код из письма"; return; }
    if (password.length < 4) { el.resetErr2.textContent = "пароль минимум 4 символа"; return; }
    el.btnResetApply.disabled = true;
    api("password-reset", { login: login, code: code, password: password }).then(function (res) {
      el.btnResetApply.disabled = false;
      if (!res || !res.ok) { el.resetErr2.textContent = (res && res.error) || "не получилось"; return; }
      el.loginNick.value = login;
      el.loginPass.value = "";
      el.resetPass.value = "";
      el.resetCode.value = "";
      showStep("login");
      toast("пароль сменён — войдите с новым");
      el.loginPass.focus();
    }).catch(function () {
      el.btnResetApply.disabled = false;
      el.resetErr2.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function mergeProfile(p) {
    if (!p) return;
    if (p.displayName) profile.name = p.displayName;
    if (p.status) profile.status = p.status;
    if (typeof p.customStatus === "string") profile.custom = p.customStatus;
    if (p.avatar) profile.avatar = p.avatar;
    if (p.hideOnline !== undefined) settings.privacy.hideOnline = !!p.hideOnline;
    if (p.privacy && typeof p.privacy === "object") {
      state.account = state.account || {};
      state.account.privacy = p.privacy;
    }
    if (p.blocked && p.blocked.length !== undefined) {
      state.account = state.account || {};
      state.account.blocked = p.blocked;
    }
    if (p.owner !== undefined) {
      state.me = state.me || {};
      state.me.owner = !!p.owner;
      state.me.admin = !!p.admin;
    }
    if (p.bio !== undefined) {
      state.account = state.account || {};
      state.account.bio = p.bio || "";
      profile.bio = p.bio || "";
    }
    if (p.email !== undefined) {
      state.account = state.account || {};
      state.account.email = p.email || "";
      state.account.emailVerified = !!p.emailVerified;
      state.account.hasPassword = !!p.hasPassword;
      state.account.oauth = p.oauth || "";
      state.account.phone = p.phone || "";
    }
    saveProfile();
    saveSettings();
    if (state.alive) {
      syncAccountUi();
      syncProfileUi();
    }
  }

  var PRIVACY_DEFAULTS = { online: "all", phone: "nobody", find: "all", write: "all", content: "all" };
  var PRIVACY_LABELS = { all: "все", contacts: "контакты", nobody: "никто" };

  function privacyState() {
    state.account = state.account || {};
    var p = state.account.privacy;
    if (!p || typeof p !== "object") {
      p = {};
      for (var k in PRIVACY_DEFAULTS) p[k] = PRIVACY_DEFAULTS[k];
      state.account.privacy = p;
    }
    for (var d in PRIVACY_DEFAULTS) {
      if (!p[d]) p[d] = PRIVACY_DEFAULTS[d];
    }
    return p;
  }

  function blockedState() {
    state.account = state.account || {};
    if (!state.account.blocked) state.account.blocked = [];
    return state.account.blocked;
  }

  function syncBlockedUi() {
    var p = privacyState();
    var fields = { "pv-online": "online", "pv-phone": "phone", "pv-find": "find", "pv-write": "write", "pv-content": "content" };
    for (var id in fields) {
      var node = $(id);
      if (node) node.value = p[fields[id]];
    }
    var list = blockedState();
    var st = $("blocked-state");
    if (st) st.textContent = list.length ? list.length + " " + (list.length === 1 ? "человек" : "человека") : "никого";
    renderBlockedList();
  }

  function renderBlockedList() {
    var box = $("blocked-list");
    if (!box) return;
    var list = blockedState();
    box.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Список пуст — здесь появятся заблокированные";
      box.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (item) {
        var row = document.createElement("div");
        row.className = "row";
        var text = document.createElement("div");
        var t = document.createElement("div");
        t.className = "t";
        t.textContent = "@" + item.nick;
        var d = document.createElement("div");
        d.className = "d";
        d.textContent = item.exists === false ? "аккаунт удалён" : "не может писать и находить вас";
        text.appendChild(t);
        text.appendChild(d);
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost small";
        btn.textContent = "Разблокировать";
        btn.onclick = function () { unblockNick(item.nick); };
        row.appendChild(text);
        row.appendChild(btn);
        box.appendChild(row);
      })(list[i]);
    }
  }

  function savePrivacy(field, level) {
    if (!state.token) return;
    privacyState()[field] = level;
    syncBlockedUi();
    var patch = {};
    patch[field] = level;
    api("privacy", { token: state.token, privacy: patch }).then(function (res) {
      if (res && res.ok) {
        if (res.profile) mergeProfile(res.profile);
        syncBlockedUi();
        toast("Сохранено: " + (PRIVACY_LABELS[level] || level));
      } else {
        toast((res && res.error) || "Не удалось сохранить");
      }
    }).catch(function () { toast("Нет связи"); });
  }

  function blockNick() {
    var input = $("block-nick");
    var err = $("block-err");
    if (err) err.textContent = "";
    var nick = String(input && input.value || "").trim().replace(/^@+/, "");
    if (!nick) { if (err) err.textContent = "введите ник"; return; }
    api("block", { token: state.token, nick: nick }).then(function (res) {
      if (res && res.ok) {
        state.account.blocked = res.blocked || [];
        if (input) input.value = "";
        syncBlockedUi();
        toast("Заблокирован @" + nick);
      } else if (err) {
        err.textContent = (res && res.error) || "не получилось";
      }
    }).catch(function () { if (err) err.textContent = "нет связи"; });
  }

  function unblockNick(nick) {
    api("unblock", { token: state.token, nick: nick }).then(function (res) {
      if (res && res.ok) {
        state.account.blocked = res.blocked || [];
        syncBlockedUi();
        toast("Разблокирован @" + nick);
      } else {
        toast((res && res.error) || "не получилось");
      }
    }).catch(function () { toast("Нет связи"); });
  }

  var FOLDER_KEY = "priks.folders";

  function loadFolders() {
    var list = [];
    try {
      var raw = localStorage.getItem(FOLDER_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (parsed && parsed.length !== undefined) list = parsed;
    } catch (e) { list = []; }
    state.folders = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (!f || !f.id) continue;
      state.folders.push({
        id: String(f.id),
        title: String(f.title || "Папка").slice(0, 24),
        chats: f.chats && f.chats.length !== undefined ? f.chats.map(String) : []
      });
    }
    if (state.folder && state.folder !== "unread" && state.folder !== "channels" && !folderById(state.folder)) {
      state.folder = "";
    }
    if (!state.folder) {
      try { state.folder = localStorage.getItem("priks.folder") || ""; } catch (e) { state.folder = ""; }
      if (state.folder && state.folder !== "unread" && state.folder !== "channels" && !folderById(state.folder)) {
        state.folder = "";
      }
    }
  }

  function saveFolders() {
    try { localStorage.setItem(FOLDER_KEY, JSON.stringify(state.folders || [])); } catch (e) { }
  }

  function folderById(id) {
    var list = state.folders || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function folderAllows(key, unreadCount) {
    var f = state.folder || "";
    if (!f) return true;
    var raw = String(key || "");
    if (f === "channels") return raw.indexOf("ch:") === 0;
    if (f === "unread") return (unreadCount || 0) > 0;
    var folder = folderById(f);
    if (!folder) return true;
    return (folder.chats || []).indexOf(raw) >= 0;
  }

  function setFolder(id) {
    state.folder = id || "";
    try { localStorage.setItem("priks.folder", state.folder); } catch (e) { }
    renderFolderChips();
    renderChatList();
  }

  function renderFolderChips() {
    var box = $("folderRow");
    if (!box) return;
    box.innerHTML = "";
    var chips = [{ id: "", title: "Все" }, { id: "unread", title: "Непрочитанные" }, { id: "channels", title: "Каналы" }];
    var list = state.folders || [];
    for (var i = 0; i < list.length; i++) chips.push({ id: list[i].id, title: list[i].title });
    for (var c = 0; c < chips.length; c++) {
      (function (chip) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "fold-chip" + ((state.folder || "") === chip.id ? " active" : "");
        b.textContent = chip.title;
        b.title = chip.title;
        b.onclick = function () { setFolder(chip.id); };
        box.appendChild(b);
      })(chips[c]);
    }
  }

  function folderChatLabel(key) {
    if (!key) return "Общий чат";
    if (key.indexOf("ch:") === 0) {
      var ch = channelOf(key.slice(3));
      return ch ? ch.title : "канал";
    }
    var user = findUser(key);
    return user ? (user.displayName || user.nick) : key;
  }

  function renderFolderList() {
    var box = $("folder-list");
    if (!box) return;
    box.innerHTML = "";
    var list = state.folders || [];
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Пока нет папок — создайте первую выше";
      box.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (folder) {
        var row = document.createElement("div");
        row.className = "row";
        var text = document.createElement("div");
        var t = document.createElement("div");
        t.className = "t";
        t.textContent = folder.title;
        var d = document.createElement("div");
        d.className = "d";
        var n = (folder.chats || []).length;
        d.textContent = n ? n + " " + (n === 1 ? "чат" : (n < 5 ? "чата" : "чатов")) : "пустая";
        text.appendChild(t);
        text.appendChild(d);

        var tools = document.createElement("div");
        tools.className = "row-tools";

        var edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn ghost small";
        edit.textContent = "Состав";
        edit.onclick = function () { openFolderEditor(folder.id); };

        var del = document.createElement("button");
        del.type = "button";
        del.className = "btn ghost small danger";
        del.textContent = "Удалить";
        del.onclick = function () { deleteFolder(folder.id); };

        tools.appendChild(edit);
        tools.appendChild(del);
        row.appendChild(text);
        row.appendChild(tools);
        box.appendChild(row);
      })(list[i]);
    }
  }

  function syncFoldersUi() {
    renderFolderList();
    renderFolderChips();
  }

  function createFolder() {
    var input = $("folder-title");
    var err = $("folder-err");
    if (err) err.textContent = "";
    var title = String(input && input.value || "").trim().slice(0, 24);
    if (title.length < 2) { if (err) err.textContent = "название: минимум 2 символа"; return; }
    state.folders = state.folders || [];
    for (var i = 0; i < state.folders.length; i++) {
      if (state.folders[i].title.toLowerCase() === title.toLowerCase()) {
        if (err) err.textContent = "такая папка уже есть";
        return;
      }
    }
    var folder = { id: "f" + Date.now().toString(36), title: title, chats: [] };
    state.folders.push(folder);
    saveFolders();
    if (input) input.value = "";
    renderFolderList();
    renderFolderChips();
    openFolderEditor(folder.id);
    toast("Папка «" + title + "» создана");
  }

  function deleteFolder(id) {
    var folder = folderById(id);
    if (!folder) return;
    state.folders = (state.folders || []).filter(function (f) { return f.id !== id; });
    saveFolders();
    if (state.folder === id) state.folder = "";
    if (state.editingFolder === id) {
      state.editingFolder = "";
      var card = $("folder-edit-card");
      if (card) card.classList.add("hidden");
    }
    renderFolderList();
    renderFolderChips();
    renderChatList();
    toast("Папка «" + folder.title + "» удалена");
  }

  function folderCandidates() {
    var out = [];
    out.push({ key: "", label: "Общий чат" });
    var channels = state.channels || [];
    for (var c = 0; c < channels.length; c++) {
      out.push({ key: "ch:" + channels[c].id, label: channels[c].title });
    }
    var people = chatPeople();
    for (var i = 0; i < people.length; i++) {
      var u = people[i];
      if (!u || !u.nick) continue;
      if (u.nick.toLowerCase() === String(state.nick || "").toLowerCase()) continue;
      out.push({ key: u.nick, label: u.displayName || u.nick });
    }
    return out;
  }

  function openFolderEditor(id) {
    var folder = folderById(id);
    if (!folder) return;
    state.editingFolder = id;
    var card = $("folder-edit-card");
    var title = $("folder-edit-title");
    var box = $("folder-chats");
    if (title) title.textContent = "Состав: " + folder.title;
    if (box) {
      box.innerHTML = "";
      var list = folderCandidates();
      if (!list.length) {
        box.innerHTML = '<div class="hint">Пока нет чатов</div>';
      }
      for (var i = 0; i < list.length; i++) {
        (function (item) {
          var label = document.createElement("label");
          label.className = "folder-line";
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.value = item.key;
          cb.checked = (folder.chats || []).indexOf(item.key) >= 0;
          var span = document.createElement("span");
          span.textContent = item.label;
          label.appendChild(cb);
          label.appendChild(span);
          box.appendChild(label);
        })(list[i]);
      }
    }
    if (card) {
      card.classList.remove("hidden");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function saveFolderEditor() {
    var folder = folderById(state.editingFolder);
    if (!folder) return;
    var box = $("folder-chats");
    var picked = [];
    if (box) {
      var boxes = box.querySelectorAll('input[type="checkbox"]');
      for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(boxes[i].value);
    }
    folder.chats = picked;
    saveFolders();
    renderFolderList();
    renderFolderChips();
    renderChatList();
    toast("Папка «" + folder.title + "» сохранена");
  }

  function syncModerationUi() {
    var me = state.me || {};
    var role = $("mod-role");
    if (role) {
      role.textContent = me.owner ? "владелец Прикса" : (me.admin ? "администратор" : "обычный участник");
    }
    var badge = $("mod-owner-badge");
    if (badge) badge.classList.toggle("hidden", !me.owner);
    var box = $("mod-channels");
    if (!box) return;
    box.innerHTML = "";
    if (!me.owner && !me.admin) {
      box.innerHTML = '<div class="hint">Верифицировать каналы может только владелец</div>';
      return;
    }
    api("channels-all", { token: state.token }).then(function (res) {
      if (!res || !res.ok) {
        box.innerHTML = '<div class="hint">' + ((res && res.error) || "не удалось загрузить каналы") + '</div>';
        return;
      }
      var list = res.channels || [];
      if (!list.length) {
        box.innerHTML = '<div class="hint">Каналов пока нет</div>';
        return;
      }
      for (var i = 0; i < list.length; i++) {
        (function (ch) {
          var row = document.createElement("div");
          row.className = "row";
          var text = document.createElement("div");
          var t = document.createElement("div");
          t.className = "t";
          t.textContent = ch.title + (ch.verified ? " ✓" : "");
          var d = document.createElement("div");
          d.className = "d";
          d.textContent = ch.verified ? "проверен" : "не проверен";
          text.appendChild(t);
          text.appendChild(d);
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn ghost small";
          btn.textContent = ch.verified ? "Снять" : "Проверить";
          btn.onclick = function () { verifyChannel(ch.id, !ch.verified); };
          row.appendChild(text);
          row.appendChild(btn);
          box.appendChild(row);
        })(list[i]);
      }
    }).catch(function () {
      box.innerHTML = '<div class="hint">нет связи</div>';
    });
  }

  function verifyChannel(id, verified) {
    api("channel-verify", { token: state.token, id: id, verified: verified }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "не получилось"); return; }
      toast(verified ? "канал проверен" : "верификация снята");
      syncModerationUi();
      loadChannels();
    }).catch(function () { toast("нет связи"); });
  }

  function syncMediaUi() {
    if ($("media-auto")) $("media-auto").checked = settings.photoAuto !== false;
    if ($("media-btn")) $("media-btn").checked = settings.photoShowBtn !== false;
    var seg = $("photo-size-seg");
    if (seg) {
      var btns = seg.querySelectorAll(".seg-btn");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("active", btns[i].getAttribute("data-v") === (settings.photoSize || "high"));
      }
    }
  }

  function applyMediaUi() {
    var btn = $("btnPhoto");
    if (btn) btn.classList.toggle("hidden", settings.photoShowBtn === false);
  }

  function prettySize(bytes) {
    if (bytes < 1024) return bytes + " Б";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " КБ";
    return (bytes / 1024 / 1024).toFixed(1) + " МБ";
  }

  function syncDataUi() {
    var cacheBytes = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("priks.") !== 0) continue;
        cacheBytes += (localStorage.getItem(k) || "").length;
      }
    } catch (e) { }
    if ($("data-cache")) $("data-cache").textContent = state.messages.length + " сообщений · " + prettySize(cacheBytes);
    if ($("data-settings")) {
      var folders = (state.folders || []).length;
      $("data-settings").textContent = folders + " " + (folders === 1 ? "папка" : "папок") + " · " + prettySize(JSON.stringify(settings).length + JSON.stringify(profile).length);
    }
  }

  function clearCache() {
    state.messages = [];
    state.since = 0;
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (k && (k === "priks.cache" || k === "priks.profile")) localStorage.removeItem(k);
      }
    } catch (e) { }
    renderMessages();
    renderChatList();
    syncDataUi();
    if (state.chat !== undefined) loadHistory(state.chat || "");
    toast("кэш сообщений очищен");
  }

  function exportData() {
    var payload = {
      app: "Прикс",
      exported: new Date().toISOString(),
      nick: state.nick,
      profile: profile,
      settings: settings,
      privacy: privacyState(),
      folders: state.folders || [],
      blocked: blockedState()
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "priks-" + (state.nick || "data") + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast("копия сохранена");
  }

  function loadSessions() {
    if (!state.token) return;
    api("sessions", { token: state.token }).then(function (res) {
      if (!res || !res.ok) return;
      if ($("sess-count")) $("sess-count").textContent = res.sessions + " " + (res.sessions === 1 ? "устройство" : "устройств");
    }).catch(function () { });
    if ($("sess-device")) $("sess-device").textContent = browserName() + " · " + (navigator.platform || "веб");
  }

  function browserName() {
    var ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Microsoft Edge";
    if (/YaBrowser/.test(ua)) return "Яндекс Браузер";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "Браузер";
  }

  function logoutOthers() {
    api("logout-all", { token: state.token }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "не получилось"); return; }
      toast(res.dropped ? "закрыто сессий: " + res.dropped : "других сессий нет");
      loadSessions();
    }).catch(function () { toast("нет связи"); });
  }

  function saveBio() {
    var input = $("bio-input");
    var err = $("bio-err");
    if (err) err.textContent = "";
    var bio = String(input && input.value || "").trim();
    api("profile", { token: state.token, bio: bio }).then(function (res) {
      if (!res || !res.ok) { if (err) err.textContent = (res && res.error) || "не получилось"; return; }
      if (res.profile) mergeProfile(res.profile);
      syncBioUi();
      toast("подпись сохранена");
    }).catch(function () { if (err) err.textContent = "нет связи"; });
  }

  function syncBioUi() {
    var input = $("bio-input");
    if (!input) return;
    var bio = (state.account && state.account.bio) || profile.bio || "";
    if (!input.value || document.activeElement !== input) input.value = bio;
  }

  function syncAccountUi() {
    var acc = state.account || {};
    if (el.setEmailState) {
      if (acc.email && acc.emailVerified) el.setEmailState.textContent = acc.email + " · подтверждена";
      else if (acc.email) el.setEmailState.textContent = acc.email + " · не подтверждена";
      else el.setEmailState.textContent = "не привязана — нужна для сброса пароля";
    }
    if (el.setPassState) {
      el.setPassState.textContent = acc.hasPassword ? "задан" : "нет — вход через Яндекс";
    }
    if (el.setYaState) {
      el.setYaState.textContent = acc.oauth === "yandex" ? "привязан" : "не привязан";
    }
    if (el.btnEmailEdit) el.btnEmailEdit.textContent = acc.email ? "Изменить" : "Указать";
    if (el.setEmailIn && !el.setEmailIn.value && acc.email) el.setEmailIn.value = acc.email;
    if (el.setPhoneState) {
      var ph = String(acc.phone || "");
      el.setPhoneState.textContent = ph.length === 10
        ? "+7 " + ph.slice(0, 3) + " " + ph.slice(3, 6) + "-" + ph.slice(6, 8) + "-" + ph.slice(8)
        : "не указан";
    }
  }

  function enter(nick, token) {
    state.alive = true;
    state.nick = nick;
    state.token = token;
    state.since = 0;
    state.messages = [];
    state.unread = {};
    state.chat = "";
    if (!profile.name) profile.name = nick;
    el.onboarding.classList.add("hidden");
    el.app.classList.remove("hidden");
    saveSession();
    applySettings();
    syncProfileUi();
    renderChatList();
    loadHistory("");
    loadFriends();
    loadChannels();
    loadGroups();
    poll();
    var askedPane = "";
    try { askedPane = new URLSearchParams(location.search).get("pane") || ""; } catch (e) { }
    if (askedPane && PANE_TITLES[askedPane]) {
      setTimeout(function () { openSettings(askedPane); }, 250);
    }
  }

  function backToLogin(message) {
    state.alive = false;
    state.token = "";
    state.nick = "";
    clearSession();
    el.app.classList.add("hidden");
    el.onboarding.classList.remove("hidden");
    showStep(1);
    el.phoneErr.textContent = message || "";
  }

  function addMessages(list) {
    var added = false;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var exists = false;
      for (var j = 0; j < state.messages.length; j++) {
        if (state.messages[j].id === m.id) { exists = true; break; }
      }
      if (exists) continue;
      state.messages.push(m);
      added = true;
      var key = chatKeyOf(m);
      if (key !== state.chat && !isMine(m)) {
        state.unread[key.toLowerCase()] = (state.unread[key.toLowerCase()] || 0) + 1;
      }
      if (m.id > state.since) state.since = m.id;
    }
    if (state.messages.length > 600) {
      state.messages.sort(function (a, b) { return a.id - b.id; });
      state.messages = state.messages.slice(-600);
    }
    return added;
  }

  function loadHistory(withNick) {
    api("history", { token: state.token, with: withNick, limit: 200 }).then(function (res) {
      if (!res || !res.ok) { if (res && res.error) backToLogin(res.error); return; }
      addMessages(res.messages || []);
      if (res.users) state.users = res.users;
      if (res.channels) state.channels = res.channels;
      renderChatList();
      renderMessages();
      updateTitle();
    }).catch(function () { });
  }

  function poll() {
    if (!state.alive || state.polling) return;
    state.polling = true;
    api("poll", { token: state.token, since: state.since }).then(function (res) {
      state.polling = false;
      if (!state.alive) return;
      if (!res || !res.ok) {
        if (res && res.error) backToLogin(res.error);
        else setTimeout(poll, 2500);
        return;
      }
      if (res.users) {
        state.users = res.users;
        renderChatList();
      }
      if (res.channels) state.channels = res.channels;
      if (res.groups) state.groups = res.groups;
      var added = addMessages(res.messages || []);
      if (added) {
        renderMessages();
        renderChatList();
        beep();
      }
      setConnected(true);
      updateTitle();
      setTimeout(poll, 900);
    }).catch(function () {
      state.polling = false;
      if (!state.alive) return;
      setConnected(false);
      setTimeout(poll, 2500);
    });
  }

  function setConnected(ok) {
    el.connBadge.textContent = ok ? "онлайн" : "нет связи";
    el.connBadge.className = "badge " + (ok ? "on" : "off");
    el.myStatus.textContent = ok ? statusLabel() : "связь потеряна";
  }

  function findUser(nick) {
    if (!nick) return null;
    var key = nick.toLowerCase();
    for (var i = 0; i < state.users.length; i++) {
      if (state.users[i].nick.toLowerCase() === key) return state.users[i];
    }
    return null;
  }

  function displayOf(nick) {
    var u = findUser(nick);
    return u && u.displayName ? u.displayName : nick;
  }

  function avatarOf(nick) {
    var u = findUser(nick);
    return u && u.avatar ? u.avatar : 1;
  }

  function isMine(msg) {
    return msg.from.toLowerCase() === state.nick.toLowerCase();
  }

  function chatKeyOf(msg) {
    if (!msg.to) return "";
    var addr = String(msg.to);
    if (isGroupTarget(addr) || isChannelTarget(addr)) return addr;
    return isMine(msg) ? msg.to : msg.from;
  }

  function isChannelTarget(value) {
    return String(value || "").indexOf("ch:") === 0;
  }

  function isGroupTarget(value) {
    return String(value || "").indexOf("g:") === 0;
  }

  function groupOf(id) {
    var want = String(id || "").replace(/^g:/, "");
    var list = state.groups || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === want) return list[i];
    }
    return null;
  }

  function groupTitle(target) {
    var g = groupOf(target);
    return g ? g.title : "Группа";
  }

  function channelOf(id) {
    var want = String(id || "").replace(/^ch:/, "");
    for (var i = 0; i < state.channels.length; i++) {
      if (state.channels[i].id === want) return state.channels[i];
    }
    return null;
  }

  function channelTitle(target) {
    var ch = channelOf(target);
    return ch ? ch.title : "Канал";
  }

  function totalUnread() {
    var sum = 0;
    for (var k in state.unread) sum += state.unread[k] || 0;
    return sum;
  }

  function updateTitle() {
    if (!settings.titleUnread || !state.nick) {
      document.title = "Прикс — мессенджер";
      return;
    }
    var n = totalUnread();
    document.title = n > 0 ? "(" + n + ") Прикс" : "Прикс — мессенджер";
  }

  function chatPeople() {
    var last = {};
    var preview = {};
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      if (!m.to) continue;
      if (isChannelTarget(m.to) || isGroupTarget(m.to)) continue;
      var other = isMine(m) ? m.to : m.from;
      if (!other) continue;
      var key = other.toLowerCase();
      if (key === state.nick.toLowerCase()) continue;
      if (!last[key] || m.ts > last[key]) { last[key] = m.ts; preview[key] = m.text; }
    }
    var out = [];
    for (var nick in last) {
      var found = findUser(nick);
      out.push({
        nick: found ? found.nick : nick,
        online: found ? !!found.online : false,
        avatar: found ? found.avatar : 1,
        displayName: found ? (found.displayName || found.nick) : nick,
        last: last[nick],
        preview: preview[nick] || ""
      });
    }
    out.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    return out;
  }

  function avatarNode(entry, cls) {
    var av = document.createElement("span");
    av.className = "avatar small" + (cls ? " " + cls : "");
    if (entry.custom) return av;
    av.classList.add(entry.cls || avatarClass(entry.avatar));
    av.textContent = (entry.letter || "?").charAt(0).toUpperCase();
    return av;
  }

  function renderChatList() {
    if (!el.chatList) return;
    el.chatList.innerHTML = "";

    if (state.tab === "all" && folderAllows("", 0)) {
      var general = document.createElement("button");
      general.className = "chat-item" + (state.chat === "" ? " active" : "");
      var gav = document.createElement("span");
      gav.className = "avatar small hash";
      gav.textContent = "#";
      general.appendChild(gav);
      var gtext = document.createElement("span");
      gtext.className = "chat-item-text";
      var gname = document.createElement("span");
      gname.className = "chat-item-name";
      gname.textContent = "Общий чат";
      var glast = document.createElement("span");
      glast.className = "chat-item-last";
      var globalMsgs = state.messages.filter(function (m) { return !m.to; });
      glast.textContent = globalMsgs.length ? globalMsgs[globalMsgs.length - 1].text : "все пользователи";
      gtext.appendChild(gname);
      gtext.appendChild(glast);
      general.appendChild(gtext);
      general.onclick = function () { openChat(""); };
      el.chatList.appendChild(general);
    }

    var source = state.tab === "friends" ? state.friends : chatPeople();
    var query = state.query.toLowerCase();
    var shown = 0;

    if (state.tab === "all") {
      for (var c = 0; c < state.channels.length; c++) {
        var ch = state.channels[c];
        var chKey = "ch:" + ch.id;
        if (!folderAllows(chKey, state.unread[chKey] || 0)) continue;
        if (query && ch.title.toLowerCase().indexOf(query) < 0 && ch.id.toLowerCase().indexOf(query) < 0) continue;
        var chCount = state.unread[chKey] || 0;
        var chMsgs = state.messages.filter(function (m) { return String(m.to || "") === "ch:" + ch.id; });
        var chBtn = document.createElement("button");
        chBtn.className = "chat-item" + (state.chat === chKey ? " active" : "");
        var chAv = document.createElement("span");
        chAv.className = "avatar small chan";
        chAv.textContent = "#";
        chBtn.appendChild(chAv);
        var chText = document.createElement("span");
        chText.className = "chat-item-text";
        var chName = document.createElement("span");
        chName.className = "chat-item-name";
        chName.textContent = ch.title;
        if (ch.verified) {
          var chTick = document.createElement("span");
          chTick.className = "verif";
          chTick.textContent = "✓";
          chTick.title = "канал проверен";
          chName.appendChild(chTick);
        }
        var chLast = document.createElement("span");
        chLast.className = "chat-item-last";
        if (chCount > 0) chLast.textContent = chCount + " новых";
        else if (chMsgs.length) chLast.textContent = chMsgs[chMsgs.length - 1].text;
        else chLast.textContent = "канал · " + ch.members + " участн.";
        chText.appendChild(chName);
        chText.appendChild(chLast);
        chBtn.appendChild(chText);
        if (chCount > 0) {
          var chBadge = document.createElement("span");
          chBadge.className = "chat-item-badge";
          chBadge.textContent = chCount;
          chBtn.appendChild(chBadge);
        }
        chBtn.onclick = (function (id) {
          return function () { openChat("ch:" + id); };
        })(ch.id);
        el.chatList.appendChild(chBtn);
        shown++;
      }
    }

    if (state.tab === "all") {
      var groupsList = state.groups || [];
      for (var gi = 0; gi < groupsList.length; gi++) {
        var gr = groupsList[gi];
        var gKey = "g:" + gr.id;
        if (!folderAllows(gKey, state.unread[gKey] || 0)) continue;
        if (query && gr.title.toLowerCase().indexOf(query) < 0) continue;
        var gCount = state.unread[gKey] || 0;
        var gMsgs = state.messages.filter(function (m) { return String(m.to || "") === gKey; });
        var gBtn = document.createElement("button");
        gBtn.className = "chat-item" + (state.chat === gKey ? " active" : "");
        var gAv = document.createElement("span");
        gAv.className = "avatar small grp";
        gAv.textContent = gr.title.charAt(0).toUpperCase();
        gBtn.appendChild(gAv);
        var gText = document.createElement("span");
        gText.className = "chat-item-text";
        var gName = document.createElement("span");
        gName.className = "chat-item-name";
        gName.textContent = gr.title;
        var gLast = document.createElement("span");
        gLast.className = "chat-item-last";
        if (gCount > 0) gLast.textContent = gCount + " новых";
        else if (gMsgs.length) gLast.textContent = gMsgs[gMsgs.length - 1].text || "фото";
        else gLast.textContent = "группа · " + gr.members + " участн.";
        gText.appendChild(gName);
        gText.appendChild(gLast);
        gBtn.appendChild(gText);
        if (gCount > 0) {
          var gBadge = document.createElement("span");
          gBadge.className = "chat-item-badge";
          gBadge.textContent = gCount;
          gBtn.appendChild(gBadge);
        }
        gBtn.onclick = (function (id) {
          return function () { openChat("g:" + id); };
        })(gr.id);
        el.chatList.appendChild(gBtn);
        shown++;
      }
    }

    for (var i = 0; i < source.length; i++) {
      var u = source[i];
      if (!u || !u.nick) continue;
      if (u.nick.toLowerCase() === state.nick.toLowerCase()) continue;
      var label = u.displayName || u.nick;
      if (!folderAllows(u.nick, state.unread[u.nick.toLowerCase()] || 0)) continue;
      if (query && (label.toLowerCase().indexOf(query) < 0 && u.nick.toLowerCase().indexOf(query) < 0)) continue;

      var item = document.createElement("button");
      item.className = "chat-item" + (u.nick.toLowerCase() === state.chat.toLowerCase() ? " active" : "");
      item.appendChild(avatarNode({ avatar: u.avatar, letter: label }));

      var text = document.createElement("span");
      text.className = "chat-item-text";
      var name = document.createElement("span");
      name.className = "chat-item-name";
      name.textContent = label;
      var last = document.createElement("span");
      last.className = "chat-item-last";
      var count = state.unread[u.nick.toLowerCase()] || 0;
      if (count > 0) last.textContent = count + " новых";
      else if (u.preview) last.textContent = u.preview;
      else if (u.status === "dnd") last.textContent = "не беспокоить";
      else if (u.customStatus) last.textContent = u.customStatus;
      else last.textContent = u.online ? "в сети" : "не в сети";
      text.appendChild(name);
      text.appendChild(last);
      item.appendChild(text);

      if (count > 0) {
        var badge = document.createElement("span");
        badge.className = "chat-item-badge";
        badge.textContent = count;
        item.appendChild(badge);
      }

      if (state.tab === "friends") {
        var del = document.createElement("span");
        del.className = "chat-item-del";
        del.title = "Убрать из друзей";
        del.textContent = "×";
        del.onclick = (function (nick) {
          return function (ev) {
            ev.stopPropagation();
            removeFriend(nick);
          };
        })(u.nick);
        item.appendChild(del);
      }

      item.onclick = (function (nick) {
        return function () { openChat(nick); };
      })(u.nick);
      el.chatList.appendChild(item);
      shown++;
    }

    if (!shown) {
      el.sideHint.textContent = query
        ? "Никого не нашли по «" + state.query + "»"
        : (state.tab === "friends"
          ? "Друзей пока нет: впиши ник в поиск и нажми Enter"
          : "Переписок пока нет: открой «Друзья» и добавь ник");
    } else {
      el.sideHint.textContent = "";
    }
  }

  function openChat(nick) {
    state.chat = nick || "";
    state.unread[state.chat.toLowerCase()] = 0;
    var ch = isChannelTarget(nick) ? channelOf(nick) : null;
    var gr = isGroupTarget(nick) ? groupOf(nick) : null;
    if (ch) {
      el.chatTitle.textContent = ch.title;
      if (ch.verified) {
        var tick = document.createElement("span");
        tick.className = "verif";
        tick.textContent = "✓";
        el.chatTitle.appendChild(tick);
      }
      el.chatSub.textContent = "канал · " + ch.members + " участн.";
      el.chatAvatar.className = "avatar small chan";
      el.chatAvatar.textContent = "#";
      el.chatAvatar.style.backgroundImage = "";
    } else if (gr) {
      el.chatTitle.textContent = gr.title;
      el.chatSub.textContent = "группа · " + gr.members + " участн.";
      el.chatAvatar.className = "avatar small grp";
      el.chatAvatar.textContent = gr.title.charAt(0).toUpperCase();
      el.chatAvatar.style.backgroundImage = "";
    } else {
      el.chatTitle.textContent = nick ? displayOf(nick) : "Общий чат";
      el.chatSub.textContent = nick ? "@" + nick : "все пользователи";
      var peer = nick ? findUser(nick) : null;
      if (peer && peer.owner) {
        var own = document.createElement("span");
        own.className = "owner-badge";
        own.textContent = "главный админ";
        el.chatSub.appendChild(own);
      }
      var av = el.chatAvatar;
      if (nick) {
        av.className = "avatar small " + avatarClass(avatarOf(nick));
        av.textContent = displayOf(nick).charAt(0).toUpperCase();
      } else {
        av.className = "avatar small hash";
        av.textContent = "#";
      }
    }
    el.app.classList.add("show-chat");
    renderChatList();
    loadHistory(state.chat);
    if (el.text) el.text.focus();
  }

  function messagesFor(chat) {
    if (isChannelTarget(chat) || isGroupTarget(chat)) {
      var asked = String(chat);
      return state.messages.filter(function (m) { return String(m.to || "") === asked; });
    }
    return state.messages.filter(function (m) {
      if (!chat) return !m.to;
      if (isChannelTarget(m.to) || isGroupTarget(m.to)) return false;
      var a = m.from.toLowerCase();
      var b = (m.to || "").toLowerCase();
      var me = state.nick.toLowerCase();
      var other = chat.toLowerCase();
      return (a === me && b === other) || (a === other && b === me);
    });
  }

  function renderMessages() {
    if (!el.messages) return;
    var list = messagesFor(state.chat);
    var box = el.messages;
    var prevTop = box.scrollTop;
    var prevHeight = box.scrollHeight;
    var atBottom = prevTop + box.clientHeight >= prevHeight - 40;
    box.innerHTML = "";

    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var wrap = document.createElement("div");
      wrap.className = "msg " + (isMine(m) ? "msg-out" : "msg-in");

      var meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = isMine(m) ? "ты" : displayOf(m.from);
      wrap.appendChild(meta);

      var body = document.createElement("div");
      body.className = "msg-body";
      if (m.img && settings.photoAuto !== false) {
        var pic = document.createElement("img");
        pic.className = "msg-img";
        pic.src = m.img;
        pic.alt = "фото";
        pic.loading = "lazy";
        pic.onclick = (function (src) {
          return function () { window.open(src, "_blank", "noopener"); };
        })(m.img);
        body.appendChild(pic);
      } else if (m.img) {
        var stub = document.createElement("button");
        stub.type = "button";
        stub.className = "btn ghost small";
        stub.textContent = "открыть фото";
        stub.onclick = (function (src) {
          return function () { window.open(src, "_blank", "noopener"); };
        })(m.img);
        body.appendChild(stub);
      }
      if (m.text) {
        var textNode = document.createElement("div");
        textNode.className = "msg-text";
        textNode.textContent = m.text;
        body.appendChild(textNode);
      }
      if (!m.text && !m.img) body.textContent = "";
      wrap.appendChild(body);

      var time = document.createElement("div");
      time.className = "msg-time";
      time.textContent = timeText(m.ts);
      wrap.appendChild(time);

      el.messages.appendChild(wrap);
    }

    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "side-hint";
      empty.textContent = state.chat ? "Сообщений пока нет — напиши первым" : "В общем чате пока тихо";
      el.messages.appendChild(empty);
    }

    if (atBottom) {
      el.messages.scrollTop = el.messages.scrollHeight;
    } else {
      var grown = el.messages.scrollHeight - prevHeight;
      el.messages.scrollTop = prevTop + (grown > 0 ? grown : 0);
    }
  }

  function setTab(tab) {
    state.tab = tab === "friends" ? "friends" : "all";
    el.tabAll.classList.toggle("active", state.tab === "all");
    el.tabFriends.classList.toggle("active", state.tab === "friends");
    renderChatList();
    if (state.tab === "friends") loadFriends();
  }

  function loadFriends() {
    if (!state.token) return;
    api("friends", { token: state.token }).then(function (res) {
      if (!res || !res.ok) return;
      state.friends = res.friends || [];
      renderChatList();
    }).catch(function () { });
  }

  function addFriend(nick) {
    if (!nick) return;
    api("friend-add", { token: state.token, nick: nick }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "не получилось"); return; }
      el.search.value = "";
      state.query = "";
      toast("в друзьях: " + nick);
      loadFriends();
    }).catch(function () { toast("нет связи, попробуйте ещё раз"); });
  }

  function removeFriend(nick) {
    if (!nick) return;
    api("friend-remove", { token: state.token, nick: nick }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "не получилось"); return; }
      toast("убрали из друзей: " + nick);
      loadFriends();
    }).catch(function () { toast("нет связи, попробуйте ещё раз"); });
  }

  function sendMessage(payload) {
    var request = { token: state.token, to: state.chat };
    if (payload && payload.text) request.text = payload.text;
    if (payload && payload.img) request.img = payload.img;
    return api("send", request).then(function (res) {
      if (!res || !res.ok) {
        toast((res && res.error) || "не отправилось");
        return res;
      }
      if (res.message && addMessages([res.message])) {
        renderMessages();
        renderChatList();
        updateTitle();
      }
      return res;
    });
  }

  function send() {
    var text = el.text.value.trim();
    if (!text) return;
    el.text.value = "";
    sendMessage({ text: text }).catch(function () {
      if (!el.text.value) el.text.value = text;
      toast("нет связи, попробуйте ещё раз");
    });
  }

  function resizeImage(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
          var w = Math.max(1, Math.round((img.width || 1) * scale));
          var h = Math.max(1, Math.round((img.height || 1) * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.82);
          resolve({ type: "jpeg", data: String(dataUrl).split(",")[1] });
        };
        img.onerror = function () { reject(new Error("битая картинка")); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error("не прочитать файл")); };
      reader.readAsDataURL(file);
    });
  }

  function handlePhoto(file) {
    if (!file) return;
    if (!/^image\//.test(String(file.type || ""))) { toast("это не картинка"); return; }
    var maxSide = settings.photoSize === "low" ? 1280 : 1920;
    toast("отправляю фото…");
    resizeImage(file, maxSide).then(function (payload) {
      return api("upload", { token: state.token, type: payload.type, image: payload.data });
    }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "фото не загрузилось"); return; }
      return sendMessage({ img: res.url });
    }).catch(function () {
      toast("не удалось отправить фото");
    });
  }

  function syncProfileUi() {
    var label = profile.name || state.nick || "Гость";
    if (el.myNick) el.myNick.textContent = label;
    if (el.myStatus) el.myStatus.textContent = statusLabel();
    if (el.myAvatar) {
      var letter = label.charAt(0);
      el.myAvatar.className = "avatar " + avatarClass(profile.avatar);
      el.myAvatar.textContent = letter.toUpperCase();
      if (profile.photo) {
        el.myAvatar.style.backgroundImage = "url(" + profile.photo + ")";
        el.myAvatar.style.backgroundSize = "cover";
        el.myAvatar.style.color = "transparent";
      } else {
        el.myAvatar.style.backgroundImage = "";
        el.myAvatar.style.color = "";
      }
    }
    if (el.setName) el.setName.textContent = label;
    var isOwner = !!(state.me && state.me.owner);
    if ($("set-owner-badge")) $("set-owner-badge").classList.toggle("hidden", !isOwner);
    if ($("set-owner-badge2")) $("set-owner-badge2").classList.toggle("hidden", !isOwner);
    if (el.setNick) el.setNick.textContent = "@" + (state.nick || "username");
    if (el.setStatus) {
      el.setStatus.className = "status-pill " + (profile.status === "dnd" ? "dnd" : profile.status === "custom" ? "custom" : "");
      el.setStatus.innerHTML = "";
      var dot = document.createElement("span");
      dot.className = "dot";
      var txt = document.createElement("span");
      txt.textContent = statusLabel();
      el.setStatus.appendChild(dot);
      el.setStatus.appendChild(txt);
    }
    if (el.setAv) {
      el.setAv.className = "avatar lg " + avatarClass(profile.avatar);
      el.setAv.textContent = label.charAt(0).toUpperCase();
      if (profile.photo) {
        el.setAv.style.backgroundImage = "url(" + profile.photo + ")";
        el.setAv.style.backgroundSize = "cover";
        el.setAv.style.color = "transparent";
      } else {
        el.setAv.style.backgroundImage = "";
        el.setAv.style.color = "";
      }
    }
    if (el.setNameIn) el.setNameIn.value = label;
    if (el.setNickIn) el.setNickIn.value = state.nick || "";
    var name2 = $("set-name2");
    if (name2) name2.textContent = label;
    var nick2 = $("set-nick2");
    if (nick2) nick2.textContent = "@" + (state.nick || "username");
    var av2 = $("set-av2");
    if (av2) {
      av2.className = "avatar lg " + avatarClass(profile.avatar);
      av2.textContent = label.charAt(0).toUpperCase();
      if (profile.photo) {
        av2.style.backgroundImage = "url(" + profile.photo + ")";
        av2.style.backgroundSize = "cover";
        av2.style.color = "transparent";
      } else {
        av2.style.backgroundImage = "";
        av2.style.color = "";
      }
    }
    var st2 = $("set-status2");
    if (st2 && el.setStatus) {
      st2.className = el.setStatus.className;
      st2.innerHTML = el.setStatus.innerHTML;
    }
    markAvatarPicks();
    markStatusSeg();
  }

  function markAvatarPicks() {
    ["avatar-pick", "avatar-pick2"].forEach(function (id) {
      var box = $(id);
      if (!box) return;
      var picks = box.querySelectorAll(".pick[data-av]");
      for (var i = 0; i < picks.length; i++) {
        picks[i].classList.toggle("active", parseInt(picks[i].getAttribute("data-av"), 10) === profile.avatar);
      }
    });
  }

  function markStatusSeg() {
    var seg = $("status-seg");
    if (!seg) return;
    var btns = seg.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-st") === profile.status);
    }
    var wrap = $("custom-status-wrap");
    if (wrap) wrap.classList.toggle("hidden", profile.status !== "custom");
    if ($("set-custom-status") && $("set-custom-status").value === "" && profile.custom) {
      $("set-custom-status").value = profile.custom;
    }
  }

  function syncSettingsUi() {
    var themeBtns = el.themeSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].classList.toggle("active", themeBtns[i].getAttribute("data-v") === settings.theme);
    }
    var accentDots = el.accentRow.querySelectorAll(".acc-dot");
    for (var j = 0; j < accentDots.length; j++) {
      accentDots[j].classList.toggle("active", accentDots[j].getAttribute("data-accent") === settings.accent);
    }
    var fontCards = el.fontRow.querySelectorAll(".fontcard");
    for (var f = 0; f < fontCards.length; f++) {
      fontCards[f].classList.toggle("active", fontCards[f].getAttribute("data-v") === settings.font);
    }
    el.fsRange.value = settings.fsIndex;
    el.fsOut.textContent = FS_LABELS[settings.fsIndex];
    el.radRange.value = settings.radius;
    el.radOut.textContent = settings.radius + " px";
    el.compactChk.checked = !!settings.compact;
    el.enterChk.checked = !!settings.enterSend;
    el.prHideOnline.checked = !!settings.privacy.hideOnline;
    el.prInviteOnly.checked = !!settings.privacy.inviteOnly;
    el.prVanish.checked = !!settings.privacy.vanish;
    el.notifSound.checked = !!settings.sound;
    el.notifVibe.checked = !!settings.vibe;
    el.notifPreview.checked = !!settings.preview;
    el.setVolume.value = settings.volume;
    el.volumeValue.textContent = settings.volume + "%";
  }

  function buildAccents() {
    el.accentRow.innerHTML = "";
    for (var i = 0; i < ACCENTS.length; i++) {
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "acc-dot";
      dot.style.background = ACCENTS[i];
      dot.setAttribute("data-accent", ACCENTS[i]);
      dot.setAttribute("aria-label", "акцент " + ACCENTS[i]);
      dot.onclick = (function (color) {
        return function () {
          settings.accent = color;
          applySettings();
          saveSettings();
          syncSettingsUi();
        };
      })(ACCENTS[i]);
      el.accentRow.appendChild(dot);
    }
  }

  var PANE_TITLES = {
    profile: "Профиль",
    security: "Безопасность",
    blocked: "Чёрный список",
    folders: "Папки",
    moderation: "Модерация",
    media: "Медиа",
    data: "Данные и память",
    sessions: "Сессии",
    notify: "Уведомления",
    devices: "Устройства",
    look: "Оформление",
    keys: "Сочетания клавиш",
    about: "О приложении"
  };

  function showPane(name) {
    var pane = PANE_TITLES[name] ? name : "profile";
    var panes = document.querySelectorAll("#settings .pane");
    for (var i = 0; i < panes.length; i++) {
      panes[i].classList.toggle("active", panes[i].getAttribute("data-pane") === pane);
    }
    var items = el.setsList.querySelectorAll(".sets-item");
    for (var j = 0; j < items.length; j++) {
      items[j].classList.toggle("active", items[j].getAttribute("data-pane") === pane);
    }
    if (el.setsTitle) el.setsTitle.textContent = PANE_TITLES[pane];
    if (el.sets) el.sets.classList.add("pane-open");
    if (el.setsBody) el.setsBody.scrollTop = 0;
    if (pane === "devices" || pane === "about") syncDevicesUi();
    if (pane === "security" || pane === "blocked") syncBlockedUi();
    if (pane === "folders") syncFoldersUi();
    if (pane === "moderation") syncModerationUi();
    if (pane === "media") syncMediaUi();
    if (pane === "data") syncDataUi();
    if (pane === "sessions") loadSessions();
    if (pane === "profile") syncBioUi();
  }

  function syncDevicesUi() {
    var ua = navigator.userAgent || "";
    var browser = "Браузер";
    if (/Edg\//.test(ua)) browser = "Microsoft Edge";
    else if (/YaBrowser/.test(ua)) browser = "Яндекс Браузер";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
    if ($("devBrowser")) $("devBrowser").textContent = browser + " · " + (navigator.platform || "веб");
    if ($("devNick")) $("devNick").textContent = state.nick ? "@" + state.nick : "—";
  }

  function openSettings(pane) {
    el.settings.classList.remove("hidden");
    syncSettingsUi();
    syncProfileUi();
    syncAccountUi();
    showPane(pane || "profile");
  }

  function closeSettings() {
    el.settings.classList.add("hidden");
    if (el.sets) el.sets.classList.remove("pane-open");
  }

  function setRail(activeId) {
    ["railChats", "railContacts", "railSettings"].forEach(function (id) {
      var node = $(id);
      if (node) node.classList.toggle("active", id === activeId);
    });
  }

  function wireAvatarPick(boxId) {
    var box = $(boxId);
    if (!box) return;
    var picks = box.querySelectorAll(".pick[data-av]");
    for (var i = 0; i < picks.length; i++) {
      picks[i].addEventListener("click", function () {
        var value = parseInt(this.getAttribute("data-av"), 10);
        profile.avatar = value;
        profile.photo = "";
        saveProfile();
        markAvatarPicks();
        if (state.alive) syncProfileUi();
        else markAvatarPicks();
      });
    }
    var file = box.querySelector("input[type=file]");
    if (file) {
      file.addEventListener("change", function () {
        var f = this.files && this.files[0];
        if (!f) return;
        var reader = new FileReader();
        reader.onload = function () {
          profile.photo = String(reader.result);
          saveProfile();
          if (state.alive) syncProfileUi();
        };
        reader.readAsDataURL(f);
      });
    }
  }

  function loadChannels() {
    if (!state.token) return;
    api("channels", { token: state.token }).then(function (res) {
      if (!res || !res.ok) return;
      state.channels = res.channels || [];
      renderChatList();
    }).catch(function () { });
  }

  function loadGroups() {
    if (!state.token) return;
    api("groups", { token: state.token }).then(function (res) {
      if (!res || !res.ok) return;
      state.groups = res.groups || [];
      renderChatList();
    }).catch(function () { });
  }

  function closePlusMenu() {
    var menu = $("plusMenu");
    if (menu) menu.classList.add("hidden");
  }

  function togglePlusMenu() {
    var menu = $("plusMenu");
    if (!menu) return;
    menu.classList.toggle("hidden");
  }

  function inviteLink() {
    if (!state.alive) return;
    var url = location.origin + location.pathname + "?invite=" + encodeURIComponent(state.nick || "");
    var show = function () { toast("ссылка скопирована: " + url); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(show).catch(function () { toast(url); });
    } else {
      toast(url);
    }
  }

  function plusAction(act) {
    closePlusMenu();
    if (act === "group") { openNewSheet(); setNewTab("group"); return; }
    if (act === "channel") { openNewSheet(); setNewTab("channel"); return; }
    if (act === "find") {
      openNewSheet();
      setNewTab("chat");
      setTimeout(function () { if (el.newQuery) el.newQuery.focus(); }, 60);
      return;
    }
    if (act === "invite") { inviteLink(); return; }
  }

  function openNewSheet() {
    if (!state.alive) return;
    closePlusMenu();
    el.newSheet.classList.remove("hidden");
    setNewTab("chat");
    el.newErr.textContent = "";
    el.chanErr.textContent = "";
    el.chanJoinErr.textContent = "";
    el.newQuery.value = "";
    el.foundCard.classList.add("hidden");
    state.found = null;
    setTimeout(function () { el.newQuery.focus(); }, 30);
  }

  function closeNewSheet() {
    el.newSheet.classList.add("hidden");
  }

  function setNewTab(kind) {
    $("newChatPane").classList.toggle("hidden", kind !== "chat");
    $("newChanPane").classList.toggle("hidden", kind !== "channel");
    $("newGroupPane").classList.toggle("hidden", kind !== "group");
    if (kind === "group") renderGroupPeople();
    var btns = el.newSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-v") === kind);
    }
  }

  function renderGroupPeople() {
    var box = $("grpPeople");
    if (!box) return;
    box.innerHTML = "";
    var seen = {};
    var list = [];
    var friends = state.friends || [];
    for (var f = 0; f < friends.length; f++) {
      if (!friends[f] || !friends[f].nick) continue;
      var fk = friends[f].nick.toLowerCase();
      if (seen[fk]) continue;
      seen[fk] = true;
      list.push(friends[f]);
    }
    var users = state.users || [];
    for (var u = 0; u < users.length; u++) {
      if (!users[u] || !users[u].nick) continue;
      var uk = users[u].nick.toLowerCase();
      if (seen[uk] || uk === String(state.nick || "").toLowerCase()) continue;
      seen[uk] = true;
      list.push(users[u]);
    }
    if (!list.length) {
      box.innerHTML = '<div class="hint">Некого добавить — сначала заведите друзей</div>';
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function (person) {
        var label = document.createElement("label");
        label.className = "folder-line";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = person.nick;
        var span = document.createElement("span");
        span.textContent = (person.displayName || person.nick) + " · @" + person.nick;
        label.appendChild(cb);
        label.appendChild(span);
        box.appendChild(label);
      })(list[i]);
    }
  }

  function createGroup() {
    var titleInput = $("grpTitle");
    var err = $("grpErr");
    if (err) err.textContent = "";
    var title = String(titleInput && titleInput.value || "").trim();
    if (title.length < 2) { if (err) err.textContent = "название: минимум 2 символа"; return; }
    var members = [];
    var boxes = document.querySelectorAll("#grpPeople input[type=checkbox]");
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) members.push(boxes[i].value);
    api("group-create", { token: state.token, title: title, members: members }).then(function (res) {
      if (!res || !res.ok) { if (err) err.textContent = (res && res.error) || "не получилось"; return; }
      state.groups = res.groups || state.groups;
      if (titleInput) titleInput.value = "";
      closeNewSheet();
      renderChatList();
      if (res.group) openChat("g:" + res.group.id);
      toast("Группа «" + title + "» создана");
    }).catch(function () { if (err) err.textContent = "нет связи"; });
  }

  function doLookup() {
    var query = el.newQuery.value.trim();
    el.newErr.textContent = "";
    el.foundCard.classList.add("hidden");
    state.found = null;
    if (!query) { el.newErr.textContent = "введите ник или номер"; return; }
    el.btnFind.disabled = true;
    el.btnFind.textContent = "ищу…";
    api("lookup", { query: query }).then(function (res) {
      el.btnFind.disabled = false;
      el.btnFind.textContent = "Найти";
      if (!res || !res.ok) {
        el.newErr.textContent = (res && res.error) || "ник или номер не найден";
        return;
      }
      state.found = res.user;
      el.foundName.textContent = res.user.displayName || res.user.nick;
      el.foundNick.textContent = "@" + res.user.nick + " · " + (res.user.online ? "в сети" : "не в сети");
      applyAvatar(el.foundAv, res.user.nick, res.user.avatar, "");
      el.foundCard.classList.remove("hidden");
    }).catch(function () {
      el.btnFind.disabled = false;
      el.btnFind.textContent = "Найти";
      el.newErr.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function startChatWithFound() {
    if (!state.found) return;
    var nick = state.found.nick;
    api("friend-add", { token: state.token, nick: nick }).then(function () { loadFriends(); }).catch(function () { });
    closeNewSheet();
    toast("чат с " + nick + " открыт");
    openChat(nick);
  }

  function createChannel() {
    var title = el.chanTitle.value.trim();
    var about = el.chanAbout.value.trim();
    el.chanErr.textContent = "";
    if (title.length < 2) { el.chanErr.textContent = "название минимум 2 символа"; return; }
    el.btnCreateChan.disabled = true;
    el.btnCreateChan.textContent = "создаю…";
    api("channel-create", { token: state.token, title: title, about: about }).then(function (res) {
      el.btnCreateChan.disabled = false;
      el.btnCreateChan.textContent = "Создать канал";
      if (!res || !res.ok) { el.chanErr.textContent = (res && res.error) || "не получилось"; return; }
      el.chanTitle.value = "";
      el.chanAbout.value = "";
      closeNewSheet();
      toast("канал создан: " + res.channel.title);
      loadChannels();
      openChat("ch:" + res.channel.id);
    }).catch(function () {
      el.btnCreateChan.disabled = false;
      el.btnCreateChan.textContent = "Создать канал";
      el.chanErr.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function joinChannel() {
    var raw = el.chanJoin.value.trim();
    el.chanJoinErr.textContent = "";
    var id = raw.replace(/.*ch[:=]/i, "").replace(/[^A-Za-z0-9]/g, "");
    if (!id) { el.chanJoinErr.textContent = "введите код-ссылку канала"; return; }
    el.btnJoinChan.disabled = true;
    el.btnJoinChan.textContent = "вступаю…";
    api("channel-join", { token: state.token, id: id }).then(function (res) {
      el.btnJoinChan.disabled = false;
      el.btnJoinChan.textContent = "Вступить";
      if (!res || !res.ok) { el.chanJoinErr.textContent = (res && res.error) || "канал не найден"; return; }
      el.chanJoin.value = "";
      state.channels = res.channels || state.channels;
      closeNewSheet();
      toast("вступили в канал: " + res.channel.title);
      openChat("ch:" + res.channel.id);
    }).catch(function () {
      el.btnJoinChan.disabled = false;
      el.btnJoinChan.textContent = "Вступить";
      el.chanJoinErr.textContent = "нет связи, попробуйте ещё раз";
    });
  }

  function init() {
    el.onboarding = $("onboarding");
    el.onbDots = $("onbDots");
    el.phone = $("phone");
    el.phoneErr = $("phone-err");
    el.fName = $("f-name");
    el.fNick = $("f-nick");
    el.nameErr = $("name-err");
    el.nickErr = $("nick-err");
    el.password = $("password");
    el.passErr = $("pass-err");
    el.regEmail = $("reg-email");
    el.emailErr = $("email-err");
    el.finishBtn = $("finishAuth");
    el.userErr = $("user-err");
    el.loginNick = $("loginNick");
    el.loginPass = $("loginPass");
    el.loginError = $("loginError");
    el.resetLogin = $("resetLogin");
    el.resetErr = $("resetErr");
    el.resetErr2 = $("resetErr2");
    el.resetHint = $("resetHint");
    el.resetCode = $("resetCode");
    el.resetPass = $("resetPass");
    el.resetStep2 = $("resetStep2");
    el.btnResetSend = $("btnResetSend");
    el.btnResetApply = $("btnResetApply");

    el.app = $("app");
    el.myNick = $("myNick");
    el.myAvatar = $("myAvatar");
    el.myStatus = $("myStatus");
    el.chatList = $("chatList");
    el.sideHint = $("sideHint");
    el.search = $("search");
    el.tabAll = $("tabAll");
    el.tabFriends = $("tabFriends");
    el.messages = $("messages");
    el.chatTitle = $("chatTitle");
    el.chatSub = $("chatSub");
    el.chatAvatar = $("chatAvatar");
    el.connBadge = $("connBadge");
    el.sendForm = $("sendForm");
    el.text = $("text");

    el.settings = $("settings");
    el.sets = $("sets");
    el.setsList = $("setsList");
    el.setsTitle = $("setsTitle");
    el.setsBody = $("setsBody");
    el.setAv = $("set-av");
    el.setName = $("set-name");
    el.setNick = $("set-nick");
    el.setStatus = $("set-status");
    el.setNameIn = $("set-name-in");
    el.setNickIn = $("set-nick-in");
    el.themeSeg = $("theme-seg");
    el.accentRow = $("accent-row");
    el.fontRow = $("font-row");
    el.fsRange = $("fs-range");
    el.fsOut = $("fs-out");
    el.radRange = $("rad-range");
    el.radOut = $("rad-out");
    el.compactChk = $("compact-chk");
    el.enterChk = $("enter-chk");
    el.prHideOnline = $("pr-hideOnline");
    el.prInviteOnly = $("pr-inviteOnly");
    el.prVanish = $("pr-vanish");
    el.notifSound = $("notif-sound");
    el.notifVibe = $("notif-vibe");
    el.notifPreview = $("notif-preview");
    el.setVolume = $("setVolume");
    el.volumeValue = $("volumeValue");
    el.toast = $("toast");

    el.newSheet = $("newSheet");
    el.newSeg = $("newSeg");
    el.newQuery = $("newQuery");
    el.newErr = $("newErr");
    el.btnFind = $("btnFind");
    el.foundCard = $("foundCard");
    el.foundAv = $("foundAv");
    el.foundName = $("foundName");
    el.foundNick = $("foundNick");
    el.chanTitle = $("chanTitle");
    el.chanAbout = $("chanAbout");
    el.chanErr = $("chanErr");
    el.btnCreateChan = $("btnCreateChan");
    el.chanJoin = $("chanJoin");
    el.chanJoinErr = $("chanJoinErr");
    el.btnJoinChan = $("btnJoinChan");

    el.setEmailState = $("set-email-state");
    el.setPhoneState = $("set-phone-state");
    el.setPassState = $("set-pass-state");
    el.setYaState = $("set-ya-state");
    el.btnEmailEdit = $("btnEmailEdit");
    el.setEmailIn = $("set-email-in");
    el.setEmailErr = $("set-email-err");
    el.emailEdit = $("email-edit");
    el.emailCodeWrap = $("email-code-wrap");
    el.setEmailCode = $("set-email-code");
    el.btnPassEdit = $("btnPassEdit");
    el.passEdit = $("pass-edit");
    el.setPassErr = $("set-pass-err");


    loadSettings();
    loadProfile();
    applySettings();
    buildAccents();
    wireAvatarPick("avatar-pick");
    wireAvatarPick("avatar-pick2");
    showStep(1);

    $("phoneNext").addEventListener("click", phoneNext);
    el.phone.addEventListener("keydown", function (e) { if (e.key === "Enter") phoneNext(); });
    $("nickNext").addEventListener("click", nickNext);
    $("backTo1").addEventListener("click", function () { showStep(1); });
    $("backTo2").addEventListener("click", function () { showStep(2); });
    $("finishAuth").addEventListener("click", finishAuth);
    el.password.addEventListener("keydown", function (e) { if (e.key === "Enter") finishAuth(); });
    $("toLogin").addEventListener("click", function () { showStep("login"); el.loginNick.focus(); });
    $("backToStart").addEventListener("click", function () { showStep(1); });
    $("btnLogin").addEventListener("click", doLogin);
    el.loginPass.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("toReset").addEventListener("click", function () {
      el.resetLogin.value = el.loginNick.value.trim();
      el.resetErr.textContent = "";
      el.resetErr2.textContent = "";
      el.resetHint.textContent = "Введи ник, телефон или почту — пришлём код на привязанную почту.";
      showStep("reset");
      el.resetLogin.focus();
    });
    $("toRegister").addEventListener("click", function () { showStep(1); el.phone.focus(); });
    $("resetBack").addEventListener("click", function () { showStep("login"); });
    el.btnResetSend.addEventListener("click", resetSend);
    el.btnResetApply.addEventListener("click", resetApply);
    el.resetLogin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); resetSend(); }
    });
    el.resetPass.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); resetApply(); }
    });
    el.regEmail.addEventListener("keydown", function (e) { if (e.key === "Enter") finishAuth(); });
    $("yaStart").addEventListener("click", startYandex);
    $("yaLogin").addEventListener("click", startYandex);
    $("srvConnect").addEventListener("click", connectServer);
    $("srvAddr").addEventListener("keydown", function (e) { if (e.key === "Enter") connectServer(); });
    checkYandex();

    if (wantsYandexLogin()) {
      clearQueryFlag();
      if (needsServerPicker()) showStep("srv");
      else startYandex();
    } else if (needsServerPicker()) {
      showStep("srv");
    } else if (wantsRegister()) {
      clearQueryFlag();
      showStep(1);
      el.phone.focus();
    }

    $("railChats").addEventListener("click", function () {
      el.app.classList.remove("show-chat");
      setTab("all");
      setRail("railChats");
    });
    $("railContacts").addEventListener("click", function () {
      el.app.classList.remove("show-chat");
      setTab("friends");
      setRail("railContacts");
    });
    $("railSettings").addEventListener("click", openSettings);
    $("btnMe").addEventListener("click", openSettings);
    $("btnChatSettings").addEventListener("click", openSettings);
    $("btnCloseSettings").addEventListener("click", closeSettings);
    $("btnDone").addEventListener("click", closeSettings);

    var privacyFields = { "pv-online": "online", "pv-phone": "phone", "pv-find": "find", "pv-write": "write", "pv-content": "content" };
    for (var pf in privacyFields) {
      (function (nodeId, field) {
        var node = $(nodeId);
        if (!node) return;
        node.addEventListener("change", function () { savePrivacy(field, this.value); });
      })(pf, privacyFields[pf]);
    }
    if ($("btnBlock")) $("btnBlock").addEventListener("click", blockNick);
    if ($("block-nick")) {
      $("block-nick").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); blockNick(); } });
    }
    if ($("btnGoBlocked")) $("btnGoBlocked").addEventListener("click", function () { showPane("blocked"); });

    var setsItems = el.setsList.querySelectorAll(".sets-item");
    for (var si = 0; si < setsItems.length; si++) {
      setsItems[si].addEventListener("click", function () { showPane(this.getAttribute("data-pane")); });
    }
    $("setMeCard").addEventListener("click", function () { showPane("profile"); });
    $("btnSetsBack").addEventListener("click", function () {
      el.sets.classList.remove("pane-open");
      showPane("profile");
      el.sets.classList.remove("pane-open");
    });
    $("btnInvite").addEventListener("click", function () {
      closeSettings();
      openNewSheet();
    });
    $("btnLogout2").addEventListener("click", function () {
      closeSettings();
      backToLogin("");
    });
    el.settings.addEventListener("click", function (e) { if (e.target === el.settings) closeSettings(); });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!el.newSheet.classList.contains("hidden")) { closeNewSheet(); return; }
      if (!el.settings.classList.contains("hidden")) closeSettings();
    });

    $("railTheme").addEventListener("click", function () {
      settings.theme = resolveTheme() === "dark" ? "light" : "dark";
      applySettings();
      saveSettings();
      syncSettingsUi();
    });
    $("railLogout").addEventListener("click", function () { backToLogin(""); });

    $("btnNew").addEventListener("click", function (e) {
      e.stopPropagation();
      togglePlusMenu();
    });
    var plusBtns = document.querySelectorAll("#plusMenu button");
    for (var pb = 0; pb < plusBtns.length; pb++) {
      plusBtns[pb].addEventListener("click", function () { plusAction(this.getAttribute("data-act")); });
    }
    document.addEventListener("click", function (e) {
      if (!e.target.closest("#plusMenu") && !e.target.closest("#btnNew")) closePlusMenu();
    });
    if ($("btnCreateGroup")) $("btnCreateGroup").addEventListener("click", createGroup);

    if ($("media-auto")) {
      $("media-auto").addEventListener("change", function () {
        settings.photoAuto = this.checked;
        saveSettings();
        renderMessages();
      });
    }
    if ($("media-btn")) {
      $("media-btn").addEventListener("change", function () {
        settings.photoShowBtn = this.checked;
        saveSettings();
        applyMediaUi();
      });
    }
    if ($("photo-size-seg")) {
      var sizeBtns = $("photo-size-seg").querySelectorAll(".seg-btn");
      for (var sb = 0; sb < sizeBtns.length; sb++) {
        sizeBtns[sb].addEventListener("click", function () {
          settings.photoSize = this.getAttribute("data-v") === "low" ? "low" : "high";
          saveSettings();
          syncMediaUi();
          toast(this.textContent);
        });
      }
    }
    if ($("btnClearCache")) $("btnClearCache").addEventListener("click", clearCache);
    if ($("btnExport")) $("btnExport").addEventListener("click", exportData);
    if ($("btnSessRefresh")) $("btnSessRefresh").addEventListener("click", loadSessions);
    if ($("btnLogoutOthers")) $("btnLogoutOthers").addEventListener("click", logoutOthers);
    if ($("btnBioSave")) $("btnBioSave").addEventListener("click", saveBio);    if ($("grpTitle")) {
      $("grpTitle").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); createGroup(); }
      });
    }
    $("btnNewClose").addEventListener("click", closeNewSheet);
    el.newSheet.addEventListener("click", function (e) { if (e.target === el.newSheet) closeNewSheet(); });
    var newBtns = el.newSeg.querySelectorAll(".seg-btn");
    for (var nb = 0; nb < newBtns.length; nb++) {
      newBtns[nb].addEventListener("click", function () { setNewTab(this.getAttribute("data-v")); });
    }
    el.btnFind.addEventListener("click", doLookup);
    el.newQuery.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doLookup(); }
    });
    $("btnStartChat").addEventListener("click", startChatWithFound);
    el.btnCreateChan.addEventListener("click", createChannel);
    el.btnJoinChan.addEventListener("click", joinChannel);
    el.chanJoin.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); joinChannel(); }
    });

    el.btnEmailEdit.addEventListener("click", function () {
      el.emailEdit.classList.toggle("hidden");
      el.setEmailErr.textContent = "";
      if (!el.emailEdit.classList.contains("hidden")) el.setEmailIn.focus();
    });

    $("btnEmailSend").addEventListener("click", function () {
      var email = el.setEmailIn.value.trim();
      var btn = $("btnEmailSend");
      el.setEmailErr.textContent = "";
      if (!email) { el.setEmailErr.textContent = "введите адрес почты"; return; }
      btn.disabled = true;
      btn.textContent = "отправляю…";
      api("email-request", { token: state.token, email: email }).then(function (res) {
        btn.disabled = false;
        btn.textContent = "Отправить код";
        if (!res || !res.ok) { el.setEmailErr.textContent = (res && res.error) || "не получилось"; return; }
        el.emailCodeWrap.classList.remove("hidden");
        if (res.sent) {
          el.setEmailErr.textContent = "код отправлен на " + res.email;
        } else {
          el.setEmailErr.textContent = "почта не настроена — код: " + res.code;
          el.setEmailCode.value = res.code;
        }
        el.setEmailCode.focus();
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "Отправить код";
        el.setEmailErr.textContent = "нет связи, попробуйте ещё раз";
      });
    });

    $("btnEmailConfirm").addEventListener("click", function () {
      var code = el.setEmailCode.value.trim();
      el.setEmailErr.textContent = "";
      if (!code) { el.setEmailErr.textContent = "введите код из письма"; return; }
      api("email-verify", { token: state.token, code: code }).then(function (res) {
        if (!res || !res.ok) { el.setEmailErr.textContent = (res && res.error) || "не получилось"; return; }
        if (res.profile) mergeProfile(res.profile);
        syncAccountUi();
        el.emailCodeWrap.classList.add("hidden");
        el.emailEdit.classList.add("hidden");
        el.setEmailCode.value = "";
        toast("почта подтверждена");
      }).catch(function () { el.setEmailErr.textContent = "нет связи, попробуйте ещё раз"; });
    });

    el.btnPassEdit.addEventListener("click", function () {
      el.passEdit.classList.toggle("hidden");
      el.setPassErr.textContent = "";
    });

    $("btnPassSave").addEventListener("click", function () {
      var oldPass = $("set-old-pass").value;
      var newPass = $("set-new-pass").value;
      el.setPassErr.textContent = "";
      if (newPass.length < 4) { el.setPassErr.textContent = "новый пароль минимум 4 символа"; return; }
      api("password-change", { token: state.token, oldPassword: oldPass, password: newPass }).then(function (res) {
        if (!res || !res.ok) { el.setPassErr.textContent = (res && res.error) || "не получилось"; return; }
        if (res.profile) mergeProfile(res.profile);
        $("set-old-pass").value = "";
        $("set-new-pass").value = "";
        el.passEdit.classList.add("hidden");
        syncAccountUi();
        toast("пароль обновлён");
      }).catch(function () { el.setPassErr.textContent = "нет связи, попробуйте ещё раз"; });
    });

    $("btnYaLink").addEventListener("click", function () {
      var acc = state.account || {};
      if (acc.oauth === "yandex") { toast("аккаунт уже привязан к Яндексу"); return; }
      if (state.yandexReady === false) { toast("вход через Яндекс пока недоступен"); return; }
      startYandex();
    });

    $("btnPhoneEdit").addEventListener("click", function () {
      $("phone-edit").classList.toggle("hidden");
      $("set-phone-err").textContent = "";
      if (!$("phone-edit").classList.contains("hidden")) $("set-phone-in").focus();
    });

    $("btnPhoneSave").addEventListener("click", function () {
      var value = $("set-phone-in").value.trim();
      var err = $("set-phone-err");
      err.textContent = "";
      api("profile", { token: state.token, phone: value }).then(function (res) {
        if (!res || !res.ok) { err.textContent = (res && res.error) || "не получилось"; return; }
        if (res.profile) mergeProfile(res.profile);
        syncAccountUi();
        $("phone-edit").classList.add("hidden");
        toast("номер сохранён");
      }).catch(function () { err.textContent = "нет связи, попробуйте ещё раз"; });
    });

    el.tabAll.addEventListener("click", function () { setTab("all"); });
    el.tabFriends.addEventListener("click", function () { setTab("friends"); });
    el.search.addEventListener("input", function () {
      state.query = this.value.trim();
      renderChatList();
    });
    el.search.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var text = el.search.value.trim();
      if (!text) return;
      if (state.tab === "friends") { addFriend(text); return; }
      var first = el.chatList.querySelector(".chat-item");
      if (first) first.click();
    });

    el.text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && settings.enterSend) {
        e.preventDefault();
        send();
      }
    });
    el.sendForm.addEventListener("submit", function (e) { e.preventDefault(); send(); });
    if ($("btnPhoto")) {
      $("btnPhoto").addEventListener("click", function () {
        var pick = $("photoFile");
        if (pick) pick.click();
      });
    }
    if ($("photoFile")) {
      $("photoFile").addEventListener("change", function () {
        var file = this.files && this.files[0];
        this.value = "";
        handlePhoto(file);
      });
    }

    var themeBtns = el.themeSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < themeBtns.length; i++) {
      themeBtns[i].addEventListener("click", function () {
        settings.theme = this.getAttribute("data-v");
        applySettings();
        saveSettings();
        syncSettingsUi();
      });
    }

    var fontCards = el.fontRow.querySelectorAll(".fontcard");
    for (var f = 0; f < fontCards.length; f++) {
      fontCards[f].addEventListener("click", function () {
        settings.font = this.getAttribute("data-v");
        applySettings();
        saveSettings();
        syncSettingsUi();
      });
    }

    el.fsRange.addEventListener("input", function () {
      settings.fsIndex = parseInt(this.value, 10) || 1;
      el.fsOut.textContent = FS_LABELS[settings.fsIndex];
      applySettings();
      saveSettings();
    });
    el.radRange.addEventListener("input", function () {
      settings.radius = parseInt(this.value, 10) || 0;
      el.radOut.textContent = settings.radius + " px";
      applySettings();
      saveSettings();
    });
    el.compactChk.addEventListener("change", function () {
      settings.compact = this.checked;
      applySettings();
      saveSettings();
    });
    el.enterChk.addEventListener("change", function () {
      settings.enterSend = this.checked;
      saveSettings();
    });

    el.prHideOnline.addEventListener("change", function () {
      settings.privacy.hideOnline = this.checked;
      saveSettings();
      if (state.alive) {
        api("profile", { token: state.token, hideOnline: this.checked }).catch(function () { });
      }
    });
    el.prInviteOnly.addEventListener("change", function () {
      settings.privacy.inviteOnly = this.checked;
      saveSettings();
    });
    el.prVanish.addEventListener("change", function () {
      settings.privacy.vanish = this.checked;
      saveSettings();
    });

    el.notifSound.addEventListener("change", function () { settings.sound = this.checked; saveSettings(); });
    el.notifVibe.addEventListener("change", function () { settings.vibe = this.checked; saveSettings(); });
    el.notifPreview.addEventListener("change", function () { settings.preview = this.checked; saveSettings(); });
    el.setVolume.addEventListener("input", function () {
      settings.volume = parseInt(this.value, 10) || 0;
      el.volumeValue.textContent = settings.volume + "%";
      saveSettings();
    });
    $("btnTestSound").addEventListener("click", beep);

    var accHeads = document.querySelectorAll(".acc-head");
    for (var a = 0; a < accHeads.length; a++) {
      accHeads[a].addEventListener("click", function () {
        this.parentNode.classList.toggle("open");
      });
    }

    $("btnEdit").addEventListener("click", function () {
      $("profile-edit").classList.toggle("hidden");
    });

    var statusBtns = $("status-seg").querySelectorAll(".seg-btn");
    for (var s = 0; s < statusBtns.length; s++) {
      statusBtns[s].addEventListener("click", function () {
        profile.status = this.getAttribute("data-st");
        markStatusSeg();
      });
    }
    $("set-custom-status").addEventListener("input", function () {
      profile.custom = this.value;
    });

    $("btnSaveProfile").addEventListener("click", function () {
      var name = el.setNameIn.value.trim();
      if (!name) { $("profile-err").textContent = "имя не может быть пустым"; return; }
      $("profile-err").textContent = "";
      profile.name = name;
      profile.custom = $("set-custom-status").value.trim();
      saveProfile();
      syncProfileUi();
      if (!state.alive) return;
      api("profile", {
        token: state.token,
        displayName: profile.name,
        status: profile.status,
        customStatus: profile.custom,
        avatar: profile.avatar,
        hideOnline: settings.privacy.hideOnline
      }).then(function (res) {
        if (res && res.ok && res.profile) {
          mergeProfile(res.profile);
          syncProfileUi();
          toast("профиль сохранён");
        } else {
          toast((res && res.error) || "не сохранилось");
        }
        loadHistory(state.chat);
      }).catch(function () { toast("нет связи, попробуйте ещё раз"); });
    });

    $("reset-btn").addEventListener("click", function () {
      settings = cloneDefaults();
      saveSettings();
      applySettings();
      syncSettingsUi();
      renderChatList();
      toast("настройки сброшены");
    });

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (settings.theme === "system") applySettings();
      });
    }

    loadFolders();
    renderFolderChips();
    if ($("btnFolderCreate")) $("btnFolderCreate").addEventListener("click", createFolder);
    if ($("btnFolderSave")) $("btnFolderSave").addEventListener("click", saveFolderEditor);
    if ($("folder-title")) {
      $("folder-title").addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); createFolder(); }
      });
    }

    var nick, token;
    try {
      nick = localStorage.getItem("priks.nick");
      token = localStorage.getItem("priks.token");
    } catch (e) { }
    if (fromYandex()) return;
    if (nick && token) {
      api("whoami", { token: token }).then(function (res) {
        if (res && res.ok) {
          if (res.profile) mergeProfile(res.profile);
          enter(res.nick, token);
        } else {
          clearSession();
        }
      }).catch(function () { });
    }
  }

  function wantsYandexLogin() {
    try { return new URLSearchParams(location.search).get("yandex") === "1"; } catch (e) { return false; }
  }

  function clearQueryFlag() {
    try { history.replaceState(null, "", location.pathname); } catch (e) { }
  }

  function connectServer() {
    var raw = $("srvAddr").value;
    var base = normalizeBase(raw);
    if (!base) { $("srvErr").textContent = "введите адрес подключения"; return; }
    $("srvErr").textContent = "";
    $("srvConnect").disabled = true;
    $("srvConnect").textContent = "проверяю…";
    fetch(base + "/auth/status").then(function (r) { return r.json(); }).then(function (res) {
      if (!res || res.ok !== true) throw new Error("bad");
      try { localStorage.setItem("priks.api", base); } catch (e) { }
      location.reload();
    }).catch(function () {
      $("srvConnect").disabled = false;
      $("srvConnect").textContent = "Подключиться";
      $("srvErr").textContent = "не удалось подключиться — проверьте адрес";
    });
  }

  function startYandex() {
    if (state.yandexReady === false) {
      toast("Вход через Яндекс пока недоступен — войди по нику и паролю");
      return;
    }
    if (API_BASE) {
      location.href = API_BASE + "/auth/yandex?return=" + encodeURIComponent(location.origin + location.pathname);
      return;
    }
    location.href = "/auth/yandex";
  }

  function checkYandex() {
    state.yandexReady = null;
    api("auth-status", {}).then(function (res) {
      state.yandexReady = !!(res && res.yandex);
    }).catch(function () { state.yandexReady = null; });
  }

  function wantsRegister() {
    try { return new URLSearchParams(location.search).get("reg") === "1"; } catch (e) { return false; }
  }

  function fromYandex() {
    var raw = String(location.hash || "").replace(/^#/, "");
    if (!raw) return false;
    var params = new URLSearchParams(raw);
    var token = params.get("auth");
    var err = params.get("auth_error");
    if (!token && !err) return false;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
    if (err) {
      showStep("login");
      el.loginError.textContent = err;
      return true;
    }
    state.alive = false;
    api("whoami", { token: token }).then(function (res) {
      if (!res || !res.ok) {
        showStep("login");
        el.loginError.textContent = (res && res.error) || "не получилось войти через Яндекс";
        return;
      }
      if (res.profile) mergeProfile(res.profile);
      enter(res.nick, token);
      toast("вход через Яндекс: " + res.nick);
    }).catch(function () {
      showStep("login");
      el.loginError.textContent = "нет связи, попробуйте ещё раз";
    });
    return true;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
