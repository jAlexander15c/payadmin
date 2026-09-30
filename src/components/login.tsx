"use client";
import { useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: f.get("email"),
          password: f.get("password"),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      location.assign("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand">
          <span className="brand-mark">p</span>PayAdmin
          <span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">MENOS INCERTIDUMBRE. MÁS CONTROL.</span>
          <h1>
            Tu tranquilidad,
            <br />
            en números.
          </h1>
          <p>
            Un espacio para entender tu deuda,
            <br />
            organizar tus aportes y mirar hacia adelante.
          </p>
        </div>
        <small>USD · America/Panama · Espacio privado</small>
      </section>
      <section className="login-card">
        <span className="lock-icon">
          <LockKeyhole size={24} />
        </span>
        <h2>Bienvenido a tu espacio</h2>
        <p>Inicia sesión para continuar con tu plan.</p>
        <form onSubmit={submit}>
          <label>
            Correo electrónico
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              placeholder="tu@correo.com"
            />
          </label>
          <label>
            Contraseña
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar a PayAdmin"}
            <ArrowRight size={18} />
          </button>
        </form>
        <small className="private-note">
          <LockKeyhole size={13} /> Acceso privado · Sin registro público
        </small>
      </section>
    </main>
  );
}
