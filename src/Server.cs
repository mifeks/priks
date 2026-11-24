using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace Priks
{
    internal sealed class Message
    {
        public long Id;
        public string From = "";
        public string To = "";
        public string Text = "";
        public long Ts;

        public string Json()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"id\":").Append(Id);
            sb.Append(",\"from\":").Append(Js.Str(From));
            sb.Append(",\"to\":").Append(Js.Str(To));
            sb.Append(",\"text\":").Append(Js.Str(Text));
            sb.Append(",\"ts\":").Append(Ts).Append('}');
            return sb.ToString();
        }
    }

    internal sealed class User
    {
        public string Nick = "";
        public string Salt = "";
        public string Hash = "";
        public long Created;
        public long LastSeen;
    }

    internal sealed class Session
    {
        public string Nick = "";
        public long Seen;
    }

    internal static class Js
    {
        public static string Str(string value)
        {
            if (value == null) return "null";
            StringBuilder sb = new StringBuilder(value.Length + 8);
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }

    internal sealed class Store
    {
        private readonly object gate = new object();
        private readonly Dictionary<string, User> users = new Dictionary<string, User>();
        private readonly List<Message> messages = new List<Message>();
        private readonly Dictionary<string, List<string>> friends = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, long> lastGeneral = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
        private readonly string dir;
        private readonly string usersFile;
        private readonly string messagesFile;
        private readonly string friendsFile;
        private long nextId = 1;

        public const int GeneralCooldownMs = 30000;

        public Store(string dataDir)
        {
            dir = dataDir;
            Directory.CreateDirectory(dir);
            usersFile = Path.Combine(dir, "users.json");
            messagesFile = Path.Combine(dir, "messages.jsonl");
            friendsFile = Path.Combine(dir, "friends.json");
            Load();
        }

        public string DataDir { get { return dir; } }

        private void Load()
        {
            if (File.Exists(usersFile))
            {
                try
                {
                    string text = File.ReadAllText(usersFile, Encoding.UTF8);
                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    object parsed = ser.DeserializeObject(text);
                    Dictionary<string, object> root = parsed as Dictionary<string, object>;
                    if (root != null)
                    {
                        object listObj;
                        if (root.TryGetValue("users", out listObj))
                        {
                            object[] list = listObj as object[];
                            if (list != null)
                            {
                                foreach (object item in list)
                                {
                                    Dictionary<string, object> d = item as Dictionary<string, object>;
                                    if (d == null) continue;
                                    User u = new User();
                                    u.Nick = GetStr(d, "nick");
                                    u.Salt = GetStr(d, "salt");
                                    u.Hash = GetStr(d, "hash");
                                    u.Created = GetLong(d, "created");
                                    u.LastSeen = GetLong(d, "lastSeen");
                                    if (u.Nick.Length > 0) users[Key(u.Nick)] = u;
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("не смог прочитать users.json: " + ex.Message);
                }
            }

            if (File.Exists(messagesFile))
            {
                try
                {
                    foreach (string line in File.ReadAllLines(messagesFile, Encoding.UTF8))
                    {
                        if (line.Trim().Length == 0) continue;
                        JavaScriptSerializer ser = new JavaScriptSerializer();
                        Dictionary<string, object> d = ser.DeserializeObject(line) as Dictionary<string, object>;
                        if (d == null) continue;
                        Message m = new Message();
                        m.Id = GetLong(d, "id");
                        m.From = GetStr(d, "from");
                        m.To = GetStr(d, "to");
                        m.Text = GetStr(d, "text");
                        m.Ts = GetLong(d, "ts");
                        if (m.Id >= nextId) nextId = m.Id + 1;
                        messages.Add(m);
                        if (m.To.Length == 0) lastGeneral[Key(m.From)] = m.Ts;
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("не смог прочитать messages.jsonl: " + ex.Message);
                }
            }

            if (File.Exists(friendsFile))
            {
                try
                {
                    string text = File.ReadAllText(friendsFile, Encoding.UTF8);
                    JavaScriptSerializer ser = new JavaScriptSerializer();
                    Dictionary<string, object> root = ser.DeserializeObject(text) as Dictionary<string, object>;
                    if (root != null)
                    {
                        foreach (KeyValuePair<string, object> pair in root)
                        {
                            object[] list = pair.Value as object[];
                            if (list == null) continue;
                            List<string> nicks = new List<string>();
                            foreach (object item in list)
                            {
                                string nick = Convert.ToString(item, CultureInfo.InvariantCulture);
                                if (!string.IsNullOrEmpty(nick)) nicks.Add(nick);
                            }
                            friends[Key(pair.Key)] = nicks;
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("не смог прочитать friends.json: " + ex.Message);
                }
            }

            Log.Write("загружено пользователей: " + users.Count + ", сообщений: " + messages.Count + ", друзей: " + friends.Count);
        }

        private static string GetStr(Dictionary<string, object> d, string key)
        {
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return "";
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        private static long GetLong(Dictionary<string, object> d, string key)
        {
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return 0;
            long result;
            if (v is long) return (long)v;
            if (v is int) return (int)v;
            if (v is decimal) return (long)(decimal)v;
            if (v is double) return (long)(double)v;
            long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out result);
            return result;
        }

        public static string Key(string nick)
        {
            return (nick ?? "").Trim().ToLowerInvariant();
        }

        public static string Normalize(string nick)
        {
            return (nick ?? "").Trim();
        }

        public static bool ValidNick(string nick, out string error)
        {
            error = null;
            string n = Normalize(nick);
            if (n.Length < 2 || n.Length > 20)
            {
                error = "ник: от 2 до 20 символов";
                return false;
            }
            for (int i = 0; i < n.Length; i++)
            {
                char c = n[i];
                bool ok = char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == '.';
                if (!ok)
                {
                    error = "в нике можно буквы, цифры, _ - и .";
                    return false;
                }
            }
            return true;
        }

        public bool Exists(string nick)
        {
            lock (gate) return users.ContainsKey(Key(nick));
        }

        public User Get(string nick)
        {
            lock (gate)
            {
                User u;
                return users.TryGetValue(Key(nick), out u) ? u : null;
            }
        }

        public bool Create(string nick, string password, out string error)
        {
            error = null;
            string n = Normalize(nick);
            if (!ValidNick(n, out error)) return false;
            if (password == null || password.Length < 4)
            {
                error = "пароль: минимум 4 символа";
                return false;
            }

            lock (gate)
            {
                if (users.ContainsKey(Key(n)))
                {
                    error = "такой ник уже занят";
                    return false;
                }

                byte[] salt = new byte[16];
                using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(salt);
                byte[] hash = Derive(password, salt);

                User u = new User();
                u.Nick = n;
                u.Salt = Convert.ToBase64String(salt);
                u.Hash = Convert.ToBase64String(hash);
                u.Created = Now();
                u.LastSeen = u.Created;
                users[Key(n)] = u;
                SaveUsers();
            }

            Log.Write("новый пользователь: " + n);
            return true;
        }

        public bool Check(string nick, string password)
        {
            User u = Get(nick);
            if (u == null) return false;
            byte[] salt;
            byte[] expected;
            try
            {
                salt = Convert.FromBase64String(u.Salt);
                expected = Convert.FromBase64String(u.Hash);
            }
            catch
            {
                return false;
            }
            byte[] actual = Derive(password ?? "", salt);
            if (actual.Length != expected.Length) return false;
            int diff = 0;
            for (int i = 0; i < actual.Length; i++) diff |= actual[i] ^ expected[i];
            return diff == 0;
        }

        private static byte[] Derive(string password, byte[] salt)
        {
            using (Rfc2898DeriveBytes pbkdf2 = new Rfc2898DeriveBytes(password, salt, 60000))
            {
                return pbkdf2.GetBytes(32);
            }
        }

        public void Touch(string nick)
        {
            lock (gate)
            {
                User u;
                if (users.TryGetValue(Key(nick), out u)) u.LastSeen = Now();
            }
        }

        public long LastSeen(string nick)
        {
            User u = Get(nick);
            return u == null ? 0 : u.LastSeen;
        }

        public List<string> Nicks()
        {
            lock (gate)
            {
                List<string> result = new List<string>();
                foreach (User u in users.Values) result.Add(u.Nick);
                result.Sort(StringComparer.OrdinalIgnoreCase);
                return result;
            }
        }

        public int Count
        {
            get { lock (gate) return users.Count; }
        }

        public List<string> FriendsOf(string nick)
        {
            lock (gate)
            {
                List<string> list;
                if (friends.TryGetValue(Key(nick), out list)) return new List<string>(list);
                return new List<string>();
            }
        }

        public bool AddFriend(string me, string other, out string error)
        {
            error = null;
            string o = Normalize(other);
            if (o.Length == 0)
            {
                error = "укажи ник друга";
                return false;
            }
            User target = Get(o);
            if (target == null)
            {
                error = "нет такого пользователя: " + o;
                return false;
            }
            if (Key(o) == Key(me))
            {
                error = "себя в друзья добавлять не нужно";
                return false;
            }

            lock (gate)
            {
                string key = Key(me);
                List<string> list;
                if (!friends.TryGetValue(key, out list))
                {
                    list = new List<string>();
                    friends[key] = list;
                }
                foreach (string nick in list)
                {
                    if (Key(nick) == Key(o))
                    {
                        error = "уже в друзьях";
                        return false;
                    }
                }
                list.Add(target.Nick);
                SaveFriends();
            }
            return true;
        }

        public bool RemoveFriend(string me, string other)
        {
            lock (gate)
            {
                List<string> list;
                if (!friends.TryGetValue(Key(me), out list)) return false;
                int removed = list.RemoveAll(delegate (string nick) { return Key(nick) == Key(other); });
                if (removed > 0) SaveFriends();
                return removed > 0;
            }
        }

        public List<string> ChatNicks(string me)
        {
            lock (gate)
            {
                Dictionary<string, long> last = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
                string key = Key(me);
                foreach (Message m in messages)
                {
                    if (m.To.Length == 0) continue;
                    string other = null;
                    if (Key(m.From) == key) other = m.To;
                    else if (Key(m.To) == key) other = m.From;
                    if (other == null) continue;
                    string k = Key(other);
                    if (k.Length == 0 || k == key) continue;
                    long prev;
                    if (!last.TryGetValue(k, out prev) || m.Ts > prev) last[k] = m.Ts;
                }

                List<string> keys = new List<string>(last.Keys);
                keys.Sort(delegate (string a, string b) { return last[b].CompareTo(last[a]); });

                List<string> result = new List<string>();
                foreach (string k in keys)
                {
                    User u;
                    result.Add(users.TryGetValue(k, out u) ? u.Nick : k);
                }
                return result;
            }
        }

        public int RemainingGeneralMs(string nick)
        {
            lock (gate)
            {
                long last;
                if (!lastGeneral.TryGetValue(Key(nick), out last) || last <= 0) return 0;
                long left = GeneralCooldownMs - (Now() - last);
                return left > 0 ? (int)left : 0;
            }
        }

        public Message Add(string from, string to, string text)
        {
            Message m = new Message();
            lock (gate)
            {
                m.Id = nextId++;
                m.From = Normalize(from);
                m.To = Normalize(to);
                m.Text = text;
                m.Ts = Now();
                messages.Add(m);
                if (m.To.Length == 0) lastGeneral[Key(m.From)] = m.Ts;
                try
                {
                    File.AppendAllText(messagesFile, m.Json() + "\n", new UTF8Encoding(false));
                }
                catch (Exception ex)
                {
                    Log.Write("не смог записать сообщение: " + ex.Message);
                }
            }
            return m;
        }

        public List<Message> Since(string me, long sinceId, int limit)
        {
            lock (gate)
            {
                List<Message> result = new List<Message>();
                string key = Key(me);
                for (int i = messages.Count - 1; i >= 0 && result.Count < limit; i--)
                {
                    Message m = messages[i];
                    if (m.Id <= sinceId) break;
                    if (m.From == me || (m.To.Length == 0 && m.From != me) || Key(m.To) == key)
                    {
                        result.Add(m);
                    }
                }
                result.Reverse();
                return result;
            }
        }

        public List<Message> History(string me, string with, int limit)
        {
            lock (gate)
            {
                List<Message> result = new List<Message>();
                for (int i = messages.Count - 1; i >= 0 && result.Count < limit; i--)
                {
                    Message m = messages[i];
                    bool match;
                    if (with.Length == 0)
                    {
                        match = m.To.Length == 0;
                    }
                    else
                    {
                        match = (m.From == me && Key(m.To) == Key(with))
                             || (Key(m.From) == Key(with) && Key(m.To) == Key(me));
                    }
                    if (match) result.Add(m);
                }
                result.Reverse();
                return result;
            }
        }

        private void SaveFriends()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('{');
            bool firstUser = true;
            foreach (KeyValuePair<string, List<string>> pair in friends)
            {
                if (!firstUser) sb.Append(',');
                firstUser = false;
                sb.Append(Js.Str(pair.Key)).Append(":[");
                for (int i = 0; i < pair.Value.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(Js.Str(pair.Value[i]));
                }
                sb.Append(']');
            }
            sb.Append('}');

            try
            {
                string tmp = friendsFile + ".tmp";
                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(friendsFile)) File.Delete(friendsFile);
                File.Move(tmp, friendsFile);
            }
            catch (Exception ex)
            {
                Log.Write("не смог записать friends.json: " + ex.Message);
            }
        }

        private void SaveUsers()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"users\":[");
            bool first = true;
            foreach (User u in users.Values)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"nick\":").Append(Js.Str(u.Nick));
                sb.Append(",\"salt\":").Append(Js.Str(u.Salt));
                sb.Append(",\"hash\":").Append(Js.Str(u.Hash));
                sb.Append(",\"created\":").Append(u.Created);
                sb.Append(",\"lastSeen\":").Append(u.LastSeen).Append('}');
            }
            sb.Append("]}");

            try
            {
                string tmp = usersFile + ".tmp";
                File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
                if (File.Exists(usersFile)) File.Delete(usersFile);
                File.Move(tmp, usersFile);
            }
            catch (Exception ex)
            {
                Log.Write("не смог записать users.json: " + ex.Message);
            }
        }

        public static long Now()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }
    }

    internal static class Log
    {
        private static readonly object gate = new object();
        private static string file;

        public static void Init(string path)
        {
            file = path;
        }

        public static void Write(string text)
        {
            string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + text;
            Console.WriteLine(line);
            if (file == null) return;
            try
            {
                lock (gate) File.AppendAllText(file, line + "\n", new UTF8Encoding(false));
            }
            catch { }
        }
    }

    internal sealed class Server
    {
        private readonly Store store;
        private readonly string webDir;
        private readonly Dictionary<string, Session> sessions = new Dictionary<string, Session>();
        private readonly object sessionGate = new object();
        private readonly JavaScriptSerializer ser = new JavaScriptSerializer();
        private TcpListener listener;

        public Server(Store store, string webDir)
        {
            this.store = store;
            this.webDir = webDir;
        }

        public void Start(int port)
        {
            listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
            Log.Write("сервер слушает порт " + port);
            while (true)
            {
                TcpClient client = null;
                try
                {
                    client = listener.AcceptTcpClient();
                }
                catch (Exception ex)
                {
                    Log.Write("accept: " + ex.Message);
                    continue;
                }
                Client c = new Client(this, client);
                Thread t = new Thread(c.Run);
                t.IsBackground = true;
                t.Start();
            }
        }

        private sealed class Client
        {
            private readonly Server server;
            private readonly TcpClient tcp;

            public Client(Server server, TcpClient tcp)
            {
                this.server = server;
                this.tcp = tcp;
            }

            public void Run()
            {
                try
                {
                    tcp.NoDelay = true;
                    tcp.ReceiveTimeout = 60000;
                    using (NetworkStream stream = tcp.GetStream())
                    {
                        Handle(stream);
                    }
                }
                catch (Exception ex)
                {
                    Log.Write("клиент: " + ex.Message);
                }
                finally
                {
                    try { tcp.Close(); } catch { }
                }
            }

            private void Handle(NetworkStream stream)
            {
                string head = "";
                byte[] buffer = new byte[4096];
                int headerEnd = -1;

                while (headerEnd < 0)
                {
                    int read = stream.Read(buffer, 0, buffer.Length);
                    if (read <= 0) return;
                    head += Encoding.UTF8.GetString(buffer, 0, read);
                    headerEnd = head.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                    if (head.Length > 65536) return;
                }

                string headers = head.Substring(0, headerEnd);
                string rest = head.Substring(headerEnd + 4);

                string[] lines = headers.Split(new string[] { "\r\n" }, StringSplitOptions.None);
                string[] first = lines[0].Split(' ');
                if (first.Length < 2) return;
                string method = first[0].ToUpperInvariant();
                string path = first[1];

                int contentLength = 0;
                for (int i = 1; i < lines.Length; i++)
                {
                    int colon = lines[i].IndexOf(':');
                    if (colon <= 0) continue;
                    string name = lines[i].Substring(0, colon).Trim();
                    if (string.Equals(name, "Content-Length", StringComparison.OrdinalIgnoreCase))
                    {
                        int.TryParse(lines[i].Substring(colon + 1).Trim(), out contentLength);
                    }
                }

                byte[] body = new byte[0];
                if (contentLength > 0)
                {
                    MemoryStream ms = new MemoryStream();
                    byte[] pre = Encoding.UTF8.GetBytes(rest);
                    int already = pre.Length;
                    ms.Write(pre, 0, pre.Length);
                    while (already < contentLength)
                    {
                        int want = Math.Min(buffer.Length, contentLength - already);
                        int read = stream.Read(buffer, 0, want);
                        if (read <= 0) break;
                        ms.Write(buffer, 0, read);
                        already += read;
                    }
                    body = ms.ToArray();
                    if (body.Length > contentLength)
                    {
                        byte[] cut = new byte[contentLength];
                        Array.Copy(body, cut, contentLength);
                        body = cut;
                    }
                }

                string bodyText = Encoding.UTF8.GetString(body);

                if (method == "OPTIONS")
                {
                    Send(stream, 204, "text/plain", new byte[0]);
                    return;
                }

                string pathOnly = path;
                string query = "";
                int q = path.IndexOf('?');
                if (q >= 0)
                {
                    pathOnly = path.Substring(0, q);
                    query = path.Substring(q + 1);
                }

                Dictionary<string, string> args = ParseQuery(query);

                if (pathOnly.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
                {
                    string json = server.Api(pathOnly.Substring(5), bodyText, args);
                    Send(stream, 200, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(json));
                    return;
                }

                ServeStatic(stream, pathOnly);
            }

            private static Dictionary<string, string> ParseQuery(string query)
            {
                Dictionary<string, string> result = new Dictionary<string, string>();
                if (string.IsNullOrEmpty(query)) return result;
                string[] pairs = query.Split('&');
                foreach (string pair in pairs)
                {
                    if (pair.Length == 0) continue;
                    int eq = pair.IndexOf('=');
                    string key = eq < 0 ? pair : pair.Substring(0, eq);
                    string value = eq < 0 ? "" : pair.Substring(eq + 1);
                    result[WebUtility.UrlDecode(key)] = WebUtility.UrlDecode(value);
                }
                return result;
            }

            private void ServeStatic(NetworkStream stream, string path)
            {
                string relative = path.TrimStart('/');
                if (relative.Length == 0) relative = "index.html";
                relative = relative.Replace('/', Path.DirectorySeparatorChar);
                if (relative.Contains(".."))
                {
                    Send(stream, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("нет"));
                    return;
                }

                string full = Path.Combine(server.webDir, relative);
                if (!File.Exists(full))
                {
                    byte[] notFound = Encoding.UTF8.GetBytes("404 — страница не найдена");
                    Send(stream, 404, "text/plain; charset=utf-8", notFound);
                    return;
                }

                byte[] data = File.ReadAllBytes(full);
                Send(stream, 200, ContentType(full), data);
            }

            private static string ContentType(string file)
            {
                string ext = Path.GetExtension(file).ToLowerInvariant();
                switch (ext)
                {
                    case ".html": return "text/html; charset=utf-8";
                    case ".css": return "text/css; charset=utf-8";
                    case ".js": return "application/javascript; charset=utf-8";
                    case ".json": return "application/json; charset=utf-8";
                    case ".png": return "image/png";
                    case ".jpg": return "image/jpeg";
                    case ".svg": return "image/svg+xml";
                    case ".ico": return "image/x-icon";
                    case ".webp": return "image/webp";
                    default: return "application/octet-stream";
                }
            }

            private static void Send(NetworkStream stream, int code, string contentType, byte[] body)
            {
                string reason = code == 200 ? "OK" : code == 204 ? "No Content" : code == 404 ? "Not Found" : "Forbidden";
                StringBuilder head = new StringBuilder();
                head.Append("HTTP/1.1 ").Append(code).Append(' ').Append(reason).Append("\r\n");
                head.Append("Content-Type: ").Append(contentType).Append("\r\n");
                head.Append("Content-Length: ").Append(body.Length).Append("\r\n");
                head.Append("Cache-Control: no-store\r\n");
                head.Append("Access-Control-Allow-Origin: *\r\n");
                head.Append("Access-Control-Allow-Headers: Content-Type\r\n");
                head.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
                head.Append("Connection: close\r\n\r\n");
                byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
                stream.Write(headBytes, 0, headBytes.Length);
                if (body.Length > 0) stream.Write(body, 0, body.Length);
                stream.Flush();
            }
        }

        private string Api(string action, string bodyText, Dictionary<string, string> args)
        {
            Dictionary<string, object> input = new Dictionary<string, object>();
            if (!string.IsNullOrEmpty(bodyText))
            {
                try
                {
                    Dictionary<string, object> parsed = ser.DeserializeObject(bodyText) as Dictionary<string, object>;
                    if (parsed != null) input = parsed;
                }
                catch (Exception ex)
                {
                    return Error("непонятный запрос: " + ex.Message);
                }
            }

            string token = Arg(input, args, "token");

            if (string.Equals(action, "register", StringComparison.OrdinalIgnoreCase))
            {
                string nick = Arg(input, args, "nick");
                string password = Arg(input, args, "password");
                string error;
                if (!store.Create(nick, password, out error)) return Error(error);
                string issued = Issue(Store.Normalize(nick));
                Log.Write("вход (новый): " + Store.Normalize(nick));
                return Ok("nick", Store.Normalize(nick), "token", issued);
            }

            if (string.Equals(action, "login", StringComparison.OrdinalIgnoreCase))
            {
                string nick = Store.Normalize(Arg(input, args, "nick"));
                string password = Arg(input, args, "password");
                if (!store.Check(nick, password)) return Error("неверный ник или пароль");
                string issued = Issue(nick);
                Log.Write("вход: " + nick);
                return Ok("nick", NickCase(nick), "token", issued);
            }

            string me = Resolve(token);
            if (me == null) return Error("сессия истекла, войди заново");

            if (string.Equals(action, "users", StringComparison.OrdinalIgnoreCase))
            {
                long now = Store.Now();
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"ok\":true,\"me\":").Append(Js.Str(me)).Append(",\"users\":[");
                bool first = true;
                foreach (string nick in store.Nicks())
                {
                    if (string.Equals(nick, me, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    long seen = store.LastSeen(nick);
                    bool online = now - seen < 70000;
                    sb.Append("{\"nick\":").Append(Js.Str(nick));
                    sb.Append(",\"online\":").Append(online ? "true" : "false");
                    sb.Append(",\"lastSeen\":").Append(seen).Append('}');
                }
                sb.Append("]}");
                return sb.ToString();
            }

            if (string.Equals(action, "send", StringComparison.OrdinalIgnoreCase))
            {
                string to = Store.Normalize(Arg(input, args, "to"));
                string text = Arg(input, args, "text");
                if (text == null) text = "";
                text = text.Trim();
                if (text.Length == 0) return Error("пустое сообщение");
                if (text.Length > 4000) text = text.Substring(0, 4000);
                if (to.Length > 0 && !store.Exists(to)) return Error("нет такого пользователя: " + to);
                if (to.Length == 0)
                {
                    int left = store.RemainingGeneralMs(me);
                    if (left > 0)
                    {
                        int seconds = (left + 999) / 1000;
                        return Error("в общем чате пауза 30 секунд: подожди " + seconds + " с");
                    }
                }
                Message m = store.Add(me, to, text);
                return "{\"ok\":true,\"message\":" + m.Json() + "}";
            }

            if (string.Equals(action, "friends", StringComparison.OrdinalIgnoreCase))
            {
                long now = Store.Now();
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"ok\":true,\"me\":").Append(Js.Str(me)).Append(",\"friends\":[");
                bool first = true;
                foreach (string nick in store.FriendsOf(me))
                {
                    if (!first) sb.Append(',');
                    first = false;
                    long seen = store.LastSeen(nick);
                    sb.Append("{\"nick\":").Append(Js.Str(nick));
                    sb.Append(",\"online\":").Append(now - seen < 70000 ? "true" : "false");
                    sb.Append(",\"lastSeen\":").Append(seen).Append('}');
                }
                sb.Append("]}");
                return sb.ToString();
            }

            if (string.Equals(action, "friend-add", StringComparison.OrdinalIgnoreCase))
            {
                string error;
                if (!store.AddFriend(me, Arg(input, args, "nick"), out error)) return Error(error);
                return "{\"ok\":true}";
            }

            if (string.Equals(action, "friend-remove", StringComparison.OrdinalIgnoreCase))
            {
                if (!store.RemoveFriend(me, Arg(input, args, "nick"))) return Error("его нет в друзьях");
                return "{\"ok\":true}";
            }

            if (string.Equals(action, "chats", StringComparison.OrdinalIgnoreCase))
            {
                long now = Store.Now();
                StringBuilder sb = new StringBuilder();
                sb.Append("{\"ok\":true,\"me\":").Append(Js.Str(me)).Append(",\"chats\":[");
                bool first = true;
                foreach (string nick in store.ChatNicks(me))
                {
                    if (!first) sb.Append(',');
                    first = false;
                    long seen = store.LastSeen(nick);
                    sb.Append("{\"nick\":").Append(Js.Str(nick));
                    sb.Append(",\"online\":").Append(now - seen < 70000 ? "true" : "false");
                    sb.Append(",\"lastSeen\":").Append(seen).Append('}');
                }
                sb.Append("]}");
                return sb.ToString();
            }

            if (string.Equals(action, "poll", StringComparison.OrdinalIgnoreCase))
            {
                long since = 0;
                long.TryParse(Arg(input, args, "since"), out since);

                DateTime deadline = DateTime.UtcNow.AddSeconds(20);
                while (true)
                {
                    List<Message> fresh = store.Since(me, since, 200);
                    if (fresh.Count > 0) return Messages(fresh, me);
                    if (DateTime.UtcNow > deadline) return "{\"ok\":true,\"messages\":[],\"users\":" + UsersJson() + "}";
                    Thread.Sleep(150);
                }
            }

            if (string.Equals(action, "history", StringComparison.OrdinalIgnoreCase))
            {
                string with = Store.Normalize(Arg(input, args, "with"));
                int limit = 100;
                int.TryParse(Arg(input, args, "limit"), out limit);
                if (limit <= 0 || limit > 500) limit = 100;
                return Messages(store.History(me, with, limit), me);
            }

            if (string.Equals(action, "whoami", StringComparison.OrdinalIgnoreCase))
            {
                return Ok("nick", me);
            }

            return Error("нет такого действия: " + action);
        }

        private string UsersJson()
        {
            long now = Store.Now();
            StringBuilder sb = new StringBuilder();
            sb.Append('[');
            bool first = true;
            foreach (string nick in store.Nicks())
            {
                if (!first) sb.Append(',');
                first = false;
                long seen = store.LastSeen(nick);
                sb.Append("{\"nick\":").Append(Js.Str(nick));
                sb.Append(",\"online\":").Append(now - seen < 70000 ? "true" : "false");
                sb.Append(",\"lastSeen\":").Append(seen).Append('}');
            }
            sb.Append(']');
            return sb.ToString();
        }

        private string Messages(List<Message> list, string me)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("{\"ok\":true,\"me\":").Append(Js.Str(me)).Append(",\"messages\":[");
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(list[i].Json());
            }
            sb.Append("],\"users\":").Append(UsersJson()).Append('}');
            return sb.ToString();
        }

        private string NickCase(string nick)
        {
            User u = store.Get(nick);
            return u == null ? nick : u.Nick;
        }

        private static string Arg(Dictionary<string, object> body, Dictionary<string, string> args, string key)
        {
            object value;
            if (body != null && body.TryGetValue(key, out value) && value != null)
            {
                return Convert.ToString(value, CultureInfo.InvariantCulture);
            }
            string found;
            if (args != null && args.TryGetValue(key, out found)) return found;
            return "";
        }

        private string Issue(string nick)
        {
            byte[] raw = new byte[24];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(raw);
            StringBuilder sb = new StringBuilder(48);
            for (int i = 0; i < raw.Length; i++) sb.Append(raw[i].ToString("x2"));
            string token = sb.ToString();
            Session s = new Session();
            s.Nick = nick;
            s.Seen = Store.Now();
            lock (sessionGate) sessions[token] = s;
            store.Touch(nick);
            return token;
        }

        private string Resolve(string token)
        {
            if (string.IsNullOrEmpty(token)) return null;
            lock (sessionGate)
            {
                Session s;
                if (!sessions.TryGetValue(token, out s)) return null;
                s.Seen = Store.Now();
                store.Touch(s.Nick);
                return s.Nick;
            }
        }

        private static string Error(string text)
        {
            return "{\"ok\":false,\"error\":" + Js.Str(text ?? "ошибка") + "}";
        }

        private static string Ok(string key, string value)
        {
            return "{\"ok\":true," + Js.Str(key) + ":" + Js.Str(value) + "}";
        }

        private static string Ok(string key, string value, string key2, string value2)
        {
            return "{\"ok\":true," + Js.Str(key) + ":" + Js.Str(value) + "," + Js.Str(key2) + ":" + Js.Str(value2) + "}";
        }
    }

    internal static class Program
    {
        private static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Priks");
            Directory.CreateDirectory(dataDir);
            Log.Init(Path.Combine(dataDir, "server.log"));

            int port = 8777;
            if (args.Length > 0) int.TryParse(args[0], out port);
            if (port <= 0) port = 8777;

            string webDir = Path.Combine(baseDir, "web");
            if (!Directory.Exists(webDir))
            {
                string alt = Path.Combine(baseDir, "..", "web");
                if (Directory.Exists(alt)) webDir = Path.GetFullPath(alt);
            }

            Log.Write("=== Прикс: сервер ===");
            Log.Write("данные: " + dataDir);
            Log.Write("веб: " + webDir);

            Store store = new Store(dataDir);
            Log.Write("пользователей в базе: " + store.Count);

            Console.WriteLine();
            Console.WriteLine("Адрес для этого компьютера: http://127.0.0.1:" + port + "/");
            foreach (IPAddress ip in LocalAddresses())
            {
                Console.WriteLine("Адрес в локальной сети:      http://" + ip + ":" + port + "/");
            }
            Console.WriteLine("Остановить сервер: Ctrl+C");
            Console.WriteLine();

            Server server = new Server(store, webDir);
            server.Start(port);
        }

        private static List<IPAddress> LocalAddresses()
        {
            List<IPAddress> result = new List<IPAddress>();
            try
            {
                foreach (IPAddress ip in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork) result.Add(ip);
                }
            }
            catch { }
            return result;
        }
    }
}
