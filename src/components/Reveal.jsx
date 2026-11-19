import React, { useEffect, useRef } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1];

/**
 * A section that rises into place the first time it scrolls into view.
 * It also exposes data-inview so CSS can stagger rows, grow probability bars
 * and light up score cells inside it (see "Detail page motion" in index.css).
 */
export function Reveal({ as = 'section', className, children, delay = 0 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.12 });
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return <Tag ref={ref} className={className} data-inview={reduce || inView ? 'true' : 'false'}
    initial={reduce ? false : { opacity: 0, y: 20 }} animate={reduce || inView ? { opacity: 1, y: 0 } : undefined}
    transition={{ duration: 0.6, delay, ease: EASE }}>{children}</Tag>;
}

/** A number that counts up to its value once visible (instantly with reduced motion). */
export function CountUp({ value, format = v => String(Math.round(v)), from = 0 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
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
