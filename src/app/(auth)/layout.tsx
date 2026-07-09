import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-r border-[var(--color-border)] bg-field lg:block">
        <div className="absolute inset-0 opacity-70" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--color-brand)] font-display text-base font-bold text-white shadow-[var(--shadow-glow)]">
              O
            </span>
            <span className="font-display text-lg font-semibold">OOVIE</span>
          </Link>

          <div>
            <h2 className="max-w-md font-display text-4xl font-semibold leading-tight tracking-tight text-gradient">
              Business development, as an operating system.
            </h2>
            <p className="mt-4 max-w-md text-[var(--color-ink-muted)]">
              Pipeline, lead scoring, industry strategy and an AI copilot — one
              intelligent workspace for the OOVIE team.
            </p>
          </div>

          <p className="text-sm text-[var(--color-ink-faint)]">
            © OOVIE Studios · Business Development Intelligence
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
