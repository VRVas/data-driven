"use client";

/**
 * Landing hero - the platform's showcase moment.
 *
 * A mono eyebrow, an oversized display headline whose characters resolve out of
 * a blurred spotlight (from the centre outward), a word-by-word subhead, and
 * the magnetic gradient CTA - all over a living aurora + particle canvas.
 * Reduced-motion users get the finished frame with no animation.
 */
import { useRef } from "react";
import { gsap, useGSAP, SplitText } from "@/lib/gsap/register";
import { ease, staggers, durations } from "@/lib/motion";
import { AuroraBackground } from "@/components/fx/AuroraBackground";
import { ParticleField } from "@/components/fx/ParticleField";
import { MagneticCTA } from "@/components/ui/MagneticCTA";
import { PillButton } from "@/components/ui/PillButton";

interface Props {
  leadCount: number;
}

export function Hero({ leadCount }: Props) {
  const scope = useRef<HTMLDivElement>(null);
  const headline = useRef<HTMLHeadingElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);

  useGSAP(
    () => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        gsap.set([headline.current, sub.current, ".hero-rest"], { autoAlpha: 1 });
        return;
      }

      // "words,chars" so characters animate individually but lines still break
      // between words - chars alone wrapped mid-word ("t / urned").
      const chars = new SplitText(headline.current, { type: "words,chars", charsClass: "hero-char" });
      const words = new SplitText(sub.current, { type: "words", wordsClass: "hero-word" });

      gsap.set([headline.current, sub.current, ".hero-rest"], { autoAlpha: 1 });

      // Put the original markup back once the animation is done. The split
      // leaves every character in its own span carrying a residual filter, and
      // a filtered child paints in its own layer, so the headline's
      // background-clip:text gradient never reached those glyphs - "operating
      // system." rendered fully transparent.
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        chars.revert();
        words.revert();
      };

      const tl = gsap.timeline({ onComplete: restore });
      tl.from(chars.chars, {
        opacity: 0,
        filter: "blur(12px)",
        scale: 0.82,
        yPercent: 18,
        duration: durations.slow,
        ease: ease.brandSnap,
        stagger: { each: 0.024, from: "center" },
      })
        .from(
          words.words,
          {
            opacity: 0,
            yPercent: 60,
            duration: durations.medium,
            ease: ease.brandSnap,
            stagger: staggers.tight,
          },
          "-=0.6",
        )
        .from(
          ".hero-rest",
          {
            opacity: 0,
            y: 20,
            duration: durations.medium,
            ease: ease.brandSnap,
            stagger: staggers.normal,
            clearProps: "opacity,transform",
          },
          "-=0.4",
        );

      return () => {
        tl.kill();
        restore();
      };
    },
    { scope },
  );

  return (
    <section ref={scope} className="relative overflow-hidden">
      {/* living canvas */}
      <AuroraBackground />
      <ParticleField count={12} />

      <div className="relative mx-auto max-w-7xl px-6 pt-24 pb-20 md:pt-32">
        <p className="hero-rest eyebrow invisible flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-mint-burst)", boxShadow: "0 0 8px 1px var(--color-mint-burst)" }}
          />
          OOVIE Studios - Business Development
        </p>

        <h1
          ref={headline}
          className="invisible mt-6 max-w-5xl font-display font-semibold leading-[0.98] tracking-[-0.03em]"
          style={{ fontSize: "clamp(40px, 6vw, 92px)" }}
        >
          Your client segmentation, turned into an{" "}
          <span className="text-gradient">operating system.</span>
        </h1>

        <p
          ref={sub}
          className="invisible mt-7 max-w-2xl text-[var(--color-ink-muted)]"
          style={{ fontSize: "clamp(16px, 1.4vw, 20px)", lineHeight: 1.5 }}
        >
          A static spreadsheet held {leadCount} leads, a hidden scoring engine and a full sales
          playbook. We turned it into a living, interactive intelligence platform - scored,
          segmented and ready to act on.
        </p>

        <div className="hero-rest invisible mt-9 flex flex-wrap items-center gap-2">
          <MagneticCTA href="/dashboard">Enter the platform</MagneticCTA>
          <PillButton href="/dashboard/scoring" size="md">
            See the scoring model
          </PillButton>
        </div>
      </div>
    </section>
  );
}
