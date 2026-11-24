using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Media;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PriksClient
{
    internal sealed class Msg
    {
        public long Id;
        public string From = "";
        public string To = "";
        public string Text = "";
        public long Ts;
    }

    internal sealed class Person
    {
        public string Nick = "";
        public bool Online;
        public long LastSeen;
    }

    internal static class Api
    {
        private static JavaScriptSerializer ser = new JavaScriptSerializer();

        public static string Base = "http://127.0.0.1:8777";

        public static Dictionary<string, object> Call(string action, Dictionary<string, object> data)
        {
            try
            {
                string url = Base.TrimEnd('/') + "/api/" + action;
                string json = ser.Serialize(data ?? new Dictionary<string, object>());
                byte[] body = Encoding.UTF8.GetBytes(json);

                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "POST";
                request.ContentType = "application/json; charset=utf-8";
                request.ContentLength = body.Length;
                request.Timeout = 40000;
                request.ReadWriteTimeout = 40000;
                request.KeepAlive = false;

                using (Stream stream = request.GetRequestStream()) stream.Write(body, 0, body.Length);

                using (WebResponse response = request.GetResponse())
                using (Stream stream = response.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return ser.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                }
            }
            catch (WebException ex)
            {
                try
                {
                    if (ex.Response != null)
                    {
                        using (Stream stream = ex.Response.GetResponseStream())
                        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                        {
                            Dictionary<string, object> parsed = ser.DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                            if (parsed != null) return parsed;
                        }
                    }
                }
                catch { }
                return null;
            }
            catch
            {
                return null;
            }
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return "";
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static long Long(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return 0;
            if (v is int) return (int)v;
            if (v is long) return (long)v;
            if (v is double) return (long)(double)v;
            if (v is decimal) return (long)(decimal)v;
            long result;
            long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out result);
            return result;
        }

        public static bool Bool(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return false;
            if (v is bool) return (bool)v;
            return string.Equals(Convert.ToString(v, CultureInfo.InvariantCulture), "true", StringComparison.OrdinalIgnoreCase);
        }
    }

    internal sealed class ClientSettings
    {
        public string Server = "http://127.0.0.1:8777";
        public string Nick = "";
        public string Token = "";
        public string Theme = "teal";
        public bool Sound = true;
        public int Volume = 60;
        public bool EnterSend = true;
        public bool Compact = false;

        private static string FilePath()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Priks");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "client.json");
        }

        public static ClientSettings Load()
        {
            ClientSettings s = new ClientSettings();
            try
            {
                string path = FilePath();
                if (!File.Exists(path)) return s;
                JavaScriptSerializer ser = new JavaScriptSerializer();
                Dictionary<string, object> d = ser.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
                if (d == null) return s;
                string server = Api.Str(d, "server");
                if (server.Length > 0) s.Server = server;
                s.Nick = Api.Str(d, "nick");
                s.Token = Api.Str(d, "token");
                string theme = Api.Str(d, "theme");
                if (theme.Length > 0) s.Theme = theme;
                if (d.ContainsKey("sound")) s.Sound = Api.Bool(d, "sound");
                if (d.ContainsKey("volume")) s.Volume = (int)Api.Long(d, "volume");
                if (d.ContainsKey("enterSend")) s.EnterSend = Api.Bool(d, "enterSend");
                if (d.ContainsKey("compact")) s.Compact = Api.Bool(d, "compact");
                if (s.Volume < 0 || s.Volume > 100) s.Volume = 60;
            }
            catch { }
            return s;
        }

        public void Save()
        {
            try
            {
                Dictionary<string, object> d = new Dictionary<string, object>();
                d["server"] = Server;
                d["nick"] = Nick;
                d["token"] = Token;
                d["theme"] = Theme;
                d["sound"] = Sound;
                d["volume"] = Volume;
                d["enterSend"] = EnterSend;
                d["compact"] = Compact;
                JavaScriptSerializer ser = new JavaScriptSerializer();
                File.WriteAllText(FilePath(), ser.Serialize(d), new UTF8Encoding(false));
            }
            catch { }
        }
    }

    internal sealed class Palette
    {
        public Color BgTop, BgBottom, BlobA, BlobB, Panel, PanelAlt, Line, LineStrong, Text, Muted;
        public Color Accent, AccentDeep, Accent2, OnAccent, Bubble, BubbleMineFrom, BubbleMineTo, Overlay, Input, Shadow;

        public static Color Blend(Color from, Color to, float t)
        {
            if (t <= 0f) return from;
            if (t >= 1f) return to;
            return Color.FromArgb(
                255,
                (int)(from.R + (to.R - from.R) * t),
                (int)(from.G + (to.G - from.G) * t),
                (int)(from.B + (to.B - from.B) * t));
        }

        public static Color Solid(Color back, Color over)
        {
            int a = over.A;
            if (a >= 255) return Color.FromArgb(255, over.R, over.G, over.B);
            return Color.FromArgb(
                255,
                (over.R * a + back.R * (255 - a)) / 255,
                (over.G * a + back.G * (255 - a)) / 255,
                (over.B * a + back.B * (255 - a)) / 255);
        }

        public Color PanelSolid { get { return Solid(BgTop, Panel); } }
        public Color PanelAltSolid { get { return Solid(BgTop, PanelAlt); } }

        public static Palette For(string theme)
        {
            Palette p = new Palette();
            switch (theme)
            {
                case "sunset":
                    p.BgTop = Color.FromArgb(12, 8, 10);
                    p.BgBottom = Color.FromArgb(7, 5, 7);
                    p.BlobA = Color.FromArgb(150, 255, 154, 77);
                    p.BlobB = Color.FromArgb(130, 255, 95, 143);
                    p.Panel = Color.FromArgb(18, 255, 255, 255);
                    p.PanelAlt = Color.FromArgb(28, 255, 255, 255);
                    p.Line = Color.FromArgb(38, 255, 255, 255);
                    p.LineStrong = Color.FromArgb(70, 255, 255, 255);
                    p.Text = Color.FromArgb(242, 236, 231);
                    p.Muted = Color.FromArgb(163, 141, 130);
                    p.Accent = Color.FromArgb(255, 154, 77);
                    p.AccentDeep = Color.FromArgb(226, 118, 42);
                    p.Accent2 = Color.FromArgb(255, 95, 143);
                    p.OnAccent = Color.FromArgb(36, 18, 2);
                    p.Bubble = Color.FromArgb(18, 255, 255, 255);
                    p.BubbleMineFrom = Color.FromArgb(70, 255, 154, 77);
                    p.BubbleMineTo = Color.FromArgb(40, 255, 95, 143);
                    p.Overlay = Color.FromArgb(170, 5, 3, 4);
                    p.Input = Color.FromArgb(46, 0, 0, 0);
                    p.Shadow = Color.FromArgb(80, 0, 0, 0);
                    break;
                case "lavender":
                    p.BgTop = Color.FromArgb(10, 9, 20);
                    p.BgBottom = Color.FromArgb(6, 5, 12);
                    p.BlobA = Color.FromArgb(150, 139, 124, 255);
                    p.BlobB = Color.FromArgb(120, 43, 212, 194);
                    p.Panel = Color.FromArgb(18, 255, 255, 255);
                    p.PanelAlt = Color.FromArgb(28, 255, 255, 255);
                    p.Line = Color.FromArgb(38, 255, 255, 255);
                    p.LineStrong = Color.FromArgb(70, 255, 255, 255);
                    p.Text = Color.FromArgb(234, 232, 247);
                    p.Muted = Color.FromArgb(146, 140, 176);
                    p.Accent = Color.FromArgb(139, 124, 255);
                    p.AccentDeep = Color.FromArgb(106, 92, 240);
                    p.Accent2 = Color.FromArgb(43, 212, 194);
                    p.OnAccent = Color.FromArgb(15, 10, 42);
                    p.Bubble = Color.FromArgb(18, 255, 255, 255);
                    p.BubbleMineFrom = Color.FromArgb(70, 139, 124, 255);
                    p.BubbleMineTo = Color.FromArgb(36, 43, 212, 194);
                    p.Overlay = Color.FromArgb(170, 5, 4, 12);
                    p.Input = Color.FromArgb(46, 0, 0, 0);
                    p.Shadow = Color.FromArgb(80, 0, 0, 0);
                    break;
                case "light":
                    p.BgTop = Color.FromArgb(248, 250, 252);
                    p.BgBottom = Color.FromArgb(224, 231, 239);
                    p.BlobA = Color.FromArgb(90, 18, 168, 154);
                    p.BlobB = Color.FromArgb(70, 255, 154, 77);
                    p.Panel = Color.FromArgb(235, 255, 255, 255);
                    p.PanelAlt = Color.FromArgb(250, 255, 255, 255);
                    p.Line = Color.FromArgb(28, 16, 32, 44);
                    p.LineStrong = Color.FromArgb(55, 16, 32, 44);
                    p.Text = Color.FromArgb(16, 32, 44);
                    p.Muted = Color.FromArgb(97, 120, 138);
                    p.Accent = Color.FromArgb(18, 168, 154);
                    p.AccentDeep = Color.FromArgb(13, 133, 122);
                    p.Accent2 = Color.FromArgb(226, 118, 42);
                    p.OnAccent = Color.White;
                    p.Bubble = Color.FromArgb(235, 255, 255, 255);
                    p.BubbleMineFrom = Color.FromArgb(56, 18, 168, 154);
                    p.BubbleMineTo = Color.FromArgb(28, 18, 168, 154);
                    p.Overlay = Color.FromArgb(110, 24, 40, 54);
                    p.Input = Color.FromArgb(232, 236, 242, 248);
                    p.Shadow = Color.FromArgb(30, 26, 54, 74);
                    break;
                default:
                    p.BgTop = Color.FromArgb(8, 14, 18);
                    p.BgBottom = Color.FromArgb(5, 7, 9);
                    p.BlobA = Color.FromArgb(150, 43, 212, 194);
                    p.BlobB = Color.FromArgb(120, 255, 154, 77);
                    p.Panel = Color.FromArgb(18, 255, 255, 255);
                    p.PanelAlt = Color.FromArgb(30, 255, 255, 255);
                    p.Line = Color.FromArgb(38, 255, 255, 255);
                    p.LineStrong = Color.FromArgb(70, 255, 255, 255);
                    p.Text = Color.FromArgb(232, 241, 244);
                    p.Muted = Color.FromArgb(125, 149, 160);
                    p.Accent = Color.FromArgb(43, 212, 194);
                    p.AccentDeep = Color.FromArgb(31, 168, 154);
                    p.Accent2 = Color.FromArgb(255, 154, 77);
                    p.OnAccent = Color.FromArgb(4, 33, 30);
                    p.Bubble = Color.FromArgb(18, 255, 255, 255);
                    p.BubbleMineFrom = Color.FromArgb(66, 43, 212, 194);
                    p.BubbleMineTo = Color.FromArgb(32, 43, 212, 194);
                    p.Overlay = Color.FromArgb(170, 4, 8, 10);
                    p.Input = Color.FromArgb(46, 0, 0, 0);
                    p.Shadow = Color.FromArgb(80, 0, 0, 0);
                    break;
            }
            return p;
        }
    }

    internal static class Sounds
    {
        public static byte[] BuildWav(int volume)
        {
            int rate = 44100;
            double duration = 0.52;
            int samples = (int)(rate * duration);
            double amp = Math.Pow(Math.Max(0, Math.Min(100, volume)) / 100.0, 1.4) * 0.16;

            double[] data = new double[samples];
            for (int i = 0; i < samples; i++)
            {
                double t = (double)i / rate;
                double v = 0;

                double t1 = t;
                if (t1 >= 0 && t1 < 0.5)
                {
                    double env = Math.Min(1.0, t1 / 0.010) * Math.Exp(-t1 * 9.0);
                    v += Math.Sin(2 * Math.PI * 1174.66 * t1) * env;
                }

                double t2 = t - 0.085;
                if (t2 >= 0 && t2 < 0.45)
                {
                    double env = Math.Min(1.0, t2 / 0.012) * Math.Exp(-t2 * 8.0);
                    v += Math.Sin(2 * Math.PI * 880.0 * t2) * env * 0.75;
                }

                data[i] = v * 0.5;
            }

            double state = 0;
            for (int i = 0; i < samples; i++)
            {
                state += 0.30 * (data[i] - state);
                data[i] = state;
            }

            double peak = 0.0001;
            for (int i = 0; i < samples; i++)
            {
                double a = Math.Abs(data[i]);
                if (a > peak) peak = a;
            }
            double scale = amp / peak;

            byte[] pcm = new byte[samples * 2];
            for (int i = 0; i < samples; i++)
            {
                double value = data[i] * scale;
                if (value > 0.99) value = 0.99;
                if (value < -0.99) value = -0.99;
                short s = (short)(value * 32767);
                pcm[i * 2] = (byte)(s & 0xFF);
                pcm[i * 2 + 1] = (byte)((s >> 8) & 0xFF);
            }

            using (MemoryStream ms = new MemoryStream())
            using (BinaryWriter w = new BinaryWriter(ms))
            {
                w.Write(new char[] { 'R', 'I', 'F', 'F' });
                w.Write(36 + pcm.Length);
                w.Write(new char[] { 'W', 'A', 'V', 'E' });
                w.Write(new char[] { 'f', 'm', 't', ' ' });
                w.Write(16);
                w.Write((short)1);
                w.Write((short)1);
                w.Write(rate);
                w.Write(rate * 2);
                w.Write((short)2);
                w.Write((short)16);
                w.Write(new char[] { 'd', 'a', 't', 'a' });
                w.Write(pcm.Length);
                w.Write(pcm);
                w.Flush();
                return ms.ToArray();
            }
        }
    }

    internal sealed class BgPanel : Panel
    {
        public Palette Pal;

        public BgPanel()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Color.FromArgb(7, 10, 13);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            Rectangle r = ClientRectangle;
            using (LinearGradientBrush brush = new LinearGradientBrush(r, Pal.BgTop, Pal.BgBottom, 90f))
            {
                e.Graphics.FillRectangle(brush, r);
            }
            DrawBlob(e.Graphics, new Rectangle((int)(r.Width * 0.02) - 220, -260, 700, 700), Pal.BlobA);
            DrawBlob(e.Graphics, new Rectangle(r.Width - 420, r.Height - 380, 640, 640), Pal.BlobB);
        }

        private static void DrawBlob(Graphics g, Rectangle bounds, Color color)
        {
            using (GraphicsPath path = new GraphicsPath())
            {
                path.AddEllipse(bounds);
                using (PathGradientBrush brush = new PathGradientBrush(path))
                {
                    brush.CenterColor = color;
                    brush.SurroundColors = new Color[] { Color.FromArgb(0, color) };
                    SmoothingMode old = g.SmoothingMode;
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.FillPath(brush, path);
                    g.SmoothingMode = old;
                }
            }
        }
    }

    internal static class Shape
    {
        public static GraphicsPath Round(Rectangle r, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int d = Math.Max(1, Math.Min(radius * 2, Math.Min(r.Width, r.Height)));
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, Rectangle r, int radius, Color color)
        {
            if (r.Width <= 0 || r.Height <= 0) return;
            using (GraphicsPath path = Round(r, radius))
            using (SolidBrush b = new SolidBrush(color)) g.FillPath(b, path);
        }

        public static void FillRound(Graphics g, Rectangle r, int radius, Color a, Color b2, float angle)
        {
            if (r.Width <= 0 || r.Height <= 0) return;
            using (GraphicsPath path = Round(r, radius))
            using (LinearGradientBrush b = new LinearGradientBrush(r, a, b2, angle)) g.FillPath(b, path);
        }

        public static void StrokeRound(Graphics g, Rectangle r, int radius, Color color)
        {
            if (r.Width <= 1 || r.Height <= 1) return;
            using (GraphicsPath path = Round(r, radius))
            using (Pen p = new Pen(color)) g.DrawPath(p, path);
        }
    }

    internal static class Surface
    {
        public static Color WindowColor(Control c, Palette pal)
        {
            Form f = c.FindForm();
            if (f == null) return pal.BgTop;
            Rectangle fr = f.RectangleToScreen(f.ClientRectangle);
            Rectangle sr = c.RectangleToScreen(c.ClientRectangle);
            if (fr.Height <= 0) return pal.BgTop;
            float t = (float)(sr.Top + sr.Height / 2 - fr.Top) / fr.Height;
            if (t < 0f) t = 0f;
            if (t > 1f) t = 1f;
            return Palette.Blend(pal.BgTop, pal.BgBottom, t);
        }

        public static Color Of(Control c, Palette pal)
        {
            for (Control p = c.Parent; p != null; p = p.Parent)
            {
                CardPanel card = p as CardPanel;
                if (card != null) return Palette.Solid(WindowColor(c, pal), card.Pal == null ? pal.Panel : card.Pal.Panel);
                if (p is BgPanel) break;
            }
            return Palette.Solid(WindowColor(c, pal), pal.Panel);
        }

        public static void Fill(Graphics g, Control c, Palette pal)
        {
            Rectangle r = c.ClientRectangle;
            r.Inflate(2, 2);
            if (r.Width <= 0 || r.Height <= 0) return;
            using (SolidBrush b = new SolidBrush(Of(c, pal))) g.FillRectangle(b, r);
        }
    }

    internal sealed class CardPanel : Panel
    {
        public Palette Pal;
        public int Radius = 22;
        public bool Shadow = true;

        public CardPanel()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Color.FromArgb(9, 13, 16);
        }

        private Color Backdrop()
        {
            Form f = FindForm();
            if (f == null) return Pal.BgTop;
            Rectangle fr = f.RectangleToScreen(f.ClientRectangle);
            Rectangle sr = RectangleToScreen(ClientRectangle);
            float t = fr.Height <= 0 ? 0f : (float)(sr.Top + sr.Height / 2 - fr.Top) / fr.Height;
            if (t < 0f) t = 0f;
            if (t > 1f) t = 1f;
            return Palette.Blend(Pal.BgTop, Pal.BgBottom, t);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            using (SolidBrush back = new SolidBrush(Pal == null ? BackColor : Backdrop()))
            {
                e.Graphics.FillRectangle(back, ClientRectangle);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            if (Shadow)
            {
                using (SolidBrush glow = new SolidBrush(Pal.Shadow))
                {
                    e.Graphics.FillPath(glow, Shape.Round(new Rectangle(1, 3, Width - 2, Height - 2), Radius + 1));
                }
            }
            Shape.FillRound(e.Graphics, r, Radius, Pal.Panel);
            Shape.StrokeRound(e.Graphics, r, Radius, Pal.Line);
        }
    }

    internal sealed class HintBox : TextBox
    {
        public string Hint = "";
        public Palette Pal;

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg != 0x000F || Pal == null) return;
            if (Focused || Text.Length > 0 || Hint.Length == 0) return;
            using (Graphics g = Graphics.FromHwnd(Handle))
            using (SolidBrush b = new SolidBrush(Palette.Solid(BackColor, Color.FromArgb(150, Pal.Muted))))
            using (StringFormat sf = new StringFormat { LineAlignment = StringAlignment.Center })
            {
                g.DrawString(Hint, Font, b, new RectangleF(0, 0, Width, Height), sf);
            }
        }

        protected override void OnGotFocus(EventArgs e)
        {
            base.OnGotFocus(e);
            Invalidate();
        }

        protected override void OnLostFocus(EventArgs e)
        {
            base.OnLostFocus(e);
            Invalidate();
        }

        protected override void OnTextChanged(EventArgs e)
        {
            base.OnTextChanged(e);
            Invalidate();
        }
    }

    internal sealed class FieldShell : Panel
    {
        public Palette Pal;
        public TextBox Box;
        public int Radius = 12;
        public bool Hot;

        public FieldShell()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
        }

        public Color Fill { get { return Palette.Solid(Palette.Solid(Pal.BgTop, Pal.Panel), Pal.Input); } }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Shape.FillRound(e.Graphics, r, Radius, Fill);
            Color line = Hot ? Pal.Accent : Palette.Solid(Palette.Solid(Pal.BgTop, Pal.Panel), Pal.LineStrong);
            Shape.StrokeRound(e.Graphics, r, Radius, line);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaintBackground(e); return; }
            Surface.Fill(e.Graphics, this, Pal);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (Box != null) Box.SetBounds(12, Math.Max(2, (Height - 22) / 2), Math.Max(10, Width - 24), 22);
        }
    }

    internal sealed class ChipTab : Control
    {
        public Palette Pal;
        public bool Active;

        public ChipTab()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            Font = new Font("Segoe UI", 8.25f, FontStyle.Bold);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaintBackground(e); return; }
            Surface.Fill(e.Graphics, this, Pal);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Color baseFill = Palette.Solid(Palette.Solid(Pal.BgTop, Pal.Panel), Pal.PanelAlt);
            Color fill = Active ? Palette.Solid(baseFill, Color.FromArgb(64, Pal.Accent)) : baseFill;
            Shape.FillRound(e.Graphics, r, Height / 2, fill);
            if (Active) Shape.StrokeRound(e.Graphics, r, Height / 2, Palette.Solid(baseFill, Color.FromArgb(120, Pal.Accent)));
            using (SolidBrush b = new SolidBrush(Active ? Pal.Text : Pal.Muted))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                e.Graphics.DrawString(Text, Font, b, new RectangleF(0, 0, Width, Height), sf);
            }
        }
    }

    internal sealed class IconButton : Button
    {
        public enum Kind { Chat, Settings, Power }
        public Kind Icon = Kind.Chat;
        public bool Active;
        public Palette Pal;

        public IconButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
            ForeColor = Color.White;
            Size = new Size(46, 46);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Surface.Fill(e.Graphics, this, Pal);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);

            Color back = Active ? Color.FromArgb(46, Pal.Accent) : (ClientRectangle.Contains(PointToClient(Cursor.Position)) ? Pal.PanelAlt : Color.Transparent);
            if (back.A > 0) Shape.FillRound(e.Graphics, r, 15, back);
            if (Active) Shape.StrokeRound(e.Graphics, r, 15, Color.FromArgb(90, Pal.Accent));

            Color color = Active ? Pal.Accent : Pal.Muted;
            using (Pen pen = new Pen(color, 1.9f))
            {
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                int cx = Width / 2;
                int cy = Height / 2;

                if (Icon == Kind.Chat)
                {
                    Rectangle bubble = new Rectangle(cx - 9, cy - 8, 18, 14);
                    using (GraphicsPath p = Shape.Round(bubble, 5)) e.Graphics.DrawPath(pen, p);
                    e.Graphics.DrawLine(pen, cx - 4, cy + 6, cx - 6, cy + 10);
                    e.Graphics.DrawLine(pen, cx - 6, cy + 10, cx - 1, cy + 6);
                }
                else if (Icon == Kind.Settings)
                {
                    e.Graphics.DrawEllipse(pen, cx - 4, cy - 4, 8, 8);
                    for (int i = 0; i < 8; i++)
                    {
                        double angle = i * Math.PI / 4;
                        int x1 = cx + (int)(8 * Math.Cos(angle));
                        int y1 = cy + (int)(8 * Math.Sin(angle));
                        int x2 = cx + (int)(11 * Math.Cos(angle));
                        int y2 = cy + (int)(11 * Math.Sin(angle));
                        e.Graphics.DrawLine(pen, x1, y1, x2, y2);
                    }
                }
                else
                {
                    e.Graphics.DrawArc(pen, cx - 9, cy - 9, 12, 18, -60, 180);
                    e.Graphics.DrawLine(pen, cx - 8, cy, cx + 8, cy);
                    e.Graphics.DrawLine(pen, cx + 3, cy - 5, cx + 8, cy);
                    e.Graphics.DrawLine(pen, cx + 3, cy + 5, cx + 8, cy);
                }
            }
        }
    }

    internal sealed class SwatchButton : Button
    {
        public Palette Pal;
        public string Title = "";
        public bool Active;
        public Color From;
        public Color To;

        public SwatchButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
            Size = new Size(112, 80);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Surface.Fill(e.Graphics, this, Pal);
            Rectangle outer = new Rectangle(0, 0, Width - 1, Height - 1);
            Shape.FillRound(e.Graphics, outer, 16, Pal.Panel);
            Shape.StrokeRound(e.Graphics, outer, 16, Active ? Pal.Accent : Pal.Line);

            Rectangle swatch = new Rectangle(9, 9, Width - 18, Height - 40);
            Shape.FillRound(e.Graphics, swatch, 11, From, To, 45f);

            using (SolidBrush text = new SolidBrush(Pal.Text))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center })
            {
                e.Graphics.DrawString(Title, new Font("Segoe UI", 8.5f, FontStyle.Bold), text,
                    new RectangleF(4, Height - 28, Width - 8, 20), sf);
            }
        }
    }

    internal sealed class PillButton : Button
    {
        public Palette Pal;
        public bool Primary;
        public int Radius = 12;
        private bool hover;

        public PillButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            hover = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Surface.Fill(e.Graphics, this, Pal);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Color text;
            if (Primary)
            {
                Color from = hover ? Palette.Solid(Pal.Accent, Color.FromArgb(40, 255, 255, 255)) : Pal.Accent;
                Color to = hover ? Palette.Solid(Pal.AccentDeep, Color.FromArgb(30, 255, 255, 255)) : Pal.AccentDeep;
                Shape.FillRound(e.Graphics, r, Radius, from, to, 30f);
                text = Pal.OnAccent;
            }
            else
            {
                Color baseFill = Surface.Of(this, Pal);
                Color fill = hover ? Palette.Solid(baseFill, Color.FromArgb(26, Pal.Accent)) : Palette.Solid(baseFill, Color.FromArgb(14, 255, 255, 255));
                Shape.FillRound(e.Graphics, r, Radius, fill);
                Shape.StrokeRound(e.Graphics, r, Radius, hover ? Palette.Solid(baseFill, Color.FromArgb(120, Pal.Accent)) : Palette.Solid(baseFill, Pal.LineStrong));
                text = Pal.Text;
            }
            if (!Enabled) text = Palette.Solid(Surface.Of(this, Pal), Color.FromArgb(110, text));
            using (SolidBrush b = new SolidBrush(text))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                e.Graphics.DrawString(Text, Font, b, new RectangleF(0, 0, Width, Height), sf);
            }
        }
    }

    internal sealed class ToggleSwitch : Control
    {
        public Palette Pal;
        public bool Checked;
        public event EventHandler Changed;

        public ToggleSwitch()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            Size = new Size(46, 26);
            Cursor = Cursors.Hand;
        }

        protected override void OnClick(EventArgs e)
        {
            Checked = !Checked;
            if (Changed != null) Changed(this, EventArgs.Empty);
            Invalidate();
            base.OnClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Surface.Fill(e.Graphics, this, Pal);
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            Shape.FillRound(e.Graphics, r, Height / 2, Checked ? Color.FromArgb(110, Pal.Accent) : Color.FromArgb(70, Pal.Muted));
            Shape.StrokeRound(e.Graphics, r, Height / 2, Checked ? Pal.Accent : Pal.LineStrong);

            int knob = Height - 8;
            int x = Checked ? Width - knob - 4 : 4;
            using (SolidBrush b = new SolidBrush(Checked ? Pal.Accent : Pal.Muted))
            {
                e.Graphics.FillEllipse(b, x, 4, knob, knob);
            }
        }
    }

    internal sealed class ValueSlider : Control
    {
        public Palette Pal;
        public int Maximum = 100;
        public int Value = 60;
        public event EventHandler Changed;

        public ValueSlider()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            Height = 26;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            SetFromMouse(e.X);
            base.OnMouseDown(e);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) SetFromMouse(e.X);
            base.OnMouseMove(e);
        }

        private void SetFromMouse(int x)
        {
            double ratio = Math.Max(0, Math.Min(1, (double)(x - 8) / Math.Max(1, Width - 16)));
            int next = (int)Math.Round(ratio * Maximum);
            if (next != Value)
            {
                Value = next;
                Invalidate();
                if (Changed != null) Changed(this, EventArgs.Empty);
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Surface.Fill(e.Graphics, this, Pal);
            int y = Height / 2;
            Rectangle track = new Rectangle(8, y - 3, Width - 16, 6);
            Shape.FillRound(e.Graphics, track, 3, Color.FromArgb(60, Pal.Muted));

            int filled = (int)((Width - 16) * (double)Value / Math.Max(1, Maximum));
            if (filled > 2)
            {
                Shape.FillRound(e.Graphics, new Rectangle(8, y - 3, filled, 6), 3, Pal.Accent, Pal.AccentDeep, 0f);
            }

            int knobX = 8 + filled;
            using (SolidBrush b = new SolidBrush(Color.White))
            using (Pen p = new Pen(Pal.Accent, 3f))
            {
                e.Graphics.FillEllipse(b, knobX - 7, y - 7, 14, 14);
                e.Graphics.DrawEllipse(p, knobX - 7, y - 7, 14, 14);
            }
        }
    }

    internal sealed class MessageView : Control
    {
        public Palette Pal;
        public string Me = "";
        public List<Msg> Items = new List<Msg>();

        private int offset;
        private int contentHeight;
        private bool syncing;
        private bool thumbVisible;
        private int thumbTop;
        private int thumbHeight;
        private bool dragging;
        private int dragStartY;
        private int dragStartOffset;

        public MessageView()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
        }

        public void SetItems(List<Msg> items)
        {
            Items = items ?? new List<Msg>();
            Recalc();
            Invalidate();
        }

        public void ScrollToEnd()
        {
            offset = Math.Max(0, contentHeight - Height);
            SyncBar();
            Invalidate();
        }

        public void SetScrollFromBar(int value)
        {
            if (syncing) return;
            offset = value;
            ClampOffset();
        }

        public bool AtEnd
        {
            get { return offset >= Math.Max(0, contentHeight - Height); }
        }

        private void SyncBar()
        {
            int max = Math.Max(0, contentHeight - Height);
            if (offset > max) offset = max;
            if (offset < 0) offset = 0;
            thumbVisible = max > 0 && Height > 40;
            if (!thumbVisible) return;
            int track = Height - 16;
            int size = (int)((double)Height / Math.Max(1, contentHeight) * track);
            if (size < 40) size = 40;
            if (size > track) size = track;
            int travel = track - size;
            thumbHeight = size;
            thumbTop = 8 + (int)((double)offset / max * travel);
        }

        private bool OnThumb(int x, int y)
        {
            return thumbVisible && x >= Width - 16 && y >= thumbTop - 2 && y <= thumbTop + thumbHeight + 2;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (OnThumb(e.X, e.Y))
            {
                dragging = true;
                dragStartY = e.Y;
                dragStartOffset = offset;
                Cursor = Cursors.SizeNS;
            }
            base.OnMouseDown(e);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (dragging)
            {
                int track = Height - 16;
                int travel = Math.Max(1, track - thumbHeight);
                int max = Math.Max(1, contentHeight - Height);
                offset = dragStartOffset + (int)((double)(e.Y - dragStartY) / travel * max);
                ClampOffset();
            }
            else
            {
                Cursor = OnThumb(e.X, e.Y) ? Cursors.SizeNS : Cursors.Default;
            }
            base.OnMouseMove(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            dragging = false;
            base.OnMouseUp(e);
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            offset -= e.Delta / 3;
            ClampOffset();
            base.OnMouseWheel(e);
        }

        private void ClampOffset()
        {
            int max = Math.Max(0, contentHeight - Height);
            if (offset > max) offset = max;
            if (offset < 0) offset = 0;
            SyncBar();
            Invalidate();
        }

        protected override void OnResize(EventArgs e)
        {
            Recalc();
            base.OnResize(e);
        }

        private void Recalc()
        {
            if (Width <= 0) return;
            int y = 10;
            int maxBubble = (int)(Width * 0.72);
            foreach (Msg m in Items)
            {
                y += 8;
                Size textSize = TextRenderer.MeasureText(m.Text, new Font("Segoe UI", 9.75f), new Size(maxBubble - 30, int.MaxValue), TextFormatFlags.WordBreak);
                y += 18 + textSize.Height + 20;
            }
            contentHeight = y + 14;
            SyncBar();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            if (Items.Count == 0)
            {
                using (SolidBrush b = new SolidBrush(Pal.Muted))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    g.DrawString("Сообщений пока нет — напиши первым", new Font("Segoe UI", 10f), b, ClientRectangle, sf);
                }
                return;
            }

            int y = 10 - offset;
            int maxBubble = (int)(Width * 0.72);
            string lastDay = "";
            Font textFont = new Font("Segoe UI", 9.75f);
            Font headFont = new Font("Segoe UI", 8.25f, FontStyle.Bold);
            Font dayFont = new Font("Segoe UI", 8.5f);

            foreach (Msg m in Items)
            {
                DateTime when = DateTimeOffset.FromUnixTimeMilliseconds(m.Ts).ToLocalTime().DateTime;
                string day = when.Date == DateTime.Today ? "сегодня"
                    : when.Date == DateTime.Today.AddDays(-1) ? "вчера"
                    : when.ToString("d MMMM", new CultureInfo("ru-RU"));

                if (day != lastDay)
                {
                    lastDay = day;
                    if (y > -40 && y < Height)
                    {
                        Size daySize = TextRenderer.MeasureText(day, dayFont);
                        Rectangle dayRect = new Rectangle((Width - daySize.Width) / 2 - 12, y, daySize.Width + 24, 24);
                        Shape.FillRound(g, dayRect, 12, Pal.Panel);
                        using (SolidBrush b = new SolidBrush(Pal.Muted))
                        {
                            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                            {
                                g.DrawString(day, dayFont, b, dayRect, sf);
                            }
                        }
                    }
                    y += 32;
                }

                Size textSize = TextRenderer.MeasureText(m.Text, textFont, new Size(maxBubble - 30, int.MaxValue), TextFormatFlags.WordBreak);
                int bubbleWidth = Math.Min(maxBubble, textSize.Width + 30);
                int bubbleHeight = 18 + textSize.Height + 18;

                bool mine = string.Equals(m.From, Me, StringComparison.OrdinalIgnoreCase);
                int left = mine ? Width - bubbleWidth - 12 : 4;
                Rectangle bubble = new Rectangle(left, y, bubbleWidth, bubbleHeight);

                if (bubble.Bottom > -20 && bubble.Top < Height + 20)
                {
                    if (mine)
                    {
                        Shape.FillRound(g, bubble, 16, Pal.BubbleMineFrom, Pal.BubbleMineTo, 45f);
                        Shape.StrokeRound(g, bubble, 16, Color.FromArgb(80, Pal.Accent));
                    }
                    else
                    {
                        Shape.FillRound(g, bubble, 16, Pal.Bubble);
                        Shape.StrokeRound(g, bubble, 16, Pal.Line);
                    }

                    using (SolidBrush head = new SolidBrush(mine ? Pal.Accent : Pal.Accent2))
                    using (SolidBrush muted = new SolidBrush(Pal.Muted))
                    using (SolidBrush text = new SolidBrush(Pal.Text))
                    {
                        string who = mine ? "ты" : m.From;
                        string time = when.ToString("HH:mm");
                        if (mine)
                        {
                            Size timeSize = TextRenderer.MeasureText(time, headFont);
                            g.DrawString(time, headFont, muted, bubble.Right - 15 - timeSize.Width, bubble.Top + 6);
                            Size whoSize = TextRenderer.MeasureText(who, headFont);
                            g.DrawString(who, headFont, head, bubble.Right - 23 - timeSize.Width - whoSize.Width, bubble.Top + 6);
                        }
                        else
                        {
                            g.DrawString(who, headFont, head, bubble.Left + 14, bubble.Top + 6);
                            g.DrawString(time, headFont, muted, bubble.Left + 20 + TextRenderer.MeasureText(who, headFont).Width, bubble.Top + 6);
                        }
                        Rectangle textRect = new Rectangle(bubble.Left + 15, bubble.Top + 25, bubble.Width - 30, bubble.Height - 33);
                        TextRenderer.DrawText(g, m.Text, textFont, textRect, Pal.Text,
                            TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.TextBoxControl);
                    }
                }

                y += bubbleHeight + 8;
            }

            if (thumbVisible)
            {
                Rectangle thumb = new Rectangle(Width - 10, thumbTop, 6, thumbHeight);
                Shape.FillRound(g, thumb, 3, Color.FromArgb(70, Pal.Muted));
            }
        }
    }

    internal sealed class ChatEntry
    {
        public string Nick = "";
        public string Title = "";
        public bool Online;
        public bool General;
        public int Unread;

        public override string ToString() { return Title; }
    }

    internal sealed class ChatList : Control
    {
        private static readonly Font TitleFont = new Font("Segoe UI", 9.75f, FontStyle.Bold);
        private static readonly Font SubFont = new Font("Segoe UI", 8.25f, FontStyle.Regular);
        private static readonly Font AvatarFont = new Font("Segoe UI", 11f, FontStyle.Bold);
        private static readonly Font HintFont = new Font("Segoe UI", 8.75f, FontStyle.Regular);

        public Palette Pal;
        public readonly List<object> Items = new List<object>();
        public int ItemHeight = 56;
        public event EventHandler SelectedIndexChanged;

        private int selectedIndex = -1;
        private int hoverIndex = -1;
        private int offset;
        private bool dragging;
        private bool thumbVisible;
        private int thumbTop;
        private int thumbHeight;
        private int dragStartY;
        private int dragStartOffset;

        public ChatList()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Cursor = Cursors.Hand;
        }

        public int SelectedIndex
        {
            get { return selectedIndex; }
            set
            {
                int next = (value >= 0 && value < Items.Count) ? value : -1;
                if (next == selectedIndex) return;
                selectedIndex = next;
                Invalidate();
                if (SelectedIndexChanged != null) SelectedIndexChanged(this, EventArgs.Empty);
            }
        }

        public object SelectedItem
        {
            get { return selectedIndex >= 0 && selectedIndex < Items.Count ? Items[selectedIndex] : null; }
        }

        public void BeginUpdate() { }

        public void EndUpdate()
        {
            ClampOffset();
            Invalidate();
        }

        private int ContentHeight { get { return Items.Count * ItemHeight; } }

        private void ClampOffset()
        {
            int max = Math.Max(0, ContentHeight - Height);
            if (offset > max) offset = max;
            if (offset < 0) offset = 0;
            SyncThumb();
        }

        private void SyncThumb()
        {
            int max = Math.Max(0, ContentHeight - Height);
            thumbVisible = max > 0 && Height > 40;
            if (!thumbVisible) return;
            int track = Height - 16;
            int size = (int)((double)Height / Math.Max(1, ContentHeight) * track);
            if (size < 36) size = 36;
            if (size > track) size = track;
            thumbHeight = size;
            thumbTop = 8 + (int)((double)offset / max * (track - size));
        }

        private int IndexAt(int y)
        {
            int index = (y + offset) / Math.Max(1, ItemHeight);
            return index >= 0 && index < Items.Count ? index : -1;
        }

        private bool OnThumb(int x, int y)
        {
            return thumbVisible && x >= Width - 18 && y >= thumbTop - 4 && y <= thumbTop + thumbHeight + 4;
        }

        protected override void OnResize(EventArgs e)
        {
            ClampOffset();
            base.OnResize(e);
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            offset -= e.Delta / 2;
            ClampOffset();
            Invalidate();
            base.OnMouseWheel(e);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (dragging)
            {
                int travel = Math.Max(1, Height - 16 - thumbHeight);
                int max = Math.Max(1, ContentHeight - Height);
                offset = dragStartOffset + (int)((double)(e.Y - dragStartY) / travel * max);
                ClampOffset();
                Invalidate();
            }
            else
            {
                Cursor = OnThumb(e.X, e.Y) ? Cursors.SizeNS : Cursors.Hand;
                int index = OnThumb(e.X, e.Y) ? -1 : IndexAt(e.Y);
                if (index != hoverIndex)
                {
                    hoverIndex = index;
                    Invalidate();
                }
            }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hoverIndex = -1;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (OnThumb(e.X, e.Y))
            {
                dragging = true;
                dragStartY = e.Y;
                dragStartOffset = offset;
            }
            else
            {
                int index = IndexAt(e.Y);
                if (index >= 0) SelectedIndex = index;
            }
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            dragging = false;
            base.OnMouseUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null) { base.OnPaint(e); return; }
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            for (int i = 0; i < Items.Count; i++)
            {
                int top = i * ItemHeight - offset;
                if (top > Height) break;
                if (top + ItemHeight < 0) continue;
                DrawRow(g, Items[i] as ChatEntry, i, top);
            }

            if (thumbVisible)
            {
                Shape.FillRound(g, new Rectangle(Width - 10, thumbTop, 6, thumbHeight), 3, Color.FromArgb(70, Pal.Muted));
            }
        }

        private void DrawRow(Graphics g, ChatEntry entry, int index, int top)
        {
            if (entry == null) return;
            Rectangle row = new Rectangle(4, top + 4, Width - 8, ItemHeight - 8);
            bool selected = index == selectedIndex;
            bool hover = index == hoverIndex;

            if (selected) Shape.FillRound(g, row, 16, Color.FromArgb(40, Pal.Accent));
            else if (hover) Shape.FillRound(g, row, 16, Color.FromArgb(16, Pal.Accent));
            if (selected) Shape.StrokeRound(g, row, 16, Color.FromArgb(80, Pal.Accent));

            if (entry.Nick.Length == 0)
            {
                using (SolidBrush b = new SolidBrush(Pal.Muted))
                {
                    g.DrawString(entry.Title, HintFont, b, new Rectangle(row.Left + 12, row.Top + 8, row.Width - 24, row.Height - 16));
                }
                return;
            }

            Rectangle avatar = new Rectangle(row.Left + 10, row.Top + (row.Height - 36) / 2, 36, 36);
            Shape.FillRound(g, avatar, 12, selected ? Color.FromArgb(70, Pal.Accent) : Pal.PanelAlt);
            using (SolidBrush b = new SolidBrush(entry.Online ? Pal.Accent : Pal.Muted))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                string initial = entry.Title.Length > 0 ? entry.Title.Substring(0, 1).ToUpperInvariant() : "?";
                g.DrawString(initial, AvatarFont, b, avatar, sf);
            }

            int textLeft = avatar.Right + 12;
            int textTop = row.Top + (row.Height - 34) / 2;
            using (SolidBrush b = new SolidBrush(Pal.Text))
            {
                g.DrawString(entry.Title, TitleFont, b, textLeft, textTop);
            }
            using (SolidBrush b = new SolidBrush(entry.Unread > 0 ? Pal.Accent2 : (entry.Online ? Pal.Accent : Pal.Muted)))
            {
                string caption = entry.Unread > 0 ? entry.Unread + " новых" : (entry.Online ? "в сети" : "не в сети");
                g.DrawString(caption, SubFont, b, textLeft, textTop + 18);
            }

            if (entry.Online)
            {
                using (SolidBrush b = new SolidBrush(Pal.Accent))
                {
                    g.FillEllipse(b, row.Right - 16, row.Top + (row.Height - 8) / 2, 8, 8);
                }
            }
        }
    }

    internal sealed class ToastPill : Control
    {
        public Palette Pal;

        public ToastPill()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            BackColor = Color.Transparent;
            Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
            Visible = false;
        }

        protected override void OnTextChanged(EventArgs e)
        {
            base.OnTextChanged(e);
            Visible = Text.Length > 0;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            if (Pal == null || Text.Length == 0) return;
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle r = new Rectangle(0, 0, Width - 1, Height - 1);
            if (r.Width <= 2 || r.Height <= 2) return;
            Color line = ForeColor;
            Shape.FillRound(g, r, Height / 2, Color.FromArgb(26, line));
            Shape.StrokeRound(g, r, Height / 2, Color.FromArgb(80, line));
            using (SolidBrush b = new SolidBrush(line))
            using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                g.DrawString(Text, Font, b, r, sf);
            }
        }
    }

    internal sealed class ClientForm : Form
    {
        private ClientSettings settings;
        private Palette pal;
        private SoundPlayer player;

        private BgPanel root;
        private Panel loginLayer;
        private Panel chatLayer;
        private Panel settingsLayer;

        private TextBox txtServer, txtNick, txtPass, txtMessage;
        private Label lblLoginError;
        private Button btnLogin, btnRegister;

        private IconButton railChats, railSettings, railPower;
        private Label myNickLabel, myStatusLabel;
        private ChatList lstChats;
        private Label lblChatTitle, lblChatSub;
        private Label lblConnBadge;
        private MessageView messages;
        private Label lblChatsHeader;

        private readonly List<Msg> all = new List<Msg>();
        private readonly List<Person> people = new List<Person>();
        private readonly Dictionary<string, int> unread = new Dictionary<string, int>();
        private string me = "";
        private string token = "";
        private string chat = "";
        private bool suppressSelect;
        private long since;
        private volatile bool running = true;

        public ClientForm()
        {
            settings = ClientSettings.Load();
            Api.Base = settings.Server;
            pal = Palette.For(settings.Theme);
            BuildSound();

            Text = "Прикс";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1120, 720);
            MinimumSize = new Size(900, 600);
            BackColor = pal.BgBottom;
            ForeColor = pal.Text;
            Font = new Font("Segoe UI", 9.5f);
            DoubleBuffered = true;

            root = new BgPanel();
            root.Pal = pal;
            root.Dock = DockStyle.Fill;
            Controls.Add(root);

            BuildLogin();
            BuildChat();
            BuildSettings();

            Resize += delegate { LayoutAll(); };
            Shown += delegate
            {
                LayoutAll();
                if (settings.Token.Length > 0) TryRestore();
            };
            FormClosing += delegate { running = false; };
        }

        private void BuildSound()
        {
            try
            {
                player = new SoundPlayer(new MemoryStream(Sounds.BuildWav(settings.Volume)));
                player.Load();
            }
            catch { player = null; }
        }

        private void PlaySound()
        {
            if (!settings.Sound || player == null) return;
            try { player.Play(); } catch { }
        }

        private Font UiFont(float size, FontStyle style)
        {
            return new Font("Segoe UI", size, style);
        }

        private Color Mix(Color over)
        {
            return Mix(pal.BgTop, over);
        }

        private static Color Mix(Color back, Color over)
        {
            int a = over.A;
            if (a >= 255) return Color.FromArgb(255, over.R, over.G, over.B);
            return Color.FromArgb(
                255,
                (over.R * a + back.R * (255 - a)) / 255,
                (over.G * a + back.G * (255 - a)) / 255,
                (over.B * a + back.B * (255 - a)) / 255);
        }

        private Label MakeLabel(string text, float size, FontStyle style, Color color)
        {
            Label l = new Label();
            l.Text = text;
            l.AutoSize = false;
            l.BackColor = Color.Transparent;
            l.ForeColor = color;
            l.Font = UiFont(size, style);
            l.TextAlign = ContentAlignment.MiddleLeft;
            return l;
        }

        private TextBox MakeInput(string hint)
        {
            HintBox box = new HintBox();
            box.Hint = hint;
            box.Pal = pal;
            box.BackColor = Palette.Solid(Palette.Solid(pal.BgTop, pal.Panel), pal.Input);
            box.ForeColor = pal.Text;
            box.BorderStyle = BorderStyle.None;
            box.Font = UiFont(10.5f, FontStyle.Regular);
            box.AccessibleDescription = hint;
            return box;
        }

        private TextBox MakeField(Control parent, string hint, int x, int y, int w, int h)
        {
            FieldShell shell = new FieldShell();
            shell.Pal = pal;
            shell.SetBounds(x, y, w, h);
            TextBox box = MakeInput(hint);
            box.SetBounds(12, (h - 22) / 2, w - 24, 22);
            shell.Box = box;
            box.Enter += delegate { shell.Hot = true; shell.Invalidate(); };
            box.Leave += delegate { shell.Hot = false; shell.Invalidate(); };
            shell.Controls.Add(box);
            parent.Controls.Add(shell);
            return box;
        }

        private Button MakeButton(string caption, bool primary)
        {
            PillButton b = new PillButton();
            b.Pal = pal;
            b.Primary = primary;
            b.Text = caption;
            b.ForeColor = primary ? pal.OnAccent : pal.Text;
            b.Font = UiFont(9.5f, FontStyle.Bold);
            b.Cursor = Cursors.Hand;
            b.Height = 40;
            return b;
        }

        private void BuildLogin()
        {
            loginLayer = new Panel();
            loginLayer.BackColor = Color.Transparent;
            root.Controls.Add(loginLayer);

            Label brandTile = MakeLabel("П", 20f, FontStyle.Bold, pal.OnAccent);
            brandTile.TextAlign = ContentAlignment.MiddleCenter;
            brandTile.Paint += delegate (object s, PaintEventArgs e)
            {
                Shape.FillRound(e.Graphics, new Rectangle(0, 0, brandTile.Width - 1, brandTile.Height - 1), 18, pal.Accent, pal.AccentDeep, 45f);
                using (SolidBrush b = new SolidBrush(pal.OnAccent))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    e.Graphics.DrawString("П", UiFont(19f, FontStyle.Bold), b, new RectangleF(0, 0, brandTile.Width, brandTile.Height), sf);
                }
            };
            loginLayer.Controls.Add(brandTile);
            loginTile = brandTile;

            Label title = MakeLabel("Прикс", 22f, FontStyle.Bold, pal.Text);
            loginTitle = title;
            loginLayer.Controls.Add(title);

            Label subtitle = MakeLabel("мессенджер без регистрации", 9.5f, FontStyle.Regular, pal.Muted);
            loginSubtitle = subtitle;
            loginLayer.Controls.Add(subtitle);

            Label f1 = MakeLabel("•  только ник и пароль", 10f, FontStyle.Regular, pal.Text);
            Label f2 = MakeLabel("•  общий чат и личные сообщения", 10f, FontStyle.Regular, pal.Text);
            Label f3 = MakeLabel("•  свой сервер на твоём компьютере", 10f, FontStyle.Regular, pal.Text);
            loginFeatures = new Label[] { f1, f2, f3 };
            loginLayer.Controls.Add(f1);
            loginLayer.Controls.Add(f2);
            loginLayer.Controls.Add(f3);

            CardPanel card = new CardPanel();
            card.Pal = pal;
            card.Radius = 24;
            loginLayer.Controls.Add(card);
            loginCard = card;

            Label h = MakeLabel("Вход", 16f, FontStyle.Bold, pal.Text);
            h.SetBounds(26, 22, 200, 30);
            card.Controls.Add(h);

            Label sub = MakeLabel("Новый ник создаётся одной кнопкой", 8.75f, FontStyle.Regular, pal.Muted);
            sub.SetBounds(26, 50, 320, 20);
            card.Controls.Add(sub);

            Label l1 = MakeLabel("СЕРВЕР", 7.5f, FontStyle.Bold, pal.Muted);
            l1.SetBounds(26, 84, 200, 16);
            card.Controls.Add(l1);

            txtServer = MakeField(card, "http://127.0.0.1:8777", 26, 100, 348, 36);
            txtServer.Text = settings.Server;

            Label l2 = MakeLabel("НИК", 7.5f, FontStyle.Bold, pal.Muted);
            l2.SetBounds(26, 144, 200, 16);
            card.Controls.Add(l2);

            txtNick = MakeField(card, "maks", 26, 160, 348, 36);
            txtNick.Text = settings.Nick;
            txtNick.MaxLength = 20;

            Label l3 = MakeLabel("ПАРОЛЬ", 7.5f, FontStyle.Bold, pal.Muted);
            l3.SetBounds(26, 204, 200, 16);
            card.Controls.Add(l3);

            txtPass = MakeField(card, "минимум 4 символа", 26, 220, 348, 36);
            txtPass.UseSystemPasswordChar = true;
            txtPass.MaxLength = 64;

            btnLogin = MakeButton("Войти", true);
            btnLogin.SetBounds(26, 276, 168, 42);
            btnLogin.Click += delegate { Login(false); };
            card.Controls.Add(btnLogin);

            btnRegister = MakeButton("Создать ник", false);
            btnRegister.SetBounds(206, 276, 168, 42);
            btnRegister.Click += delegate { Login(true); };
            card.Controls.Add(btnRegister);

            lblLoginError = MakeLabel("", 9f, FontStyle.Regular, Color.FromArgb(255, 122, 122));
            lblLoginError.SetBounds(26, 330, 348, 40);
            card.Controls.Add(lblLoginError);

            Label openSettings = MakeLabel("Настройки: тема, звук, сообщения", 8.5f, FontStyle.Regular, pal.Muted);
            openSettings.SetBounds(26, 384, 348, 20);
            openSettings.Cursor = Cursors.Hand;
            openSettings.Click += delegate { ShowSettings(); };
            card.Controls.Add(openSettings);

            AcceptButton = btnLogin;
        }

        private Label loginTile, loginTitle, loginSubtitle;
        private Label[] loginFeatures;
        private CardPanel loginCard;

        private void BuildChat()
        {
            chatLayer = new Panel();
            chatLayer.BackColor = Color.Transparent;
            chatLayer.Visible = false;
            root.Controls.Add(chatLayer);

            CardPanel rail = new CardPanel();
            rail.Pal = pal;
            rail.Radius = 22;
            chatLayer.Controls.Add(rail);
            railPanel = rail;

            Label logo = MakeLabel("П", 14f, FontStyle.Bold, pal.OnAccent);
            logo.Paint += delegate (object s, PaintEventArgs e)
            {
                Shape.FillRound(e.Graphics, new Rectangle(0, 0, logo.Width - 1, logo.Height - 1), 13, pal.Accent, pal.AccentDeep, 45f);
                using (SolidBrush b = new SolidBrush(pal.OnAccent))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    e.Graphics.DrawString("П", UiFont(13f, FontStyle.Bold), b, new RectangleF(0, 0, logo.Width, logo.Height), sf);
                }
            };
            rail.Controls.Add(logo);
            railLogo = logo;

            railChats = new IconButton();
            railChats.Icon = IconButton.Kind.Chat;
            railChats.Pal = pal;
            railChats.Active = true;
            railChats.Click += delegate { ToggleSidebar(); };
            rail.Controls.Add(railChats);

            railSettings = new IconButton();
            railSettings.Icon = IconButton.Kind.Settings;
            railSettings.Pal = pal;
            railSettings.Click += delegate { ShowSettings(); };
            rail.Controls.Add(railSettings);

            railPower = new IconButton();
            railPower.Icon = IconButton.Kind.Power;
            railPower.Pal = pal;
            railPower.Click += delegate { Logout(); };
            rail.Controls.Add(railPower);

            CardPanel sidebar = new CardPanel();
            sidebar.Pal = pal;
            sidebar.Radius = 22;
            chatLayer.Controls.Add(sidebar);
            sidePanel = sidebar;

            Panel meRow = new Panel();
            meRow.BackColor = Color.Transparent;
            meRow.SetBounds(14, 12, 262, 58);
            sidebar.Controls.Add(meRow);

            Panel avatar = new Panel();
            avatar.SetBounds(0, 6, 44, 44);
            avatar.BackColor = Color.Transparent;
            avatar.Paint += delegate (object s, PaintEventArgs e)
            {
                Shape.FillRound(e.Graphics, new Rectangle(0, 0, 43, 43), 14, pal.Accent, pal.AccentDeep, 45f);
                using (SolidBrush b = new SolidBrush(pal.OnAccent))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    string initial = me.Length > 0 ? me.Substring(0, 1).ToUpperInvariant() : "?";
                    e.Graphics.DrawString(initial, UiFont(14f, FontStyle.Bold), b, new RectangleF(0, 0, 44, 44), sf);
                }
            };
            meRow.Controls.Add(avatar);
            myAvatarPanel = avatar;

            myNickLabel = MakeLabel("—", 11f, FontStyle.Bold, pal.Text);
            myNickLabel.SetBounds(56, 8, 190, 22);
            meRow.Controls.Add(myNickLabel);

            myStatusLabel = MakeLabel("в сети", 8.5f, FontStyle.Regular, pal.Accent);
            myStatusLabel.SetBounds(56, 30, 190, 18);
            meRow.Controls.Add(myStatusLabel);

            Panel divider = new Panel();
            divider.BackColor = pal.Line;
            divider.SetBounds(14, 72, 262, 1);
            sidebar.Controls.Add(divider);
            sideDivider = divider;

            Panel general = new Panel();
            general.BackColor = Color.Transparent;
            general.Cursor = Cursors.Hand;
            general.SetBounds(8, 80, 274, 56);
            general.Paint += delegate (object s, PaintEventArgs e)
            {
                bool active = chat.Length == 0;
                if (active) Shape.FillRound(e.Graphics, new Rectangle(0, 0, general.Width - 1, general.Height - 1), 16, Color.FromArgb(34, pal.Accent));
                if (active) Shape.StrokeRound(e.Graphics, new Rectangle(0, 0, general.Width - 1, general.Height - 1), 16, Color.FromArgb(80, pal.Accent));
                Shape.FillRound(e.Graphics, new Rectangle(12, 11, 34, 34), 11, pal.PanelAlt);
                using (SolidBrush b = new SolidBrush(pal.Accent2))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    e.Graphics.DrawString("#", UiFont(12f, FontStyle.Bold), b, new RectangleF(12, 11, 34, 34), sf);
                }
                using (SolidBrush b = new SolidBrush(pal.Text))
                {
                    e.Graphics.DrawString("Общий чат", UiFont(9.75f, FontStyle.Bold), b, 54, 11);
                }
                using (SolidBrush b = new SolidBrush(pal.Muted))
                {
                    e.Graphics.DrawString("пауза 30 секунд", UiFont(8.25f, FontStyle.Regular), b, 54, 31);
                }
            };
            general.Click += delegate { OpenChat(""); };
            sidebar.Controls.Add(general);
            generalItem = general;

            txtSearch = MakeField(sidebar, "Поиск", 14, 146, 262, 32);
            txtSearch.TextChanged += delegate { RefreshChatList(); };
            txtSearch.KeyDown += delegate (object s, KeyEventArgs e)
            {
                if (e.KeyCode != Keys.Enter) return;
                e.SuppressKeyPress = true;
                SearchGo();
            };

            ChipTab chipsTab = new ChipTab();
            chipsTab.Pal = pal;
            chipsTab.Text = "ЧАТЫ";
            chipsTab.Active = true;
            chipsTab.SetBounds(14, 186, 126, 30);
            chipsTab.Click += delegate { SetSideTab(0); };
            sidebar.Controls.Add(chipsTab);
            tabChats = chipsTab;

            ChipTab friendsTab = new ChipTab();
            friendsTab.Pal = pal;
            friendsTab.Text = "ДРУЗЬЯ";
            friendsTab.SetBounds(150, 186, 126, 30);
            friendsTab.Click += delegate { SetSideTab(1); };
            sidebar.Controls.Add(friendsTab);
            tabFriends = friendsTab;

            lblChatsHeader = MakeLabel("", 7.5f, FontStyle.Bold, pal.Muted);
            lblChatsHeader.Visible = false;
            sidebar.Controls.Add(lblChatsHeader);

            sideToast = new ToastPill();
            sideToast.Pal = pal;
            sidebar.Controls.Add(sideToast);

            lstChats = new ChatList();
            lstChats.Pal = pal;
            lstChats.ItemHeight = settings.Compact ? 44 : 56;
            lstChats.SetBounds(8, 224, 274, 100);
            lstChats.SelectedIndexChanged += delegate { OnChatSelected(); };
            sidebar.Controls.Add(lstChats);

            lblChatTitle = MakeLabel("Общий чат", 15f, FontStyle.Bold, pal.Text);
            chatLayer.Controls.Add(lblChatTitle);

            lblChatSub = MakeLabel("все пользователи", 8.5f, FontStyle.Regular, pal.Muted);
            chatLayer.Controls.Add(lblChatSub);

            lblConnBadge = MakeLabel("онлайн", 8.5f, FontStyle.Bold, pal.Accent);
            lblConnBadge.TextAlign = ContentAlignment.MiddleCenter;
            lblConnBadge.Paint += delegate (object s, PaintEventArgs e)
            {
                Rectangle r = new Rectangle(0, 0, lblConnBadge.Width - 1, lblConnBadge.Height - 1);
                Color line = lblConnBadge.ForeColor;
                Shape.FillRound(e.Graphics, r, 12, Color.FromArgb(26, line));
                Shape.StrokeRound(e.Graphics, r, 12, Color.FromArgb(90, line));
                using (SolidBrush b = new SolidBrush(line))
                using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    e.Graphics.DrawString(lblConnBadge.Text, lblConnBadge.Font, b, r, sf);
                }
            };
            chatLayer.Controls.Add(lblConnBadge);

            IconButton chatSettings = new IconButton();
            chatSettings.Icon = IconButton.Kind.Settings;
            chatSettings.Pal = pal;
            chatSettings.Size = new Size(38, 38);
            chatSettings.Click += delegate { ShowSettings(); };
            chatLayer.Controls.Add(chatSettings);
            chatSettingsBtn = chatSettings;

            messages = new MessageView();
            messages.Pal = pal;
            messages.Me = "";
            chatLayer.Controls.Add(messages);

            CardPanel composer = new CardPanel();
            composer.Pal = pal;
            composer.Radius = 18;
            composer.Shadow = false;
            chatLayer.Controls.Add(composer);
            composerPanel = composer;

            txtMessage = MakeField(composer, "Сообщение…", 12, 10, 200, 36);
            messageShell = (FieldShell)txtMessage.Parent;
            txtMessage.KeyDown += delegate (object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter && !e.Shift)
                {
                    e.SuppressKeyPress = true;
                    if (settings.EnterSend) SendMessage();
                }
            };

            Button send = MakeButton("Отправить", true);
            send.SetBounds(10, 10, 118, 34);
            send.Font = UiFont(9f, FontStyle.Bold);
            send.Click += delegate { SendMessage(); };
            composer.Controls.Add(send);
            sendButton = send;
        }

        private CardPanel railPanel, sidePanel, composerPanel;
        private FieldShell messageShell;
        private Panel sideDivider, generalItem, myAvatarPanel;
        private TextBox txtSearch;
        private ChipTab tabChats, tabFriends;
        private ToastPill sideToast;
        private System.Windows.Forms.Timer toastTimer;
        private int sideTab;
        private readonly List<Person> friendPeople = new List<Person>();
        private Label railLogo;
        private IconButton chatSettingsBtn;
        private Button sendButton;

        private Panel settingsCard;
        private SwatchButton[] swatches;

        private void BuildSettings()
        {
            settingsLayer = new AlphaPanel();
            settingsLayer.BackColor = Color.Transparent;
            settingsLayer.Visible = false;
            root.Controls.Add(settingsLayer);
            settingsLayer.Paint += delegate (object s, PaintEventArgs e)
            {
                using (SolidBrush dim = new SolidBrush(Color.FromArgb(150, 4, 8, 10))) e.Graphics.FillRectangle(dim, settingsLayer.ClientRectangle);
            };

            CardPanel card = new CardPanel();
            card.Pal = pal;
            card.Radius = 24;
            settingsLayer.Controls.Add(card);
            settingsCard = card;

            Label title = MakeLabel("Настройки", 16f, FontStyle.Bold, pal.Text);
            title.SetBounds(28, 24, 300, 30);
            card.Controls.Add(title);

            Label sub = MakeLabel("тема, звук и поведение сообщений", 8.5f, FontStyle.Regular, pal.Muted);
            sub.SetBounds(28, 54, 300, 18);
            card.Controls.Add(sub);

            Button close = MakeButton("Закрыть", false);
            close.SetBounds(436, 26, 96, 32);
            close.Font = UiFont(8.5f, FontStyle.Bold);
            close.Click += delegate { HideSettings(); };
            card.Controls.Add(close);

            Label themesTitle = MakeLabel("ТЕМА", 7.5f, FontStyle.Bold, pal.Muted);
            themesTitle.SetBounds(28, 96, 200, 16);
            card.Controls.Add(themesTitle);

            string[] keys = new string[] { "teal", "sunset", "lavender", "light" };
            string[] names = new string[] { "Бирюза", "Закат", "Лаванда", "Светлая" };
            Color[] from = new Color[] { Color.FromArgb(43, 212, 194), Color.FromArgb(255, 154, 77), Color.FromArgb(139, 124, 255), Color.White };
            Color[] to = new Color[] { Color.FromArgb(13, 77, 71), Color.FromArgb(107, 42, 42), Color.FromArgb(43, 36, 80), Color.FromArgb(207, 217, 226) };

            int swW = (560 - 56 - 3 * 16) / 4;
            swatches = new SwatchButton[keys.Length];
            for (int i = 0; i < keys.Length; i++)
            {
                SwatchButton sw = new SwatchButton();
                sw.Pal = pal;
                sw.Title = names[i];
                sw.From = from[i];
                sw.To = to[i];
                sw.Active = settings.Theme == keys[i];
                sw.Tag = keys[i];
                sw.SetBounds(28 + i * (swW + 16), 118, swW, 84);
                sw.Click += delegate (object s, EventArgs e)
                {
                    SwatchButton node = (SwatchButton)s;
                    settings.Theme = (string)node.Tag;
                    settings.Save();
                    ApplyTheme();
                };
                card.Controls.Add(sw);
                swatches[i] = sw;
            }

            Label soundTitle = MakeLabel("ЗВУК", 7.5f, FontStyle.Bold, pal.Muted);
            soundTitle.SetBounds(28, 226, 200, 16);
            card.Controls.Add(soundTitle);

            ToggleSwitch sound = new ToggleSwitch();
            sound.Pal = pal;
            sound.Checked = settings.Sound;
            sound.SetBounds(28, 250, 46, 26);
            sound.Changed += delegate
            {
                settings.Sound = sound.Checked;
                settings.Save();
            };
            card.Controls.Add(sound);
            soundToggle = sound;

            Label soundLabel = MakeLabel("Звук новых сообщений", 9.5f, FontStyle.Regular, pal.Text);
            soundLabel.SetBounds(86, 251, 320, 24);
            card.Controls.Add(soundLabel);

            Label volumeLabel = MakeLabel("Громкость", 8.75f, FontStyle.Regular, pal.Muted);
            volumeLabel.SetBounds(28, 290, 96, 22);
            card.Controls.Add(volumeLabel);

            ValueSlider volume = new ValueSlider();
            volume.Pal = pal;
            volume.Value = settings.Volume;
            volume.SetBounds(128, 288, 300, 26);
            volume.Changed += delegate
            {
                settings.Volume = volume.Value;
                settings.Save();
                BuildSound();
                volumeValue.Text = settings.Volume + "%";
            };
            card.Controls.Add(volume);
            volumeSlider = volume;

            volumeValue = MakeLabel(settings.Volume + "%", 8.75f, FontStyle.Bold, pal.Text);
            volumeValue.SetBounds(436, 290, 96, 22);
            volumeValue.TextAlign = ContentAlignment.MiddleRight;
            card.Controls.Add(volumeValue);

            Button test = MakeButton("Проверить звук", false);
            test.SetBounds(28, 326, 168, 34);
            test.Font = UiFont(8.5f, FontStyle.Bold);
            test.Click += delegate { PlaySound(); };
            card.Controls.Add(test);

            Label msgTitle = MakeLabel("СООБЩЕНИЯ", 7.5f, FontStyle.Bold, pal.Muted);
            msgTitle.SetBounds(28, 380, 200, 16);
            card.Controls.Add(msgTitle);

            ToggleSwitch enter = new ToggleSwitch();
            enter.Pal = pal;
            enter.Checked = settings.EnterSend;
            enter.SetBounds(28, 404, 46, 26);
            enter.Changed += delegate
            {
                settings.EnterSend = enter.Checked;
                settings.Save();
            };
            card.Controls.Add(enter);
            enterToggle = enter;

            Label enterLabel = MakeLabel("Enter отправляет сообщение", 9.5f, FontStyle.Regular, pal.Text);
            enterLabel.SetBounds(86, 405, 400, 24);
            card.Controls.Add(enterLabel);

            ToggleSwitch compact = new ToggleSwitch();
            compact.Pal = pal;
            compact.Checked = settings.Compact;
            compact.SetBounds(28, 444, 46, 26);
            compact.Changed += delegate
            {
                settings.Compact = compact.Checked;
                settings.Save();
                ApplyCompact();
            };
            card.Controls.Add(compact);
            compactToggle = compact;

            Label compactLabel = MakeLabel("Компактный список чатов", 9.5f, FontStyle.Regular, pal.Text);
            compactLabel.SetBounds(86, 445, 400, 24);
            card.Controls.Add(compactLabel);

            Label slowNote = MakeLabel("В общем чате — пауза 30 секунд между сообщениями", 8.5f, FontStyle.Regular, pal.Muted);
            slowNote.SetBounds(28, 484, 500, 20);
            card.Controls.Add(slowNote);

            Button reset = MakeButton("Сбросить настройки", false);
            reset.SetBounds(28, 526, 200, 36);
            reset.Font = UiFont(8.5f, FontStyle.Bold);
            reset.Click += delegate
            {
                settings.Theme = "teal";
                settings.Sound = true;
                settings.Volume = 60;
                settings.EnterSend = true;
                settings.Compact = false;
                settings.Save();
                ApplyTheme();
                RefreshSettingsUi();
            };
            card.Controls.Add(reset);

            Button done = MakeButton("Готово", true);
            done.SetBounds(352, 526, 180, 36);
            done.Font = UiFont(8.5f, FontStyle.Bold);
            done.Click += delegate { HideSettings(); };
            card.Controls.Add(done);
        }

        private ToggleSwitch soundToggle, enterToggle, compactToggle;
        private ValueSlider volumeSlider;
        private Label volumeValue;

        private void RefreshSettingsUi()
        {
            if (swatches != null)
            {
                foreach (SwatchButton sw in swatches)
                {
                    sw.Active = string.Equals((string)sw.Tag, settings.Theme, StringComparison.OrdinalIgnoreCase);
                    sw.Invalidate();
                }
            }
            if (soundToggle != null) { soundToggle.Checked = settings.Sound; soundToggle.Invalidate(); }
            if (enterToggle != null) { enterToggle.Checked = settings.EnterSend; enterToggle.Invalidate(); }
            if (compactToggle != null) { compactToggle.Checked = settings.Compact; compactToggle.Invalidate(); }
            if (volumeSlider != null) { volumeSlider.Value = settings.Volume; volumeSlider.Invalidate(); }
            if (volumeValue != null) volumeValue.Text = settings.Volume + "%";
        }

        private void ApplyCompact()
        {
            if (lstChats != null)
            {
                lstChats.ItemHeight = settings.Compact ? 44 : 56;
                lstChats.Invalidate();
            }
        }

        private void ApplyTheme()
        {
            pal = Palette.For(settings.Theme);
            bool wasChat = chatLayer != null && chatLayer.Visible;
            if (!wasChat && me.Length > 0) wasChat = token.Length > 0;
            HideSettings();
            root.Pal = pal;
            root.Invalidate();
            CloseLayer();
            BuildLogin();
            BuildChat();
            RebuildOverlay();
            LayoutAll();
            if (wasChat && me.Length > 0)
            {
                ShowChatLayer();
                myNickLabel.Text = me;
                myAvatarPanel.Invalidate();
                messages.Me = me;
                lblChatTitle.Text = chat.Length > 0 ? chat : "Общий чат";
                lblChatSub.Text = chat.Length > 0 ? "личные сообщения" : "все пользователи";
                if (generalItem != null) generalItem.Invalidate();
            }
            RefreshChatList();
            RenderMessages();
        }

        private void RebuildOverlay()
        {
            BuildSettings();
            LayoutAll();
        }

        private void CloseLayer()
        {
            List<Control> doomed = new List<Control>();
            foreach (Control c in root.Controls)
            {
                if (c != root) doomed.Add(c);
            }
            foreach (Control c in doomed) c.Dispose();
        }

        private sealed class AlphaPanel : Panel
        {
            public AlphaPanel()
            {
                SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
            }
        }

        private void LayoutAll()
        {
            if (root == null) return;
            int w = root.ClientSize.Width;
            int h = root.ClientSize.Height;
            if (w <= 0 || h <= 0) return;

            if (loginLayer != null && loginLayer.Visible)
            {
                loginLayer.SetBounds(0, 0, w, h);
                int cardW = 400;
                int cardH = 430;
                int cardX = (int)(w * 0.56);
                if (cardX + cardW > w - 40) cardX = w - cardW - 40;
                if (cardX < 24) cardX = Math.Max(24, (w - cardW) / 2);
                loginCard.SetBounds(cardX, (h - cardH) / 2, cardW, cardH);

                int heroX = Math.Max(40, cardX - 470);
                int heroY = (h - 300) / 2;
                loginTile.SetBounds(heroX, heroY, 62, 62);
                loginTitle.SetBounds(heroX + 80, heroY - 4, 340, 40);
                loginSubtitle.SetBounds(heroX + 82, heroY + 34, 340, 24);
                for (int i = 0; i < loginFeatures.Length; i++)
                {
                    loginFeatures[i].SetBounds(heroX, heroY + 96 + i * 30, 380, 24);
                }
            }

            if (chatLayer != null && chatLayer.Visible)
            {
                chatLayer.SetBounds(0, 0, w, h);
                int pad = 16;
                int railW = 76;
                int sideW = 288;
                railPanel.SetBounds(pad, pad, railW, h - pad * 2);
                railLogo.SetBounds((railW - 42) / 2, 14, 42, 42);
                railChats.SetBounds((railW - 46) / 2, 74, 46, 46);
                railSettings.SetBounds((railW - 46) / 2, 128, 46, 46);
                railPower.SetBounds((railW - 46) / 2, h - pad * 2 - 60, 46, 46);

                sidePanel.SetBounds(pad + railW + 12, pad, sideW, h - pad * 2);
                lstChats.SetBounds(8, 224, sideW - 16, sidePanel.Height - 262);
                if (sideToast != null) sideToast.SetBounds(16, sidePanel.Height - 42, sideW - 32, 26);

                int paneX = pad + railW + 12 + sideW + 14;
                int paneW = w - paneX - pad;
                lblChatTitle.SetBounds(paneX + 6, pad + 2, 420, 28);
                lblChatSub.SetBounds(paneX + 7, pad + 30, 420, 20);
                lblConnBadge.SetBounds(paneX + paneW - 190, pad + 12, 86, 26);
                chatSettingsBtn.SetBounds(paneX + paneW - 46, pad + 6, 38, 38);

                int msgTop = pad + 62;
                int composerH = 56;
                int msgH = h - pad - composerH - 12 - msgTop;
                messages.SetBounds(paneX + 2, msgTop, paneW - 14, msgH);
                composerPanel.SetBounds(paneX, msgTop + msgH + 12, paneW, composerH);
                sendButton.SetBounds(composerPanel.Width - 128, 10, 118, 36);
                if (messageShell != null) messageShell.SetBounds(12, 10, composerPanel.Width - 128 - 24, 36);
            }

            if (settingsLayer != null && settingsLayer.Visible)
            {
                settingsLayer.SetBounds(0, 0, w, h);
                int cw = 560;
                int chh = 600;
                settingsCard.SetBounds(Math.Max(20, (w - cw) / 2), Math.Max(20, (h - chh) / 2), cw, chh);
            }
            root.Invalidate();
        }

        private void ToggleSidebar()
        {
            sidePanel.Visible = !sidePanel.Visible;
        }

        private void ShowSettings()
        {
            settingsLayer.Visible = true;
            settingsLayer.BringToFront();
            RefreshSettingsUi();
            LayoutAll();
        }

        private void HideSettings()
        {
            if (settingsLayer != null) settingsLayer.Visible = false;
        }

        private void ShowChatLayer()
        {
            loginLayer.Visible = false;
            chatLayer.Visible = true;
            chatLayer.BringToFront();
            settingsLayer.Visible = false;
            LayoutAll();
        }

        private void Login(bool create)
        {
            lblLoginError.Text = "";
            string server = txtServer.Text.Trim();
            if (server.Length == 0) server = "http://127.0.0.1:8777";
            if (!server.StartsWith("http", StringComparison.OrdinalIgnoreCase)) server = "http://" + server;
            Api.Base = server;

            string nick = txtNick.Text.Trim();
            string pass = txtPass.Text;
            if (nick.Length == 0) { lblLoginError.Text = "впиши ник"; return; }
            if (pass.Length < 4) { lblLoginError.Text = "пароль: минимум 4 символа"; return; }

            btnLogin.Enabled = false;
            btnRegister.Enabled = false;
            Dictionary<string, object> data = new Dictionary<string, object>();
            data["nick"] = nick;
            data["password"] = pass;
            string action = create ? "register" : "login";

            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> res = Api.Call(action, data);
                BeginInvoke((Action)delegate
                {
                    btnLogin.Enabled = true;
                    btnRegister.Enabled = true;
                    if (res == null) { lblLoginError.Text = "сервер не отвечает: проверь адрес"; return; }
                    if (!Api.Bool(res, "ok"))
                    {
                        string error = Api.Str(res, "error");
                        lblLoginError.Text = error.Length > 0 ? error : "не вышло войти";
                        return;
                    }
                    settings.Server = server;
                    settings.Nick = Api.Str(res, "nick");
                    settings.Token = Api.Str(res, "token");
                    settings.Save();
                    EnterChat(settings.Nick, settings.Token);
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void TryRestore()
        {
            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["token"] = settings.Token;
                Dictionary<string, object> res = Api.Call("whoami", data);
                if (res != null && Api.Bool(res, "ok"))
                {
                    string nick = Api.Str(res, "nick");
                    BeginInvoke((Action)delegate { EnterChat(nick, settings.Token); });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void EnterChat(string nick, string sessionToken)
        {
            me = nick;
            token = sessionToken;
            myNickLabel.Text = nick;
            myAvatarPanel.Invalidate();
            messages.Me = nick;
            ShowChatLayer();
            lstChats.Items.Clear();
            since = 0;
            all.Clear();
            chat = "";
            OpenChat("");
            LoadHistory("");
            StartPolling();
            SetSideTab(0);
            LoadFriends();
        }

        private void Logout()
        {
            token = "";
            me = "";
            all.Clear();
            people.Clear();
            unread.Clear();
            chat = "";
            since = 0;
            settings.Token = "";
            settings.Save();
            chatLayer.Visible = false;
            loginLayer.Visible = true;
            loginLayer.BringToFront();
            txtPass.Text = "";
            LayoutAll();
        }

        private void OpenChat(string nick)
        {
            chat = nick ?? "";
            if (chat.Length > 0) unread[chat.ToLowerInvariant()] = 0;
            lblChatTitle.Text = chat.Length > 0 ? chat : "Общий чат";
            lblChatSub.Text = chat.Length > 0 ? "личные сообщения" : "все пользователи";
            if (generalItem != null) generalItem.Invalidate();
            RenderMessages();
            LoadHistory(chat);
            if (txtMessage != null) txtMessage.Focus();
        }

        private void LoadHistory(string with)
        {
            string localToken = token;
            string localWith = with;
            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["token"] = localToken;
                data["with"] = localWith;
                data["limit"] = 200;
                Dictionary<string, object> res = Api.Call("history", data);
                if (res == null || !Api.Bool(res, "ok")) return;
                List<Msg> list = ParseMessages(res);
                BeginInvoke((Action)delegate
                {
                    foreach (Msg m in list)
                    {
                        bool exists = false;
                        for (int i = 0; i < all.Count; i++)
                        {
                            if (all[i].Id == m.Id) { exists = true; break; }
                        }
                        if (!exists) all.Add(m);
                        if (m.Id > since) since = m.Id;
                    }
                    ApplyUsers(res);
                    RenderMessages();
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void StartPolling()
        {
            Thread worker = new Thread(delegate ()
            {
                while (running)
                {
                    string localToken = token;
                    if (localToken.Length == 0) { Thread.Sleep(300); continue; }

                    Dictionary<string, object> data = new Dictionary<string, object>();
                    data["token"] = localToken;
                    data["since"] = since;
                    Dictionary<string, object> res = Api.Call("poll", data);

                    if (res == null) { Thread.Sleep(1500); continue; }
                    if (!Api.Bool(res, "ok"))
                    {
                        string error = Api.Str(res, "error");
                        if (error.IndexOf("сессия", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            BeginInvoke((Action)delegate
                            {
                                Logout();
                                lblLoginError.Text = "сессия истекла, войди заново";
                            });
                        }
                        Thread.Sleep(1000);
                        continue;
                    }

                    List<Msg> fresh = ParseMessages(res);
                    long maxId = since;
                    for (int i = 0; i < fresh.Count; i++) if (fresh[i].Id > maxId) maxId = fresh[i].Id;
                    if (maxId > since) since = maxId;

                    Dictionary<string, object> snapshot = res;
                    BeginInvoke((Action)delegate
                    {
                        bool added = false;
                        foreach (Msg m in fresh)
                        {
                            bool exists = false;
                            for (int i = 0; i < all.Count; i++)
                            {
                                if (all[i].Id == m.Id) { exists = true; break; }
                            }
                            if (exists) continue;
                            all.Add(m);
                            added = true;
                            string key = m.To.Length == 0 ? "" : (string.Equals(m.From, me, StringComparison.OrdinalIgnoreCase) ? m.To : m.From);
                            if (!string.Equals(key, chat, StringComparison.OrdinalIgnoreCase)
                                && !string.Equals(m.From, me, StringComparison.OrdinalIgnoreCase))
                            {
                                int count;
                                unread.TryGetValue(key.ToLowerInvariant(), out count);
                                unread[key.ToLowerInvariant()] = count + 1;
                            }
                        }
                        ApplyUsers(snapshot);
                        if (added)
                        {
                            RenderMessages();
                            PlaySound();
                        }
                    });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private List<Msg> ParseMessages(Dictionary<string, object> res)
        {
            List<Msg> list = new List<Msg>();
            object raw;
            if (res == null || !res.TryGetValue("messages", out raw) || raw == null) return list;
            object[] items = raw as object[];
            if (items == null) return list;
            foreach (object item in items)
            {
                Dictionary<string, object> d = item as Dictionary<string, object>;
                if (d == null) continue;
                Msg m = new Msg();
                m.Id = Api.Long(d, "id");
                m.From = Api.Str(d, "from");
                m.To = Api.Str(d, "to");
                m.Text = Api.Str(d, "text");
                m.Ts = Api.Long(d, "ts");
                list.Add(m);
            }
            return list;
        }

        private void ApplyUsers(Dictionary<string, object> res)
        {
            object raw;
            if (res == null || !res.TryGetValue("users", out raw) || raw == null) return;
            object[] items = raw as object[];
            if (items == null) return;

            people.Clear();
            foreach (object item in items)
            {
                Dictionary<string, object> d = item as Dictionary<string, object>;
                if (d == null) continue;
                Person p = new Person();
                p.Nick = Api.Str(d, "nick");
                p.Online = Api.Bool(d, "online");
                p.LastSeen = Api.Long(d, "lastSeen");
                if (p.Nick.Length == 0) continue;
                if (string.Equals(p.Nick, me, StringComparison.OrdinalIgnoreCase)) continue;
                people.Add(p);
            }
            RefreshChatList();
        }

        private void RefreshChatList()
        {
            if (lstChats == null) return;

            string keep = chat;
            bool wasActive = chatLayer.Visible;
            string query = txtSearch == null ? "" : txtSearch.Text.Trim().ToLowerInvariant();

            List<Person> source = sideTab == 1 ? new List<Person>(friendPeople) : ChatPeople();

            suppressSelect = true;
            lstChats.BeginUpdate();
            lstChats.Items.Clear();
            int shown = 0;
            foreach (Person p in source)
            {
                if (query.Length > 0 && p.Nick.ToLowerInvariant().IndexOf(query) < 0) continue;
                int count;
                unread.TryGetValue(p.Nick.ToLowerInvariant(), out count);
                lstChats.Items.Add(new ChatEntry { Nick = p.Nick, Title = p.Nick, Online = p.Online, Unread = count });
                shown++;
            }
            if (shown == 0)
            {
                string hint;
                if (query.Length > 0)
                {
                    hint = "Никого не нашли по «" + query + "»";
                }
                else if (sideTab == 1)
                {
                    hint = "Друзей пока нет: впиши ник выше и нажми Enter";
                }
                else
                {
                    hint = "Переписок пока нет: найди друга во вкладке Друзья";
                }
                ChatEntry empty = new ChatEntry { Nick = "", Title = hint };
                lstChats.Items.Add(empty);
            }
            lstChats.EndUpdate();
            lstChats.SelectedIndex = -1;
            suppressSelect = false;
            lstChats.Invalidate();
            if (wasActive && keep.Length > 0)
            {
                lblChatTitle.Text = keep;
            }
        }

        private List<Person> ChatPeople()
        {
            Dictionary<string, long> last = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            foreach (Msg m in all)
            {
                if (m.To.Length == 0) continue;
                string other;
                if (string.Equals(m.From, me, StringComparison.OrdinalIgnoreCase)) other = m.To;
                else if (string.Equals(m.To, me, StringComparison.OrdinalIgnoreCase)) other = m.From;
                else continue;
                if (other.Length == 0) continue;
                if (string.Equals(other, me, StringComparison.OrdinalIgnoreCase)) continue;
                string k = other.ToLowerInvariant();
                long prev;
                if (!last.TryGetValue(k, out prev) || m.Ts > prev) last[k] = m.Ts;
            }

            List<Person> result = new List<Person>();
            foreach (KeyValuePair<string, long> pair in last)
            {
                Person found = null;
                foreach (Person p in people)
                {
                    if (string.Equals(p.Nick, pair.Key, StringComparison.OrdinalIgnoreCase)) { found = p; break; }
                }
                if (found == null)
                {
                    found = new Person();
                    found.Nick = pair.Key;
                }
                result.Add(found);
            }
            result.Sort(delegate (Person a, Person b)
            {
                long ta, tb;
                last.TryGetValue(a.Nick.ToLowerInvariant(), out ta);
                last.TryGetValue(b.Nick.ToLowerInvariant(), out tb);
                return tb.CompareTo(ta);
            });
            return result;
        }

        private void SetSideTab(int index)
        {
            sideTab = index == 1 ? 1 : 0;
            if (tabChats != null) { tabChats.Active = sideTab == 0; tabChats.Invalidate(); }
            if (tabFriends != null) { tabFriends.Active = sideTab == 1; tabFriends.Invalidate(); }
            RefreshChatList();
            if (sideTab == 1) LoadFriends();
        }

        private void SearchGo()
        {
            if (txtSearch == null) return;
            string query = txtSearch.Text.Trim();
            if (query.Length == 0) return;

            if (sideTab == 1)
            {
                AddFriend(query);
                return;
            }

            if (lstChats.Items.Count > 0)
            {
                lstChats.SelectedIndex = 0;
            }
        }

        private void AddFriend(string nick)
        {
            string local = token;
            Dictionary<string, object> data = new Dictionary<string, object>();
            data["token"] = local;
            data["nick"] = nick;

            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> res = Api.Call("friend-add", data);
                BeginInvoke((Action)delegate
                {
                    if (res == null) { Toast("сервер не отвечает", pal.Accent2); return; }
                    if (!Api.Bool(res, "ok")) { Toast(Api.Str(res, "error"), pal.Accent2); return; }
                    if (txtSearch != null) txtSearch.Text = "";
                    Toast("в друзьях: " + nick, pal.Accent);
                    LoadFriends();
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void LoadFriends()
        {
            string local = token;
            if (local.Length == 0) return;
            Dictionary<string, object> data = new Dictionary<string, object>();
            data["token"] = local;

            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> res = Api.Call("friends", data);
                if (res == null || !Api.Bool(res, "ok")) return;
                object raw;
                if (!res.TryGetValue("friends", out raw) || raw == null) return;
                object[] items = raw as object[];
                if (items == null) return;

                List<Person> next = new List<Person>();
                foreach (object item in items)
                {
                    Dictionary<string, object> d = item as Dictionary<string, object>;
                    if (d == null) continue;
                    Person p = new Person();
                    p.Nick = Api.Str(d, "nick");
                    p.Online = Api.Bool(d, "online");
                    p.LastSeen = Api.Long(d, "lastSeen");
                    if (p.Nick.Length > 0) next.Add(p);
                }

                BeginInvoke((Action)delegate
                {
                    friendPeople.Clear();
                    friendPeople.AddRange(next);
                    RefreshChatList();
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        private void Toast(string text, Color color)
        {
            if (sideToast == null) return;
            sideToast.Text = text;
            sideToast.ForeColor = color;
            if (toastTimer == null)
            {
                toastTimer = new System.Windows.Forms.Timer();
                toastTimer.Interval = 4000;
                toastTimer.Tick += delegate
                {
                    toastTimer.Stop();
                    if (sideToast != null) sideToast.Text = "";
                };
            }
            toastTimer.Stop();
            toastTimer.Start();
        }

        private void OnChatSelected()
        {
            if (suppressSelect) return;
            ChatEntry entry = lstChats.SelectedItem as ChatEntry;
            if (entry == null || entry.General) return;
            if (entry.Nick.Length == 0) return;
            string nick = entry.Nick;
            chat = nick;
            unread[nick.ToLowerInvariant()] = 0;
            lblChatTitle.Text = nick;
            lblChatSub.Text = "личные сообщения";
            if (generalItem != null) generalItem.Invalidate();
            RenderMessages();
            LoadHistory(nick);
        }

        private void RenderMessages()
        {
            List<Msg> list = new List<Msg>();
            foreach (Msg m in all)
            {
                if (chat.Length == 0)
                {
                    if (m.To.Length == 0) list.Add(m);
                }
                else
                {
                    bool mine = string.Equals(m.From, me, StringComparison.OrdinalIgnoreCase);
                    bool toMe = string.Equals(m.To, me, StringComparison.OrdinalIgnoreCase);
                    bool toOther = string.Equals(m.To, chat, StringComparison.OrdinalIgnoreCase);
                    bool fromOther = string.Equals(m.From, chat, StringComparison.OrdinalIgnoreCase);
                    if ((mine && toOther) || (fromOther && toMe)) list.Add(m);
                }
            }
            list.Sort(delegate (Msg a, Msg b) { return a.Id.CompareTo(b.Id); });
            messages.Me = me;
            bool atEnd = messages.AtEnd;
            messages.SetItems(list);
            if (atEnd) messages.ScrollToEnd();
        }

        private void SendMessage()
        {
            string text = txtMessage.Text.Trim();
            if (text.Length == 0 || token.Length == 0) return;
            txtMessage.Text = "";
            string localToken = token;
            string localChat = chat;

            Thread worker = new Thread(delegate ()
            {
                Dictionary<string, object> data = new Dictionary<string, object>();
                data["token"] = localToken;
                data["to"] = localChat;
                data["text"] = text;
                Dictionary<string, object> res = Api.Call("send", data);
                if (res == null || !Api.Bool(res, "ok"))
                {
                    BeginInvoke((Action)delegate
                    {
                        lblChatSub.Text = res == null ? "нет связи с сервером" : Api.Str(res, "error");
                    });
                    return;
                }
                object raw;
                if (!res.TryGetValue("message", out raw)) return;
                Dictionary<string, object> d = raw as Dictionary<string, object>;
                if (d == null) return;
                Msg m = new Msg();
                m.Id = Api.Long(d, "id");
                m.From = Api.Str(d, "from");
                m.To = Api.Str(d, "to");
                m.Text = Api.Str(d, "text");
                m.Ts = Api.Long(d, "ts");
                BeginInvoke((Action)delegate
                {
                    bool exists = false;
                    for (int i = 0; i < all.Count; i++) if (all[i].Id == m.Id) { exists = true; break; }
                    if (!exists) all.Add(m);
                    if (m.Id > since) since = m.Id;
                    RenderMessages();
                    messages.ScrollToEnd();
                });
            });
            worker.IsBackground = true;
            worker.Start();
        }
    }

    internal static class Log
    {
        private static readonly object gate = new object();
        private static string file;

        private static string FilePath()
        {
            if (file != null) return file;
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Priks");
            Directory.CreateDirectory(dir);
            file = Path.Combine(dir, "client.log");
            return file;
        }

        public static void Write(string text)
        {
            try
            {
                lock (gate)
                {
                    File.AppendAllText(FilePath(), DateTime.Now.ToString("HH:mm:ss.fff") + "  " + text + "\n", new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Log.Write("=== клиент запущен ===");
            AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
            {
                Log.Write("НЕОБРАБОТАННОЕ: " + Convert.ToString(e.ExceptionObject));
            };
            Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e)
            {
                Log.Write("ОШИБКА UI: " + e.Exception);
            };
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new ClientForm());
            }
            catch (Exception ex)
            {
                Log.Write("ПАДЕНИЕ: " + ex);
                throw;
            }
            Log.Write("=== клиент закрыт ===");
        }
    }
}
