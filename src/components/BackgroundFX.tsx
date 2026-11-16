import React, { useEffect, useRef } from 'react';

/**
 * Interaktiver Hintergrund (schwarz-weiß):
 * – feines Punktraster, das beim Drüberfahren aufleuchtet und sanft ausweicht
 * – langsam schwebende Partikel, die sich bei Mausnähe mit feinen Linien verbinden
 * – weicher Lichtkegel + Leuchtspur unter dem Cursor
 * – Sternschnuppen, langsamer Scan-Lichtstreifen
 * – Klick erzeugt Schockwellen-Ringe, die Partikel wegschieben
 * Pausiert bei verstecktem Fenster, respektiert „Bewegung reduzieren“.
 */
export function BackgroundFX() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GAP = 38;
    const R = 180;
    let w = 0, h = 0, raf = 0, alive = true;
    const m = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let parts: P[] = [];
    type Star = { x: number; y: number; vx: number; vy: number; life: number; len: number };
    let stars: Star[] = [];
    let ripples: { x: number; y: number; r: number }[] = [];
    let trail: { x: number; y: number }[] = [];
    let nextStar = 90, frame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(80, Math.round((w * h) / 22000));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.3 + 0.5,
      }));
      if (reduce) draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      m.x += (m.tx - m.x) * 0.14;
      m.y += (m.ty - m.y) * 0.14;
      const hasMouse = m.tx > -5000;

      // Lichtkegel
      if (hasMouse) {
        const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 340);
        g.addColorStop(0, 'rgba(255,255,255,0.075)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Scan-Lichtstreifen (sehr langsam von oben nach unten)
      frame++;
      const sy = ((frame * 0.55) % (h + 400)) - 200;
      const sg = ctx.createLinearGradient(0, sy - 140, 0, sy + 140);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.035)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(0, sy - 140, w, 280);

      // Cursor-Leuchtspur
      if (hasMouse) {
        trail.push({ x: m.x, y: m.y });
        if (trail.length > 22) trail.shift();
        for (let i = 1; i < trail.length; i++) {
          const k = i / trail.length;
          ctx.strokeStyle = `rgba(255,255,255,${k * 0.28})`;
          ctx.lineWidth = k * 2.2;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y); ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
        }
      } else trail = [];

      // Punktraster
      for (let gx = GAP / 2; gx < w; gx += GAP) {
        for (let gy = GAP / 2; gy < h; gy += GAP) {
          let a = 0.075, rad = 0.9, ox = 0, oy = 0;
          if (hasMouse) {
            const dx = gx - m.x, dy = gy - m.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d < R) {
              const k = 1 - d / R;
              const e = k * k;
              a += e * 0.6; rad += e * 1.5;
              ox = (dx / d) * e * 9; oy = (dy / d) * e * 9;
            }
          }
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.beginPath();
          ctx.arc(gx + ox, gy + oy, rad, 0, 6.2832);
          ctx.fill();
        }
      }

      // Partikel + Verbindungen
      for (const p of parts) {
        if (!reduce) {
          for (const rp of ripples) {
            const dx = p.x - rp.x, dy = p.y - rp.y, d = Math.hypot(dx, dy) || 1;
            if (Math.abs(d - rp.r) < 26) { p.vx += (dx / d) * 0.18; p.vy += (dy / d) * 0.18; }
          }
          p.vx *= 0.985; p.vy *= 0.985;
          if (Math.abs(p.vx) < 0.06) p.vx += (Math.random() - 0.5) * 0.01;
          if (Math.abs(p.vy) < 0.06) p.vy += (Math.random() - 0.5) * 0.01;
          p.x += p.vx; p.y += p.vy;
          if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
          if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 110) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 110) * 0.10})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        if (hasMouse) {
          const d = Math.hypot(a.x - m.x, a.y - m.y);
          if (d < 190) {
            ctx.strokeStyle = `rgba(255,255,255,${(1 - d / 190) * 0.4})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
          }
        }
      }

      // Sternschnuppen
      if (!reduce && --nextStar <= 0) {
        nextStar = 150 + Math.random() * 280;
        const ang = Math.PI * (0.18 + Math.random() * 0.12);
        const sp = 7 + Math.random() * 5;
        stars.push({ x: Math.random() * w * 0.9, y: -20 + Math.random() * h * 0.4, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, len: 90 + Math.random() * 90 });
      }
      stars = stars.filter(st => st.life > 0 && st.x < w + 200 && st.y < h + 200);
      for (const st of stars) {
        st.x += st.vx; st.y += st.vy; st.life -= 0.006;
        const mag = Math.hypot(st.vx, st.vy);
        const tx = st.x - (st.vx / mag) * st.len, ty = st.y - (st.vy / mag) * st.len;
        const lg = ctx.createLinearGradient(tx, ty, st.x, st.y);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(1, `rgba(255,255,255,${Math.min(0.85, st.life)})`);
        ctx.strokeStyle = lg; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(st.x, st.y); ctx.stroke();
      }

      // Klick-Schockwellen
      ripples = ripples.filter(r => r.r < 520);
      for (const r of ripples) {
        r.r += 6;
        const a = Math.max(0, 1 - r.r / 520);
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.45})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.18})`;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r * 0.72, 0, 6.2832); ctx.stroke();
      }
    };

    const loop = () => {
      if (!alive) return;
      draw();
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      m.tx = e.clientX; m.ty = e.clientY;
      if (m.x < -5000) { m.x = m.tx; m.y = m.ty; }
    };
    const onDown = (e: PointerEvent) => { if (!reduce) ripples.push({ x: e.clientX, y: e.clientY, r: 0 }); };
    const onLeave = () => { m.tx = -9999; m.ty = -9999; m.x = -9999; m.y = -9999; };
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); alive = false; }
      else if (!reduce && !alive) { alive = true; loop(); }
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);
    if (!reduce) loop();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="bg-fx" aria-hidden="true" />;
}
