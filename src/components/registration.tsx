"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { RegistrationState } from "@/lib/initial-registration";

export default function Registration({ state }: { state: RegistrationState }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [closed, setClosed] = useState(state === "closed");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirmation")) {
      setError("Las contraseñas no coinciden.");
      setBusy(false);
      return;
    }
    try {
      const r = await fetch("/api/initial-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: f.get("code"),
          email: f.get("email"),
          password: f.get("password"),
          confirmation: f.get("confirmation"),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (r.status === 409) setClosed(true);
        throw new Error(data.error);
      }
      location.assign("/login?created=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la cuenta.");
      setBusy(false);
    }
  }
  const available = state === "available" && !closed;
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand">
          <span className="brand-mark">p</span>PayAdmin
          <span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">TU ESPACIO. TU PLAN.</span>
          <h1>
            Empieza con
            <br />
            tranquilidad.
          </h1>
          <p>
            Crea tu acceso privado y lleva tus cuentas
            <br />
            desde cualquier dispositivo.
          </p>
        </div>
        <small>USD · America/Panama · Espacio privado</small>
      </section>
      <section className="login-card registration-card">
        <span className="lock-icon">
          <LockKeyhole size={24} />
        </span>
        <h2>
          {available
            ? "Crea tu cuenta privada"
            : closed
              ? "Tu cuenta ya está creada"
              : state === "database_pending"
                ? "Conexión pendiente"
                : "Creación de cuenta deshabilitada"}
        </h2>
        <p>
          {available
            ? "Usa tu código de creación para elegir tu correo y contraseña. Este registro se cerrará al crear la primera cuenta."
            : closed
              ? "Inicia sesión con tu correo y contraseña."
              : state === "database_pending"
                ? "Comprueba la conexión a PostgreSQL y las migraciones antes de crear tu cuenta."
                : "Habilita el código temporal de creación en las variables del servicio web de Railway."}
        </p>
        {available && (
          <form onSubmit={submit}>
            <label>
              Código de creación
              <input
                name="code"
                type="password"
                autoComplete="off"
                required
                maxLength={256}
              />
            </label>
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                aria-label="Contraseña"
                aria-describedby="registration-password-hint"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
              />
              <small className="field-hint" id="registration-password-hint">
                Al menos 14 caracteres.
              </small>
            </label>
            <label>
              Confirmar contraseña
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={14}
                maxLength={256}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "Creando cuenta…" : "Crear mi cuenta"}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        {!available && error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Link href="/login" className="registration-link">
          Ir a iniciar sesión
        </Link>
        <small className="private-note">
          <LockKeyhole size={13} /> Acceso privado · Una sola cuenta inicial
        </small>
      </section>
    </main>
  );
}
