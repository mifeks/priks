(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var state = {
    nick: "",
    token: "",
    chat: "",
    since: 0,
    messages: [],
    users: [],
    friends: [],
    unread: {},
    query: "",
    tab: "all",
    polling: false,
    alive: false,
    hintTimer: 0,
    toastTimer: 0
  };

  var ACCENTS = ["#b78d4a", "#4d8bff", "#2bd4c2", "#a78bfa", "#e0574d", "#3ba55d", "#e08a3c", "#c2557a"];

  var defaults = {
    theme: "light",
    accent: "#b78d4a",
    fontSize: 16,
    enterSend: true,
    compact: false,
    titleUnread: true,
    sound: true,
    volume: 60
  };

  var settings = {};

  function loadSettings() {
    settings = {};
    for (var k in defaults) settings[k] = defaults[k];
    try {
      var raw = localStorage.getItem("priks.settings");
      if (!raw) return;
      var saved = JSON.parse(raw);
      for (var key in defaults) {
        if (saved[key] !== undefined && saved[key] !== null) settings[key] = saved[key];
      }
    } catch (e) { }
  }

  function saveSettings() {
    try { localStorage.setItem("priks.settings", JSON.stringify(settings)); } catch (e) { }
  }

  function applySettings() {
    document.documentElement.setAttribute("data-theme", settings.theme === "dark" ? "dark" : "light");
    document.documentElement.style.setProperty("--accent", settings.accent);
    document.documentElement.style.setProperty("--fs", settings.fontSize + "px");
    if (el.app) el.app.classList.toggle("compact", !!settings.compact);
  }

  function api(action, data) {
    return fetch("/api/" + action, {
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

  function initial(nick) {
    return (nick || "?").charAt(0).toUpperCase();
  }

  function chatKeyOf(msg) {
    if (!msg.to) return "";
    return msg.from.toLowerCase() === state.nick.toLowerCase() ? msg.to : msg.from;
  }

  function isMine(msg) {
    return msg.from.toLowerCase() === state.nick.toLowerCase();
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

  function toast(text) {
    if (!el.toast) return;
    el.toast.textContent = text;
    el.toast.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.toast.classList.add("hidden"); }, 2600);
  }

  function beep() {
    if (!settings.sound || settings.volume <= 0) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var gain = ctx.createGain();
      var freq = 660;
      gain.gain.value = Math.min(1, settings.volume / 100) * 0.28;
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.2);
      setTimeout(function () { try { ctx.close(); } catch (e) { } }, 400);
    } catch (e) { }
  }

  function enter(nick, token) {
    state.alive = true;
    state.nick = nick;
    state.token = token;
    state.since = 0;
    state.messages = [];
    state.unread = {};
    state.chat = "";
    el.myNick.textContent = nick;
    el.myAvatar.textContent = initial(nick);
    el.login.classList.add("hidden");
    el.app.classList.remove("hidden");
    saveSession();
    updateTitle();
    renderChatList();
    loadHistory("");
    loadFriends();
    poll();
  }

  function backToLogin(message) {
    state.alive = false;
    state.token = "";
    state.nick = "";
    clearSession();
    el.login.classList.remove("hidden");
    el.app.classList.add("hidden");
    el.loginError.textContent = message || "";
    updateTitle();
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
    return added;
  }

  function loadHistory(withNick) {
    api("history", { token: state.token, with: withNick, limit: 200 }).then(function (res) {
      if (!res || !res.ok) { if (res && res.error) backToLogin(res.error); return; }
      addMessages(res.messages || []);
      if (res.users) state.users = res.users;
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
      var added = addMessages(res.messages || []);
      if (added) {
        renderMessages();
        renderChatList();
        beep();
      }
      setConnected(true);
      updateTitle();
      poll();
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
    el.myStatus.textContent = ok ? "в сети" : "связь потеряна";
  }

  function chatPeople() {
    var last = {};
    var preview = {};
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      if (!m.to) continue;
      var other = isMine(m) ? m.to : m.from;
      if (!other) continue;
      var key = other.toLowerCase();
      if (key === state.nick.toLowerCase()) continue;
      if (!last[key] || m.ts > last[key]) { last[key] = m.ts; preview[key] = m.text; }
    }
    var out = [];
    for (var nick in last) {
      var found = null;
      for (var j = 0; j < state.users.length; j++) {
        if (state.users[j].nick.toLowerCase() === nick) { found = state.users[j]; break; }
      }
      out.push({
        nick: found ? found.nick : nick,
        online: found ? !!found.online : false,
        last: last[nick],
        preview: preview[nick] || ""
      });
    }
    out.sort(function (a, b) { return (b.last || 0) - (a.last || 0); });
    return out;
  }

  function renderChatList() {
    if (!el.chatList) return;
    el.chatList.innerHTML = "";

    if (state.tab === "all") {
      var general = document.createElement("button");
      general.className = "chat-item" + (state.chat === "" ? " active" : "");
      general.appendChild(avatarNode("#", "hash"));
      var gt = document.createElement("span");
      gt.className = "chat-item-text";
      var gn = document.createElement("span");
      gn.className = "chat-item-name";
      gn.textContent = "Общий чат";
      var gl = document.createElement("span");
      gl.className = "chat-item-last";
      var globalMsgs = state.messages.filter(function (m) { return !m.to; });
      gl.textContent = globalMsgs.length ? globalMsgs[globalMsgs.length - 1].text : "все пользователи";
      gt.appendChild(gn);
      gt.appendChild(gl);
      general.appendChild(gt);
      general.onclick = function () { openChat(""); };
      el.chatList.appendChild(general);
    }

    var source = state.tab === "friends" ? state.friends : chatPeople();
    var query = state.query.toLowerCase();
    var shown = 0;

    for (var i = 0; i < source.length; i++) {
      var u = source[i];
      if (!u || !u.nick) continue;
      if (u.nick.toLowerCase() === state.nick.toLowerCase()) continue;
      if (query && u.nick.toLowerCase().indexOf(query) < 0) continue;

      var item = document.createElement("button");
      item.className = "chat-item" + (u.nick.toLowerCase() === state.chat.toLowerCase() ? " active" : "");
      item.appendChild(avatarNode(initial(u.nick), ""));

      var text = document.createElement("span");
      text.className = "chat-item-text";
      var name = document.createElement("span");
      name.className = "chat-item-name";
      name.textContent = u.nick;
      var last = document.createElement("span");
      last.className = "chat-item-last";
      var count = state.unread[u.nick.toLowerCase()] || 0;
      if (count > 0) last.textContent = count + " новых";
      else if (u.preview) last.textContent = u.preview;
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

  function avatarNode(text, cls) {
    var av = document.createElement("span");
    av.className = "avatar small" + (cls ? " " + cls : "");
    av.textContent = text;
    return av;
  }

  function openChat(nick) {
    state.chat = nick || "";
    state.unread[state.chat.toLowerCase()] = 0;
    el.chatTitle.textContent = nick || "Общий чат";
    el.chatSub.textContent = nick ? "личные сообщения" : "все пользователи";
    el.chatAvatar.textContent = nick ? initial(nick) : "#";
    el.chatAvatar.className = "avatar small" + (nick ? "" : " hash");
    el.app.classList.add("show-chat");
    renderChatList();
    loadHistory(state.chat);
    if (el.text) el.text.focus();
  }

  function messagesFor(chat) {
    return state.messages.filter(function (m) {
      if (!chat) return !m.to;
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
    var atBottom = el.messages.scrollTop + el.messages.clientHeight >= el.messages.scrollHeight - 40;
    el.messages.innerHTML = "";

    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var wrap = document.createElement("div");
      wrap.className = "msg " + (isMine(m) ? "msg-out" : "msg-in");

      var meta = document.createElement("div");
      meta.className = "msg-meta";
      meta.textContent = isMine(m) ? "ты" : m.from;
      wrap.appendChild(meta);

      var body = document.createElement("div");
      body.className = "msg-body";
      body.textContent = m.text;
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

    if (atBottom) el.messages.scrollTop = el.messages.scrollHeight;
  }

  function setTab(tab) {
    state.tab = tab === "friends" ? "friends" : "all";
    if (el.tabAll) el.tabAll.classList.toggle("active", state.tab === "all");
    if (el.tabFriends) el.tabFriends.classList.toggle("active", state.tab === "friends");
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
      if (!res || !res.ok) { toast(res && res.error ? res.error : "не получилось"); return; }
      if (el.search) el.search.value = "";
      state.query = "";
      toast("в друзьях: " + nick);
      loadFriends();
    }).catch(function () { toast("сервер не отвечает"); });
  }

  function send() {
    var text = el.text.value.trim();
    if (!text) return;
    el.text.value = "";
    api("send", { token: state.token, to: state.chat, text: text }).then(function (res) {
      if (!res || !res.ok) { toast(res && res.error ? res.error : "не отправилось"); return; }
      if (res.message && addMessages([res.message])) {
        renderMessages();
        renderChatList();
        updateTitle();
      }
    }).catch(function () { toast("сервер не отвечает"); });
  }

  function openSettings() {
    el.settings.classList.remove("hidden");
    syncSettingsUi();
  }

  function closeSettings() {
    el.settings.classList.add("hidden");
  }

  function syncSettingsUi() {
    var segs = el.themeSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < segs.length; i++) {
      segs[i].classList.toggle("active", segs[i].getAttribute("data-theme") === settings.theme);
    }
    var dots = el.accentRow.querySelectorAll(".acc-dot");
    for (var j = 0; j < dots.length; j++) {
      dots[j].classList.toggle("active", dots[j].getAttribute("data-accent") === settings.accent);
    }
    el.setFontSize.value = settings.fontSize;
    el.fontSizeValue.textContent = settings.fontSize;
    el.setEnter.checked = !!settings.enterSend;
    el.setCompact.checked = !!settings.compact;
    el.setTitle.checked = !!settings.titleUnread;
    el.setSound.checked = !!settings.sound;
    el.setVolume.value = settings.volume;
    el.volumeValue.textContent = settings.volume + "%";
  }

  function buildAccents() {
    el.accentRow.innerHTML = "";
    for (var i = 0; i < ACCENTS.length; i++) {
      var dot = document.createElement("button");
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

  function init() {
    el.login = $("login");
    el.app = $("app");
    el.nick = $("nick");
    el.password = $("password");
    el.btnLogin = $("btnLogin");
    el.btnRegister = $("btnRegister");
    el.loginError = $("loginError");
    el.serverName = $("serverName");
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
    el.themeSeg = $("themeSeg");
    el.accentRow = $("accentRow");
    el.setFontSize = $("setFontSize");
    el.fontSizeValue = $("fontSizeValue");
    el.setEnter = $("setEnter");
    el.setCompact = $("setCompact");
    el.setTitle = $("setTitle");
    el.setSound = $("setSound");
    el.setVolume = $("setVolume");
    el.volumeValue = $("volumeValue");
    el.toast = $("toast");

    el.serverName.textContent = location.host || "локальный файл";

    loadSettings();
    applySettings();
    buildAccents();

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
    $("btnChatSettings").addEventListener("click", openSettings);
    $("btnCloseSettings").addEventListener("click", closeSettings);
    $("btnDone").addEventListener("click", closeSettings);
    el.settings.addEventListener("click", function (e) { if (e.target === el.settings) closeSettings(); });

    $("railTheme").addEventListener("click", function () {
      settings.theme = settings.theme === "dark" ? "light" : "dark";
      applySettings();
      saveSettings();
      if (!el.settings.classList.contains("hidden")) syncSettingsUi();
    });

    $("railLogout").addEventListener("click", function () { backToLogin(""); });

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

    el.btnLogin.addEventListener("click", function () {
      el.loginError.textContent = "";
      api("login", { nick: el.nick.value, password: el.password.value }).then(function (res) {
        if (!res || !res.ok) { el.loginError.textContent = (res && res.error) || "не вышло"; return; }
        enter(res.nick, res.token);
      }).catch(function () { el.loginError.textContent = "сервер не отвечает"; });
    });

    el.btnRegister.addEventListener("click", function () {
      el.loginError.textContent = "";
      api("register", { nick: el.nick.value, password: el.password.value }).then(function (res) {
        if (!res || !res.ok) { el.loginError.textContent = (res && res.error) || "не вышло"; return; }
        enter(res.nick, res.token);
      }).catch(function () { el.loginError.textContent = "сервер не отвечает"; });
    });

    el.password.addEventListener("keydown", function (e) { if (e.key === "Enter") el.btnLogin.click(); });
    el.nick.addEventListener("keydown", function (e) { if (e.key === "Enter") el.password.focus(); });

    el.text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && settings.enterSend) {
        e.preventDefault();
        send();
      }
    });
    el.sendForm.addEventListener("submit", function (e) { e.preventDefault(); send(); });

    var segs = el.themeSeg.querySelectorAll(".seg-btn");
    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener("click", function () {
        settings.theme = this.getAttribute("data-theme");
        applySettings();
        saveSettings();
        syncSettingsUi();
      });
    }

    el.setFontSize.addEventListener("input", function () {
      settings.fontSize = parseInt(this.value, 10) || 16;
      el.fontSizeValue.textContent = settings.fontSize;
      applySettings();
      saveSettings();
    });
    el.setVolume.addEventListener("input", function () {
      settings.volume = parseInt(this.value, 10) || 0;
      el.volumeValue.textContent = settings.volume + "%";
      saveSettings();
    });
    el.setEnter.addEventListener("change", function () { settings.enterSend = this.checked; saveSettings(); });
    el.setCompact.addEventListener("change", function () { settings.compact = this.checked; applySettings(); saveSettings(); });
    el.setTitle.addEventListener("change", function () { settings.titleUnread = this.checked; saveSettings(); updateTitle(); });
    el.setSound.addEventListener("change", function () { settings.sound = this.checked; saveSettings(); });

    $("btnTestSound").addEventListener("click", beep);
    $("btnReset").addEventListener("click", function () {
      settings = {};
      for (var k in defaults) settings[k] = defaults[k];
      saveSettings();
      applySettings();
      syncSettingsUi();
      renderChatList();
      toast("настройки сброшены");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.settings.classList.contains("hidden")) closeSettings();
    });

    var nick, token;
    try {
      nick = localStorage.getItem("priks.nick");
      token = localStorage.getItem("priks.token");
    } catch (e) { }
    if (nick && token) {
      api("whoami", { token: token }).then(function (res) {
        if (res && res.ok) enter(res.nick, token);
        else clearSession();
      }).catch(function () { });
    }
  }

  function setRail(activeId) {
    var ids = ["railChats", "railContacts", "railSettings"];
    for (var i = 0; i < ids.length; i++) {
      var node = $(ids[i]);
      if (!node) continue;
      node.classList.toggle("active", ids[i] === activeId);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
