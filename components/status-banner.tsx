import type { ReactNode } from "react";

export function StatusBanner({
  tone,
  children
}: {
  tone: "error" | "info" | "success";
  children: ReactNode;
}) {
  const toneClass = {
    error: "border-red-200 bg-red-50 text-red-700",
    info: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700"
  }[tone];

  return (
    <div
      aria-live={tone === "error" ? "assertive" : "polite"}
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}
    >
      {children}
    </div>
  );
}
