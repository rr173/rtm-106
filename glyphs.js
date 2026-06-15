(function() {
  const GLYPH_UNITS = 1000;
  const ASCENDER = 700;
  const DESCENDER = -200;
  const FONT_HEIGHT = ASCENDER - DESCENDER;

  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      a += p1.x * p2.y - p2.x * p1.y;
    }
    return a / 2;
  }

  function ensureCCW(pts) {
    return polyArea(pts) > 0 ? pts.slice() : pts.slice().reverse();
  }

  function ensureCW(pts) {
    return polyArea(pts) < 0 ? pts.slice() : pts.slice().reverse();
  }

  function ellipsePoints(cx, cy, rx, ry, n, startAngle, endAngle) {
    const pts = [];
    const total = endAngle - startAngle;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const a = startAngle + f * total;
      pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }
    return pts;
  }

  function rectPoints(x, y, w, h) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ];
  }

  const STROKE = 80;
  const ROUND_SEGMENTS = 16;

  function buildStem(x, y, w, h) {
    return rectPoints(x, y, w, h);
  }

  function buildHorizontalBar(x, y, w, h) {
    return rectPoints(x, y, w, h);
  }

  function combinePaths(paths) {
    if (paths.length === 0) return { outer: [], holes: [] };
    if (paths.length === 1) return paths[0];

    let result = { outer: paths[0].outer.slice(), holes: paths[0].holes ? paths[0].holes.slice() : [] };
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      result.outer = result.outer.concat(p.outer);
      if (p.holes) result.holes = result.holes.concat(p.holes);
    }
    return result;
  }

  const GLYPHS = {};

  function glyphA() {
    const t = STROKE;
    const left = 50, right = 650;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const midY = bottom + h * 0.45;

    const outer = [];
    const steps = 3;

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (right - left) * 0.1 * f, y: bottom + h * f });
    }

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (right - left) * 0.45 + (right - left) * 0.45 * f, y: top - h * 0.05 * f });
    }

    outer.push({ x: right, y: bottom + h * 0.4 });
    outer.push({ x: right - t * 0.8, y: bottom + h * 0.4 });

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - t * 0.8 - (right - left) * 0.25 * f, y: bottom + h * 0.4 - h * 0.05 * f });
    }

    outer.push({ x: left + (right - left) * 0.45 + t/2, y: bottom + h * 0.5 + t/2 });

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (right - left) * 0.45 + t/2 - (right - left) * 0.25 * f, y: bottom + h * 0.5 + t/2 - h * 0.4 * f });
    }

    outer.push({ x: left + t, y: top - h * 0.05 });
    outer.push({ x: left, y: top });

    const hole = [];
    const hw = (right - left) * 0.35;
    const hh = h * 0.3;
    const hx = left + (right - left - hw) / 2;
    const hy = bottom + h * 0.08;

    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      hole.push({ x: hx + hw * 0.1 * f, y: hy + hh * f });
    }
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      hole.push({ x: hx + hw * 0.45 + hw * 0.45 * f, y: hy + hh - hh * 0.05 * f });
    }
    hole.push({ x: hx + hw, y: hy + hh * 0.5 });
    hole.push({ x: hx + hw - t * 0.6, y: hy + hh * 0.5 });
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      hole.push({ x: hx + hw - t * 0.6 - hw * 0.25 * f, y: hy + hh * 0.5 - hh * 0.05 * f });
    }
    hole.push({ x: hx + hw * 0.45 + t/2, y: hy + hh * 0.5 + t/2 });
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      hole.push({ x: hx + hw * 0.45 + t/2 - hw * 0.25 * f, y: hy + hh * 0.5 + t/2 - hh * 0.35 * f });
    }
    hole.push({ x: hx + t, y: hy + hh * 0.95 });

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphB() {
    const t = STROKE;
    const left = 80, right = 620;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: bottom + h * 0.05 });

    const lowerCx = left + t + (right - left - t) * 0.55;
    const lowerCy = bottom + h * 0.25;
    const lowerRx = (right - left - t) * 0.45;
    const lowerRy = h * 0.2;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: lowerCx + Math.cos(a) * lowerRx, y: lowerCy + Math.sin(a) * lowerRy });
    }

    outer.push({ x: left + t, y: bottom + h * 0.48 });
    outer.push({ x: left + t, y: bottom + h * 0.52 });

    const upperCx = left + t + (right - left - t) * 0.55;
    const upperCy = top - h * 0.23;
    const upperRx = (right - left - t) * 0.45;
    const upperRy = h * 0.2;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: upperCx + Math.cos(a) * upperRx, y: upperCy + Math.sin(a) * upperRy });
    }

    outer.push({ x: left + t, y: top - h * 0.05 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    const lowerHole = [];
    const lhcx = left + t * 2 + (right - left - t * 2) * 0.5;
    const lhcy = bottom + h * 0.25;
    const lhrx = (right - left - t * 2) * 0.35;
    const lhry = h * 0.1;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      lowerHole.push({ x: lhcx + Math.cos(a) * lhrx, y: lhcy + Math.sin(a) * lhry });
    }

    const upperHole = [];
    const uhcx = left + t * 2 + (right - left - t * 2) * 0.5;
    const uhcy = top - h * 0.23;
    const uhrx = (right - left - t * 2) * 0.35;
    const uhry = h * 0.1;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      upperHole.push({ x: uhcx + Math.cos(a) * uhrx, y: uhcy + Math.sin(a) * uhry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(lowerHole), ensureCW(upperHole)] };
  }

  function glyphC() {
    const t = STROKE;
    const left = 80, right = 580;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (top - bottom) / 2;

    const outer = [];
    const segments = ROUND_SEGMENTS;
    const startAngle = Math.PI * 0.65;
    const endAngle = -Math.PI * 0.65;
    const total = endAngle - startAngle;
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const a = startAngle + f * total;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    const hStart = -Math.PI * 0.55;
    const hEnd = Math.PI * 0.55;
    const hTotal = hEnd - hStart;
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const a = hStart + f * hTotal;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphD() {
    const t = STROKE;
    const left = 80, right = 620;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: bottom + h * 0.05 });

    const cx = left + t + (right - left - t) * 0.6;
    const cy = (top + bottom) / 2;
    const rx = (right - left - t) * 0.5;
    const ry = (top - bottom) / 2 - t;
    for (let i = 0; i <= ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: left + t, y: top - h * 0.05 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    const hole = [];
    const hcx = left + t * 2 + (right - left - t * 2) * 0.55;
    const hrx = (right - left - t * 2) * 0.4;
    const hry = (top - bottom) / 2 - t * 1.8;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      hole.push({ x: hcx + Math.cos(a) * hrx, y: cy + Math.sin(a) * hry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphE() {
    const t = STROKE;
    const left = 80, right = 580;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const midY = (top + bottom) / 2;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: bottom + t });
    outer.push({ x: left + t, y: bottom + t });
    outer.push({ x: left + t, y: midY - t/2 });
    outer.push({ x: right - t, y: midY - t/2 });
    outer.push({ x: right - t, y: midY + t/2 });
    outer.push({ x: left + t, y: midY + t/2 });
    outer.push({ x: left + t, y: top - t });
    outer.push({ x: right, y: top - t });
    outer.push({ x: right, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphF() {
    const t = STROKE;
    const left = 80, right = 580;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const midY = (top + bottom) / 2;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: midY - t/2 });
    outer.push({ x: right - t, y: midY - t/2 });
    outer.push({ x: right - t, y: midY + t/2 });
    outer.push({ x: left + t, y: midY + t/2 });
    outer.push({ x: left + t, y: top - t });
    outer.push({ x: right, y: top - t });
    outer.push({ x: right, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphG() {
    const t = STROKE;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (top - bottom) / 2;

    const outer = [];
    const segments = ROUND_SEGMENTS;
    const startAngle = Math.PI * 0.6;
    const endAngle = -Math.PI * 0.6;
    const total = endAngle - startAngle;
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const a = startAngle + f * total;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: cx + rx * 0.5, y: cy - ry * 0.15 });
    outer.push({ x: right - t, y: cy - ry * 0.15 });
    outer.push({ x: right - t, y: bottom + t * 0.5 });
    outer.push({ x: cx + rx * 0.5, y: bottom + t * 0.5 });
    outer.push({ x: cx + rx * 0.5, y: bottom + t * 1.2 });
    outer.push({ x: right, y: bottom + t * 1.2 });
    outer.push({ x: right, y: bottom });
    outer.push({ x: cx - t, y: bottom });

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    const hStart = -Math.PI * 0.5;
    const hEnd = Math.PI * 0.5;
    const hTotal = hEnd - hStart;
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const a = hStart + f * hTotal;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }
    hole.push({ x: cx + irx * 0.5, y: cy - iry * 0.05 });
    hole.push({ x: cx + irx * 0.5, y: bottom + t * 0.8 });
    hole.push({ x: cx - t, y: bottom + t * 0.8 });

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphH() {
    const t = STROKE;
    const left = 80, right = 620;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const midY = (top + bottom) / 2;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: midY + t/2 });
    outer.push({ x: right - t, y: midY + t/2 });
    outer.push({ x: right - t, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: top });
    outer.push({ x: right - t, y: top });
    outer.push({ x: right - t, y: midY - t/2 });
    outer.push({ x: left + t, y: midY - t/2 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphI() {
    const t = STROKE;
    const cx = 350;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const w = 80;

    return { outer: ensureCCW(rectPoints(cx - w/2, bottom, w, top - bottom)), holes: [] };
  }

  function glyphJ() {
    const t = STROKE;
    const left = 100, right = 480;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: right - t, y: top });
    outer.push({ x: right, y: top });
    outer.push({ x: right, y: bottom + t * 2.5 });

    const botCx = cx;
    const botCy = bottom + t * 1.5;
    const botRx = (right - left) / 2 - t/2;
    const botRy = t * 1.2;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: left + t, y: bottom + t * 0.8 });
    outer.push({ x: left, y: bottom + t * 1.8 });

    const innerBotCx = cx;
    const innerBotCy = bottom + t * 1.5;
    const innerBotRx = (right - left) / 2 - t * 1.2;
    const innerBotRy = t * 0.5;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: innerBotCx + Math.cos(a) * innerBotRx, y: innerBotCy + Math.sin(a) * innerBotRy });
    }

    outer.push({ x: right - t, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphK() {
    const t = STROKE * 0.85;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const midY = (top + bottom) / 2;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: midY + t * 0.4 });

    const diagSteps = 5;
    for (let i = 1; i <= diagSteps; i++) {
      const f = i / diagSteps;
      outer.push({ x: left + t + (right - left - t) * f, y: midY + t * 0.4 - (midY - bottom - t) * f });
    }

    outer.push({ x: right, y: bottom + t });
    outer.push({ x: right - t * 0.4, y: bottom });
    outer.push({ x: left + t * 1.5, y: midY - t * 0.2 });

    const diagSteps2 = 5;
    for (let i = 1; i <= diagSteps2; i++) {
      const f = i / diagSteps2;
      outer.push({ x: left + t * 1.5 + (right - left - t * 1.5) * f, y: midY - t * 0.2 + (top - midY - t) * f });
    }

    outer.push({ x: right - t * 0.5, y: top - t * 0.3 });
    outer.push({ x: right - t, y: top });
    outer.push({ x: left + t, y: midY + t * 0.5 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphL() {
    const t = STROKE;
    const left = 80, right = 560;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: bottom + t });
    outer.push({ x: left + t, y: bottom + t });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphM() {
    const t = STROKE * 0.85;
    const left = 50, right = 750;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: top - h * 0.1 });

    const points = [
      { x: left + w * 0.3, y: bottom + h * 0.55 },
      { x: left + w * 0.5, y: bottom + h * 0.15 },
      { x: left + w * 0.7, y: bottom + h * 0.55 },
      { x: right - t, y: bottom },
    ];

    let curX = left + t, curY = top - h * 0.1;
    const steps = 3;
    for (const p of points) {
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        outer.push({ x: curX + (p.x - curX) * f, y: curY + (p.y - curY) * f });
      }
      curX = p.x; curY = p.y;
    }

    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: top });
    outer.push({ x: right - t, y: top });

    const rightPoints = [
      { x: right - t, y: bottom + h * 0.6 },
      { x: left + w * 0.7, y: bottom + h * 0.2 },
      { x: left + w * 0.5, y: bottom + h * 0.55 },
      { x: left + w * 0.3, y: bottom + h * 0.2 },
      { x: left + t, y: bottom + h * 0.65 },
    ];

    curX = right - t; curY = top;
    for (const p of rightPoints) {
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        outer.push({ x: curX + (p.x - curX) * f, y: curY + (p.y - curY) * f });
      }
      curX = p.x; curY = p.y;
    }

    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphN() {
    const t = STROKE * 0.85;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: top - h * 0.3 });

    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + t + (right - left - t * 2) * f, y: top - h * 0.3 - (h * 0.6) * f });
    }

    outer.push({ x: right - t, y: bottom + t });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: top });
    outer.push({ x: right - t, y: top });
    outer.push({ x: right - t, y: bottom + h * 0.3 });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - t - (right - left - t * 2) * f, y: bottom + h * 0.3 + (h * 0.6) * f });
    }

    outer.push({ x: left + t, y: top - t });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphO() {
    const t = STROKE;
    const left = 80, right = 580;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (top - bottom) / 2;

    const outer = [];
    for (let i = 0; i < ROUND_SEGMENTS * 2; i++) {
      const f = i / (ROUND_SEGMENTS * 2);
      const a = -Math.PI/2 + f * Math.PI * 2;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    for (let i = 0; i < ROUND_SEGMENTS * 2; i++) {
      const f = i / (ROUND_SEGMENTS * 2);
      const a = Math.PI/2 - f * Math.PI * 2;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphP() {
    const t = STROKE;
    const left = 80, right = 580;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: top - h * 0.45 });

    const cx = left + t + (right - left - t) * 0.55;
    const cy = top - h * 0.22;
    const rx = (right - left - t) * 0.5;
    const ry = h * 0.2;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: left + t, y: top - h * 0.05 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    const hole = [];
    const hcx = left + t * 2 + (right - left - t * 2) * 0.5;
    const hcy = top - h * 0.22;
    const hrx = (right - left - t * 2) * 0.35;
    const hry = h * 0.1;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      hole.push({ x: hcx + Math.cos(a) * hrx, y: hcy + Math.sin(a) * hry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphQ() {
    const t = STROKE;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = (right - left) / 2;
    const ry = (top - bottom) / 2;

    const outer = [];
    for (let i = 0; i < ROUND_SEGMENTS * 2; i++) {
      const f = i / (ROUND_SEGMENTS * 2);
      const a = -Math.PI/2 + f * Math.PI * 2;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: right - t, y: bottom + t * 0.5 });
    outer.push({ x: right, y: bottom - t * 0.5 });
    outer.push({ x: right, y: bottom + t * 0.3 });

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    for (let i = 0; i < ROUND_SEGMENTS * 2; i++) {
      const f = i / (ROUND_SEGMENTS * 2);
      const a = Math.PI/2 - f * Math.PI * 2;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphR() {
    const t = STROKE;
    const left = 80, right = 620;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: bottom + h * 0.32 });

    const legSteps = 4;
    for (let i = 1; i <= legSteps; i++) {
      const f = i / legSteps;
      outer.push({ x: left + t + (right - left - t) * 0.7 * f, y: bottom + h * 0.32 - h * 0.27 * f });
    }

    outer.push({ x: right - t * 0.5, y: bottom + t });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right - t * 0.3, y: bottom + t * 0.8 });

    const backSteps = 4;
    for (let i = 1; i <= backSteps; i++) {
      const f = i / backSteps;
      outer.push({ x: right - t * 0.3 - (right - left) * 0.35 * f, y: bottom + t * 0.8 + h * 0.12 * f });
    }

    outer.push({ x: left + t, y: bottom + h * 0.48 });
    outer.push({ x: left + t, y: top - h * 0.45 });

    const cx = left + t + (right - left - t) * 0.55;
    const cy = top - h * 0.22;
    const rx = (right - left - t) * 0.5;
    const ry = h * 0.2;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: left + t, y: top - h * 0.05 });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    const hole = [];
    const hcx = left + t * 2 + (right - left - t * 2) * 0.5;
    const hcy = top - h * 0.22;
    const hrx = (right - left - t * 2) * 0.35;
    const hry = h * 0.1;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      hole.push({ x: hcx + Math.cos(a) * hrx, y: hcy + Math.sin(a) * hry });
    }

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphS() {
    const t = STROKE * 1.1;
    const left = 80, right = 520;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const midY = (top + bottom) / 2;

    const outer = [];
    const topCx = left + (right - left) * 0.6;
    const topCy = top - h * 0.22;
    const topRx = (right - left) * 0.45;
    const topRy = h * 0.18;

    const topStartAngle = Math.PI * 0.15;
    const topEndAngle = -Math.PI * 1.0;
    for (let i = 0; i <= ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = topStartAngle + f * (topEndAngle - topStartAngle);
      outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }

    outer.push({ x: left + t, y: midY - t * 0.1 });

    const midConnectSteps = 4;
    for (let i = 1; i <= midConnectSteps; i++) {
      const f = i / midConnectSteps;
      outer.push({ x: left + t + (right - left - t * 2) * 0.35 * f, y: midY - t * 0.1 - t * 0.4 * f });
    }

    const botCx = left + (right - left) * 0.4;
    const botCy = bottom + h * 0.22;
    const botRx = (right - left) * 0.45;
    const botRy = h * 0.18;

    const botStartAngle = Math.PI * 0.9;
    const botEndAngle = Math.PI * -0.25;
    for (let i = 0; i <= ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = botStartAngle + f * (botEndAngle - botStartAngle);
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: right - t, y: midY + t * 0.1 });

    const midConnectSteps2 = 4;
    for (let i = 1; i <= midConnectSteps2; i++) {
      const f = i / midConnectSteps2;
      outer.push({ x: right - t - (right - left - t * 2) * 0.35 * f, y: midY + t * 0.1 + t * 0.4 * f });
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphT() {
    const t = STROKE;
    const left = 50, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const cx = (left + right) / 2;

    const outer = [];
    outer.push({ x: cx - t/2, y: bottom });
    outer.push({ x: cx + t/2, y: bottom });
    outer.push({ x: cx + t/2, y: top - t });
    outer.push({ x: right, y: top - t });
    outer.push({ x: right, y: top });
    outer.push({ x: left, y: top });
    outer.push({ x: left, y: top - t });
    outer.push({ x: cx - t/2, y: top - t });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphU() {
    const t = STROKE;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    outer.push({ x: left, y: top });
    outer.push({ x: left + t, y: top });
    outer.push({ x: left + t, y: bottom + h * 0.3 });

    const botCx = (left + right) / 2;
    const botCy = bottom + h * 0.22;
    const botRx = (right - left) / 2 - t;
    const botRy = h * 0.17;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI - f * Math.PI;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: right - t, y: top });
    outer.push({ x: right, y: top });
    outer.push({ x: right, y: bottom + h * 0.25 });

    const innerBotCx = (left + right) / 2;
    const innerBotCy = bottom + h * 0.25;
    const innerBotRx = (right - left) / 2 - t * 2;
    const innerBotRy = h * 0.08;
    const hole = [];
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = 0 + f * Math.PI;
      hole.push({ x: innerBotCx + Math.cos(a) * innerBotRx, y: innerBotCy + Math.sin(a) * innerBotRy });
    }
    hole.push({ x: right - t * 2, y: top - t * 0.5 });
    hole.push({ x: left + t * 2, y: top - t * 0.5 });

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyphV() {
    const t = STROKE;
    const left = 50, right = 650;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;

    const outer = [];
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (right - left) * 0.08 * f, y: top - h * 0.95 * f });
    }

    outer.push({ x: (left + right) / 2 - t * 0.15, y: bottom });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: (left + right) / 2 - t * 0.15 + (right - left) * 0.42 * f, y: bottom + h * 0.95 * f });
    }

    outer.push({ x: right, y: top });
    outer.push({ x: right - t, y: top });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - t - (right - left) * 0.35 * f, y: top - h * 0.85 * f });
    }

    outer.push({ x: (left + right) / 2 + t * 0.1, y: bottom + t });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: (left + right) / 2 + t * 0.1 - (right - left) * 0.33 * f, y: bottom + t + h * 0.85 * f });
    }

    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphW() {
    const t = STROKE * 0.75;
    const left = 30, right = 870;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    outer.push({ x: left, y: top });
    outer.push({ x: left + t, y: top });

    const downPoints = [
      { x: left + w * 0.2, y: bottom + h * 0.15 },
      { x: left + w * 0.35, y: bottom + h * 0.5 },
      { x: left + w * 0.5, y: bottom + h * 0.1 },
      { x: left + w * 0.65, y: bottom + h * 0.5 },
      { x: left + w * 0.8, y: bottom + h * 0.15 },
      { x: right - t, y: top },
    ];

    let curX = left + t, curY = top;
    const steps = 3;
    for (const p of downPoints) {
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        outer.push({ x: curX + (p.x - curX) * f, y: curY + (p.y - curY) * f });
      }
      curX = p.x; curY = p.y;
    }

    outer.push({ x: right, y: top });
    outer.push({ x: right - t * 0.5, y: top });

    const upPoints = [
      { x: right - t * 0.5 - w * 0.15, y: bottom + h * 0.25 },
      { x: right - t * 0.5 - w * 0.3, y: bottom + h * 0.58 },
      { x: right - t * 0.5 - w * 0.5, y: bottom + h * 0.2 },
      { x: right - t * 0.5 - w * 0.7, y: bottom + h * 0.58 },
      { x: left + t + w * 0.15, y: bottom + h * 0.25 },
      { x: left + t, y: top },
    ];

    curX = right; curY = top;
    for (const p of upPoints) {
      for (let i = 1; i <= steps; i++) {
        const f = i / steps;
        outer.push({ x: curX + (p.x - curX) * f, y: curY + (p.y - curY) * f });
      }
      curX = p.x; curY = p.y;
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphX() {
    const t = STROKE;
    const left = 80, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const cx = (left + right) / 2;
    const midY = (top + bottom) / 2;

    const outer = [];
    const steps = 4;
    outer.push({ x: left, y: top });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (w * 0.5 - t/2) * f, y: top - (h * 0.5 - t/2) * f });
    }
    outer.push({ x: cx - t/2, y: midY });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: cx - t/2 + (w * 0.5 - t/2) * f, y: midY - (h * 0.5 - t/2) * f });
    }
    outer.push({ x: right, y: bottom });
    outer.push({ x: right - t, y: bottom });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - t - (w * 0.5 - t) * f, y: bottom + (h * 0.5 - t/2) * f });
    }
    outer.push({ x: cx + t/2, y: midY });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: cx + t/2 - (w * 0.5 - t) * f, y: midY + (h * 0.5 - t/2) * f });
    }
    outer.push({ x: left + t, y: top });
    outer.push({ x: left, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphY() {
    const t = STROKE;
    const left = 50, right = 600;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const midY = bottom + h * 0.45;
    const cx = (left + right) / 2;

    const outer = [];
    const steps = 4;
    outer.push({ x: left, y: top });
    outer.push({ x: left + t, y: top });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + t + (cx - left - t * 1.3) * f, y: top - (top - midY - t/2) * f });
    }
    outer.push({ x: cx - t/2, y: midY + t/2 });
    outer.push({ x: cx - t/2, y: bottom });
    outer.push({ x: cx + t/2, y: bottom });
    outer.push({ x: cx + t/2, y: midY + t/2 });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: cx + t/2 + (right - cx - t * 1.3) * f, y: midY + t/2 + (top - midY - t/2) * f });
    }
    outer.push({ x: right - t, y: top });
    outer.push({ x: right, y: top });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - t - (right - cx - t * 1.1) * f, y: top - (top - midY + t*0.3) * f });
    }
    outer.push({ x: cx + t * 0.1, y: midY });
    outer.push({ x: cx + t * 0.1, y: bottom + t });
    outer.push({ x: cx - t * 0.1, y: bottom + t });
    outer.push({ x: cx - t * 0.1, y: midY });
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: cx - t * 0.1 - (cx - left - t * 1.1) * f, y: midY + (top - midY + t*0.3) * f });
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyphZ() {
    const t = STROKE * 0.9;
    const left = 80, right = 570;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    outer.push({ x: left, y: top });
    outer.push({ x: right, y: top });
    outer.push({ x: right, y: top - t });

    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - (w - t * 0.6) * f, y: top - t - (h - t * 2) * f });
    }

    outer.push({ x: left + t * 0.4, y: bottom + t });
    outer.push({ x: left, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: bottom + t });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - (w - t * 0.6) * f, y: bottom + t + (h - t * 2) * f });
    }

    outer.push({ x: left + t * 0.6, y: top - t * 0.5 });
    outer.push({ x: left + t, y: top });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph0() { return glyphO(); }

  function glyph1() {
    const t = STROKE;
    const cx = 330;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const w = 90;

    const outer = [];
    outer.push({ x: cx - w/2, y: bottom });
    outer.push({ x: cx + w/2, y: bottom });
    outer.push({ x: cx + w/2, y: top - t * 0.8 });
    outer.push({ x: cx + w * 1.2, y: top - t * 0.3 });
    outer.push({ x: cx + w * 0.6, y: top });
    outer.push({ x: cx - w/2, y: top - t * 0.4 });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph2() {
    const t = STROKE;
    const left = 80, right = 540;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const midY = bottom + h * 0.45;

    const outer = [];
    const topCy = top - h * 0.22;
    const topRx = w / 2 - t * 0.5;
    const topRy = h * 0.18;
    const topCx = left + w / 2;

    for (let i = 0; i <= ROUND_SEGMENTS * 0.7; i++) {
      const f = i / (ROUND_SEGMENTS * 0.7);
      const a = Math.PI/2 - f * Math.PI * 0.9;
      outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }

    outer.push({ x: left + t, y: midY - t * 0.1 });

    const diagSteps = 6;
    for (let i = 1; i <= diagSteps; i++) {
      const f = i / diagSteps;
      outer.push({ x: left + t + (w - t * 1.5) * f, y: midY - t * 0.1 - (h * 0.35) * f });
    }

    outer.push({ x: right - t, y: bottom + t });
    outer.push({ x: right - t, y: bottom });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: left + t, y: bottom + t });

    for (let i = 1; i <= diagSteps; i++) {
      const f = i / diagSteps;
      outer.push({ x: left + t + (w - t * 2) * f, y: bottom + t + (h * 0.2) * f });
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph3() {
    const t = STROKE;
    const left = 80, right = 540;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const midY = (top + bottom) / 2;

    const outer = [];
    const topCy = top - h * 0.23;
    const topRx = w / 2 - t * 0.3;
    const topRy = h * 0.18;
    const topCx = left + w / 2 + t * 0.3;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }

    outer.push({ x: left + t * 1.5, y: midY + t * 0.1 });
    outer.push({ x: midY + t, y: midY + t * 0.1 });

    const botCy = bottom + h * 0.23;
    const botRx = w / 2 - t * 0.3;
    const botRy = h * 0.18;
    const botCx = left + w / 2 + t * 0.3;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: left + t * 1.5, y: bottom + t * 0.8 });

    const innerBotCx = left + w / 2;
    const innerBotCy = bottom + h * 0.25;
    const innerBotRx = w / 3;
    const innerBotRy = h * 0.1;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: innerBotCx + Math.cos(a) * innerBotRx, y: innerBotCy + Math.sin(a) * innerBotRy });
    }

    outer.push({ x: left + t * 2, y: midY - t * 0.1 });

    const innerTopCx = left + w / 2;
    const innerTopCy = top - h * 0.25;
    const innerTopRx = w / 3;
    const innerTopRy = h * 0.1;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: innerTopCx + Math.cos(a) * innerTopRx, y: innerTopCy + Math.sin(a) * innerTopRy });
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph4() {
    const t = STROKE;
    const left = 80, right = 540;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const midY = bottom + h * 0.45;

    const outer = [];
    outer.push({ x: right - t, y: top });
    outer.push({ x: right - t, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: top });

    outer.push({ x: left, y: midY + t/2 });

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + (w * 0.55) * f, y: midY + t/2 - (h * 0.45) * f });
    }

    outer.push({ x: left + w * 0.5, y: top });
    outer.push({ x: left + w * 0.5 + t, y: top });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + w * 0.5 + t + t * 0.3 * f, y: top - (h * 0.45) * f });
    }

    outer.push({ x: right - t, y: midY - t * 0.5 });
    outer.push({ x: right - t, y: midY + t * 0.5 });
    outer.push({ x: left + w * 0.5 + t, y: midY + t * 0.5 });
    outer.push({ x: left + w * 0.5 + t, y: bottom });
    outer.push({ x: left + w * 0.5, y: bottom });
    outer.push({ x: left + w * 0.5, y: midY + t * 0.5 });
    outer.push({ x: left, y: midY + t/2 });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph5() {
    const t = STROKE;
    const left = 80, right = 540;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    outer.push({ x: right, y: top });
    outer.push({ x: right, y: top - t });

    const topCy = top - h * 0.25;
    const topRx = w / 2 - t * 0.5;
    const topRy = h * 0.18;
    const topCx = left + w / 2;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }

    outer.push({ x: left + t, y: top - h * 0.5 });
    outer.push({ x: left, y: top - h * 0.5 });
    outer.push({ x: left, y: top - h * 0.4 });
    outer.push({ x: left + t, y: top - h * 0.4 });
    outer.push({ x: left + t, y: bottom + h * 0.35 });

    const botCy = bottom + h * 0.22;
    const botRx = w / 2 - t * 0.3;
    const botRy = h * 0.17;
    const botCx = left + w / 2 + t * 0.2;

    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: left + t, y: bottom + t });
    outer.push({ x: left + t, y: bottom });
    outer.push({ x: right, y: bottom });
    outer.push({ x: right, y: bottom + t });

    const innerBotCx = left + w / 2;
    const innerBotCy = bottom + h * 0.25;
    const innerBotRx = w / 3;
    const innerBotRy = h * 0.08;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      outer.push({ x: innerBotCx + Math.cos(a) * innerBotRx, y: innerBotCy + Math.sin(a) * innerBotRy });
    }

    outer.push({ x: left + t * 2, y: bottom + h * 0.4 });
    outer.push({ x: left + t * 2, y: top - h * 0.42 });

    const innerTopCx = left + w / 2;
    const innerTopCy = top - h * 0.27;
    const innerTopRx = w / 2 - t * 1.5;
    const innerTopRy = h * 0.08;
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      outer.push({ x: innerTopCx + Math.cos(a) * innerTopRx, y: innerTopCy + Math.sin(a) * innerTopRy });
    }

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph6() {
    const t = STROKE;
    const left = 80, right = 560;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const cx = (left + right) / 2;
    const cy = bottom + h * 0.3;
    const rx = w / 2 - t;
    const ry = h * 0.25;

    const outer = [];
    const topStartAngle = Math.PI * 0.8;
    const topEndAngle = -Math.PI * 0.1;
    const topCx = cx + t;
    const topCy = top - h * 0.2;
    const topRx = w / 2 - t;
    const topRy = h * 0.15;

    const topTotal = topEndAngle - topStartAngle;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.6; i++) {
      const f = i / (ROUND_SEGMENTS * 0.6);
      const a = topStartAngle + f * topTotal;
      outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }

    outer.push({ x: cx + rx * 0.5, y: cy + ry * 0.3 });

    const botTotal = Math.PI * 1.8;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.9; i++) {
      const f = i / (ROUND_SEGMENTS * 0.9);
      const a = Math.PI * 0.9 - f * botTotal;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: cx - rx * 0.8, y: cy + ry * 0.2 });
    outer.push({ x: cx - rx * 0.6, y: top - h * 0.15 });

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    for (let i = 0; i < ROUND_SEGMENTS * 1.5; i++) {
      const f = i / (ROUND_SEGMENTS * 1.5);
      const a = Math.PI/2 + f * Math.PI * 1.5;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }
    hole.push({ x: cx - irx * 0.5, y: cy + iry * 0.5 });

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  function glyph7() {
    const t = STROKE;
    const left = 80, right = 540;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    outer.push({ x: left, y: top });
    outer.push({ x: right, y: top });
    outer.push({ x: right, y: top - t });

    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: right - (w - t * 0.5) * f, y: top - t - (h - t * 1.5) * f });
    }

    outer.push({ x: left + t * 0.5, y: bottom + t * 0.5 });
    outer.push({ x: left, y: bottom });
    outer.push({ x: left + t, y: bottom - t * 0.3 });

    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      outer.push({ x: left + t + (w - t * 1.5) * f, y: bottom - t * 0.3 + (h - t * 1.5) * f });
    }

    outer.push({ x: right - t, y: top - t * 1.2 });
    outer.push({ x: left, y: top - t });

    return { outer: ensureCCW(outer), holes: [] };
  }

  function glyph8() {
    const t = STROKE;
    const left = 80, right = 560;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;

    const outer = [];
    const topCx = (left + right) / 2;
    const topCy = top - h * 0.27;
    const topRx = w / 2 - t * 0.5;
    const topRy = h * 0.18;

    for (let i = 0; i < ROUND_SEGMENTS * 1.2; i++) {
      const f = i / (ROUND_SEGMENTS * 1.2);
      const a = -Math.PI/2 + f * Math.PI * 1.2;
      if (a < Math.PI * 0.6) {
        outer.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
      }
    }

    const midCx = (left + right) / 2;
    const midCy = (top + bottom) / 2;
    const midRx = w / 2 - t * 0.8;
    const midRy = h * 0.08;

    const botCx = (left + right) / 2;
    const botCy = bottom + h * 0.27;
    const botRx = w / 2 - t * 0.3;
    const botRy = h * 0.22;

    const botStartAngle = Math.PI * 0.4;
    const botEndAngle = -Math.PI * 0.6;
    const botTotal = botEndAngle - botStartAngle;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.7; i++) {
      const f = i / (ROUND_SEGMENTS * 0.7);
      const a = botStartAngle + f * botTotal;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    const backStartAngle = -Math.PI * 0.7;
    const backEndAngle = Math.PI * 0.7;
    const backTotal = backEndAngle - backStartAngle;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.7; i++) {
      const f = i / (ROUND_SEGMENTS * 0.7);
      const a = backStartAngle + f * backTotal;
      outer.push({ x: botCx - t + Math.cos(a) * (botRx - t), y: botCy + Math.sin(a) * (botRy - t) });
    }

    const topHole = [];
    const thRx = topRx - t;
    const thRy = topRy - t;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      topHole.push({ x: topCx + Math.cos(a) * thRx, y: topCy + Math.sin(a) * thRy });
    }

    const botHole = [];
    const bhRx = botRx - t * 1.2;
    const bhRy = botRy - t;
    for (let i = 0; i < ROUND_SEGMENTS; i++) {
      const f = i / ROUND_SEGMENTS;
      const a = Math.PI/2 - f * Math.PI * 2;
      botHole.push({ x: botCx + Math.cos(a) * bhRx, y: botCy + Math.sin(a) * bhRy });
    }

    const simplifiedOuter = [];
    simplifiedOuter.push({ x: left + w * 0.15, y: top - t });
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 - f * Math.PI;
      simplifiedOuter.push({ x: topCx + Math.cos(a) * topRx, y: topCy + Math.sin(a) * topRy });
    }
    simplifiedOuter.push({ x: left + w * 0.3, y: midCy + t * 0.3 });
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 + f * Math.PI;
      simplifiedOuter.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }
    simplifiedOuter.push({ x: right - t, y: bottom + t });
    simplifiedOuter.push({ x: right, y: bottom });
    simplifiedOuter.push({ x: right - t * 0.5, y: bottom + t * 0.5 });
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = -Math.PI/2 - f * Math.PI;
      simplifiedOuter.push({ x: botCx + Math.cos(a) * (botRx - t), y: botCy + Math.sin(a) * (botRy - t) });
    }
    simplifiedOuter.push({ x: left + w * 0.4, y: midCy - t * 0.2 });
    for (let i = 0; i <= ROUND_SEGMENTS/2; i++) {
      const f = i / (ROUND_SEGMENTS/2);
      const a = Math.PI/2 + f * Math.PI;
      simplifiedOuter.push({ x: topCx + Math.cos(a) * (topRx - t), y: topCy + Math.sin(a) * (topRy - t) });
    }
    simplifiedOuter.push({ x: left, y: top - t * 0.5 });

    return { outer: ensureCCW(simplifiedOuter), holes: [ensureCW(topHole), ensureCW(botHole)] };
  }

  function glyph9() {
    const t = STROKE;
    const left = 80, right = 560;
    const bottom = DESCENDER + 50, top = ASCENDER - 50;
    const h = top - bottom;
    const w = right - left;
    const cx = (left + right) / 2;
    const cy = top - h * 0.3;
    const rx = w / 2 - t;
    const ry = h * 0.22;

    const outer = [];
    const botStartAngle = -Math.PI * 0.8;
    const botEndAngle = Math.PI * 0.1;
    const botCx = cx - t;
    const botCy = bottom + h * 0.2;
    const botRx = w / 2 - t;
    const botRy = h * 0.15;

    const botTotal = botEndAngle - botStartAngle;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.5; i++) {
      const f = i / (ROUND_SEGMENTS * 0.5);
      const a = botStartAngle + f * botTotal;
      outer.push({ x: botCx + Math.cos(a) * botRx, y: botCy + Math.sin(a) * botRy });
    }

    outer.push({ x: cx - rx * 0.3, y: cy - ry * 0.3 });

    const topTotal = -Math.PI * 1.8;
    for (let i = 0; i <= ROUND_SEGMENTS * 0.9; i++) {
      const f = i / (ROUND_SEGMENTS * 0.9);
      const a = Math.PI * 0.9 + f * topTotal;
      outer.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
    }

    outer.push({ x: cx + rx * 0.7, y: cy - ry * 0.2 });
    outer.push({ x: cx + rx * 0.5, y: bottom + h * 0.1 });

    const hole = [];
    const irx = rx - t;
    const iry = ry - t;
    for (let i = 0; i < ROUND_SEGMENTS * 1.5; i++) {
      const f = i / (ROUND_SEGMENTS * 1.5);
      const a = -Math.PI/2 - f * Math.PI * 1.5;
      hole.push({ x: cx + Math.cos(a) * irx, y: cy + Math.sin(a) * iry });
    }
    hole.push({ x: cx + irx * 0.5, y: cy - iry * 0.5 });

    return { outer: ensureCCW(outer), holes: [ensureCW(hole)] };
  }

  const glyphFns = {
    'A': glyphA, 'B': glyphB, 'C': glyphC, 'D': glyphD, 'E': glyphE, 'F': glyphF, 'G': glyphG,
    'H': glyphH, 'I': glyphI, 'J': glyphJ, 'K': glyphK, 'L': glyphL, 'M': glyphM, 'N': glyphN,
    'O': glyphO, 'P': glyphP, 'Q': glyphQ, 'R': glyphR, 'S': glyphS, 'T': glyphT, 'U': glyphU,
    'V': glyphV, 'W': glyphW, 'X': glyphX, 'Y': glyphY, 'Z': glyphZ,
    '0': glyph0, '1': glyph1, '2': glyph2, '3': glyph3, '4': glyph4,
    '5': glyph5, '6': glyph6, '7': glyph7, '8': glyph8, '9': glyph9
  };

  ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'].forEach(ch => {
    GLYPHS[ch] = {
      advance: getAdvanceWidth(ch),
      paths: [glyphFns[ch]()]
    };
  });

  ['0','1','2','3','4','5','6','7','8','9'].forEach(ch => {
    GLYPHS[ch] = {
      advance: 500,
      paths: [glyphFns[ch]()]
    };
  });

  function getAdvanceWidth(ch) {
    const widths = {
      'A': 700, 'B': 650, 'C': 600, 'D': 650, 'E': 580, 'F': 540, 'G': 650, 'H': 650,
      'I': 250, 'J': 450, 'K': 620, 'L': 520, 'M': 800, 'N': 650, 'O': 650, 'P': 600,
      'Q': 680, 'R': 650, 'S': 580, 'T': 580, 'U': 650, 'V': 650, 'W': 850, 'X': 620,
      'Y': 620, 'Z': 580
    };
    return widths[ch] || 600;
  }

  GLYPHS[' '] = { advance: 300, paths: [] };

  function getGlyph(char) {
    return GLYPHS[char] || GLYPHS[' '];
  }

  function scalePoints(points, scaleX, scaleY) {
    return points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
  }

  function translatePoints(points, tx, ty) {
    return points.map(p => ({ x: p.x + tx, y: p.y + ty }));
  }

  function measureText(text, fontSize, letterSpacing) {
    let totalWidth = 0;
    const scale = fontSize / FONT_HEIGHT;
    const spacing = (letterSpacing || 0) * scale;
    for (let i = 0; i < text.length; i++) {
      const glyph = getGlyph(text[i]);
      totalWidth += glyph.advance * scale;
      if (i < text.length - 1) totalWidth += spacing;
    }
    return totalWidth;
  }

  function textToPaths(text, fontSize, letterSpacing, fontWeight) {
    const result = [];
    const scale = fontSize / FONT_HEIGHT;
    const weightScale = 1 + (fontWeight || 0) * 0.002;
    const spacing = (letterSpacing || 0) * scale;
    let cursorX = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const glyph = getGlyph(ch);

      if (glyph.paths && glyph.paths.length > 0) {
        for (const path of glyph.paths) {
          const charData = {
            char: ch,
            charIndex: i,
            x: cursorX,
            outer: scalePoints(path.outer, scale * weightScale, scale),
            holes: (path.holes || []).map(h => scalePoints(h, scale * weightScale, scale))
          };
          charData.outer = translatePoints(charData.outer, cursorX, 0);
          charData.holes = charData.holes.map(h => translatePoints(h, cursorX, 0));
          result.push(charData);
        }
      }

      cursorX += glyph.advance * scale;
      if (i < text.length - 1) cursorX += spacing;
    }

    return result;
  }

  function getPathLength(points) {
    let len = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      len += Math.hypot(p2.x - p1.x, p2.y - p1.y);
    }
    return len;
  }

  function getPointAtPathLength(points, targetDist) {
    let acc = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (acc + segLen >= targetDist) {
        const t = (targetDist - acc) / segLen;
        return {
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
          angle: Math.atan2(p2.y - p1.y, p2.x - p1.x),
          segmentIndex: i,
          t: t
        };
      }
      acc += segLen;
    }
    const last = points[points.length - 1];
    return { x: last.x, y: last.y, angle: 0, segmentIndex: points.length - 1, t: 1 };
  }

  function transformPointsAlongPath(charPaths, baselinePoints, startOffset) {
    const pathLen = getPathLength(baselinePoints);
    const result = [];

    for (const charData of charPaths) {
      const charWidth = charData.outer.length > 0 ? 
        Math.max(...charData.outer.map(p => p.x)) - Math.min(...charData.outer.map(p => p.x)) : 0;
      
      const centerDist = startOffset + charData.x + charWidth / 2;
      const posInfo = getPointAtPathLength(baselinePoints, centerDist);

      const angle = posInfo.angle;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const transformed = {
        ...charData,
        baseAngle: angle,
        baseX: posInfo.x,
        baseY: posInfo.y
      };

      const transformPt = (pt) => {
        const localX = pt.x - (charData.x + charWidth / 2);
        const localY = pt.y;
        return {
          x: posInfo.x + localX * cos - localY * sin,
          y: posInfo.y + localX * sin + localY * cos
        };
      };

      transformed.outer = charData.outer.map(transformPt);
      transformed.holes = charData.holes.map(h => h.map(transformPt));
      result.push(transformed);
    }

    return result;
  }

  window.GlyphSystem = {
    GLYPHS,
    FONT_HEIGHT,
    ASCENDER,
    DESCENDER,
    getGlyph,
    measureText,
    textToPaths,
    transformPointsAlongPath,
    getPathLength,
    getPointAtPathLength
  };

})();
