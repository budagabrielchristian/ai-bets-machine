import { useLayoutEffect, useRef } from 'react';

export default function Overlay({ label, onClose, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} aria-label={label} className="overlay-root" onCancel={e => { e.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}
