const COLORS = ['#ea580c', '#f59e0b', '#10b981', '#0ea5e9', '#f43f5e'];

/** Конфетти без зависимостей: DOM-частицы и Web Animations API, уважает reduced-motion. */
export function confettiBurst(x: number, y: number, count = 16): void {
  if (typeof document === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('span');
    piece.setAttribute('aria-hidden', 'true');
    piece.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:7px;height:7px;border-radius:2px;background:${COLORS[i % COLORS.length]};pointer-events:none;z-index:9999`;
    document.body.appendChild(piece);
    const dx = (Math.random() - 0.5) * 140;
    const up = 30 + Math.random() * 50;
    const down = 60 + Math.random() * 90;
    const rot = (Math.random() - 0.5) * 540;
    const animation = piece.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${-up}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${dx}px, ${down}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)' },
    );
    animation.onfinish = () => piece.remove();
    // В скрытой вкладке события анимаций не доставляются — страховочная уборка по таймеру.
    setTimeout(() => piece.remove(), 1400);
  }
}