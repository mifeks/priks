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
    step: 1,
    reg: { phone: "", name: "", nick: "", avatar: 1, password: "" },
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
    ["p1", "p2", "p3", "loginBox"].forEach(function (id) { $(id).classList.add("hidden"); });
    if (step === "login") {
      $("loginBox").classList.remove("hidden");
      $("onbStep").textContent = "вход";
      ["", "", ""].forEach(function () { });
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
    el.passErr.textContent = "";
    el.userErr.textContent = "";
    if (password.length < 4) { el.passErr.textContent = "пароль минимум 4 символа"; return; }
    state.reg.password = password;
    var payload = {
      nick: state.reg.nick,
      password: password,
      displayName: state.reg.name,
      avatar: state.reg.avatar
    };
    api("register", payload).then(function (res) {
      if (!res || !res.ok) { el.userErr.textContent = (res && res.error) || "не получилось"; return; }
      profile.name = state.reg.name;
      profile.avatar = state.reg.avatar;
      saveProfile();
      enter(res.nick, res.token);
      toast("ник создан: " + res.nick);
    }).catch(function () { el.userErr.textContent = "сервер не отвечает"; });
  }

  function doLogin() {
    el.loginError.textContent = "";
    api("login", { nick: el.loginNick.value, password: el.loginPass.value }).then(function (res) {
      if (!res || !res.ok) { el.loginError.textContent = (res && res.error) || "не вышло"; return; }
      if (res.profile) mergeProfile(res.profile);
      enter(res.nick, res.token);
    }).catch(function () { el.loginError.textContent = "сервер не отвечает"; });
  }

  function mergeProfile(p) {
    if (!p) return;
    if (p.displayName) profile.name = p.displayName;
    if (p.status) profile.status = p.status;
    if (typeof p.customStatus === "string") profile.custom = p.customStatus;
    if (p.avatar) profile.avatar = p.avatar;
    if (p.hideOnline !== undefined) settings.privacy.hideOnline = !!p.hideOnline;
    saveProfile();
    saveSettings();
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
    poll();
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
    return isMine(msg) ? msg.to : msg.from;
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

    if (state.tab === "all") {
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

    for (var i = 0; i < source.length; i++) {
      var u = source[i];
      if (!u || !u.nick) continue;
      if (u.nick.toLowerCase() === state.nick.toLowerCase()) continue;
      var label = u.displayName || u.nick;
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

  function openChat(nick) {
    state.chat = nick || "";
    state.unread[state.chat.toLowerCase()] = 0;
    el.chatTitle.textContent = nick ? displayOf(nick) : "Общий чат";
    el.chatSub.textContent = nick ? "@" + nick : "все пользователи";
    var av = el.chatAvatar;
    if (nick) {
      av.className = "avatar small " + avatarClass(avatarOf(nick));
      av.textContent = displayOf(nick).charAt(0).toUpperCase();
    } else {
      av.className = "avatar small hash";
      av.textContent = "#";
    }
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
      meta.textContent = isMine(m) ? "ты" : displayOf(m.from);
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
    }).catch(function () { toast("сервер не отвечает"); });
  }

  function send() {
    var text = el.text.value.trim();
    if (!text) return;
    el.text.value = "";
    api("send", { token: state.token, to: state.chat, text: text }).then(function (res) {
      if (!res || !res.ok) { toast((res && res.error) || "не отправилось"); return; }
      if (res.message && addMessages([res.message])) {
        renderMessages();
        renderChatList();
        updateTitle();
      }
    }).catch(function () { toast("сервер не отвечает"); });
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

  function openSettings() {
    el.settings.classList.remove("hidden");
    syncSettingsUi();
    syncProfileUi();
  }

  function closeSettings() {
    el.settings.classList.add("hidden");
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
    el.userErr = $("user-err");
    el.loginNick = $("loginNick");
    el.loginPass = $("loginPass");
    el.loginError = $("loginError");
    el.serverName = $("serverName");

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

    el.serverName.textContent = location.host || "локальный файл";

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
    el.settings.addEventListener("click", function (e) { if (e.target === el.settings) closeSettings(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !el.settings.classList.contains("hidden")) closeSettings();
    });

    $("railTheme").addEventListener("click", function () {
      settings.theme = resolveTheme() === "dark" ? "light" : "dark";
      applySettings();
      saveSettings();
      syncSettingsUi();
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

    el.text.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && settings.enterSend) {
        e.preventDefault();
        send();
      }
    });
    el.sendForm.addEventListener("submit", function (e) { e.preventDefault(); send(); });

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
      }).catch(function () { toast("сервер не отвечает"); });
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

    var nick, token;
    try {
      nick = localStorage.getItem("priks.nick");
      token = localStorage.getItem("priks.token");
    } catch (e) { }
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
