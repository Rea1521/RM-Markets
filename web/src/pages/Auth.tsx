import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { post } from "../api/client";
import { GOOGLE_CLIENT_ID } from "../api/config";
import { I } from "../components/Icons";
import { useAuth } from "../store/auth";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const setSession = useAuth((s) => s.setSession);
  const token = useAuth((s) => s.accessToken);
  const [form, setForm] = useState({ identifier: "", email: "", username: "", password: "", display_name: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const googleRef = useRef<HTMLDivElement>(null);
  const dest = loc.state?.from || "/";

  useEffect(() => { if (token) nav(dest, { replace: true }); }, [token, nav, dest]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleRef.current) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      const g = (window as any).google;
      g?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (r: any) => {
          try { setSession(await post("/api/auth/oauth/google", { id_token: r.credential })); } catch (e) { setError((e as Error).message); }
        },
      });
      g?.accounts.id.renderButton(googleRef.current, { theme: "outline", size: "large", width: 360, text: mode === "login" ? "signin_with" : "signup_with" });
    };
    document.body.appendChild(s);
    return () => { s.remove(); };
  }, [mode, setSession]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = mode === "login"
        ? await post("/api/auth/login", { identifier: form.identifier, password: form.password })
        : await post("/api/auth/register", { email: form.email, username: form.username, password: form.password, display_name: form.display_name || undefined });
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async () => {
    setBusy(true);
    try { setSession(await post("/api/auth/demo")); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div className="brand" style={{ color: "#fff", padding: 0 }}><span className="brand-mark" style={{ color: "#93c5fd" }}>RM</span> RM Markets</div>
        <div className="col gap-16">
          <h1>Practice trading with live markets. Zero risk.</h1>
          <p>Trade stocks, crypto, forex, commodities and indices with a $100,000 virtual balance. Learn with real-time charts, technical indicators, backtesting and performance analytics.</p>
          <div className="feature-list">
            {["Live WebSocket prices", "RSI, MACD, Bollinger, MAs", "Options with Greeks", "Walk-forward backtester", "Portfolio stress testing", "Paper trading competitions", "Trading journal & analytics", "Voice commands"].map((f) => (
              <div key={f}><I.check width={14} />{f}</div>
            ))}
          </div>
        </div>
        <div className="small" style={{ color: "#9db7f5" }}>Educational demo platform. No real money is ever traded.</div>
      </div>
      <div className="auth-form">
        <div className="auth-card card card-pad">
          <h1 style={{ marginBottom: 4 }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p className="muted" style={{ marginTop: 0 }}>{mode === "login" ? "Sign in to your demo trading account." : "Start with $100,000 in virtual funds."}</p>
          <form className="col gap-12" onSubmit={submit}>
            {mode === "login" ? (
              <label className="field">Email or username<input className="input" autoComplete="username" required value={form.identifier} onChange={set("identifier")} /></label>
            ) : (
              <>
                <label className="field">Email<input className="input" type="email" autoComplete="email" required value={form.email} onChange={set("email")} /></label>
                <div className="grid g-2" style={{ gap: 10 }}>
                  <label className="field">Username<input className="input" required minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" value={form.username} onChange={set("username")} /></label>
                  <label className="field">Display name<input className="input" maxLength={80} value={form.display_name} onChange={set("display_name")} /></label>
                </div>
              </>
            )}
            <label className="field">Password
              <input className="input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 8 : 1} value={form.password} onChange={set("password")} />
              {mode === "register" && <span className="tiny faint">At least 8 characters with letters and numbers.</span>}
            </label>
            {error && <div className="notice error">{error}</div>}
            <button className="btn primary block" style={{ height: 40 }} disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
          </form>
          <div className="row" style={{ margin: "14px 0", color: "var(--faint)" }}><div className="grow" style={{ height: 1, background: "var(--border)" }} /><span className="tiny">OR</span><div className="grow" style={{ height: 1, background: "var(--border)" }} /></div>
          <div className="col gap-12">
            {GOOGLE_CLIENT_ID && <div ref={googleRef} style={{ display: "flex", justifyContent: "center" }} />}
            <button className="btn block" style={{ height: 40 }} onClick={demo} disabled={busy}><I.bolt width={16} />Try instantly as a guest</button>
          </div>
          <p className="small muted center mt-16">
            {mode === "login" ? <>New to RM Markets? <Link to="/register">Create an account</Link></> : <>Already have an account? <Link to="/login">Sign in</Link></>}
          </p>
        </div>
      </div>
    </div>
  );
}
