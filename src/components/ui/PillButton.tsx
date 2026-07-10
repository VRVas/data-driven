"use client";

/**
 * PillButton — the platform's signature ghost pill. A frosted-cream label
 * inside a hairline pill that inverts to a solid fill on hover, with an
 * optional magnetic pull toward the cursor. Renders a Next `Link` when `href`
 * is set, otherwise a `<button>`.
 */
import { forwardRef } from "react";
import Link from "next/link";
import clsx from "clsx";
import { useMagnetic } from "@/lib/gsap/hooks/useMagnetic";

type Variant = "ghost" | "solid";
type Size = "sm" | "md";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  magnetic?: boolean;
  className?: string;
  children: React.ReactNode;
}

type AnchorProps = BaseProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & { href: string };
type ButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & { href?: undefined };

const base =
  "group relative inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold leading-none tracking-[-0.16px] transition-[background-color,color,border-color,transform] duration-300 ease-[var(--ease-brand-snap)] disabled:cursor-not-allowed disabled:opacity-50";

const sizes: Record<Size, string> = {
  sm: "px-4 py-2.5 text-[15px]",
  md: "px-6 py-[15px] text-base",
};

const variants: Record<Variant, string> = {
  ghost:
    "border border-[var(--color-frosted-canvas)] text-[var(--color-frosted-canvas)] hover:bg-[var(--color-frosted-canvas)] hover:text-[var(--color-absolute-zero)]",
  solid:
    "border border-transparent bg-[var(--color-frosted-canvas)] text-[var(--color-absolute-zero)] hover:brightness-90",
};

export const PillButton = forwardRef<HTMLAnchorElement | HTMLButtonElement, AnchorProps | ButtonProps>(
  function PillButton({ variant = "ghost", size = "md", magnetic = true, className, children, ...rest }, _ref) {
    const magRef = useMagnetic<HTMLElement>(0.3);
    const cls = clsx(base, sizes[size], variants[variant], className);
    const ref = (magnetic ? magRef : undefined) as never;

    if ("href" in rest && rest.href !== undefined) {
      const { href, ...anchor } = rest as AnchorProps;
      return (
        <Link href={href} ref={ref} className={cls} {...anchor}>
          {children}
        </Link>
      );
    }
    const buttonProps = rest as ButtonProps;
    return (
      <button ref={ref} className={cls} {...buttonProps}>
        {children}
      </button>
    );
  },
);
