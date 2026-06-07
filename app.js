(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const zoomEl = document.getElementById('zoom-level');
  const cursorEl = document.getElementById('cursor-pos');

  const GRID_SIZE = 20;

  let viewport = { x: 0, y: 0, scale: 1 };
  let shapes = [];
  let selectedIds = new Set();
  let nextId = 1;
  let currentTool = 'select';

  let undoStack = [];
  let redoStack = [];
  const MAX_HISTORY = 50;

  let isDrawing = false;
  let drawStart = null;
  let drawEnd = null;
  let polygonPoints = [];

  let isPanning = false;
  let panStart = null;

  let isDraggingShape = false;
  let dragStart = null;
  let dragOriginalWorldPts = [];

  let isTransforming = false;
  let transformHandle = null;
  let transformStart = null;
  let transformOriginalData = [];

  let isMarquee = false;
  let marqueeStart = null;
  let marqueeEnd = null;

  let lastMouseWorld = { x: 0, y: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }
  window.addEventListener('resize', resize);

  function screenToWorld(sx, sy) {
    return {
      x: (sx - window.innerWidth / 2) / viewport.scale + viewport.x,
      y: (sy - window.innerHeight / 2) / viewport.scale + viewport.y
    };
  }

  function bakeTransform(shape) {
    const t = shape.transform;
    shape.points = applyTransform(shape.points, t.tx, t.ty, t.rotation, t.scaleX, t.scaleY);
    if (shape.holes) {
      shape.holes = shape.holes.map(h => applyTransform(h, t.tx, t.ty, t.rotation, t.scaleX, t.scaleY));
    }
    shape.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  function worldPointsOf(shape) {
    const t = shape.transform;
    return applyTransform(shape.points, t.tx, t.ty, t.rotation, t.scaleX, t.scaleY);
  }

  function worldHolesOf(shape) {
    if (!shape.holes) return [];
    const t = shape.transform;
    return shape.holes.map(h => applyTransform(h, t.tx, t.ty, t.rotation, t.scaleX, t.scaleY));
  }

  function getShapeById(id) {
    return shapes.find(s => s.id === id);
  }

  function deepCloneShapes(arr) {
    return JSON.parse(JSON.stringify(arr));
  }

  function pushHistory() {
    undoStack.push(deepCloneShapes(shapes));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(deepCloneShapes(shapes));
    shapes = undoStack.pop();
    selectedIds.clear();
    updateToolbar();
    render();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(deepCloneShapes(shapes));
    shapes = redoStack.pop();
    selectedIds.clear();
    updateToolbar();
    render();
  }

  function createShape(points, fill, holes) {
    return {
      id: nextId++,
      type: 'polygon',
      points: points,
      holes: holes || [],
      fill: fill || randomFillColor(),
      stroke: '#000',
      strokeWidth: 2,
      transform: { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    };
  }

  function hitTest(wx, wy) {
    const pt = { x: wx, y: wy };
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      const wp = worldPointsOf(s);
      if (pointInPolygonOrOnEdge(pt, wp)) return s;
    }
    return null;
  }

  function getBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function boundsCenter(b) {
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  function getControlHandles(bounds, ctr) {
    return [
      { type: 'nw', point: { x: bounds.minX, y: bounds.minY } },
      { type: 'n',  point: { x: ctr.x, y: bounds.minY } },
      { type: 'ne', point: { x: bounds.maxX, y: bounds.minY } },
      { type: 'e',  point: { x: bounds.maxX, y: ctr.y } },
      { type: 'se', point: { x: bounds.maxX, y: bounds.maxY } },
      { type: 's',  point: { x: ctr.x, y: bounds.maxY } },
      { type: 'sw', point: { x: bounds.minX, y: bounds.maxY } },
      { type: 'w',  point: { x: bounds.minX, y: ctr.y } }
    ];
  }

  function hitTestHandle(wx, wy) {
    if (selectedIds.size !== 1) return null;
    const s = getShapeById([...selectedIds][0]);
    if (!s) return null;
    const pts = worldPointsOf(s);
    const bounds = getBounds(pts);
    const ctr = boundsCenter(bounds);
    const handles = getControlHandles(bounds, ctr);
    const hitRadius = 8 / viewport.scale;
    for (const h of handles) {
      if (dist({x: wx, y: wy}, h.point) < hitRadius) return h;
    }
    if (dist({x: wx, y: wy}, ctr) < hitRadius * 1.5) return { type: 'rotate', point: ctr };
    return null;
  }

  function getSelectedShapes() {
    return [...selectedIds].map(id => getShapeById(id)).filter(Boolean);
  }

  function drawPolygonPath(points, holes) {
    ctx.beginPath();
    if (points.length > 0) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();
    }
    if (holes) {
      for (const hole of holes) {
        if (hole.length > 0) {
          ctx.moveTo(hole[0].x, hole[0].y);
          for (let i = 1; i < hole.length; i++) {
            ctx.lineTo(hole[i].x, hole[i].y);
          }
          ctx.closePath();
        }
      }
    }
  }

  function render() {
    const w = window.innerWidth, h = window.innerHeight;
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewport.scale, viewport.scale);
    ctx.translate(-viewport.x, -viewport.y);

    drawGrid();

    for (const s of shapes) {
      renderShape(s);
    }

    for (const id of selectedIds) {
      const s = getShapeById(id);
      if (s) renderSelection(s);
    }

    if (isDrawing && currentTool === 'rect' && drawStart && drawEnd) {
      const x = Math.min(drawStart.x, drawEnd.x);
      const y = Math.min(drawStart.y, drawEnd.y);
      const w2 = Math.abs(drawEnd.x - drawStart.x);
      const h2 = Math.abs(drawEnd.y - drawStart.y);
      ctx.save();
      ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
      ctx.strokeStyle = '#4d9fff';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.fillRect(x, y, w2, h2);
      ctx.strokeRect(x, y, w2, h2);
      ctx.restore();
    }

    if (isDrawing && currentTool === 'circle' && drawStart && drawEnd) {
      const r = dist(drawStart, drawEnd);
      ctx.save();
      ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
      ctx.strokeStyle = '#4d9fff';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.beginPath();
      ctx.arc(drawStart.x, drawStart.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (currentTool === 'polygon' && polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#4d9fff';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i++) {
        ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      }
      if (lastMouseWorld) {
        ctx.lineTo(lastMouseWorld.x, lastMouseWorld.y);
      }
      ctx.stroke();
      ctx.restore();

      for (const p of polygonPoints) {
        ctx.save();
        ctx.fillStyle = '#4d9fff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / viewport.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if (isMarquee && marqueeStart && marqueeEnd) {
      const x = Math.min(marqueeStart.x, marqueeEnd.x);
      const y = Math.min(marqueeStart.y, marqueeEnd.y);
      const w3 = Math.abs(marqueeEnd.x - marqueeStart.x);
      const h3 = Math.abs(marqueeEnd.y - marqueeStart.y);
      ctx.save();
      ctx.fillStyle = 'rgba(77, 159, 255, 0.15)';
      ctx.strokeStyle = '#4d9fff';
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.setLineDash([4 / viewport.scale, 3 / viewport.scale]);
      ctx.fillRect(x, y, w3, h3);
      ctx.strokeRect(x, y, w3, h3);
      ctx.restore();
    }

    ctx.restore();

    zoomEl.textContent = Math.round(viewport.scale * 100) + '%';
  }

  function drawGrid() {
    const spacing = GRID_SIZE;
    const w = window.innerWidth, h = window.innerHeight;
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(w, h);
    const startX = Math.floor(tl.x / spacing) * spacing;
    const startY = Math.floor(tl.y / spacing) * spacing;

    ctx.save();
    ctx.fillStyle = '#d8d8d8';
    const dotSize = 1.5 / viewport.scale;
    for (let x = startX; x <= br.x; x += spacing) {
      for (let y = startY; y <= br.y; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderShape(s) {
    const pts = worldPointsOf(s);
    const holes = worldHolesOf(s);
    ctx.save();
    drawPolygonPath(pts, holes);
    ctx.fillStyle = s.fill;
    ctx.fill('evenodd');
    ctx.lineWidth = (s.strokeWidth || 2) / viewport.scale;
    ctx.strokeStyle = s.stroke || '#000';
    ctx.stroke();
    ctx.restore();
  }

  function renderSelection(s) {
    const pts = worldPointsOf(s);
    const bounds = getBounds(pts);
    const ctr = boundsCenter(bounds);
    const handles = getControlHandles(bounds, ctr);

    ctx.save();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2 / viewport.scale;
    ctx.setLineDash([4 / viewport.scale, 3 / viewport.scale]);
    ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    ctx.setLineDash([]);
    ctx.restore();

    for (const h of handles) {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 1.5 / viewport.scale;
      const hs = 6 / viewport.scale;
      ctx.fillRect(h.point.x - hs / 2, h.point.y - hs / 2, hs, hs);
      ctx.strokeRect(h.point.x - hs / 2, h.point.y - hs / 2, hs, hs);
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = '#1a73e8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 / viewport.scale;
    ctx.beginPath();
    ctx.arc(ctr.x, ctr.y, 7 / viewport.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ctr.x, ctr.y, 14 / viewport.scale, 0, Math.PI * 2);
    ctx.strokeStyle = '#1a73e8';
    ctx.stroke();
    ctx.restore();
  }

  function updateToolbar() {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const btnId = 'tool-' + currentTool;
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.add('active');

    const opBtns = ['op-union', 'op-subtract', 'op-intersect'];
    const enabled = selectedIds.size === 2;
    for (const id of opBtns) {
      document.getElementById(id).disabled = !enabled;
    }
  }

  function performBoolean(op) {
    if (selectedIds.size !== 2) return;
    const ids = [...selectedIds];
    const a = getShapeById(ids[0]);
    const b = getShapeById(ids[1]);
    if (!a || !b) return;

    pushHistory();

    const aPts = worldPointsOf(a);
    const bPts = worldPointsOf(b);

    let result;
    if (op === 'union') result = weilerAtherton(aPts, bPts, 'union');
    else if (op === 'intersect') result = weilerAtherton(aPts, bPts, 'intersect');
    else result = weilerAtherton(aPts, bPts, 'subtract');

    if (op === 'intersect' && result.polygons.length === 0) {
      undoStack.pop();
      alert('No intersection');
      return;
    }

    shapes = shapes.filter(s => s.id !== a.id && s.id !== b.id);

    const newShapes = [];
    if (result.polygons.length > 0) {
      const mainPoly = result.polygons[0];
      const holes = result.holes || [];
      const ns = createShape(ensureCCW(mainPoly), a.fill, holes.map(h => ensureCW(h)));
      newShapes.push(ns);
      shapes.push(ns);
      for (let i = 1; i < result.polygons.length; i++) {
        const ns2 = createShape(ensureCCW(result.polygons[i]), a.fill, []);
        newShapes.push(ns2);
        shapes.push(ns2);
      }
    }

    selectedIds.clear();
    for (const ns of newShapes) selectedIds.add(ns.id);
    updateToolbar();
    render();
  }

  function exportSVG() {
    if (shapes.length === 0) {
      alert('Canvas is empty');
      return;
    }
    const allBounds = shapes.map(s => getBounds(worldPointsOf(s)));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of allBounds) {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const pad = 20;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const vw = Math.ceil(maxX - minX), vh = Math.ceil(maxY - minY);

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${minX.toFixed(2)} ${minY.toFixed(2)} ${vw} ${vh}">`;

    for (const s of shapes) {
      const wp = worldPointsOf(s);
      const holes = worldHolesOf(s);
      let d = '';
      if (wp.length > 0) {
        d += `M${wp[0].x.toFixed(2)} ${wp[0].y.toFixed(2)}`;
        for (let i = 1; i < wp.length; i++) {
          d += ` L${wp[i].x.toFixed(2)} ${wp[i].y.toFixed(2)}`;
        }
        d += ' Z';
      }
      if (holes && holes.length > 0) {
        for (const hole of holes) {
          if (hole.length > 0) {
            const rev = hole.slice().reverse();
            d += ` M${rev[0].x.toFixed(2)} ${rev[0].y.toFixed(2)}`;
            for (let i = 1; i < rev.length; i++) {
              d += ` L${rev[i].x.toFixed(2)} ${rev[i].y.toFixed(2)}`;
            }
            d += ' Z';
          }
        }
      }
      svg += `<path d="${d}" fill="${s.fill}" fill-rule="evenodd" stroke="${s.stroke}" stroke-width="${s.strokeWidth || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    svg += '</svg>';

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'canvas.svg';
    a.click();
    URL.revokeObjectURL(url);
  }

  function setTool(tool) {
    currentTool = tool;
    isDrawing = false;
    polygonPoints = [];
    drawStart = drawEnd = null;
    canvas.style.cursor = (tool === 'select') ? 'default' : 'crosshair';
    updateToolbar();
    render();
  }

  function translatePoints(points, dx, dy) {
    return points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  }

  function scalePointsAround(points, pivot, sx, sy) {
    return points.map(p => {
      const dx = p.x - pivot.x;
      const dy = p.y - pivot.y;
      return { x: pivot.x + dx * sx, y: pivot.y + dy * sy };
    });
  }

  function rotatePointsAround(points, pivot, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return points.map(p => {
      const dx = p.x - pivot.x;
      const dy = p.y - pivot.y;
      return {
        x: pivot.x + dx * cos - dy * sin,
        y: pivot.y + dx * sin + dy * cos
      };
    });
  }

  function setShapeWorldPoints(shape, newPts) {
    shape.points = newPts.map(p => ({ ...p }));
    shape.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  function setShapeWorldPointsAndHoles(shape, newPts, newHoles) {
    shape.points = newPts.map(p => ({ ...p }));
    if (newHoles) {
      shape.holes = newHoles.map(h => h.map(p => ({ ...p })));
    }
    shape.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  canvas.addEventListener('mousedown', (e) => {
    const world = screenToWorld(e.clientX, e.clientY);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, vx: viewport.x, vy: viewport.y };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    if (currentTool === 'rect' || currentTool === 'circle') {
      isDrawing = true;
      drawStart = { ...world };
      drawEnd = { ...world };
    } else if (currentTool === 'polygon') {
      if (polygonPoints.length === 0) {
        polygonPoints.push({ ...world });
      } else {
        const first = polygonPoints[0];
        if (dist(first, world) < 8 / viewport.scale) {
          if (polygonPoints.length >= 3) {
            pushHistory();
            const ns = createShape(ensureCCW(polygonPoints.slice()));
            shapes.push(ns);
            selectedIds.clear();
            selectedIds.add(ns.id);
            polygonPoints = [];
            updateToolbar();
          }
        } else {
          polygonPoints.push({ ...world });
        }
      }
      render();
      return;
    } else if (currentTool === 'select') {
      const handle = hitTestHandle(world.x, world.y);
      if (handle && selectedIds.size === 1) {
        pushHistory();
        isTransforming = true;
        transformHandle = handle;
        const selShape = getSelectedShapes()[0];
        const originalPts = worldPointsOf(selShape);
        const originalHoles = worldHolesOf(selShape);
        const origBounds = getBounds(originalPts);
        const origCenter = boundsCenter(origBounds);

        transformOriginalData = [{
          shape: selShape,
          originalPts,
          originalHoles,
          bounds: origBounds,
          center: origCenter
        }];
        transformStart = {
          world,
          mouseX: e.clientX,
          mouseY: e.clientY
        };
        if (handle.type === 'rotate') {
          transformStart.angle = Math.atan2(world.y - origCenter.y, world.x - origCenter.x);
        }
        return;
      }

      const hit = hitTest(world.x, world.y);
      if (hit) {
        if (!e.shiftKey && !selectedIds.has(hit.id)) {
          selectedIds.clear();
        }
        if (e.shiftKey && selectedIds.has(hit.id)) {
          selectedIds.delete(hit.id);
        } else {
          selectedIds.add(hit.id);
        }
        isDraggingShape = true;
        dragStart = { world };
        dragOriginalWorldPts = getSelectedShapes().map(s => ({
          shape: s,
          pts: worldPointsOf(s),
          holes: worldHolesOf(s)
        }));
        updateToolbar();
        render();
        return;
      } else {
        if (!e.shiftKey) {
          isMarquee = true;
          marqueeStart = { ...world };
          marqueeEnd = { ...world };
          selectedIds.clear();
        } else {
          selectedIds.clear();
        }
        updateToolbar();
        render();
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const world = screenToWorld(e.clientX, e.clientY);
    lastMouseWorld = { ...world };
    cursorEl.textContent = `x: ${world.x.toFixed(1)}, y: ${world.y.toFixed(1)}`;

    if (isPanning) {
      const dx = (e.clientX - panStart.x) / viewport.scale;
      const dy = (e.clientY - panStart.y) / viewport.scale;
      viewport.x = panStart.vx - dx;
      viewport.y = panStart.vy - dy;
      render();
      return;
    }

    if (isDrawing && drawStart) {
      drawEnd = { ...world };
      render();
      return;
    }

    if (currentTool === 'polygon' && polygonPoints.length > 0) {
      render();
      return;
    }

    if (isMarquee) {
      marqueeEnd = { ...world };
      render();
      return;
    }

    if (isDraggingShape && dragStart) {
      const dx = world.x - dragStart.world.x;
      const dy = world.y - dragStart.world.y;
      for (const d of dragOriginalWorldPts) {
        const newPts = translatePoints(d.pts, dx, dy);
        const newHoles = d.holes.map(h => translatePoints(h, dx, dy));
        setShapeWorldPointsAndHoles(d.shape, newPts, newHoles);
      }
      render();
      return;
    }

    if (isTransforming && transformHandle && transformStart && transformOriginalData.length > 0) {
      const data = transformOriginalData[0];
      if (transformHandle.type === 'rotate') {
        const currentAngle = Math.atan2(world.y - data.center.y, world.x - data.center.x);
        const delta = currentAngle - transformStart.angle;
        const newPts = rotatePointsAround(data.originalPts, data.center, delta);
        const newHoles = data.originalHoles.map(h => rotatePointsAround(h, data.center, delta));
        setShapeWorldPointsAndHoles(data.shape, newPts, newHoles);
      } else {
        const ht = transformHandle.type;
        const b = data.bounds;
        const c = data.center;
        const origW = b.maxX - b.minX;
        const origH = b.maxY - b.minY;

        let anchorX, anchorY;
        if (ht.includes('w')) anchorX = b.maxX;
        else if (ht.includes('e')) anchorX = b.minX;
        else anchorX = c.x;

        if (ht.includes('n')) anchorY = b.maxY;
        else if (ht.includes('s')) anchorY = b.minY;
        else anchorY = c.y;

        let targetX = world.x, targetY = world.y;

        let sx = 1, sy = 1;
        if (ht.includes('w')) {
          const dx = anchorX - targetX;
          if (origW > 1) sx = Math.max(0.05, dx / origW);
        } else if (ht.includes('e')) {
          const dx = targetX - anchorX;
          if (origW > 1) sx = Math.max(0.05, dx / origW);
        }
        if (ht.includes('n')) {
          const dy = anchorY - targetY;
          if (origH > 1) sy = Math.max(0.05, dy / origH);
        } else if (ht.includes('s')) {
          const dy = targetY - anchorY;
          if (origH > 1) sy = Math.max(0.05, dy / origH);
        }

        const isCorner = (ht === 'nw' || ht === 'ne' || ht === 'sw' || ht === 'se');
        if (isCorner) {
          const ratio = Math.max(sx, sy);
          sx = ratio;
          sy = ratio;
        }

        const pivot = { x: anchorX, y: anchorY };
        const newPts = scalePointsAround(data.originalPts, pivot, sx, sy);
        const newHoles = data.originalHoles.map(h => scalePointsAround(h, pivot, sx, sy));
        setShapeWorldPointsAndHoles(data.shape, newPts, newHoles);
      }
      render();
      return;
    }

    if (currentTool === 'select') {
      const handle = hitTestHandle(world.x, world.y);
      if (handle) {
        if (handle.type === 'rotate') canvas.style.cursor = 'grab';
        else if (handle.type === 'nw' || handle.type === 'se') canvas.style.cursor = 'nwse-resize';
        else if (handle.type === 'ne' || handle.type === 'sw') canvas.style.cursor = 'nesw-resize';
        else if (handle.type === 'n' || handle.type === 's') canvas.style.cursor = 'ns-resize';
        else canvas.style.cursor = 'ew-resize';
      } else {
        const hit = hitTest(world.x, world.y);
        canvas.style.cursor = hit ? 'move' : 'default';
      }
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = (currentTool === 'select') ? 'default' : 'crosshair';
      return;
    }

    if (isDrawing && drawStart && drawEnd) {
      isDrawing = false;
      pushHistory();

      if (currentTool === 'rect') {
        const x = Math.min(drawStart.x, drawEnd.x);
        const y = Math.min(drawStart.y, drawEnd.y);
        const w = Math.abs(drawEnd.x - drawStart.x);
        const h = Math.abs(drawEnd.y - drawStart.y);
        if (w > 3 && h > 3) {
          const pts = rectToPolygon(x, y, w, h);
          const ns = createShape(ensureCCW(pts));
          shapes.push(ns);
          selectedIds.clear();
          selectedIds.add(ns.id);
        }
      } else if (currentTool === 'circle') {
        const r = dist(drawStart, drawEnd);
        if (r > 3) {
          const pts = circleToPolygon(drawStart.x, drawStart.y, r, 64);
          const ns = createShape(ensureCCW(pts));
          shapes.push(ns);
          selectedIds.clear();
          selectedIds.add(ns.id);
        }
      }
      drawStart = drawEnd = null;
      updateToolbar();
      render();
      return;
    }

    if (isMarquee && marqueeStart && marqueeEnd) {
      isMarquee = false;
      const mx1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const my1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const mx2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const my2 = Math.max(marqueeStart.y, marqueeEnd.y);
      if (Math.abs(mx2 - mx1) > 3 || Math.abs(my2 - my1) > 3) {
        for (const s of shapes) {
          const pts = worldPointsOf(s);
          const b = getBounds(pts);
          if (b.minX >= mx1 && b.maxX <= mx2 && b.minY >= my1 && b.maxY <= my2) {
            selectedIds.add(s.id);
          }
        }
      }
      marqueeStart = marqueeEnd = null;
      updateToolbar();
      render();
      return;
    }

    if (isDraggingShape) {
      isDraggingShape = false;
      dragStart = null;
      dragOriginalWorldPts = [];
      render();
      return;
    }

    if (isTransforming) {
      isTransforming = false;
      transformHandle = null;
      transformStart = null;
      transformOriginalData = [];
      render();
      return;
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    if (currentTool === 'polygon' && polygonPoints.length >= 3) {
      pushHistory();
      const ns = createShape(ensureCCW(polygonPoints.slice()));
      shapes.push(ns);
      selectedIds.clear();
      selectedIds.add(ns.id);
      polygonPoints = [];
      updateToolbar();
      render();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.25, Math.min(8, viewport.scale * factor));
    if (newScale === viewport.scale) return;

    const worldBefore = screenToWorld(e.clientX, e.clientY);
    viewport.scale = newScale;
    const worldAfter = screenToWorld(e.clientX, e.clientY);
    viewport.x += worldBefore.x - worldAfter.x;
    viewport.y += worldBefore.y - worldAfter.y;
    render();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectedIds.clear();
      for (const s of shapes) selectedIds.add(s.id);
      updateToolbar();
      render();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.size > 0) {
        pushHistory();
        shapes = shapes.filter(s => !selectedIds.has(s.id));
        selectedIds.clear();
        updateToolbar();
        render();
      }
      return;
    }
    if (e.key === 'Escape') {
      polygonPoints = [];
      isDrawing = false;
      selectedIds.clear();
      setTool('select');
      render();
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key.toLowerCase() === 'v') setTool('select');
      else if (e.key.toLowerCase() === 'r') setTool('rect');
      else if (e.key.toLowerCase() === 'c') setTool('circle');
      else if (e.key.toLowerCase() === 'p') setTool('polygon');
    }
  });

  document.getElementById('tool-select').addEventListener('click', () => setTool('select'));
  document.getElementById('tool-rect').addEventListener('click', () => setTool('rect'));
  document.getElementById('tool-circle').addEventListener('click', () => setTool('circle'));
  document.getElementById('tool-polygon').addEventListener('click', () => setTool('polygon'));
  document.getElementById('op-union').addEventListener('click', () => performBoolean('union'));
  document.getElementById('op-subtract').addEventListener('click', () => performBoolean('subtract'));
  document.getElementById('op-intersect').addEventListener('click', () => performBoolean('intersect'));
  document.getElementById('export-svg').addEventListener('click', exportSVG);

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function createDemo() {
    const rect = createShape(
      ensureCCW(rectToPolygon(-250, -120, 200, 150)),
      'hsla(220, 60%, 70%, 0.4)'
    );
    const circle = createShape(
      ensureCCW(circleToPolygon(-80, 0, 80, 64)),
      'hsla(0, 60%, 70%, 0.4)'
    );
    const pentagonPts = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      pentagonPts.push({ x: 80 + Math.cos(a) * 75, y: -20 + Math.sin(a) * 75 });
    }
    const pentagon = createShape(ensureCCW(pentagonPts), 'hsla(120, 60%, 70%, 0.4)');

    shapes.push(rect, circle, pentagon);
    render();
  }

  resize();
  createDemo();
})();
