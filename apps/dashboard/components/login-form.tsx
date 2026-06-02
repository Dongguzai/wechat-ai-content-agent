"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

export function LoginForm({
  nextPath,
  authConfigured
}: {
  nextPath: string;
  authConfigured: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setMessage(payload.error ?? "登录失败。");
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-20 max-w-sm border border-line bg-white p-6 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
        Dashboard Login
      </p>
      <h2 className="mt-3 text-2xl font-bold text-ink">访问工作台</h2>
      <label className="mt-5 block text-sm font-semibold text-stone-700" htmlFor="dashboard-password">
        密码
      </label>
      <input
        id="dashboard-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={!authConfigured || isSubmitting}
        className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-ink"
        autoComplete="current-password"
      />
      <button
        type="submit"
        disabled={!authConfigured || isSubmitting || !password}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        <LogIn className="size-4" aria-hidden="true" />
        登录
      </button>
      {!authConfigured ? (
        <p className="mt-3 text-sm leading-6 text-amber-700">
          请先配置 DASHBOARD_PASSWORD 和 AUTH_SECRET。
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm leading-6 text-red-700">{message}</p> : null}
    </form>
  );
}
