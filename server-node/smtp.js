"use strict";

const net = require("net");
const tls = require("tls");

function wrap76(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 76) out.push(line.slice(i, i + 76));
  return out.length ? out.join("\r\n") : "";
}

function encodeHeader(value) {
  const text = String(value || "");
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return "=?UTF-8?B?" + Buffer.from(text, "utf8").toString("base64") + "?=";
}

function buildMessage(opts) {
  const from = opts.from;
  const to = opts.to;
  const subject = encodeHeader(opts.subject || "Прикс");
  const body = wrap76(Buffer.from(String(opts.text || ""), "utf8").toString("base64"));
  return [
    "From: " + opts.fromName + " <" + from + ">",
    "To: <" + to + ">",
    "Subject: " + subject,
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + Date.now() + "." + Math.random().toString(36).slice(2) + "@priks>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
}

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.waiters = [];
    this.dead = null;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.pump();
    });
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new Error("соединение закрыто сервером")));
  }

  fail(err) {
    this.dead = this.dead || err;
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w.reject(err);
  }

  take() {
    const lines = [];
    let idx = 0;
    while (true) {
      const nl = this.buffer.indexOf("\r\n", idx);
      if (nl < 0) return null;
      const line = this.buffer.slice(idx, nl);
      lines.push(line);
      idx = nl + 2;
      if (!/^\d{3}-/.test(line)) {
        this.buffer = this.buffer.slice(idx);
        const code = parseInt(line.slice(0, 3), 10);
        return { code: Number.isFinite(code) ? code : 0, lines: lines };
      }
    }
  }

  pump() {
    while (this.waiters.length) {
      const res = this.take();
      if (!res) return;
      this.waiters.shift().resolve(res);
    }
  }

  read() {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve: resolve, reject: reject });
      this.pump();
    });
  }

  send(line) {
    this.socket.write(line + "\r\n");
  }

  cmd(line) {
    this.send(line);
    return this.read();
  }

  close() {
    try { this.socket.end(); } catch (e) { }
    setTimeout(() => { try { this.socket.destroy(); } catch (e) { } }, 500);
  }
}

function expect(res, codes, what) {
  if (codes.indexOf(res.code) < 0) {
    throw new Error(what + ": " + res.lines.join(" ").slice(0, 240));
  }
  return res;
}

function connect(host, port, secure, rejectUnauthorized) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host: host, port: port, servername: host, rejectUnauthorized: rejectUnauthorized })
      : net.connect({ host: host, port: port });
    const event = secure ? "secureConnect" : "connect";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("истекло время подключения к SMTP (" + host + ":" + port + ")"));
    }, 15000);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function sendMail(options) {
  const opts = options || {};
  const host = String(opts.host || "").trim();
  const port = parseInt(opts.port, 10) || 465;
  if (!host) throw new Error("SMTP не настроен: нет хоста");
  const secure = opts.secure !== false;
  const socket = await connect(host, port, secure, opts.insecureTLS !== true);
  const conn = new Conn(socket);
  const trace = [];
  try {
    const hello = await conn.read();
    trace.push(hello.code);
    expect(hello, [220], "приветствие SMTP");

    let ehlo = await conn.cmd("EHLO priks.local");
    trace.push(ehlo.code);
    expect(ehlo, [250], "EHLO");
    const caps = ehlo.lines.join("\n").toUpperCase();

    if (!secure && /STARTTLS/.test(caps)) {
      throw new Error("сервер требует STARTTLS — поставь SMTP_SECURE=1 и порт 465");
    }

    if (opts.user && opts.pass) {
      if (/AUTH[^\n]*\bPLAIN\b/.test(caps) && !/AUTH[^\n]*\bLOGIN\b/.test(caps)) {
        const plain = Buffer.from("\u0000" + opts.user + "\u0000" + opts.pass, "utf8").toString("base64");
        const auth = await conn.cmd("AUTH PLAIN " + plain);
        trace.push(auth.code);
        expect(auth, [235], "AUTH PLAIN");
      } else {
        const start = await conn.cmd("AUTH LOGIN");
        trace.push(start.code);
        expect(start, [334], "AUTH LOGIN");
        const userStep = await conn.cmd(Buffer.from(opts.user, "utf8").toString("base64"));
        trace.push(userStep.code);
        expect(userStep, [334], "AUTH логин");
        const passStep = await conn.cmd(Buffer.from(opts.pass, "utf8").toString("base64"));
        trace.push(passStep.code);
        expect(passStep, [235], "AUTH пароль");
      }
    }

    const from = String(opts.from || opts.user || "").trim();
    if (!from) throw new Error("SMTP не настроен: нет адреса отправителя");
    const mail = await conn.cmd("MAIL FROM:<" + from + ">");
    trace.push(mail.code);
    expect(mail, [250], "MAIL FROM");

    const rcpt = await conn.cmd("RCPT TO:<" + String(opts.to || "").trim() + ">");
    trace.push(rcpt.code);
    expect(rcpt, [250, 251], "RCPT TO");

    const data = await conn.cmd("DATA");
    trace.push(data.code);
    expect(data, [354], "DATA");

    const body = buildMessage({
      from: from,
      fromName: encodeHeader(opts.fromName || "Прикс"),
      to: String(opts.to || "").trim(),
      subject: opts.subject,
      text: opts.text
    });
    conn.socket.write(body + "\r\n.\r\n");
    const done = await conn.read();
    trace.push(done.code);
    expect(done, [250], "отправка письма");

    await conn.cmd("QUIT").catch(() => null);
    return { ok: true, trace: trace };
  } finally {
    conn.close();
  }
}

module.exports = { sendMail: sendMail };
