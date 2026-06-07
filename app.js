(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const zoomEl = document.getElementById('zoom-level');
  const cursorEl = document.getElementById('cursor-pos');
  const layersListEl = document.getElementById('layers-list');
  const nodeEditIndicatorEl = document.getElementById('node-edit-indicator');

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

  let isNodeEditMode = false;
  let selectedVertexIndex = -1;
  let isDraggingVertex = false;
  let dragVertexOriginalPts = [];
  let hoveredEdgeIndex = -1;

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
    selectedVertexIndex = -1;
    updateToolbar();
    renderLayers();
    render();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(deepCloneShapes(shapes));
    shapes = redoStack.pop();
    selectedIds.clear();
    selectedVertexIndex = -1;
    updateToolbar();
    renderLayers();
    render();
  }

  let shapeCounter = 0;
  function createShape(points, fill, holes) {
    shapeCounter++;
    return {
      id: nextId++,
      name: 'Shape ' + shapeCounter,
      type: 'polygon',
      visible: true,
      locked: false,
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
      if (!s.visible || s.locked) continue;
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

  function hitTestVertex(wx, wy) {
    if (selectedIds.size !== 1) return null;
    const s = getShapeById([...selectedIds][0]);
    if (!s) return null;
    const pts = worldPointsOf(s);
    const hitRadius = 7 / viewport.scale;
    for (let i = 0; i < pts.length; i++) {
      if (dist({x: wx, y: wy}, pts[i]) < hitRadius) {
        return { shape: s, index: i };
      }
    }
    return null;
  }

  function hitTestEdge(wx, wy) {
    if (selectedIds.size !== 1) return null;
    const s = getShapeById([...selectedIds][0]);
    if (!s) return null;
    const pts = worldPointsOf(s);
    const hitRadius = 6 / viewport.scale;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (pointToSegmentDist({x: wx, y: wy}, a, b) < hitRadius) {
        return { shape: s, index: i };
      }
    }
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
      if (s.visible) {
        renderShape(s);
      }
    }

    if (isNodeEditMode && selectedIds.size === 1) {
      const s = getSelectedShapes()[0];
      if (s) renderNodeEdit(s);
    } else {
      for (const id of selectedIds) {
        const s = getShapeById(id);
        if (s) renderSelection(s);
      }
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

  function renderNodeEdit(s) {
    const pts = worldPointsOf(s);
    ctx.save();
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2 / viewport.scale;
    ctx.beginPath();
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();

    const vertexSize = 8 / viewport.scale;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      ctx.save();
      if (i === selectedVertexIndex) {
        ctx.fillStyle = '#ff6b35';
        ctx.strokeStyle = '#fff';
      } else {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1a73e8';
      }
      ctx.lineWidth = 2 / viewport.scale;
      ctx.fillRect(p.x - vertexSize / 2, p.y - vertexSize / 2, vertexSize, vertexSize);
      ctx.strokeRect(p.x - vertexSize / 2, p.y - vertexSize / 2, vertexSize, vertexSize);
      ctx.restore();
    }

    if (hoveredEdgeIndex >= 0 && hoveredEdgeIndex < pts.length && !isDraggingVertex) {
      const a = pts[hoveredEdgeIndex];
      const b = pts[(hoveredEdgeIndex + 1) % pts.length];
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      ctx.save();
      ctx.fillStyle = '#4d9fff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / viewport.scale;
      const size = 6 / viewport.scale;
      ctx.beginPath();
      ctx.arc(midX, midY, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
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
    if (s.locked) return;
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

  function renderLayers() {
    layersListEl.innerHTML = '';

    if (shapes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-layers';
      empty.textContent = 'No layers yet';
      layersListEl.appendChild(empty);
      return;
    }

    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      const item = document.createElement('div');
      item.className = 'layer-item';
      item.dataset.id = s.id;
      item.draggable = true;

      if (selectedIds.has(s.id)) item.classList.add('selected');
      if (s.locked) item.classList.add('locked');

      const visibilityBtn = document.createElement('button');
      visibilityBtn.className = 'layer-btn ' + (s.visible ? 'active' : 'inactive');
      visibilityBtn.innerHTML = s.visible
        ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';
      visibilityBtn.title = s.visible ? 'Hide' : 'Show';
      visibilityBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        s.visible = !s.visible;
        renderLayers();
        render();
      });

      const colorSwatch = document.createElement('div');
      colorSwatch.className = 'layer-color';
      colorSwatch.style.background = s.fill;

      const nameEl = document.createElement('span');
      nameEl.className = 'layer-name';
      nameEl.textContent = s.name;
      nameEl.title = 'Double-click to rename';
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startRenameLayer(item, s, nameEl);
      });

      const lockBtn = document.createElement('button');
      lockBtn.className = 'layer-btn ' + (s.locked ? 'active' : 'inactive');
      lockBtn.innerHTML = s.locked
        ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/></svg>';
      lockBtn.title = s.locked ? 'Unlock' : 'Lock';
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        s.locked = !s.locked;
        if (s.locked && selectedIds.has(s.id)) {
          selectedIds.delete(s.id);
          selectedVertexIndex = -1;
          isNodeEditMode = false;
        }
        updateToolbar();
        renderLayers();
        render();
      });

      item.appendChild(visibilityBtn);
      item.appendChild(colorSwatch);
      item.appendChild(nameEl);
      item.appendChild(lockBtn);

      item.addEventListener('click', (e) => {
        if (s.locked) return;
        if (e.shiftKey) {
          if (selectedIds.has(s.id)) selectedIds.delete(s.id);
          else selectedIds.add(s.id);
        } else {
          selectedIds.clear();
          selectedIds.add(s.id);
        }
        selectedVertexIndex = -1;
        updateToolbar();
        renderLayers();
        render();
      });

      item.addEventListener('dragstart', (e) => {
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id.toString());
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.layer-item.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.layer-item.drag-over').forEach(el => el.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const draggedId = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (isNaN(draggedId) || draggedId === s.id) return;

        const draggedIdx = shapes.findIndex(sh => sh.id === draggedId);
        const targetIdx = shapes.findIndex(sh => sh.id === s.id);
        if (draggedIdx === -1 || targetIdx === -1) return;

        pushHistory();
        const [dragged] = shapes.splice(draggedIdx, 1);
        const newTargetIdx = shapes.findIndex(sh => sh.id === s.id);
        shapes.splice(newTargetIdx, 0, dragged);
        renderLayers();
        render();
      });

      layersListEl.appendChild(item);
    }
  }

  function startRenameLayer(item, shape, nameEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-name-input';
    input.value = shape.name;
    input.maxLength = 50;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finish = (commit) => {
      const newName = input.value.trim() || shape.name;
      if (commit && newName !== shape.name) {
        pushHistory();
        shape.name = newName;
      }
      input.replaceWith(nameEl);
      renderLayers();
    };

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        finish(true);
      } else if (e.key === 'Escape') {
        finish(false);
      }
    });

    input.addEventListener('blur', () => finish(true));
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

    if (isNodeEditMode) {
      nodeEditIndicatorEl.classList.remove('hidden');
    } else {
      nodeEditIndicatorEl.classList.add('hidden');
    }
  }

  function toggleNodeEditMode() {
    if (isNodeEditMode) {
      isNodeEditMode = false;
      selectedVertexIndex = -1;
      hoveredEdgeIndex = -1;
    } else {
      if (selectedIds.size === 1) {
        const s = getSelectedShapes()[0];
        if (s && !s.locked) {
          isNodeEditMode = true;
          selectedVertexIndex = -1;
          hoveredEdgeIndex = -1;
        }
      }
    }
    updateToolbar();
    render();
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
    selectedVertexIndex = -1;
    isNodeEditMode = false;
    updateToolbar();
    renderLayers();
    render();
  }

  function exportSVG() {
    if (shapes.length === 0) {
      alert('Canvas is empty');
      return;
    }
    const visibleShapes = shapes.filter(s => s.visible);
    if (visibleShapes.length === 0) {
      alert('No visible shapes');
      return;
    }
    const allBounds = visibleShapes.map(s => getBounds(worldPointsOf(s)));
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

    for (const s of visibleShapes) {
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
    isNodeEditMode = false;
    selectedVertexIndex = -1;
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

    if (isNodeEditMode && selectedIds.size === 1) {
      const vHit = hitTestVertex(world.x, world.y);
      if (vHit) {
        pushHistory();
        selectedVertexIndex = vHit.index;
        isDraggingVertex = true;
        dragVertexOriginalPts = worldPointsOf(vHit.shape);
        return;
      }
    }

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
            renderLayers();
          }
        } else {
          polygonPoints.push({ ...world });
        }
      }
      render();
      return;
    } else if (currentTool === 'select' && !isNodeEditMode) {
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
        renderLayers();
        render();
        return;
      } else {
        if (!e.shiftKey) {
          isMarquee = true;
          marqueeStart = { ...world };
          marqueeEnd = { ...world };
          selectedIds.clear();
          selectedVertexIndex = -1;
        } else {
          selectedIds.clear();
          selectedVertexIndex = -1;
        }
        isNodeEditMode = false;
        updateToolbar();
        renderLayers();
        render();
      }
    } else if (currentTool === 'select' && isNodeEditMode) {
      const hit = hitTest(world.x, world.y);
      if (!hit) {
        selectedVertexIndex = -1;
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

    if (isDraggingVertex && isNodeEditMode && selectedVertexIndex >= 0 && selectedIds.size === 1) {
      const s = getSelectedShapes()[0];
      if (s) {
        const orig = dragVertexOriginalPts;
        const newPts = orig.map((p, i) => {
          if (i === selectedVertexIndex) {
            return { x: world.x, y: world.y };
          }
          return { ...p };
        });
        setShapeWorldPointsAndHoles(s, newPts, worldHolesOf(s));
        render();
        return;
      }
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

    if (isNodeEditMode && selectedIds.size === 1 && !isDraggingVertex) {
      const vHit = hitTestVertex(world.x, world.y);
      if (vHit) {
        canvas.style.cursor = 'move';
        hoveredEdgeIndex = -1;
      } else {
        const eHit = hitTestEdge(world.x, world.y);
        if (eHit) {
          hoveredEdgeIndex = eHit.index;
          canvas.style.cursor = 'copy';
        } else {
          hoveredEdgeIndex = -1;
          canvas.style.cursor = 'default';
        }
      }
      render();
      return;
    }

    if (currentTool === 'select' && !isNodeEditMode) {
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

    if (isDraggingVertex) {
      isDraggingVertex = false;
      dragVertexOriginalPts = [];
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
      renderLayers();
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
          if (!s.visible || s.locked) continue;
          const pts = worldPointsOf(s);
          const b = getBounds(pts);
          if (b.minX >= mx1 && b.maxX <= mx2 && b.minY >= my1 && b.maxY <= my2) {
            selectedIds.add(s.id);
          }
        }
      }
      marqueeStart = marqueeEnd = null;
      updateToolbar();
      renderLayers();
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
    const world = screenToWorld(e.clientX, e.clientY);

    if (currentTool === 'polygon' && polygonPoints.length >= 3) {
      pushHistory();
      const ns = createShape(ensureCCW(polygonPoints.slice()));
      shapes.push(ns);
      selectedIds.clear();
      selectedIds.add(ns.id);
      polygonPoints = [];
      updateToolbar();
      renderLayers();
      render();
      return;
    }

    if (isNodeEditMode && selectedIds.size === 1) {
      const s = getSelectedShapes()[0];
      if (!s || s.locked) return;
      const eHit = hitTestEdge(world.x, world.y);
      if (eHit) {
        pushHistory();
        const pts = worldPointsOf(s).map(p => ({ ...p }));
        const a = pts[eHit.index];
        const b = pts[(eHit.index + 1) % pts.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pts.splice(eHit.index + 1, 0, mid);
        setShapeWorldPointsAndHoles(s, pts, worldHolesOf(s));
        selectedVertexIndex = eHit.index + 1;
        render();
      }
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
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      return;
    }

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
      for (const s of shapes) {
        if (!s.locked && s.visible) selectedIds.add(s.id);
      }
      isNodeEditMode = false;
      selectedVertexIndex = -1;
      updateToolbar();
      renderLayers();
      render();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (isNodeEditMode && selectedIds.size === 1 && selectedVertexIndex >= 0) {
        const s = getSelectedShapes()[0];
        if (s && !s.locked) {
          const pts = worldPointsOf(s);
          if (pts.length > 3) {
            pushHistory();
            const newPts = pts.filter((_, i) => i !== selectedVertexIndex);
            setShapeWorldPointsAndHoles(s, newPts, worldHolesOf(s));
            if (selectedVertexIndex >= newPts.length) {
              selectedVertexIndex = newPts.length - 1;
            }
            render();
          }
        }
        e.preventDefault();
        return;
      }
      if (selectedIds.size > 0) {
        pushHistory();
        shapes = shapes.filter(s => !selectedIds.has(s.id));
        selectedIds.clear();
        selectedVertexIndex = -1;
        isNodeEditMode = false;
        updateToolbar();
        renderLayers();
        render();
      }
      return;
    }
    if (e.key === 'Escape') {
      polygonPoints = [];
      isDrawing = false;
      selectedIds.clear();
      selectedVertexIndex = -1;
      isNodeEditMode = false;
      setTool('select');
      renderLayers();
      render();
      return;
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key.toLowerCase() === 'v') setTool('select');
      else if (e.key.toLowerCase() === 'r') setTool('rect');
      else if (e.key.toLowerCase() === 'c') setTool('circle');
      else if (e.key.toLowerCase() === 'p') setTool('polygon');
      else if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        toggleNodeEditMode();
      }
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
    rect.name = 'Rectangle';
    const circle = createShape(
      ensureCCW(circleToPolygon(-80, 0, 80, 64)),
      'hsla(0, 60%, 70%, 0.4)'
    );
    circle.name = 'Circle';
    const pentagonPts = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      pentagonPts.push({ x: 80 + Math.cos(a) * 75, y: -20 + Math.sin(a) * 75 });
    }
    const pentagon = createShape(ensureCCW(pentagonPts), 'hsla(120, 60%, 70%, 0.4)');
    pentagon.name = 'Pentagon';

    shapes.push(rect, circle, pentagon);
    renderLayers();
    render();
  }

  resize();
  createDemo();
})();
