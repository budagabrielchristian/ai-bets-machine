import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1];

/**
 * A section that rises into place the first time it scrolls into view.
 * It also exposes data-inview so CSS can stagger rows, grow probability bars
 * and light up score cells inside it (see "Detail page motion" in index.css).
 */
/**
 * useInView, plus a plain position check on every scroll and resize (the page
 * scrolls inside <main>, and the observer alone sometimes missed sections,
 * leaving them invisible). Once seen, it stays true.
 */
function useSeen(ref, amount) {
  const observed = useInView(ref, { once: true, amount });
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (observed || checked) return;
    const check = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r && r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight)) setChecked(true);
    };
    check();
    const timer = setTimeout(check, 300);
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener('scroll', check, { capture: true }); window.removeEventListener('resize', check); };
  }, [observed, checked, ref]);
  return observed || checked;
}

export function Reveal({ as = 'section', className, children, delay = 0 }) {
  const ref = useRef(null);
  const inView = useSeen(ref, 0.12);
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return <Tag ref={ref} className={className} data-inview={reduce || inView ? 'true' : 'false'}
    initial={reduce ? false : { opacity: 0, y: 20 }} animate={reduce || inView ? { opacity: 1, y: 0 } : undefined}
    transition={{ duration: 0.6, delay, ease: EASE }}>{children}</Tag>;
}

/** A number that counts up to its value once visible (instantly with reduced motion). */
export function CountUp({ value, format = v => String(Math.round(v)), from = 0 }) {
  const ref = useRef(null);
  const inView = useSeen(ref, 0.5);
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || !Number.isFinite(value)) return;
    if (reduce) { node.textContent = format(value); return; }
    if (!inView) { node.textContent = format(from); return; }
    const controls = animate(from, value, { duration: 0.9, ease: EASE, onUpdate: v => { node.textContent = format(v); } });
    return () => controls.stop();
  }, [value, inView, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref}>{Number.isFinite(value) ? format(reduce ? value : from) : '-'}</span>;
}
