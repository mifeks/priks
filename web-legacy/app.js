(function () {
  "use strict";

  var DEFAULTS = {
    theme: "teal",
    sound: true,
    volume: 60,
    enterSend: true,
    titleUnread: true,
    compact: false
  };

  var THEMES = ["teal", "sunset", "lavender", "light"];

  var PREVIEW = /[?&]preview=1/.test(location.search || "");

  var settings = loadSettings();

  var state = {
    nick: "",
    token: "",
    chat: "",
    messages: [],
    users: [],
    friends: [],
    tab: "chats",
    query: "",
    since: 0,
    unread: {},
    polling: false,
    alive: true,
    audio: null
  };

  var el = {};

  function $(id) { return document.getElementById(id); }

  function loadSettings() {
    var result = {};
    for (var k in DEFAULTS) result[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem("priks.settings");
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var key in DEFAULTS) {
          if (parsed[key] !== undefined) result[key] = parsed[key];
        }
      }
    } catch (e) { }
    if (THEMES.indexOf(result.theme) < 0) result.theme = DEFAULTS.theme;
    return result;
  }

  function saveSettings() {
    try { localStorage.setItem("priks.settings", JSON.stringify(settings)); } catch (e) { }
  }

  function applySettings() {
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.documentElement.setAttribute("data-density", settings.compact ? "compact" : "normal");
    syncSettingsUi();
    updateTitle();
  }

  function syncSettingsUi() {
    var swatches = document.querySelectorAll(".theme-swatch");
    for (var i = 0; i < swatches.length; i++) {
      var node = swatches[i];
      if (node.getAttribute("data-theme") === settings.theme) node.classList.add("active");
      else node.classList.remove("active");
    }
    if ($("setSound")) $("setSound").checked = !!settings.sound;
    if ($("setVolume")) $("setVolume").value = settings.volume;
    if ($("volumeValue")) $("volumeValue").textContent = settings.volume + "%";
    if ($("setEnter")) $("setEnter").checked = !!settings.enterSend;
    if ($("setTitle")) $("setTitle").checked = !!settings.titleUnread;
    if ($("setCompact")) $("setCompact").checked = !!settings.compact;
  }

  function beep() {
    if (!settings.sound) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!state.audio) state.audio = new Ctx();
      var ctx = state.audio;
      if (ctx.state === "suspended") ctx.resume();
      var now = ctx.currentTime;
      var volume = Math.pow(Math.max(0, Math.min(1, settings.volume / 100)), 1.4) * 0.12;

      var master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), now + 0.012);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
      master.connect(ctx.destination);

      var filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2600;
      filter.Q.value = 0.5;
      filter.connect(master);

      var notes = [[1174.66, 0, 0.5, 9.0], [880, 0.085, 0.45, 8.0]];
      for (var i = 0; i < notes.length; i++) {
        var freq = notes[i][0], at = notes[i][1], life = notes[i][2], decay = notes[i][3];
        var osc = ctx.createOscillator();
        var env = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + at);
        env.gain.setValueAtTime(0.0001, now + at);
        env.gain.exponentialRampToValueAtTime(i === 0 ? 1 : 0.75, now + at + 0.012);
        env.gain.exponentialRampToValueAtTime(0.0001, now + at + life);
        osc.connect(env);
        env.connect(filter);
        osc.start(now + at);
        osc.stop(now + at + life + 0.02);
      }
    } catch (e) { }
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

  function dayText(ts) {
    var d = new Date(ts);
    var today = new Date();
    var yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    var same = function (a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    };
    if (same(d, today)) return "сегодня";
    if (same(d, yesterday)) return "вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }

  function chatKeyOf(msg) {
    if (!msg.to) return "";
    return msg.from.toLowerCase() === state.nick.toLowerCase() ? msg.to : msg.from;
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

  function enter(nick, token) {
    state.nick = nick;
    state.token = token;
    el.myNick.textContent = nick;
    el.myAvatar.textContent = nick.charAt(0).toUpperCase();
    el.login.classList.add("hidden");
    el.app.classList.remove("hidden");
    saveSession();
    loadHistory("");
    poll();
    loadFriends();
    setTab("chats");
    if (location.hash === "#settings") openSettings();
    if (location.hash === "#friends") setTab("friends");
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
      if (key !== state.chat && m.from.toLowerCase() !== state.nick.toLowerCase()) {
        state.unread[key.toLowerCase()] = (state.unread[key.toLowerCase()] || 0) + 1;
      }
      if (m.id > state.since) state.since = m.id;
    }
    return added;
  }

  function loadHistory(withNick) {
    api("history", { token: state.token, with: withNick, limit: 200 }).then(function (res) {
      if (!res.ok) { if (res.error) backToLogin(res.error); return; }
      addMessages(res.messages || []);
      if (res.users) state.users = res.users;
      renderUsers();
      renderMessages();
      updateTitle();
    });
  }

  function poll() {
    if (!state.alive || state.polling) return;
    state.polling = true;
    api("poll", { token: state.token, since: state.since }).then(function (res) {
      state.polling = false;
      if (!state.alive) return;
      if (!res.ok) {
        if (res.error) backToLogin(res.error);
        return;
      }
      if (res.users) {
        state.users = res.users;
        renderUsers();
      }
      var added = addMessages(res.messages || []);
      if (added) {
        renderMessages();
        beep();
      }
      setConnected(true);
      updateTitle();
      if (!PREVIEW) poll();
    }).catch(function () {
      state.polling = false;
      if (!state.alive) return;
      setConnected(false);
      if (!PREVIEW) setTimeout(poll, 2500);
    });
  }

  function setConnected(ok) {
    el.connBadge.textContent = ok ? "онлайн" : "нет связи";
    el.connBadge.className = ok ? "badge" : "badge off";
    el.myStatus.textContent = ok ? "в сети" : "связь потеряна";
  }

  function renderUsers() {
    el.userList.innerHTML = "";
    var source = state.tab === "friends" ? state.friends : chatPeople();
    var query = state.query.toLowerCase();
    var shown = 0;

    for (var i = 0; i < source.length; i++) {
      var u = source[i];
      if (u.nick.toLowerCase() === state.nick.toLowerCase()) continue;
      if (query && u.nick.toLowerCase().indexOf(query) < 0) continue;

      var item = document.createElement("button");
      item.className = "chat-item";
      if (u.nick.toLowerCase() === state.chat.toLowerCase()) item.className += " active";
      if (state.unread[u.nick.toLowerCase()]) item.className += " unread";

      var av = document.createElement("div");
      av.className = "avatar small";
      av.textContent = u.nick.charAt(0).toUpperCase();
      if (u.online) av.style.borderColor = "rgba(43, 212, 194, .55)";

      var txt = document.createElement("div");
      txt.className = "chat-text";
      var name = document.createElement("div");
      name.className = "chat-name";
      name.textContent = u.nick;
      var last = document.createElement("div");
      last.className = "chat-last";
      var count = state.unread[u.nick.toLowerCase()] || 0;
      last.textContent = count > 0 ? count + " новых" : (u.online ? "в сети" : "не в сети");
      txt.appendChild(name);
      txt.appendChild(last);

      item.appendChild(av);
      item.appendChild(txt);
      item.onclick = (function (nick) {
        return function () { openChat(nick); };
      })(u.nick);
      el.userList.appendChild(item);
      shown++;
    }

    if (!shown) {
      var none = document.createElement("div");
      none.className = "side-hint";
      if (query) none.textContent = "Никого не нашли по «" + query + "»";
      else if (state.tab === "friends") none.textContent = "Друзей пока нет: впиши ник выше и нажми Enter";
      else none.textContent = "Переписок пока нет: найди друга во вкладке Друзья";
      el.userList.appendChild(none);
    }
    updateTitle();
  }

  function chatPeople() {
    var last = {};
    for (var i = 0; i < state.messages.length; i++) {
      var m = state.messages[i];
      if (!m.to) continue;
      var other = m.from.toLowerCase() === state.nick.toLowerCase() ? m.to : m.from;
      if (!other) continue;
      var key = other.toLowerCase();
      if (key === state.nick.toLowerCase()) continue;
      if (!last[key] || m.ts > last[key]) last[key] = m.ts;
    }

    var out = [];
    for (var nick in last) {
      var found = null;
      for (var j = 0; j < state.users.length; j++) {
        if (state.users[j].nick.toLowerCase() === nick) { found = state.users[j]; break; }
      }
      out.push(found || { nick: nick, online: false });
    }
    out.sort(function (a, b) {
      return (last[b.nick.toLowerCase()] || 0) - (last[a.nick.toLowerCase()] || 0);
    });
    return out;
  }

  function setSideHint(text, kind) {
    if (!el.sideHint) return;
    el.sideHint.textContent = text || "";
    el.sideHint.className = "side-hint" + (kind ? " " + kind : "");
    if (text) {
      clearTimeout(state.hintTimer);
      state.hintTimer = setTimeout(function () { setSideHint(""); }, 4000);
    }
  }

  function setTab(tab) {
    state.tab = tab === "friends" ? "friends" : "chats";
    if (el.tabChats) el.tabChats.classList.toggle("active", state.tab === "chats");
    if (el.tabFriends) el.tabFriends.classList.toggle("active", state.tab === "friends");
    renderUsers();
    if (state.tab === "friends") loadFriends();
  }

  function loadFriends() {
    if (!state.token) return;
    api("friends", { token: state.token }).then(function (res) {
      if (!res || !res.ok) return;
      state.friends = res.friends || [];
      renderUsers();
    }).catch(function () { });
  }

  function addFriend(nick) {
    if (!nick) return;
    api("friend-add", { token: state.token, nick: nick }).then(function (res) {
      if (!res || !res.ok) { setSideHint(res && res.error ? res.error : "не получилось", "bad"); return; }
      if (el.search) el.search.value = "";
      state.query = "";
      setSideHint("в друзьях: " + nick, "good");
      loadFriends();
    }).catch(function () { setSideHint("сервер не отвечает", "bad"); });
  }

  function searchGo() {
    var text = el.search ? el.search.value.trim() : "";
    if (!text) return;
    if (state.tab === "friends") { addFriend(text); return; }
    var first = el.userList.querySelector(".chat-item");
    if (first) first.click();
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
    var list = messagesFor(state.chat);
    el.messages.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = state.chat
        ? "Сообщений с <b>" + escapeHtml(state.chat) + "</b> пока нет<br>напиши первым"
        : "Общий чат пуст<br>напиши первым";
      el.messages.appendChild(empty);
      return;
    }

    var lastDay = "";
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var day = dayText(m.ts);
      if (day !== lastDay) {
        lastDay = day;
        var sep = document.createElement("div");
        sep.className = "day";
        sep.textContent = day;
        el.messages.appendChild(sep);
      }

      var mine = m.from.toLowerCase() === state.nick.toLowerCase();
      var box = document.createElement("div");
      box.className = "msg" + (mine ? " mine" : "");

      var head = document.createElement("div");
      head.className = "msg-head";
      var who = document.createElement("span");
      who.className = "msg-from";
      who.textContent = mine ? "ты" : m.from;
      var when = document.createElement("span");
      when.textContent = timeText(m.ts);
      head.appendChild(who);
      head.appendChild(when);

      var text = document.createElement("div");
      text.className = "msg-text";
      text.textContent = m.text;

      box.appendChild(head);
      box.appendChild(text);
      el.messages.appendChild(box);
    }
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function openChat(nick) {
    state.chat = nick || "";
    state.unread[state.chat.toLowerCase()] = 0;
    el.chatTitle.textContent = nick || "Общий чат";
    el.chatSub.textContent = nick ? "личные сообщения" : "все пользователи";
    el.generalChat.classList.toggle("active", !nick);
    document.querySelector(".sidebar").classList.remove("open");
    renderUsers();
    renderMessages();
    updateTitle();
    el.text.focus();
  }

  function openSettings() {
    syncSettingsUi();
    $("settings").classList.remove("hidden");
  }

  function closeSettings() {
    $("settings").classList.add("hidden");
    if (location.hash === "#settings") history.replaceState(null, "", location.pathname);
  }

  function initSettingsUi() {
    var swatches = document.querySelectorAll(".theme-swatch");
    for (var i = 0; i < swatches.length; i++) {
      swatches[i].addEventListener("click", function () {
        settings.theme = this.getAttribute("data-theme");
        saveSettings();
        applySettings();
      });
    }

    $("setSound").addEventListener("change", function () {
      settings.sound = this.checked;
      saveSettings();
    });

    $("setVolume").addEventListener("input", function () {
      settings.volume = parseInt(this.value, 10) || 0;
      $("volumeValue").textContent = settings.volume + "%";
      saveSettings();
    });

    $("btnTestSound").addEventListener("click", function () { beep(); });

    $("setEnter").addEventListener("change", function () {
      settings.enterSend = this.checked;
      saveSettings();
    });

    $("setTitle").addEventListener("change", function () {
      settings.titleUnread = this.checked;
      saveSettings();
      updateTitle();
    });

    $("setCompact").addEventListener("change", function () {
      settings.compact = this.checked;
      saveSettings();
      applySettings();
    });

    $("btnCloseSettings").addEventListener("click", closeSettings);
    $("btnSettingsDone").addEventListener("click", closeSettings);
    $("btnOpenSettings").addEventListener("click", openSettings);
    $("railSettings").addEventListener("click", openSettings);

    $("btnResetSettings").addEventListener("click", function () {
      settings = {};
      for (var k in DEFAULTS) settings[k] = DEFAULTS[k];
      saveSettings();
      applySettings();
    });

    $("railTheme").addEventListener("click", function () {
      var index = THEMES.indexOf(settings.theme);
      settings.theme = THEMES[(index + 1) % THEMES.length];
      saveSettings();
      applySettings();
    });

    $("railChats").addEventListener("click", function () {
      document.querySelector(".sidebar").classList.toggle("open");
    });

    $("railLogout").addEventListener("click", function () {
      backToLogin("вышел из аккаунта");
      el.password.value = "";
    });

    $("settings").addEventListener("click", function (e) {
      if (e.target === this) closeSettings();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSettings();
    });
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
    el.userList = $("userList");
    el.messages = $("messages");
    el.chatTitle = $("chatTitle");
    el.chatSub = $("chatSub");
    el.connBadge = $("connBadge");
    el.sendForm = $("sendForm");
    el.text = $("text");
    el.generalChat = $("generalChat");
    el.search = $("search");
    el.sideHint = $("sideHint");
    el.tabChats = $("tabChats");
    el.tabFriends = $("tabFriends");

    el.serverName.textContent = location.host || "локальный файл";

    applySettings();
    initSettingsUi();

    el.generalChat.addEventListener("click", function () { openChat(""); });

    if (el.tabChats) el.tabChats.addEventListener("click", function () { setTab("chats"); });
    if (el.tabFriends) el.tabFriends.addEventListener("click", function () { setTab("friends"); });

    if (el.search) {
      el.search.addEventListener("input", function () {
        state.query = this.value.trim();
        renderUsers();
      });
      el.search.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); searchGo(); }
      });
    }

    el.btnLogin.addEventListener("click", function () {
      el.loginError.textContent = "";
      api("login", { nick: el.nick.value, password: el.password.value }).then(function (res) {
        if (!res.ok) { el.loginError.textContent = res.error || "не вышло"; return; }
        enter(res.nick, res.token);
      }).catch(function () { el.loginError.textContent = "сервер не отвечает"; });
    });

    el.btnRegister.addEventListener("click", function () {
      el.loginError.textContent = "";
      api("register", { nick: el.nick.value, password: el.password.value }).then(function (res) {
        if (!res.ok) { el.loginError.textContent = res.error || "не вышло"; return; }
        enter(res.nick, res.token);
      }).catch(function () { el.loginError.textContent = "сервер не отвечает"; });
    });

    el.password.addEventListener("keydown", function (e) {
      if (e.key === "Enter") el.btnLogin.click();
    });

    el.nick.addEventListener("keydown", function (e) {
      if (e.key === "Enter") el.password.focus();
    });

    el.text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && settings.enterSend) {
        e.preventDefault();
        el.sendForm.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    el.sendForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = el.text.value.trim();
      if (!text) return;
      el.text.value = "";
      api("send", { token: state.token, to: state.chat, text: text }).then(function (res) {
        if (!res.ok) { setSideHint(res.error || "не отправилось", "bad"); return; }
        if (res.message && addMessages([res.message])) {
          renderMessages();
          updateTitle();
        }
      });
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
