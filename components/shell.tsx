import Link from "next/link";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/constants";

export function AppShell({
  children,
  title,
  subtitle
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6 sm:px-6">
      <div className="mb-6">
        <Link
          className="text-sm font-medium uppercase tracking-[0.25em] text-accent transition hover:text-teal-700"
          href="/"
        >
          {APP_NAME}
        </Link>
        <h1 className="mt-3 text-3xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
      </div>
      <section className="flex-1 rounded-[28px] border border-border bg-white/90 p-5 shadow-card backdrop-blur">
        {children}
      </section>
    </main>
  );
}
