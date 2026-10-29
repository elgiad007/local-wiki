import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ children, onClose, busy }: { children: ReactNode; onClose: () => void; busy: boolean }) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><section ref={container} role="dialog" aria-modal="true" aria-labelledby="import-title" className="modal" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>{children}</section></div>;
}
