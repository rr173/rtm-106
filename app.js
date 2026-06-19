(function() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const zoomEl = document.getElementById('zoom-level');
  const cursorEl = document.getElementById('cursor-pos');
  const layersListEl = document.getElementById('layers-list');
  const componentsListEl = document.getElementById('components-list');
  const nodeEditIndicatorEl = document.getElementById('node-edit-indicator');
  const componentEditIndicatorEl = document.getElementById('component-edit-indicator');
  const componentEditNameEl = document.getElementById('component-edit-name');
  const constraintListEl = document.getElementById('constraint-list');
  const paramsListEl = document.getElementById('params-list');
  const dofValueEl = document.getElementById('dof-value');
  const dofHintEl = document.getElementById('dof-hint');
  const modeIndicatorEl = document.getElementById('mode-indicator');
  const constraintMenuEl = document.getElementById('constraint-menu');
  const constraintDialogEl = document.getElementById('constraint-edit-dialog');
  const toastEl = document.getElementById('toast');
  const paramSelectEl = document.getElementById('constraint-param-select');
  const valueInputEl = document.getElementById('constraint-value-input');

  const createComponentDialogEl = document.getElementById('create-component-dialog');
  const componentNameInputEl = document.getElementById('component-name-input');
  const deleteComponentDialogEl = document.getElementById('delete-component-dialog');
  const deleteComponentMessageEl = document.getElementById('delete-component-message');
  const instanceOverrideDialogEl = document.getElementById('instance-override-dialog');
  const overrideFillColorEl = document.getElementById('override-fill-color');
  const overrideStrokeColorEl = document.getElementById('override-stroke-color');
  const instanceChildListEl = document.getElementById('instance-child-list');

  const GRID_SIZE = 20;
  const STORAGE_KEY = 'rtm-106-editor-state';
  const CS = window.ConstraintSystem;
  const {
    CONSTRAINT_TYPES,
    CoincidentConstraint,
    PointOnLineConstraint,
    ParallelConstraint,
    PerpendicularConstraint,
    EqualLengthConstraint,
    FixedAngleConstraint,
    DistanceConstraint,
    HorizontalConstraint,
    VerticalConstraint,
    ConstraintSolver,
    ParamManager,
    makePointId,
    parsePointId
  } = CS;

  let viewport = { x: 0, y: 0, scale: 1 };
  let shapes = [];
  let selectedIds = new Set();
  let nextId = 1;
  let nextComponentId = 1;
  let currentTool = 'select';

  let components = {};
  let editingComponentId = null;
  let savedViewportForComponentEdit = null;
  let savedSelectionForComponentEdit = null;
  let savedConstraintsForComponentEdit = null;
  let pendingComponentToDelete = null;
  let editingInstanceId = null;
  let tempOverrides = null;

  let undoStack = [];
  let redoStack = [];
  const MAX_HISTORY = 50;

  let isDrawing = false;
  let drawStart = null;
  let drawEnd = null;
  let polygonPoints = [];

  let textSettings = {
    text: 'HELLO',
    fontSize: 100,
    fontWeight: 0,
    letterSpacing: 50
  };

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
  let selectedVertex = null;
  let isDraggingVertex = false;
  let dragVertexOriginalData = null;
  let hoveredEdge = null;

  let constraintSolver = new ConstraintSolver();

  let animationController = new window.AnimationController();
  let selectedKeyframeShapeId = null;
  let selectedKeyframeProp = null;
  let selectedKeyframeFrame = null;
  let timelineCollapsed = false;
  let originalShapeData = null;
  let paramManager = new ParamManager();
  let constraints = [];
  let paramsData = {};
  let selectedConstraintIdx = -1;
  let editingConstraintIdx = -1;

  let constraintSelection = [];
  let constraintMode = null;

  let shapeCounter = 0;

  const PM = window.PathMotion;
  let motionPathManager = new PM.MotionPathManager();
  let selectedPathShapeIdForBinding = null;

  const SNAP_THRESHOLD = 8;
  let snapEnabled = true;
  let snapInfo = {
    active: false,
    lines: [],
    distances: []
  };
  let keys = { shift: false, alt: false };

  const DS = window.DimensionSystem;
  const DIM_TYPES = window.DIMENSION_TYPES;
  const UNIT_TYPES = window.UNIT_TYPES;
  let dimensionSystem = new DS();
  let selectedDimensionId = null;
  let dimToolSelection = [];
  let dimToolType = null;

  let guideSystem = null;

  let pages = [];
  let currentPageId = null;
  let nextPageId = 1;
  let clipboardShapes = null;
  let isDraggingPageTab = false;
  let draggedPageId = null;

  function createPageData(name) {
    return {
      id: nextPageId++,
      name: name || generateNextPageName(),
      shapes: [],
      constraints: [],
      paramsData: {},
      viewport: { x: 0, y: 0, scale: 1 },
      animationData: null,
      motionPathData: null,
      dimensionData: null,
      guideData: null
    };
  }

  function generateNextPageName() {
    let maxNum = 0;
    for (const page of pages) {
      const match = page.name.match(/^Page (\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return 'Page ' + (maxNum + 1);
  }

  function getCurrentPage() {
    return pages.find(p => p.id === currentPageId) || null;
  }

  function getPageById(id) {
    return pages.find(p => p.id === id) || null;
  }

  function saveCurrentPageState() {
    const page = getCurrentPage();
    if (!page) return;

    try {
      page.shapes = JSON.parse(JSON.stringify(shapes || []));
    } catch (e) {
      console.warn('Failed to save shapes:', e);
      page.shapes = page.shapes || [];
    }

    try {
      page.constraints = JSON.parse(JSON.stringify((constraints || []).map(c => serializeConstraint(c)).filter(Boolean)));
    } catch (e) {
      console.warn('Failed to save constraints:', e);
      page.constraints = page.constraints || [];
    }

    try {
      page.paramsData = JSON.parse(JSON.stringify(paramsData || {}));
    } catch (e) {
      console.warn('Failed to save paramsData:', e);
      page.paramsData = page.paramsData || {};
    }

    try {
      page.viewport = JSON.parse(JSON.stringify(viewport || { x: 0, y: 0, scale: 1 }));
    } catch (e) {
      console.warn('Failed to save viewport:', e);
    }

    try {
      page.animationData = animationController.serialize();
    } catch (e) {
      console.warn('Failed to save animationData:', e);
      page.animationData = page.animationData || null;
    }

    try {
      page.motionPathData = motionPathManager.serialize();
    } catch (e) {
      console.warn('Failed to save motionPathData:', e);
      page.motionPathData = page.motionPathData || null;
    }

    try {
      page.dimensionData = dimensionSystem.serialize();
    } catch (e) {
      console.warn('Failed to save dimensionData:', e);
      page.dimensionData = page.dimensionData || null;
    }

    try {
      if (guideSystem) {
        page.guideData = guideSystem.serialize();
      }
    } catch (e) {
      console.warn('Failed to save guideData:', e);
      page.guideData = page.guideData || null;
    }
  }

  function loadPageState(pageId) {
    const page = getPageById(pageId);
    if (!page) return false;

    saveCurrentPageState();

    const oldPageId = currentPageId;
    const oldShapes = shapes;
    const oldConstraints = constraints;
    const oldParamsData = paramsData;
    const oldViewport = viewport;

    try {
      currentPageId = pageId;

      shapes = JSON.parse(JSON.stringify(page.shapes || []));
      constraints = (page.constraints || []).map(d => deserializeConstraint(d)).filter(Boolean);
      paramsData = JSON.parse(JSON.stringify(page.paramsData || {}));
      viewport = JSON.parse(JSON.stringify(page.viewport || { x: 0, y: 0, scale: 1 }));

      try {
        animationController.deserialize(page.animationData || {});
      } catch (e) {
        console.warn('Failed to deserialize animationData:', e);
      }

      try {
        motionPathManager.deserialize(page.motionPathData || {});
      } catch (e) {
        console.warn('Failed to deserialize motionPathData:', e);
      }

      try {
        dimensionSystem.deserialize(page.dimensionData || {});
      } catch (e) {
        console.warn('Failed to deserialize dimensionData:', e);
      }

      try {
        if (guideSystem) {
          guideSystem.deserialize(page.guideData || {});
        }
      } catch (e) {
        console.warn('Failed to deserialize guideData:', e);
      }

      for (const s of shapes) {
        if (s.opacity === undefined) s.opacity = 1;
        if (s.type === 'motion-path') {
          try {
            motionPathManager.invalidatePathCache(s.id);
          } catch (e) {
            // ignore
          }
        }
      }

      selectedIds.clear();
      selectedVertex = null;
      selectedConstraintIdx = -1;
      constraintSelection = [];
      constraintMode = null;
      selectedDimensionId = null;
      dimToolSelection = [];
      dimToolType = null;
      isNodeEditMode = false;

      undoStack = [];
      redoStack = [];

      try {
        rebuildSolverAndParams();
        initialSolve();
      } catch (e) {
        console.warn('Failed to rebuild solver:', e);
      }

      try {
        dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
      } catch (e) {
        console.warn('Failed to update dimension system:', e);
      }

      updateToolbar();
      updateTextPanel();
      updateDimensionPanel();
      updateFillPanel();
      updateMotionPathPanel();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      renderParams();
      renderComponentsList();
      renderTimelineTracks();
      render();
      scheduleSave();

      return true;
    } catch (e) {
      console.warn('Failed to load page state, rolling back:', e);
      currentPageId = oldPageId;
      shapes = oldShapes;
      constraints = oldConstraints;
      paramsData = oldParamsData;
      viewport = oldViewport;
      showToast('Failed to load page', 'error');
      renderPageTabs();
      render();
      return false;
    }
  }

  function addNewPage(switchTo) {
    const newPage = createPageData();
    pages.push(newPage);
    if (switchTo !== false) {
      loadPageState(newPage.id);
    }
    renderPageTabs();
    scheduleSave();
    return newPage;
  }

  function deletePage(pageId) {
    if (pages.length <= 1) {
      showToast('Cannot delete the last page', 'error');
      return false;
    }

    const pageIndex = pages.findIndex(p => p.id === pageId);
    if (pageIndex === -1) return false;

    pages.splice(pageIndex, 1);

    if (currentPageId === pageId) {
      const newIndex = Math.min(pageIndex, pages.length - 1);
      loadPageState(pages[newIndex].id);
    }

    renderPageTabs();
    scheduleSave();
    return true;
  }

  function renamePage(pageId, newName) {
    const page = getPageById(pageId);
    if (!page) return false;
    page.name = newName || ('Page ' + pageId);
    renderPageTabs();
    scheduleSave();
    return true;
  }

  function reorderPages(draggedId, targetId, insertAfter) {
    const draggedIdx = pages.findIndex(p => p.id === draggedId);
    const targetIdx = pages.findIndex(p => p.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1 || draggedIdx === targetIdx) return false;

    const [draggedPage] = pages.splice(draggedIdx, 1);
    let newTargetIdx = pages.findIndex(p => p.id === targetId);
    if (insertAfter) newTargetIdx++;
    pages.splice(newTargetIdx, 0, draggedPage);

    renderPageTabs();
    scheduleSave();
    return true;
  }

  function renderPageTabs() {
    const container = document.getElementById('pages-tabs-container');
    if (!container) return;

    container.innerHTML = '';

    for (const page of pages) {
      const tab = document.createElement('div');
      tab.className = 'page-tab';
      tab.dataset.pageId = page.id;
      if (page.id === currentPageId) {
        tab.classList.add('active');
      }

      const nameEl = document.createElement('span');
      nameEl.className = 'page-tab-name';
      nameEl.textContent = page.name;
      nameEl.title = 'Double-click to rename';

      const closeBtn = document.createElement('button');
      closeBtn.className = 'page-tab-close';
      closeBtn.innerHTML = '×';
      closeBtn.title = 'Delete page';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Delete page "' + page.name + '"?')) {
          deletePage(page.id);
        }
      });

      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'page-tab-name-input';
        input.value = page.name;
        input.addEventListener('blur', () => {
          renamePage(page.id, input.value.trim());
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            renamePage(page.id, input.value.trim());
          } else if (e.key === 'Escape') {
            renderPageTabs();
          }
        });
        nameEl.replaceWith(input);
        input.focus();
        input.select();
      });

      tab.addEventListener('click', () => {
        if (page.id !== currentPageId) {
          loadPageState(page.id);
          renderPageTabs();
        }
      });

      tab.draggable = true;
      tab.addEventListener('dragstart', (e) => {
        isDraggingPageTab = true;
        draggedPageId = page.id;
        tab.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', page.id.toString());
      });
      tab.addEventListener('dragend', () => {
        isDraggingPageTab = false;
        draggedPageId = null;
        tab.classList.remove('dragging');
        document.querySelectorAll('.page-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
      tab.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedPageId === page.id) return;
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.page-tab.drag-over').forEach(el => el.classList.remove('drag-over'));
        tab.classList.add('drag-over');
      });
      tab.addEventListener('dragleave', () => {
        tab.classList.remove('drag-over');
      });
      tab.addEventListener('drop', (e) => {
        e.preventDefault();
        tab.classList.remove('drag-over');
        const rect = tab.getBoundingClientRect();
        const insertAfter = (e.clientX - rect.left) > rect.width / 2;
        reorderPages(draggedPageId, page.id, insertAfter);
      });

      tab.appendChild(nameEl);
      tab.appendChild(closeBtn);
      container.appendChild(tab);
    }
  }

  function copySelectedShapes() {
    const selected = getSelectedShapes();
    if (selected.length === 0) {
      showToast('Nothing selected to copy', 'warning');
      return false;
    }

    const idsToCopy = collectAllMaskedIds(selected.map(s => s.id));
    const idsSet = new Set(idsToCopy);
    const shapesToCopy = shapes.filter(s => idsSet.has(s.id));

    const newIdMap = {};
    clipboardShapes = shapesToCopy.map(s => {
      const clone = JSON.parse(JSON.stringify(s));
      newIdMap[s.id] = clone.id;
      return clone;
    });

    for (const s of clipboardShapes) {
      const oldId = s.id;
      s.id = nextId++;
      newIdMap[oldId] = s.id;
      s.transform = { ...s.transform };
      s.transform.tx += 20;
      s.transform.ty += 20;
    }

    for (const s of clipboardShapes) {
      if (s.maskOf !== undefined && newIdMap[s.maskOf] !== undefined) {
        s.maskOf = newIdMap[s.maskOf];
      }
    }

    showToast('Copied ' + selected.length + ' shape(s)', 'success');
    return true;
  }

  function pasteShapes() {
    if (!clipboardShapes || clipboardShapes.length === 0) {
      showToast('Nothing to paste', 'warning');
      return false;
    }

    pushHistory();

    const idMap = {};
    const pastedShapes = clipboardShapes.map(s => {
      const clone = JSON.parse(JSON.stringify(s));
      clone.id = nextId++;
      idMap[s.id] = clone.id;
      if (clone.type === 'component-instance') {
        clone.localShapeId = clone.id;
      }
      return clone;
    });

    for (const s of pastedShapes) {
      if (s.maskOf !== undefined && idMap[s.maskOf] !== undefined) {
        s.maskOf = idMap[s.maskOf];
      }
      shapes.push(s);
    }

    selectedIds.clear();
    for (const s of pastedShapes) {
      if (!isMaskShape(s)) {
        selectedIds.add(s.id);
      }
    }

    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    renderLayers();
    renderConstraintList();
    render();
    scheduleSave();

    showToast('Pasted ' + pastedShapes.length + ' shape(s)', 'success');
    return true;
  }

  function generateSVGForPage(pageData) {
    const pageShapes = pageData.shapes;
    const allX = [];
    const allY = [];
    const exportShapes = [];
    const defsMap = {};
    const clipPathDefs = [];
    const maskDefs = [];

    function pointsToPathD(pts, holes) {
      let d = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ') + 'Z';
      for (const hole of holes) {
        d += ' ' + hole.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ') + 'Z';
      }
      return d;
    }

    function localWorldPointsOf(s) {
      const pts = s.points.map(p => ({ x: p.x, y: p.y }));
      const t = s.transform;
      if (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1) {
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const rad = t.rotation * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        for (const p of pts) {
          const dx = p.x - cx, dy = p.y - cy;
          p.x = cx + (dx * cos - dy * sin) * t.scaleX;
          p.y = cy + (dx * sin + dy * cos) * t.scaleY;
        }
      }
      for (const p of pts) {
        p.x += t.tx;
        p.y += t.ty;
      }
      return pts;
    }

    function localWorldHolesOf(s) {
      if (!s.holes || s.holes.length === 0) return [];
      const worldHoles = [];
      for (const hole of s.holes) {
        const pts = hole.map(p => ({ x: p.x, y: p.y }));
        const t = s.transform;
        if (t.rotation !== 0 || t.scaleX !== 1 || t.scaleY !== 1) {
          const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          const rad = t.rotation * Math.PI / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          for (const p of pts) {
            const dx = p.x - cx, dy = p.y - cy;
            p.x = cx + (dx * cos - dy * sin) * t.scaleX;
            p.y = cy + (dx * sin + dy * cos) * t.scaleY;
          }
        }
        for (const p of pts) {
          p.x += t.tx;
          p.y += t.ty;
        }
        worldHoles.push(pts);
      }
      return worldHoles;
    }

    function localGetMasksOfShape(shapeId) {
      return pageShapes.filter(s => s.maskOf === shapeId);
    }

    function localGetMaskType(maskShape) {
      return maskShape.maskType || 'clip';
    }

    for (const s of pageShapes) {
      if (!s.visible) continue;
      if (s.maskOf !== undefined) continue;
      if (s.type === 'component-instance') {
        const expanded = getInstanceExpandedShapes(s);
        for (const es of expanded) {
          exportShapes.push(es);
          const pts = es.points;
          for (const p of pts) { allX.push(p.x); allY.push(p.y); }
          const holes = es.holes || [];
          for (const hole of holes) {
            for (const p of hole) { allX.push(p.x); allY.push(p.y); }
          }
        }
      } else {
        exportShapes.push(s);
        const pts = localWorldPointsOf(s);
        for (const p of pts) { allX.push(p.x); allY.push(p.y); }
        const holes = localWorldHolesOf(s);
        for (const hole of holes) {
          for (const p of hole) { allX.push(p.x); allY.push(p.y); }
        }
      }
    }

    if (allX.length === 0) {
      return null;
    }

    const minX = Math.min(...allX);
    const minY = Math.min(...allY);
    const maxX = Math.max(...allX);
    const maxY = Math.max(...allY);
    const pad = 20;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}">`;

    let defsContent = '';

    for (let i = 0; i < exportShapes.length; i++) {
      const s = exportShapes[i];
      const fill = ensureFillStructure(s.fill);
      const transform = s._isExpandedInstance
        ? { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 }
        : s.transform;
      const fillRef = exportFillToSVGDefs(fill, defsMap, `shape${i}`, transform);
      const exportFill = fillRef || getFillDisplayColor(fill);

      const pts = s._isExpandedInstance ? s.points : localWorldPointsOf(s);
      const holes = s._isExpandedInstance ? (s.holes || []) : localWorldHolesOf(s);
      const d = pointsToPathD(pts, holes);

      let extraAttrs = '';

      if (!s._isExpandedInstance && s.id !== undefined) {
        const masks = localGetMasksOfShape(s.id);
        if (masks.length > 0) {
          const clipMasks = masks.filter(m => localGetMaskType(m) === 'clip');
          const alphaMasks = masks.filter(m => localGetMaskType(m) === 'alpha');

          if (clipMasks.length > 0) {
            const clipPathId = `clipPath-${s.id}`;
            let clipPathContent = '';
            for (let j = 0; j < clipMasks.length; j++) {
              const mask = clipMasks[j];
              const maskPts = localWorldPointsOf(mask);
              const maskHoles = localWorldHolesOf(mask);
              const maskD = pointsToPathD(maskPts, maskHoles);
              clipPathContent += `<path d="${maskD}" fill-rule="evenodd"/>`;
            }
            clipPathDefs.push(`<clipPath id="${clipPathId}">${clipPathContent}</clipPath>`);
            extraAttrs += ` clip-path="url(#${clipPathId})"`;
          }

          if (alphaMasks.length > 0) {
            const maskId = `mask-${s.id}`;
            let maskContent = '';
            
            const filterId = `luminance-filter-${s.id}`;
            maskDefs.push(`<filter id="${filterId}" x="0" y="0" width="100%" height="100%"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.2126 0.7152 0.0722 0 0"/></filter>`);
            
            for (let j = 0; j < alphaMasks.length; j++) {
              const mask = alphaMasks[j];
              const maskPts = localWorldPointsOf(mask);
              const maskHoles = localWorldHolesOf(mask);
              const maskD = pointsToPathD(maskPts, maskHoles);
              
              const maskFill = ensureFillStructure(mask.fill);
              const maskFillColor = getFillDisplayColor(maskFill);
              
              if (j === 0) {
                maskContent += `<path d="${maskD}" fill="${maskFillColor}" fill-rule="evenodd" filter="url(#${filterId})"/>`;
              } else {
                maskContent += `<path d="${maskD}" fill="${maskFillColor}" fill-rule="evenodd" filter="url(#${filterId})" style="mix-blend-mode: multiply"/>`;
              }
            }
            maskDefs.push(`<mask id="${maskId}" maskUnits="userSpaceOnUse">${maskContent}</mask>`);
            extraAttrs += ` mask="url(#${maskId})"`;
          }
        }
      }

      svg += `<path d="${d}" fill="${exportFill}" stroke="${s.stroke || '#000'}" stroke-width="${s.strokeWidth || 2}" fill-rule="evenodd"${extraAttrs}/>`;
    }

    if (Object.keys(defsMap).length > 0 || clipPathDefs.length > 0 || maskDefs.length > 0) {
      defsContent = '<defs>';
      if (Object.keys(defsMap).length > 0) {
        defsContent += generateSVGDefs(defsMap);
      }
      for (const cp of clipPathDefs) {
        defsContent += cp;
      }
      for (const m of maskDefs) {
        defsContent += m;
      }
      defsContent += '</defs>';
      svg = svg.replace('>', '>' + defsContent);
    }

    svg += '</svg>';
    return svg;
  }

  function exportCurrentPageSVG() {
    saveCurrentPageState();
    const currentPage = pages.find(p => p.id === currentPageId);
    if (!currentPage) {
      showToast('No page selected', 'error');
      return;
    }

    const svg = generateSVGForPage(currentPage);
    if (!svg) {
      showToast('No shapes to export', 'warning');
      return;
    }

    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentPage.name + '.svg';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported: ' + currentPage.name + '.svg', 'success');
  }

  function exportAllPagesSVG() {
    saveCurrentPageState();

    const validPages = [];
    for (const page of pages) {
      const svg = generateSVGForPage(page);
      if (svg) {
        validPages.push({ name: page.name, svg: svg });
      }
    }

    if (validPages.length === 0) {
      showToast('No shapes to export in any page', 'warning');
      return;
    }

    if (validPages.length === 1) {
      const blob = new Blob([validPages[0].svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = validPages[0].name + '.svg';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported: ' + validPages[0].name + '.svg', 'success');
      return;
    }

    const zipContent = [];
    zipContent.push('PK\x03\x04\x14\x00\x00\x00\x00\x00');
    
    let centralDir = [];
    let offset = 0;

    const usedNames = {};

    for (const page of validPages) {
      let fileName = page.name.replace(/[<>:"/\\|?*]/g, '_') + '.svg';
      if (usedNames[fileName]) {
        usedNames[fileName]++;
        const ext = '.svg';
        const baseName = fileName.slice(0, -4);
        fileName = baseName + ' (' + usedNames[fileName] + ')' + ext;
      } else {
        usedNames[fileName] = 1;
      }

      const fileData = new TextEncoder().encode(page.svg);
      const fileNameBytes = new TextEncoder().encode(fileName);
      
      const crc32 = crc32Buffer(fileData);
      const compressedSize = fileData.length;
      const uncompressedSize = fileData.length;
      
      const localHeader = new ArrayBuffer(30 + fileNameBytes.length);
      const view = new DataView(localHeader);
      
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true);
      view.setUint16(10, 0, true);
      view.setUint32(12, crc32, true);
      view.setUint32(16, compressedSize, true);
      view.setUint32(20, uncompressedSize, true);
      view.setUint16(24, fileNameBytes.length, true);
      view.setUint16(26, 0, true);
      
      for (let i = 0; i < fileNameBytes.length; i++) {
        view.setUint8(28 + i, fileNameBytes[i]);
      }
      
      const headerBytes = new Uint8Array(localHeader);
      const fullEntry = new Uint8Array(headerBytes.length + fileData.length);
      fullEntry.set(headerBytes, 0);
      fullEntry.set(fileData, headerBytes.length);
      
      const cdEntry = new ArrayBuffer(46 + fileNameBytes.length);
      const cdView = new DataView(cdEntry);
      
      cdView.setUint32(0, 0x02014b50, true);
      cdView.setUint16(4, 20, true);
      cdView.setUint16(6, 20, true);
      cdView.setUint16(8, 0, true);
      cdView.setUint16(10, 0, true);
      cdView.setUint16(12, 0, true);
      cdView.setUint32(14, crc32, true);
      cdView.setUint32(18, compressedSize, true);
      cdView.setUint32(22, uncompressedSize, true);
      cdView.setUint16(26, fileNameBytes.length, true);
      cdView.setUint16(28, 0, true);
      cdView.setUint16(30, 0, true);
      cdView.setUint16(32, 0, true);
      cdView.setUint16(34, 0, true);
      cdView.setUint32(36, 0, true);
      cdView.setUint32(40, offset, true);
      
      for (let i = 0; i < fileNameBytes.length; i++) {
        cdView.setUint8(44 + i, fileNameBytes[i]);
      }
      
      centralDir.push(new Uint8Array(cdEntry));
      offset += fullEntry.length;
      
      zipContent.push(fullEntry);
    }

    const cdLength = centralDir.reduce((sum, entry) => sum + entry.length, 0);
    const eocd = new ArrayBuffer(22);
    const eocdView = new DataView(eocd);
    
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(4, 0, true);
    eocdView.setUint16(6, 0, true);
    eocdView.setUint16(8, validPages.length, true);
    eocdView.setUint16(10, validPages.length, true);
    eocdView.setUint32(12, cdLength, true);
    eocdView.setUint32(16, offset, true);
    eocdView.setUint16(20, 0, true);
    
    const totalLength = zipContent.slice(1).reduce((sum, arr) => sum + arr.length, 0) + cdLength + eocd.byteLength;
    const result = new Uint8Array(totalLength);
    
    let pos = 0;
    for (let i = 1; i < zipContent.length; i++) {
      result.set(zipContent[i], pos);
      pos += zipContent[i].length;
    }
    
    for (const entry of centralDir) {
      result.set(entry, pos);
      pos += entry.length;
    }
    
    result.set(new Uint8Array(eocd), pos);
    
    const blob = new Blob([result], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pages_export.zip';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported ' + validPages.length + ' pages as ZIP', 'success');
  }

  function crc32Buffer(buffer) {
    const crcTable = (function() {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        table[n] = c;
      }
      return table;
    })();

    let crc = 0 ^ (-1);
    for (let i = 0; i < buffer.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  function showExportDialog() {
    const dialog = document.getElementById('export-dialog');
    if (!dialog) return;
    dialog.style.display = 'flex';

    const confirmBtn = document.getElementById('export-confirm-btn');
    const cancelBtn = document.getElementById('export-cancel-btn');
    const currentPageRadio = document.getElementById('export-current-page');
    const allPagesRadio = document.getElementById('export-all-pages');
    const pageCountSpan = document.getElementById('export-page-count');

    if (pageCountSpan) {
      pageCountSpan.textContent = '(' + pages.length + ' pages)';
    }

    const handleConfirm = () => {
      if (currentPageRadio && currentPageRadio.checked) {
        exportCurrentPageSVG();
      } else if (allPagesRadio && allPagesRadio.checked) {
        exportAllPagesSVG();
      }
      handleCancel();
    };

    const handleCancel = () => {
      dialog.style.display = 'none';
      confirmBtn.removeEventListener('click', handleConfirm);
      cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
  }

  function getShapePointsForDim(shapeId) {
    const shape = shapes.find(s => s.id === shapeId);
    if (!shape) return [];
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      if (expanded.length > 0) return expanded[0].points;
    }
    return worldPointsOf(shape);
  }

  function getShapeHolesForDim(shapeId) {
    const shape = shapes.find(s => s.id === shapeId);
    if (!shape) return [];
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      if (expanded.length > 0) return expanded[0].holes || [];
    }
    return worldHolesOf(shape);
  }

  function isSameVertex(a, b) {
    if (!a || !b) return false;
    return a.isHole === b.isHole && a.holeIndex === b.holeIndex && a.pointIndex === b.pointIndex;
  }

  function showToast(msg, type) {
    toastEl.textContent = msg;
    toastEl.className = 'toast ' + (type || '');
    setTimeout(() => toastEl.classList.add('hidden'), 0);
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  }

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

  function getMotionPathState(shape, frame) {
    if (isComponentInstance(shape)) return null;
    if (shape.type === 'motion-path') return null;
    const binding = motionPathManager.getBinding(shape.id);
    if (!binding) return null;
    const pathShape = getShapeById(binding.pathShapeId);
    if (!pathShape || !pathShape.visible || pathShape.type !== 'motion-path') return null;
    const pathPoints = worldPointsOf(pathShape);
    if (pathPoints.length < 2) return null;
    const useFrame = (frame !== undefined) ? frame : animationController.currentFrame;
    const total = Math.max(1, animationController.getTotalFrames());
    const animProps = animationController.getShapePropertiesAtFrame(shape.id, useFrame, {
      tx: shape.transform.tx,
      ty: shape.transform.ty,
      rotation: shape.transform.rotation
    });
    const pathKfs = pathShape.motionPathData ? pathShape.motionPathData.speedKeyframes : null;
    const bindingWithKfs = { ...binding, speedKeyframes: pathKfs || binding.speedKeyframes };
    const state = motionPathManager.computeBindingState(
      bindingWithKfs, pathPoints, useFrame, total,
      animProps.tx, animProps.ty, animProps.rotation
    );
    state.binding = binding;
    return state;
  }

  function worldPointsOf(shape) {
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      if (expanded.length === 0) return [];
      let allPts = [];
      for (const es of expanded) allPts = allPts.concat(es.points);
      return allPts;
    }
    const t = shape.transform;
    let tx = t.tx, ty = t.ty, rot = t.rotation, sx = t.scaleX, sy = t.scaleY;

    const mpState = getMotionPathState(shape);
    if (mpState && (animationController.isPlaying || animationController.currentFrame > 0)) {
      tx = mpState.tx;
      ty = mpState.ty;
      rot = mpState.rotation;
    }
    return applyTransform(shape.points, tx, ty, rot, sx, sy);
  }

  function worldHolesOf(shape) {
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      let allHoles = [];
      for (const es of expanded) {
        if (es.holes) allHoles = allHoles.concat(es.holes);
      }
      return allHoles;
    }
    if (!shape.holes) return [];
    const t = shape.transform;
    let tx = t.tx, ty = t.ty, rot = t.rotation, sx = t.scaleX, sy = t.scaleY;

    const mpState = getMotionPathState(shape);
    if (mpState && (animationController.isPlaying || animationController.currentFrame > 0)) {
      tx = mpState.tx;
      ty = mpState.ty;
      rot = mpState.rotation;
    }
    return shape.holes.map(h => applyTransform(h, tx, ty, rot, sx, sy));
  }

  function getInstanceExpandedSingleShapes(instance) {
    const expanded = getInstanceExpandedShapes(instance);
    return expanded;
  }

  function hitTestInstance(wx, wy, instance) {
    if (!instance.visible || instance.locked) return null;
    const pt = { x: wx, y: wy };
    const expanded = getInstanceExpandedShapes(instance);
    for (let i = expanded.length - 1; i >= 0; i--) {
      const s = expanded[i];
      if (!s.visible) continue;
      if (!pointInPolygonOrOnEdge(pt, s.points)) continue;
      let inHole = false;
      const holes = s.holes || [];
      for (const hole of holes) {
        if (pointInPolygonOrOnEdge(pt, hole)) { inHole = true; break; }
      }
      if (!inHole) return instance;
    }
    return null;
  }

  function getShapeById(id) {
    return shapes.find(s => s.id === id);
  }

  function isMaskShape(shape) {
    return shape && shape.maskOf !== undefined && shape.maskOf !== null;
  }

  function getMasksOfShape(shapeId) {
    return shapes.filter(s => s.maskOf === shapeId);
  }

  function getMaskedShape(maskShapeId) {
    const maskShape = getShapeById(maskShapeId);
    if (!maskShape || !isMaskShape(maskShape)) return null;
    return getShapeById(maskShape.maskOf);
  }

  function getMaskType(maskShape) {
    return maskShape.maskType || 'clip';
  }

  function isAlphaMask(maskShape) {
    return getMaskType(maskShape) === 'alpha';
  }

  function collectAllMaskedIds(shapeIds) {
    const result = new Set(shapeIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of shapes) {
        if (isMaskShape(s) && result.has(s.maskOf) && !result.has(s.id)) {
          result.add(s.id);
          changed = true;
        }
      }
    }
    return [...result];
  }

  function createClipMask(maskedShapeId, maskShapeId) {
    const maskedShape = getShapeById(maskedShapeId);
    const maskShape = getShapeById(maskShapeId);
    if (!maskedShape || !maskShape) return false;
    if (isMaskShape(maskedShape)) return false;
    if (isMaskShape(maskShape)) return false;

    maskShape.maskOf = maskedShapeId;
    maskShape.maskType = 'clip';
    maskShape._originalVisible = maskShape.visible !== false;
    maskShape.visible = false;

    const maskIdx = shapes.findIndex(s => s.id === maskShapeId);
    const maskedIdx = shapes.findIndex(s => s.id === maskedShapeId);
    if (maskIdx > maskedIdx) {
      shapes.splice(maskIdx, 1);
      shapes.splice(maskedIdx, 0, maskShape);
    }

    return true;
  }

  function createAlphaMask(maskedShapeId, maskShapeId) {
    const maskedShape = getShapeById(maskedShapeId);
    const maskShape = getShapeById(maskShapeId);
    if (!maskedShape || !maskShape) return false;
    if (isMaskShape(maskedShape)) return false;
    if (isMaskShape(maskShape)) return false;

    maskShape.maskOf = maskedShapeId;
    maskShape.maskType = 'alpha';
    maskShape._originalVisible = maskShape.visible !== false;
    maskShape.visible = false;

    const maskIdx = shapes.findIndex(s => s.id === maskShapeId);
    const maskedIdx = shapes.findIndex(s => s.id === maskedShapeId);
    if (maskIdx > maskedIdx) {
      shapes.splice(maskIdx, 1);
      shapes.splice(maskedIdx, 0, maskShape);
    }

    return true;
  }

  function releaseMask(maskShapeId) {
    const maskShape = getShapeById(maskShapeId);
    if (!maskShape || !isMaskShape(maskShape)) return false;

    delete maskShape.maskOf;
    delete maskShape.maskType;
    if (maskShape._originalVisible !== undefined) {
      maskShape.visible = maskShape._originalVisible;
      delete maskShape._originalVisible;
    }

    return true;
  }

  function deepCloneState() {
    return {
      shapes: JSON.parse(JSON.stringify(shapes)),
      constraints: JSON.parse(JSON.stringify(constraints.map(c => serializeConstraint(c)))),
      paramsData: JSON.parse(JSON.stringify(paramsData)),
      components: JSON.parse(JSON.stringify(components)),
      nextComponentId: nextComponentId,
      motionPathData: JSON.parse(JSON.stringify(motionPathManager.serialize())),
      dimensionData: JSON.parse(JSON.stringify(dimensionSystem.serialize()))
    };
  }

  function restoreState(state) {
    shapes = JSON.parse(JSON.stringify(state.shapes));
    constraints = state.constraints.map(d => deserializeConstraint(d));
    paramsData = JSON.parse(JSON.stringify(state.paramsData));
    components = state.components ? JSON.parse(JSON.stringify(state.components)) : {};
    nextComponentId = state.nextComponentId || 1;
    if (state.motionPathData) {
      motionPathManager.deserialize(JSON.parse(JSON.stringify(state.motionPathData)));
    } else {
      motionPathManager = new PM.MotionPathManager();
    }
    if (state.dimensionData) {
      dimensionSystem.deserialize(JSON.parse(JSON.stringify(state.dimensionData)));
    } else {
      dimensionSystem = new DS();
    }
    for (const s of shapes) {
      if (s.type === 'motion-path') {
        motionPathManager.invalidatePathCache(s.id);
      }
    }
    rebuildSolverAndParams();
  }

  function pushHistory() {
    undoStack.push(deepCloneState());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
  }

  function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(deepCloneState());
    restoreState(undoStack.pop());
    selectedIds.clear();
    selectedVertex = null;
    selectedConstraintIdx = -1;
    constraintSelection = [];
    constraintMode = null;
    selectedDimensionId = null;
    dimToolSelection = [];
    dimToolType = null;
    updateToolbar();
    updateTextPanel();
    updateDimensionPanel();
    renderLayers();
    renderConstraintList();
    renderParams();
    updateDOFDisplay();
    render();
  }

  function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(deepCloneState());
    restoreState(redoStack.pop());
    selectedIds.clear();
    selectedVertex = null;
    selectedConstraintIdx = -1;
    constraintSelection = [];
    constraintMode = null;
    selectedDimensionId = null;
    dimToolSelection = [];
    dimToolType = null;
    updateToolbar();
    updateTextPanel();
    updateDimensionPanel();
    renderLayers();
    renderConstraintList();
    renderParams();
    updateDOFDisplay();
    render();
  }

  function createDefaultFill(baseColor) {
    return {
      type: 'solid',
      color: baseColor || randomFillColor()
    };
  }

  function createDefaultLinearGradient(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const w = bounds.maxX - bounds.minX;
    return {
      type: 'linear',
      x1: cx - w / 2,
      y1: cy,
      x2: cx + w / 2,
      y2: cy,
      stops: [
        { offset: 0, color: '#4d9fff' },
        { offset: 1, color: '#e53935' }
      ]
    };
  }

  function createDefaultRadialGradient(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const r = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    return {
      type: 'radial',
      cx: cx,
      cy: cy,
      r: r,
      stops: [
        { offset: 0, color: '#4d9fff' },
        { offset: 1, color: '#e53935' }
      ]
    };
  }

  function createDefaultPattern() {
    return {
      type: 'pattern',
      pattern: 'diagonal',
      scale: 1,
      rotation: 0,
      fgColor: '#000000',
      bgColor: '#ffffff'
    };
  }

  function ensureFillStructure(fill) {
    if (!fill) return createDefaultFill();
    if (typeof fill === 'string') {
      return { type: 'solid', color: fill };
    }
    if (fill && fill.type) return fill;
    return createDefaultFill();
  }

  function getFillDisplayColor(fill) {
    if (!fill) return '#ccc';
    if (typeof fill === 'string') return fill;
    if (fill.type === 'solid') return fill.color;
    if (fill.type === 'linear' && fill.stops && fill.stops.length > 0) return fill.stops[0].color;
    if (fill.type === 'radial' && fill.stops && fill.stops.length > 0) return fill.stops[0].color;
    if (fill.type === 'pattern') return fill.bgColor || '#fff';
    return '#ccc';
  }

  let isDraggingGradientHandle = false;
  let gradientDragType = null;
  let gradientDragShapeId = null;
  let selectedGradientStopIdx = -1;
  let currentGradientType = null;

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
      fill: ensureFillStructure(fill),
      stroke: '#000',
      strokeWidth: 2,
      opacity: 1,
      transform: { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 }
    };
  }

  function createMotionPathShape(points) {
    shapeCounter++;
    return {
      id: nextId++,
      name: 'Path ' + shapeCounter,
      type: 'motion-path',
      visible: true,
      locked: false,
      points: points,
      holes: [],
      fill: 'rgba(142, 36, 170, 0.05)',
      stroke: '#8e24aa',
      strokeWidth: 2,
      opacity: 1,
      transform: { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      motionPathData: {
        speedKeyframes: [
          { pathT: 0, speedFactor: 1 },
          { pathT: 1, speedFactor: 1 }
        ],
        closed: false
      }
    };
  }

  function createTextShape(text, x, y, fontSize, fontWeight, letterSpacing, fill) {
    const gs = window.GlyphSystem;
    if (!gs) {
      console.warn('GlyphSystem not available');
      return null;
    }

    const charPaths = gs.textToPaths(text.toUpperCase(), fontSize, letterSpacing, fontWeight);

    if (charPaths.length === 0) return null;

    let allOuter = [];
    let allHoles = [];

    for (const cp of charPaths) {
      allOuter = allOuter.concat(cp.outer);
      if (cp.holes && cp.holes.length > 0) {
        allHoles = allHoles.concat(cp.holes);
      }
    }

    const shape = createShape(allOuter, fill, allHoles);
    shape.name = 'Text: ' + text;
    shape.type = 'text';
    shape.textData = {
      text: text.toUpperCase(),
      fontSize: fontSize,
      fontWeight: fontWeight,
      letterSpacing: letterSpacing
    };

    const bounds = getBounds(shape.points);
    const offsetX = x - bounds.minX;
    const offsetY = y - bounds.maxY;

    shape.points = shape.points.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
    shape.holes = shape.holes.map(h => h.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })));

    return shape;
  }

  function isTextShape(shape) {
    return shape && shape.type === 'text' && shape.textData;
  }

  function updateTextShape(shape, newText, newFontSize, newWeight, newSpacing) {
    if (!isTextShape(shape)) return false;

    const gs = window.GlyphSystem;
    if (!gs) return false;

    const text = newText !== undefined ? newText.toUpperCase() : shape.textData.text;
    const fontSize = newFontSize !== undefined ? newFontSize : shape.textData.fontSize;
    const fontWeight = newWeight !== undefined ? newWeight : shape.textData.fontWeight;
    const letterSpacing = newSpacing !== undefined ? newSpacing : shape.textData.letterSpacing;

    const oldBounds = getBounds(shape.points);
    const oldLeft = oldBounds.minX;
    const oldBottom = oldBounds.maxY;

    const charPaths = gs.textToPaths(text, fontSize, letterSpacing, fontWeight);

    let allOuter = [];
    let allHoles = [];

    for (const cp of charPaths) {
      allOuter = allOuter.concat(cp.outer);
      if (cp.holes && cp.holes.length > 0) {
        allHoles = allHoles.concat(cp.holes);
      }
    }

    if (allOuter.length === 0) return false;

    const newBounds = getBounds(allOuter);
    const offsetX = oldLeft - newBounds.minX;
    const offsetY = oldBottom - newBounds.maxY;

    shape.points = allOuter.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }));
    shape.holes = allHoles.map(h => h.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })));
    shape.textData = { text, fontSize, fontWeight, letterSpacing };
    shape.name = 'Text: ' + text;

    return true;
  }

  function splitTextIntoCharacters(textShape) {
    if (!isTextShape(textShape)) return [];

    const gs = window.GlyphSystem;
    if (!gs) return [];

    const td = textShape.textData;
    const text = td.text;
    const fontSize = td.fontSize;
    const fontWeight = td.fontWeight;
    const letterSpacing = td.letterSpacing;

    const oldBounds = getBounds(textShape.points);
    const oldLeft = oldBounds.minX;
    const oldBottom = oldBounds.maxY;

    const charPaths = gs.textToPaths(text, fontSize, letterSpacing, fontWeight);

    const firstBounds = charPaths.length > 0 ? getBounds(charPaths[0].outer) : { minX: 0, maxY: 0 };
    const offsetX = oldLeft - firstBounds.minX;
    const offsetY = oldBottom - firstBounds.maxY;

    const result = [];
    let charIndex = 0;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const glyph = gs.getGlyph(ch);
      if (!glyph.paths || glyph.paths.length === 0) continue;

      const glyphCharPaths = charPaths.filter(cp => cp.charIndex === i);
      if (glyphCharPaths.length === 0) continue;

      let outerPts = [];
      let holePts = [];

      for (const gcp of glyphCharPaths) {
        outerPts = outerPts.concat(gcp.outer);
        if (gcp.holes) holePts = holePts.concat(gcp.holes);
      }

      const shape = createShape(
        outerPts.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })),
        textShape.fill,
        holePts.map(h => h.map(p => ({ x: p.x + offsetX, y: p.y + offsetY })))
      );
      shape.name = 'Char: ' + ch;
      shape.type = 'text';
      shape.textData = {
        text: ch,
        fontSize: fontSize,
        fontWeight: fontWeight,
        letterSpacing: 0
      };
      shape.stroke = textShape.stroke;
      shape.strokeWidth = textShape.strokeWidth;
      shape.opacity = textShape.opacity;

      result.push(shape);
      charIndex++;
    }

    return result;
  }

  function putTextOnPath(textShape, pathPoints) {
    if (!isTextShape(textShape)) return false;

    const gs = window.GlyphSystem;
    if (!gs) return false;

    const td = textShape.textData;
    const charPaths = gs.textToPaths(td.text, td.fontSize, td.letterSpacing, td.fontWeight);

    const transformed = gs.transformPointsAlongPath(charPaths, pathPoints, 0);

    let allOuter = [];
    let allHoles = [];

    for (const t of transformed) {
      allOuter = allOuter.concat(t.outer);
      if (t.holes) allHoles = allHoles.concat(t.holes);
    }

    if (allOuter.length === 0) return false;

    textShape.points = allOuter;
    textShape.holes = allHoles;
    textShape.textData.onPath = true;

    return true;
  }

  function isComponentInstance(shape) {
    return shape && shape.type === 'component-instance';
  }

  function getComponentById(id) {
    return components[id] || null;
  }

  function getInstancesOfComponent(componentId) {
    return shapes.filter(s => isComponentInstance(s) && s.componentId === componentId);
  }

  function getComponentsReferencing(componentId) {
    const result = [];
    for (const cid in components) {
      if (parseInt(cid, 10) === componentId) continue;
      const comp = components[cid];
      const hasRef = comp.shapes.some(s => isComponentInstance(s) && s.componentId === componentId);
      if (hasRef) result.push(parseInt(cid, 10));
    }
    return result;
  }

  function unlinkInstanceInComponent(hostComponentId, instanceShape) {
    const hostComp = getComponentById(hostComponentId);
    if (!hostComp) return;
    const comp = getComponentById(instanceShape.componentId);
    if (!comp) return;
    const expanded = expandComponentShapes(comp, instanceShape.transform, instanceShape.overrides || {});
    const insertIdx = hostComp.shapes.findIndex(s => s.id === instanceShape.id);
    if (insertIdx < 0) return;
    for (const s of expanded) {
      if (s.localShapeId === undefined) s.localShapeId = s.id;
      if (s.name === undefined) s.name = 'Shape ' + s.id;
      if (s.visible === undefined) s.visible = true;
      if (s.locked === undefined) s.locked = false;
      if (s.type === undefined) s.type = 'polygon';
    }
    hostComp.shapes.splice(insertIdx, 1, ...expanded);
    if (hostComp.constraints) {
      hostComp.constraints = hostComp.constraints.filter(c => {
        const refs = [c.pointA, c.pointB, c.point, c.lineStart, c.lineEnd, c.line1Start, c.line1End, c.line2Start, c.line2End].filter(Boolean);
        for (const pid of refs) {
          const { shapeId } = parsePointId(pid);
          if (shapeId === instanceShape.id) return false;
        }
        return true;
      });
    }
  }

  function remapShapeIds(clonedShapes, idMap) {
    for (const s of clonedShapes) {
      const oldId = s.id;
      s.id = nextId++;
      idMap[oldId] = s.id;
      if (s.type === 'component-instance') {
        s.localShapeId = s.id;
      }
    }
  }

  function expandComponentShapes(component, baseTransform, overrides, parentIdMap) {
    const result = [];
    const idMap = parentIdMap || {};
    const componentShapes = component.shapes.map(s => JSON.parse(JSON.stringify(s)));
    remapShapeIds(componentShapes, idMap);

    for (let i = 0; i < componentShapes.length; i++) {
      const s = componentShapes[i];
      const origShape = component.shapes[i];
      const localOverrides = overrides && overrides.children && overrides.children[origShape.localShapeId || origShape.id];

      if (localOverrides && localOverrides.hidden) continue;

      const t = s.transform;
      const combined = {
        tx: baseTransform.tx + t.tx,
        ty: baseTransform.ty + t.ty,
        rotation: baseTransform.rotation + t.rotation,
        scaleX: baseTransform.scaleX * t.scaleX,
        scaleY: baseTransform.scaleY * t.scaleY
      };

      if (isComponentInstance(s)) {
        const innerComp = getComponentById(s.componentId);
        if (innerComp) {
          const innerOverrides = localOverrides || {};
          const innerExpanded = expandComponentShapes(innerComp, combined, innerOverrides, idMap);
          result.push(...innerExpanded);
        }
      } else {
        const clone = JSON.parse(JSON.stringify(s));
        clone.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
        clone.points = applyTransform(s.points, combined.tx, combined.ty, combined.rotation, combined.scaleX, combined.scaleY);
        clone.holes = (s.holes || []).map(h => applyTransform(h, combined.tx, combined.ty, combined.rotation, combined.scaleX, combined.scaleY));
        clone._originalId = origShape.localShapeId || origShape.id;
        clone._isExpandedInstance = true;

        if (overrides) {
          if (overrides.fill) clone.fill = overrides.fill;
          if (overrides.stroke) clone.stroke = overrides.stroke;
          if (localOverrides) {
            if (localOverrides.fill) clone.fill = localOverrides.fill;
            if (localOverrides.stroke) clone.stroke = localOverrides.stroke;
          }
        }
        result.push(clone);
      }
    }
    return result;
  }

  function getInstanceExpandedShapes(instance) {
    const comp = getComponentById(instance.componentId);
    if (!comp) return [];
    return expandComponentShapes(comp, instance.transform, instance.overrides);
  }

  function checkCircularReference(componentId, targetComponentId, visited) {
    visited = visited || new Set();
    if (visited.has(componentId)) return false;
    visited.add(componentId);
    const comp = getComponentById(componentId);
    if (!comp) return false;
    for (const s of comp.shapes) {
      if (isComponentInstance(s)) {
        if (s.componentId === targetComponentId) return true;
        if (checkCircularReference(s.componentId, targetComponentId, visited)) return true;
      }
    }
    return false;
  }

  function computeComponentBounds(component) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expanded = expandComponentShapes(component, { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    for (const s of expanded) {
      const pts = s.points;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (minX === Infinity) return { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    return { minX, minY, maxX, maxY };
  }

  let saveStateTimer = null;
  function saveStateToStorage() {
    try {
      saveCurrentPageState();
      const state = {
        pages: JSON.parse(JSON.stringify(pages)),
        currentPageId,
        nextPageId,
        nextId,
        components,
        nextComponentId
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Failed to save state:', e);
    }
  }

  function scheduleSave() {
    if (saveStateTimer) clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(saveStateToStorage, 300);
  }

  function loadStateFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const state = JSON.parse(raw);

      if (state.pages && Array.isArray(state.pages) && state.pages.length > 0) {
        pages = JSON.parse(JSON.stringify(state.pages));
        currentPageId = state.currentPageId || (pages[0]?.id || null);
        nextPageId = state.nextPageId || (pages.length + 1);
        nextId = state.nextId || 1;
        if (state.components) components = state.components;
        if (state.nextComponentId) nextComponentId = state.nextComponentId;

        for (const page of pages) {
          if (page.nextId !== undefined) {
            delete page.nextId;
          }
        }

        const currentPage = getCurrentPage();
        if (currentPage) {
          shapes = JSON.parse(JSON.stringify(currentPage.shapes || []));
          constraints = (currentPage.constraints || []).map(d => deserializeConstraint(d));
          paramsData = JSON.parse(JSON.stringify(currentPage.paramsData || {}));
          viewport = JSON.parse(JSON.stringify(currentPage.viewport || { x: 0, y: 0, scale: 1 }));

          animationController.deserialize(currentPage.animationData || {});
          motionPathManager.deserialize(currentPage.motionPathData || {});
          dimensionSystem.deserialize(currentPage.dimensionData || {});
          if (guideSystem) {
            guideSystem.deserialize(currentPage.guideData || {});
          }

          for (const s of shapes) {
            if (s.opacity === undefined) s.opacity = 1;
            if (s.type === 'motion-path') {
              motionPathManager.invalidatePathCache(s.id);
            }
          }

          if (shapes.length > 0) {
            const maxShapeId = Math.max(...shapes.map(s => s.id));
            nextId = Math.max(nextId, maxShapeId + 1);
          }
        }
        return true;
      }

      if (state.shapes) {
        const page = createPageData('Page 1');
        page.shapes = JSON.parse(JSON.stringify(state.shapes));
        page.constraints = (state.constraints || []).map(d => serializeConstraint(deserializeConstraint(d)));
        page.paramsData = JSON.parse(JSON.stringify(state.paramsData || {}));
        page.viewport = JSON.parse(JSON.stringify(state.viewport || { x: 0, y: 0, scale: 1 }));
        page.animationData = state.animationData || null;
        page.motionPathData = state.motionPathData || null;
        page.dimensionData = state.dimensionData || null;
        page.guideData = state.guideData || null;

        pages = [page];
        currentPageId = page.id;
        nextPageId = 2;
        nextId = state.nextId || 1;
        if (state.components) components = state.components;
        if (state.nextComponentId) nextComponentId = state.nextComponentId;

        shapes = JSON.parse(JSON.stringify(page.shapes));
        constraints = page.constraints.map(d => deserializeConstraint(d));
        paramsData = JSON.parse(JSON.stringify(page.paramsData));
        viewport = JSON.parse(JSON.stringify(page.viewport));

        animationController.deserialize(page.animationData || {});
        motionPathManager.deserialize(page.motionPathData || {});
        dimensionSystem.deserialize(page.dimensionData || {});
        if (guideSystem) {
          guideSystem.deserialize(page.guideData || {});
        }

        for (const s of shapes) {
          if (s.opacity === undefined) s.opacity = 1;
          if (s.type === 'motion-path') {
            motionPathManager.invalidatePathCache(s.id);
          }
        }

        if (shapes.length > 0) {
          const maxShapeId = Math.max(...shapes.map(s => s.id));
          nextId = Math.max(nextId, maxShapeId + 1);
        }
        return true;
      }

      return false;
    } catch (e) {
      console.warn('Failed to load state:', e);
      return false;
    }
  }

  function hitTest(wx, wy) {
    const pt = { x: wx, y: wy };
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (!s.visible || s.locked) continue;
      if (isComponentInstance(s)) {
        const hit = hitTestInstance(wx, wy, s);
        if (hit) return hit;
      } else {
        const wp = worldPointsOf(s);
        if (!pointInPolygonOrOnEdge(pt, wp)) continue;
        const holes = worldHolesOf(s);
        let inHole = false;
        for (const hole of holes) {
          if (pointInPolygonOrOnEdge(pt, hole)) { inHole = true; break; }
        }
        if (!inHole) return s;
      }
    }
    
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (s.locked) continue;
      if (!isMaskShape(s)) continue;
      const wp = worldPointsOf(s);
      if (!pointInPolygonOrOnEdge(pt, wp)) continue;
      const holes = worldHolesOf(s);
      let inHole = false;
      for (const hole of holes) {
        if (pointInPolygonOrOnEdge(pt, hole)) { inHole = true; break; }
      }
      if (!inHole) return s;
    }
    
    return null;
  }

  function getBounds(points) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
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
    const hitRadius = 7 / viewport.scale;
    for (const s of shapes) {
      if (!s.visible) continue;
      const pts = worldPointsOf(s);
      for (let i = 0; i < pts.length; i++) {
        if (dist({x: wx, y: wy}, pts[i]) < hitRadius) {
          return { shape: s, isHole: false, holeIndex: -1, pointIndex: i };
        }
      }
      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        for (let i = 0; i < hole.length; i++) {
          if (dist({x: wx, y: wy}, hole[i]) < hitRadius) {
            return { shape: s, isHole: true, holeIndex: h, pointIndex: i };
          }
        }
      }
    }
    return null;
  }

  function hitTestEdge(wx, wy) {
    const hitRadius = 6 / viewport.scale;
    for (const s of shapes) {
      if (!s.visible) continue;
      const pts = worldPointsOf(s);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (pointToSegmentDist({x: wx, y: wy}, a, b) < hitRadius) {
          return { shape: s, isHole: false, holeIndex: -1, edgeIndex: i };
        }
      }
      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i], b = hole[(i + 1) % hole.length];
          if (pointToSegmentDist({x: wx, y: wy}, a, b) < hitRadius) {
            return { shape: s, isHole: true, holeIndex: h, edgeIndex: i };
          }
        }
      }
    }
    return null;
  }

  function hitTestConstraintIcon(wx, wy) {
    const pointMap = buildPointMap();
    const hitRadius = 16 / viewport.scale;
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      const pos = c.getIconPosition(pointMap);
      if (pos && dist({x: wx, y: wy}, pos) < hitRadius) return i;
    }
    return -1;
  }

  function getSelectedShapes() {
    return [...selectedIds].map(id => getShapeById(id)).filter(Boolean);
  }

  function getVertexPointId(v) {
    if (!v) return null;
    return makePointId(v.shape.id, v.isHole, v.holeIndex, v.pointIndex);
  }

  function getEdgePointIds(e) {
    if (!e) return null;
    const pts = e.isHole ? worldHolesOf(e.shape)[e.holeIndex] : worldPointsOf(e.shape);
    if (!pts) return null;
    const a = makePointId(e.shape.id, e.isHole, e.holeIndex, e.edgeIndex);
    const bIdx = (e.edgeIndex + 1) % pts.length;
    const b = makePointId(e.shape.id, e.isHole, e.holeIndex, bIdx);
    return { start: a, end: b };
  }

  function buildPointMap() {
    if (editingComponentId !== null) {
      return buildComponentEditPointMap();
    }
    const map = {};
    for (const s of shapes) {
      if (!s.visible) continue;
      if (isComponentInstance(s)) continue;
      const pts = worldPointsOf(s);
      for (let i = 0; i < pts.length; i++) {
        map[makePointId(s.id, false, -1, i)] = { ...pts[i] };
      }
      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        for (let i = 0; i < hole.length; i++) {
          map[makePointId(s.id, true, h, i)] = { ...hole[i] };
        }
      }
    }
    return map;
  }

  function applyPointMap(pointMap) {
    const targetShapes = editingComponentId !== null
      ? (getComponentById(editingComponentId)?.shapes || [])
      : shapes;
    for (const s of targetShapes) {
      if (!s.visible) continue;
      if (isComponentInstance(s)) continue;
      const newPts = [];
      for (let i = 0; i < s.points.length; i++) {
        const id = makePointId(s.id, false, -1, i);
        newPts.push(pointMap[id] ? { ...pointMap[id] } : { ...s.points[i] });
      }
      s.points = newPts;
      if (s.holes) {
        const newHoles = [];
        for (let h = 0; h < s.holes.length; h++) {
          const hole = s.holes[h];
          const newHole = [];
          for (let i = 0; i < hole.length; i++) {
            const id = makePointId(s.id, true, h, i);
            newHole.push(pointMap[id] ? { ...pointMap[id] } : { ...hole[i] });
          }
          newHoles.push(newHole);
        }
        s.holes = newHoles;
      }
      s.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
    }
  }

  function serializeConstraint(c) {
    return {
      type: c.type, pointA: c.pointA, pointB: c.pointB,
      point: c.point, lineStart: c.lineStart, lineEnd: c.lineEnd,
      line1Start: c.line1Start, line1End: c.line1End,
      line2Start: c.line2Start, line2End: c.line2End,
      angle: c.angle, paramRef: c.paramRef, distance: c.distance
    };
  }

  function deserializeConstraint(d) {
    switch (d.type) {
      case CONSTRAINT_TYPES.COINCIDENT: return new CoincidentConstraint(d.pointA, d.pointB);
      case CONSTRAINT_TYPES.POINT_ON_LINE: return new PointOnLineConstraint(d.point, d.lineStart, d.lineEnd);
      case CONSTRAINT_TYPES.PARALLEL: return new ParallelConstraint(d.line1Start, d.line1End, d.line2Start, d.line2End);
      case CONSTRAINT_TYPES.PERPENDICULAR: return new PerpendicularConstraint(d.line1Start, d.line1End, d.line2Start, d.line2End);
      case CONSTRAINT_TYPES.EQUAL_LENGTH: return new EqualLengthConstraint(d.line1Start, d.line1End, d.line2Start, d.line2End);
      case CONSTRAINT_TYPES.FIXED_ANGLE: return new FixedAngleConstraint(d.lineStart, d.lineEnd, d.angle || 0, d.paramRef);
      case CONSTRAINT_TYPES.DISTANCE: return new DistanceConstraint(d.pointA, d.pointB, d.distance || 0, d.paramRef);
      case CONSTRAINT_TYPES.HORIZONTAL: return new HorizontalConstraint(d.pointA, d.pointB);
      case CONSTRAINT_TYPES.VERTICAL: return new VerticalConstraint(d.pointA, d.pointB);
      default: return null;
    }
  }

  function rebuildSolverAndParams() {
    constraintSolver = new ConstraintSolver();
    paramManager = new ParamManager();
    for (const name in paramsData) {
      const pd = paramsData[name];
      paramManager.addParam(name, pd.value || 0);
      if (pd.expression) paramManager.setExpression(name, pd.expression);
    }
    paramManager.reevaluateAll();
    for (const c of constraints) constraintSolver.addConstraint(c);
    constraintSolver.params = paramManager.getAllParams();
  }

  function updateSolverParams() {
    paramManager.reevaluateAll();
    constraintSolver.params = paramManager.getAllParams();
  }

  function runSolver(fixedPoints, extraFixed, maxIter) {
    if (constraints.length === 0) {
      if (extraFixed && Object.keys(extraFixed).length > 0) {
        const pointMap = buildPointMap();
        for (const key in extraFixed) {
          const parts = key.split('_');
          const coord = parts.pop();
          const id = parts.join('_');
          if (pointMap[id]) {
            pointMap[id][coord] = extraFixed[key];
          }
        }
        applyPointMap(pointMap);
      }
      return { success: true, iterations: 0, residual: 0 };
    }
    const pointMap = buildPointMap();
    updateSolverParams();
    const result = constraintSolver.solve(pointMap, fixedPoints, extraFixed, maxIter);
    applyPointMap(pointMap);
    return result;
  }

  function initialSolve() {
    if (constraints.length === 0) return;
    rebuildSolverAndParams();
    runSolver(new Set(), null, 200);
  }

  function render() {
    const w = window.innerWidth, h = window.innerHeight;
    
    if (guideSystem) {
      guideSystem.setViewport(viewport);
    }
    
    if (editingComponentId !== null) {
      ctx.fillStyle = '#faf6f2';
    } else {
      ctx.fillStyle = '#f0f0f0';
    }
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(viewport.scale, viewport.scale);
    ctx.translate(-viewport.x, -viewport.y);
    drawGrid();

    if (editingComponentId !== null) {
      const comp = getComponentById(editingComponentId);
      if (comp) {
        for (const s of comp.shapes) {
          if (s.visible) renderShape(s);
        }
        renderConstraintIcons();
      }
    } else {
      for (const s of shapes) {
        if (s.visible || isMaskShape(s)) renderShape(s);
      }

      renderConstraintIcons();
      dimensionSystem.updateFromShapes(
        (id) => { const s = getShapeById(id); return s ? worldPointsOf(s) : null; },
        (id) => { const s = getShapeById(id); return s ? worldHolesOf(s) : null; }
      );
      dimensionSystem.render(ctx, viewport.scale);
    }

    if (isNodeEditMode) {
      renderNodeEditGlobal();
    } else {
      for (const id of selectedIds) {
        const s = getShapeById(id);
        if (s && !s.locked && (s.visible || isMaskShape(s))) renderSelection(s);
      }
    }

    if (dimensionSystem.measureMode && editingComponentId === null) {
      dimensionSystem.renderMeasureOverlay(ctx, viewport.scale, null,
        (id, isHole) => {
          const s = getShapeById(id);
          if (!s) return null;
          return isHole ? worldHolesOf(s) : [worldPointsOf(s)];
        }
      );
    }

    if (isDrawing && currentTool === 'rect' && drawStart && drawEnd) {
      const x = Math.min(drawStart.x, drawEnd.x), y = Math.min(drawStart.y, drawEnd.y);
      const w2 = Math.abs(drawEnd.x - drawStart.x), h2 = Math.abs(drawEnd.y - drawStart.y);
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
      for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      if (lastMouseWorld) ctx.lineTo(lastMouseWorld.x, lastMouseWorld.y);
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

    if (currentTool === 'motionpath' && polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#8e24aa';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
      if (lastMouseWorld) ctx.lineTo(lastMouseWorld.x, lastMouseWorld.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      for (const p of polygonPoints) {
        ctx.save();
        ctx.fillStyle = '#8e24aa';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / viewport.scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    if ((animationController.isPlaying || animationController.currentFrame > 0) && editingComponentId === null) {
      const useAnimation = true;
      const cf = animationController.currentFrame;
      for (const s of shapes) {
        if (s.type === 'motion-path') continue;
        if (!s.visible || s.locked) continue;
        const binding = motionPathManager.getBinding(s.id);
        if (!binding) continue;
        const pathShape = getShapeById(binding.pathShapeId);
        if (!pathShape || !pathShape.visible) continue;
        const animProps = getAnimatedShapeProps(s, cf);
        if (animProps._pathMotionState) {
          const ps = animProps._pathMotionState;
          ctx.save();
          ctx.beginPath();
          ctx.arc(ps.point.x, ps.point.y, 5 / viewport.scale, 0, Math.PI * 2);
          ctx.fillStyle = '#ff5722';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5 / viewport.scale;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    if (isMarquee && marqueeStart && marqueeEnd) {
      const x = Math.min(marqueeStart.x, marqueeEnd.x), y = Math.min(marqueeStart.y, marqueeEnd.y);
      const w3 = Math.abs(marqueeEnd.x - marqueeStart.x), h3 = Math.abs(marqueeEnd.y - marqueeStart.y);
      ctx.save();
      ctx.fillStyle = 'rgba(77, 159, 255, 0.15)';
      ctx.strokeStyle = '#4d9fff';
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.setLineDash([4 / viewport.scale, 3 / viewport.scale]);
      ctx.fillRect(x, y, w3, h3);
      ctx.strokeRect(x, y, w3, h3);
      ctx.restore();
    }

    renderConstraintSelection();
    renderSnapGuides();
    ctx.restore();
    zoomEl.textContent = Math.round(viewport.scale * 100) + '%';
  }

  function renderConstraintSelection() {
    if (constraintSelection.length === 0) return;
    ctx.save();
    const hitRadius = 10 / viewport.scale;
    for (const sel of constraintSelection) {
      if (sel.type === 'vertex') {
        const v = sel.data;
        const pts = v.isHole ? worldHolesOf(v.shape)[v.holeIndex] : worldPointsOf(v.shape);
        if (pts && pts[v.pointIndex]) {
          const p = pts[v.pointIndex];
          ctx.fillStyle = 'rgba(77, 159, 255, 0.3)';
          ctx.strokeStyle = '#1a73e8';
          ctx.lineWidth = 2 / viewport.scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, hitRadius * 1.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (sel.type === 'edge') {
        const e = sel.data;
        const pts = e.isHole ? worldHolesOf(e.shape)[e.holeIndex] : worldPointsOf(e.shape);
        if (pts) {
          const a = pts[e.edgeIndex];
          const b = pts[(e.edgeIndex + 1) % pts.length];
          ctx.strokeStyle = '#1a73e8';
          ctx.lineWidth = 5 / viewport.scale;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function getPointStatusColor(pid) {
    if (constraints.length === 0) return '#000';
    const hasConflict = constraintSolver.conflictConstraints.size > 0;
    if (hasConflict) {
      for (const ci of constraintSolver.conflictConstraints) {
        const c = constraints[ci];
        if (c && c.getReferencedPoints().includes(pid)) return '#e53935';
      }
    }
    const statusMap = constraintSolver.getPointStatusMap();
    const status = statusMap[pid];
    if (status === 'over') return '#e53935';
    if (status === 'under') return '#43a047';
    return '#000';
  }

  function renderPolyline(points, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = (width || 2) / viewport.scale;
    ctx.beginPath();
    if (points.length > 0) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();
  }

  function renderVertexSquare(p, isSelected, vertexSize, color) {
    ctx.save();
    if (isSelected) {
      ctx.fillStyle = '#ff6b35'; ctx.strokeStyle = '#fff';
    } else if (color) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = color;
    } else {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1a73e8';
    }
    ctx.lineWidth = 2 / viewport.scale;
    ctx.fillRect(p.x - vertexSize / 2, p.y - vertexSize / 2, vertexSize, vertexSize);
    ctx.strokeRect(p.x - vertexSize / 2, p.y - vertexSize / 2, vertexSize, vertexSize);
    ctx.restore();
  }

  function renderEdgeMidpoint(a, b) {
    const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
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

  function buildComponentEditPointMap() {
    const map = {};
    if (editingComponentId === null) return map;
    const comp = getComponentById(editingComponentId);
    if (!comp) return map;
    for (const s of comp.shapes) {
      if (!s.visible) continue;
      if (isComponentInstance(s)) continue;
      const pts = worldPointsOf(s);
      for (let i = 0; i < pts.length; i++) {
        map[makePointId(s.id, false, -1, i)] = { ...pts[i] };
      }
      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        for (let i = 0; i < hole.length; i++) {
          map[makePointId(s.id, true, h, i)] = { ...hole[i] };
        }
      }
    }
    return map;
  }

  function renderComponentEditConstraintIcons() {
    if (editingComponentId === null) return;
    const comp = getComponentById(editingComponentId);
    if (!comp || !comp.constraints || comp.constraints.length === 0) return;
    const pointMap = buildComponentEditPointMap();
    for (let i = 0; i < comp.constraints.length; i++) {
      const c = comp.constraints[i];
      const pos = c.getIconPosition(pointMap);
      if (!pos) continue;
      ctx.save();
      const bgColor = '#e3f2fd';
      const borderColor = '#1a73e8';
      const textColor = '#0d47a1';
      ctx.fillStyle = bgColor;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5 / viewport.scale;
      const pad = 5 / viewport.scale;
      const label = c.getLabel();
      ctx.font = `700 ${11 / viewport.scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const textW = ctx.measureText(label).width;
      const iconSize = 14 / viewport.scale;
      const bw = Math.max(textW + pad * 2, iconSize * 2);
      const bh = iconSize * 1.5;
      const bx = pos.x - bw / 2, by = pos.y - bh / 2;
      roundRect(ctx, bx, by, bw, bh, 4 / viewport.scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);
      ctx.restore();
    }
  }

  function getActiveShapes() {
    if (editingComponentId !== null) {
      const comp = getComponentById(editingComponentId);
      return comp ? comp.shapes.filter(s => !isComponentInstance(s)) : [];
    }
    return shapes;
  }

  function renderNodeEditGlobal() {
    const vertexSize = 8 / viewport.scale;
    const activeShapes = getActiveShapes();
    for (const s of activeShapes) {
      if (!s.visible) continue;
      if (isComponentInstance(s)) continue;
      const pts = worldPointsOf(s);
      const holes = worldHolesOf(s);
      renderPolyline(pts, '#1a73e8', 2);
      for (const hole of holes) renderPolyline(hole, '#1a73e8', 2);

      for (let i = 0; i < pts.length; i++) {
        const pid = makePointId(s.id, false, -1, i);
        const vcol = getPointStatusColor(pid);
        let isSel = false;
        if (selectedVertex && selectedVertex.shape &&
            selectedVertex.shape.id === s.id &&
            !selectedVertex.isHole &&
            selectedVertex.pointIndex === i) isSel = true;
        for (const sel of constraintSelection) {
          if (sel.type === 'vertex' && sel.data.shape.id === s.id &&
              !sel.data.isHole && sel.data.pointIndex === i) isSel = true;
        }
        renderVertexSquare(pts[i], isSel, vertexSize, vcol);
      }

      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        for (let i = 0; i < hole.length; i++) {
          const pid = makePointId(s.id, true, h, i);
          const vcol = getPointStatusColor(pid);
          let isSel = false;
          if (selectedVertex && selectedVertex.shape &&
              selectedVertex.shape.id === s.id &&
              selectedVertex.isHole &&
              selectedVertex.holeIndex === h &&
              selectedVertex.pointIndex === i) isSel = true;
          for (const sel of constraintSelection) {
            if (sel.type === 'vertex' && sel.data.shape.id === s.id &&
                sel.data.isHole && sel.data.holeIndex === h &&
                sel.data.pointIndex === i) isSel = true;
          }
          renderVertexSquare(hole[i], isSel, vertexSize, vcol);
        }
      }
    }

    if (hoveredEdge && !isDraggingVertex && selectedIds.size === 1) {
      const selShape = getSelectedShapes()[0];
      if (selShape) {
        const pts = hoveredEdge.isHole ? worldHolesOf(selShape)[hoveredEdge.holeIndex] : worldPointsOf(selShape);
        if (pts && hoveredEdge.edgeIndex >= 0 && hoveredEdge.edgeIndex < pts.length) {
          const a = pts[hoveredEdge.edgeIndex];
          const b = pts[(hoveredEdge.edgeIndex + 1) % pts.length];
          renderEdgeMidpoint(a, b);
        }
      }
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

  function drawPolygonPath(points, holes) {
    ctx.beginPath();
    if (points.length > 0) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.closePath();
    }
    if (holes) {
      for (const hole of holes) {
        if (hole.length > 0) {
          ctx.moveTo(hole[0].x, hole[0].y);
          for (let i = 1; i < hole.length; i++) ctx.lineTo(hole[i].x, hole[i].y);
          ctx.closePath();
        }
      }
    }
  }

  function getAnimatedShapeProps(shape, frame) {
    const baseTransform = shape.transform;
    const baseFill = shape.fill;
    const baseOpacity = shape.opacity !== undefined ? shape.opacity : 1;

    let animProps = animationController.getShapePropertiesAtFrame(shape.id, frame, {
      tx: baseTransform.tx,
      ty: baseTransform.ty,
      rotation: baseTransform.rotation,
      scaleX: baseTransform.scaleX,
      scaleY: baseTransform.scaleY,
      fill: baseFill,
      opacity: baseOpacity
    });

    if (shape.type !== 'motion-path' && !isComponentInstance(shape)) {
      const binding = motionPathManager.getBinding(shape.id);
      if (binding) {
        const pathShape = getShapeById(binding.pathShapeId);
        if (pathShape && pathShape.visible && pathShape.type === 'motion-path') {
          const pathPts = worldPointsOf(pathShape);
          if (pathPts.length >= 2) {
            const total = Math.max(1, animationController.getTotalFrames());
            const pathKfs = pathShape.motionPathData ? pathShape.motionPathData.speedKeyframes : null;
            const bindingWithKfs = { ...binding, speedKeyframes: pathKfs || binding.speedKeyframes };
            const mpState = motionPathManager.computeBindingState(
              bindingWithKfs, pathPts, frame, total,
              animProps.tx, animProps.ty, animProps.rotation
            );
            animProps = {
              ...animProps,
              tx: mpState.tx,
              ty: mpState.ty,
              rotation: mpState.rotation,
              _pathMotionState: mpState
            };
          }
        }
      }
    }

    return animProps;
  }

  function getAnimatedWorldPoints(shape, frame) {
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      if (expanded.length === 0) return [];
      let allPts = [];
      for (const es of expanded) {
        if (es.points) allPts = allPts.concat(es.points);
      }
      return allPts;
    }
    const props = getAnimatedShapeProps(shape, frame);
    const pts = applyTransform(shape.points, props.tx, props.ty, props.rotation, props.scaleX, props.scaleY);
    return pts;
  }

  function getAnimatedWorldHoles(shape, frame) {
    if (isComponentInstance(shape)) {
      const expanded = getInstanceExpandedShapes(shape);
      let allHoles = [];
      for (const es of expanded) {
        if (es.holes) allHoles = allHoles.concat(es.holes);
      }
      return allHoles;
    }
    if (!shape.holes) return [];
    const props = getAnimatedShapeProps(shape, frame);
    return shape.holes.map(h => applyTransform(h, props.tx, props.ty, props.rotation, props.scaleX, props.scaleY));
  }

  function drawOpenPath(points) {
    ctx.beginPath();
    if (points.length > 0) {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    }
  }

  function renderMaskOutline(maskShape) {
    const pts = worldPointsOf(maskShape);
    const holes = worldHolesOf(maskShape);
    ctx.save();
    drawPolygonPath(pts, holes);
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1.5 / viewport.scale;
    ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function applyClipMasks(masks, useAnimation, currentFrame) {
    if (masks.length === 0) return;
    const clipMasks = masks.filter(m => getMaskType(m) === 'clip');
    if (clipMasks.length === 0) return;

    for (const mask of clipMasks) {
      const maskPts = useAnimation ? getAnimatedWorldPoints(mask, currentFrame) : worldPointsOf(mask);
      const maskHoles = useAnimation ? getAnimatedWorldHoles(mask, currentFrame) : worldHolesOf(mask);
      drawPolygonPath(maskPts, maskHoles);
    }
    ctx.clip('evenodd');
  }

  function renderShapeWithAlphaMask(s, masks, useAnimation, currentFrame) {
    const alphaMasks = masks.filter(m => getMaskType(m) === 'alpha');
    if (alphaMasks.length === 0) {
      renderShapeRaw(s, useAnimation, currentFrame);
      return;
    }

    const pts = useAnimation ? getAnimatedWorldPoints(s, currentFrame) : worldPointsOf(s);
    const holes = useAnimation ? getAnimatedWorldHoles(s, currentFrame) : worldHolesOf(s);
    const allBounds = getBounds(pts);

    for (const mask of alphaMasks) {
      const maskPts = useAnimation ? getAnimatedWorldPoints(mask, currentFrame) : worldPointsOf(mask);
      const mb = getBounds(maskPts);
      allBounds.minX = Math.min(allBounds.minX, mb.minX);
      allBounds.minY = Math.min(allBounds.minY, mb.minY);
      allBounds.maxX = Math.max(allBounds.maxX, mb.maxX);
      allBounds.maxY = Math.max(allBounds.maxY, mb.maxY);
    }

    const pad = 2;
    const x = allBounds.minX - pad;
    const y = allBounds.minY - pad;
    const w = allBounds.maxX - allBounds.minX + pad * 2;
    const h = allBounds.maxY - allBounds.minY + pad * 2;

    const offscreen = document.createElement('canvas');
    offscreen.width = w * viewport.scale;
    offscreen.height = h * viewport.scale;
    const octx = offscreen.getContext('2d');
    octx.scale(viewport.scale, viewport.scale);
    octx.translate(-x, -y);

    const savedCtx = ctx;
    ctx = octx;
    renderShapeRaw(s, useAnimation, currentFrame);
    ctx = savedCtx;

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w * viewport.scale;
    maskCanvas.height = h * viewport.scale;
    const mctx = maskCanvas.getContext('2d');
    mctx.scale(viewport.scale, viewport.scale);
    mctx.translate(-x, -y);

    for (let i = 0; i < alphaMasks.length; i++) {
      const mask = alphaMasks[i];
      const maskPts = useAnimation ? getAnimatedWorldPoints(mask, currentFrame) : worldPointsOf(mask);
      const maskHoles = useAnimation ? getAnimatedWorldHoles(mask, currentFrame) : worldHolesOf(mask);

      const maskFill = ensureFillStructure(mask.fill);
      const maskFillColor = getFillDisplayColor(maskFill);

      if (i === 0) {
        mctx.save();
        mctx.beginPath();
        if (maskPts.length > 0) {
          mctx.moveTo(maskPts[0].x, maskPts[0].y);
          for (let j = 1; j < maskPts.length; j++) mctx.lineTo(maskPts[j].x, maskPts[j].y);
          mctx.closePath();
        }
        if (maskHoles) {
          for (const hole of maskHoles) {
            if (hole.length > 0) {
              mctx.moveTo(hole[0].x, hole[0].y);
              for (let j = 1; j < hole.length; j++) mctx.lineTo(hole[j].x, hole[j].y);
              mctx.closePath();
            }
          }
        }
        mctx.fillStyle = maskFillColor;
        mctx.globalAlpha = 1;
        mctx.fill('evenodd');
        mctx.restore();
      } else {
        mctx.globalCompositeOperation = 'destination-in';
        mctx.save();
        mctx.beginPath();
        if (maskPts.length > 0) {
          mctx.moveTo(maskPts[0].x, maskPts[0].y);
          for (let j = 1; j < maskPts.length; j++) mctx.lineTo(maskPts[j].x, maskPts[j].y);
          mctx.closePath();
        }
        if (maskHoles) {
          for (const hole of maskHoles) {
            if (hole.length > 0) {
              mctx.moveTo(hole[0].x, hole[0].y);
              for (let j = 1; j < hole.length; j++) mctx.lineTo(hole[j].x, hole[j].y);
              mctx.closePath();
            }
          }
        }
        mctx.fillStyle = maskFillColor;
        mctx.fill('evenodd');
        mctx.restore();
        mctx.globalCompositeOperation = 'source-over';
      }
    }

    const maskImgData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const shapeImgData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
    const maskData = maskImgData.data;
    const shapeData = shapeImgData.data;

    for (let i = 0; i < shapeData.length; i += 4) {
      const r = maskData[i];
      const g = maskData[i + 1];
      const b = maskData[i + 2];
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      shapeData[i + 3] = shapeData[i + 3] * luminance;
    }

    octx.putImageData(shapeImgData, 0, 0);

    savedCtx.save();
    savedCtx.drawImage(offscreen, x, y, w, h);
    savedCtx.restore();
  }

  function renderShapeRaw(s, useAnimation, currentFrame) {
    if (s.type === 'motion-path') {
      const pts = worldPointsOf(s);
      const opacity = s.opacity !== undefined ? s.opacity : 1;
      ctx.save();
      ctx.globalAlpha = opacity;
      drawOpenPath(pts);
      ctx.lineWidth = (s.strokeWidth || 2) / viewport.scale;
      ctx.strokeStyle = s.stroke || '#8e24aa';
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.fill) {
        ctx.fillStyle = s.fill;
        drawOpenPath(pts);
        ctx.globalAlpha = opacity * 0.08;
        ctx.fill();
      }
      for (let i = 0; i < pts.length; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 3 / viewport.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#8e24aa';
        ctx.globalAlpha = opacity;
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (isComponentInstance(s)) {
      if (editingComponentId !== null) {
        if (editingComponentId === s.componentId) {
          return;
        }
      }
      const expanded = getInstanceExpandedShapes(s);
      for (const es of expanded) {
        const pts = es.points;
        const holes = es.holes || [];
        ctx.save();
        if (useAnimation) {
          const animProps = getAnimatedShapeProps(s, currentFrame);
          ctx.globalAlpha = animProps.opacity;
        }
        drawPolygonPath(pts, holes);
        let fillColor = es.fill;
        if (useAnimation) {
          const animProps = getAnimatedShapeProps(s, currentFrame);
          fillColor = animProps.fill;
        }
        ctx.fillStyle = fillColor;
        ctx.fill('evenodd');
        ctx.lineWidth = (es.strokeWidth || 2) / viewport.scale;
        ctx.strokeStyle = es.stroke || '#000';
        ctx.stroke();
        ctx.restore();
      }
    } else {
      let pts = useAnimation ? getAnimatedWorldPoints(s, currentFrame) : worldPointsOf(s);
      let holes = useAnimation ? getAnimatedWorldHoles(s, currentFrame) : worldHolesOf(s);
      let fillColor = s.fill;
      let opacity = s.opacity !== undefined ? s.opacity : 1;

      if (useAnimation) {
        const animProps = getAnimatedShapeProps(s, currentFrame);
        fillColor = animProps.fill;
        opacity = animProps.opacity;
      }

      ctx.save();
      ctx.globalAlpha = opacity;
      drawPolygonPath(pts, holes);
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');
      ctx.lineWidth = (s.strokeWidth || 2) / viewport.scale;
      ctx.strokeStyle = s.stroke || '#000';
      ctx.stroke();
      ctx.restore();
    }
  }

  function renderShape(s) {
    const currentFrame = animationController.currentFrame;
    const useAnimation = animationController.isPlaying || animationController.currentFrame > 0;

    if (isMaskShape(s)) {
      if (selectedIds.has(s.id) || isNodeEditMode) {
        renderMaskOutline(s);
      }
      return;
    }

    const masks = getMasksOfShape(s.id);

    if (masks.length === 0) {
      renderShapeRaw(s, useAnimation, currentFrame);
      return;
    }

    const clipMasks = masks.filter(m => getMaskType(m) === 'clip');
    const alphaMasks = masks.filter(m => getMaskType(m) === 'alpha');

    if (alphaMasks.length === 0) {
      ctx.save();
      applyClipMasks(masks, useAnimation, currentFrame);
      renderShapeRaw(s, useAnimation, currentFrame);
      ctx.restore();
    } else {
      ctx.save();
      applyClipMasks(clipMasks, useAnimation, currentFrame);
      renderShapeWithAlphaMask(s, alphaMasks, useAnimation, currentFrame);
      ctx.restore();
    }
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

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function renderConstraintIcons() {
    if (constraints.length === 0) return;
    const pointMap = buildPointMap();
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      const pos = c.getIconPosition(pointMap);
      if (!pos) continue;
      const isConflict = constraintSolver.conflictConstraints.has(i);
      const isSelected = selectedConstraintIdx === i;
      ctx.save();
      const bgColor = isConflict ? '#ffcdd2' : (isSelected ? '#bbdefb' : '#e3f2fd');
      const borderColor = isConflict ? '#c62828' : (isSelected ? '#1565c0' : '#1a73e8');
      const textColor = isConflict ? '#c62828' : '#0d47a1';
      ctx.fillStyle = bgColor;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5 / viewport.scale;
      const pad = 5 / viewport.scale;
      const label = c.getLabel();
      ctx.font = `700 ${11 / viewport.scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const textW = ctx.measureText(label).width;
      const iconSize = 14 / viewport.scale;
      const bw = Math.max(textW + pad * 2, iconSize * 2);
      const bh = iconSize * 1.5;
      const bx = pos.x - bw / 2, by = pos.y - bh / 2;
      roundRect(ctx, bx, by, bw, bh, 4 / viewport.scale);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x, pos.y);
      ctx.restore();
    }
  }

  function createLayerItem(s, isMask, indentLevel) {
    const item = document.createElement('div');
    item.className = 'layer-item';
    item.dataset.id = s.id;
    item.draggable = true;
    if (selectedIds.has(s.id)) item.classList.add('selected');
    if (s.locked) item.classList.add('locked');
    if (isComponentInstance(s)) item.classList.add('is-instance');
    if (isMask) item.classList.add('mask-layer');

    if (indentLevel && indentLevel > 0) {
      item.style.paddingLeft = (indentLevel * 20) + 'px';
    }

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
      if (!s.visible && selectedIds.has(s.id)) {
        selectedIds.delete(s.id);
        if (selectedIds.size === 0) { isNodeEditMode = false; selectedVertex = null; }
      }
      updateToolbar();
      renderLayers();
      renderComponentsList();
      render();
    });

    const colorSwatch = document.createElement('div');
    colorSwatch.className = 'layer-color';
    let displayFill = s.fill;
    if (isComponentInstance(s) && s.overrides && s.overrides.fill) {
      displayFill = s.overrides.fill;
    }
    colorSwatch.style.background = displayFill;

    const nameWrapper = document.createElement('div');
    nameWrapper.style.display = 'flex';
    nameWrapper.style.alignItems = 'center';
    nameWrapper.style.flex = '1';
    nameWrapper.style.minWidth = '0';

    if (isMask) {
      const maskIcon = document.createElement('span');
      maskIcon.className = 'mask-icon';
      maskIcon.title = getMaskType(s) === 'alpha' ? 'Alpha Mask' : 'Clip Mask';
      maskIcon.innerHTML = getMaskType(s) === 'alpha'
        ? '<svg viewBox="0 0 24 24" width="14" height="14"><defs><linearGradient id="maskGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#000;stop-opacity:1" /><stop offset="100%" style="stop-color:#fff;stop-opacity:1" /></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="2" fill="url(#maskGrad)" stroke="#666" stroke-width="1.5"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" opacity="0.4"/><path fill="currentColor" d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6z"/></svg>';
      nameWrapper.appendChild(maskIcon);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    if (isComponentInstance(s)) {
      const comp = getComponentById(s.componentId);
      nameEl.textContent = comp ? comp.name : s.name;
    } else {
      nameEl.textContent = s.name;
    }
    nameEl.title = isComponentInstance(s) ? 'Component Instance - Double-click to edit component' : 'Double-click to rename';
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      if (isComponentInstance(s)) {
        enterComponentEditMode(s.componentId);
      } else {
        startRenameLayer(item, s, nameEl);
      }
    });

    if (isComponentInstance(s)) {
      const badge = document.createElement('span');
      badge.className = 'layer-badge';
      badge.textContent = 'C';
      nameWrapper.appendChild(badge);
    }
    if (s.type === 'motion-path') {
      const badge = document.createElement('span');
      badge.className = 'layer-badge';
      badge.textContent = 'P';
      badge.style.background = '#8e24aa';
      badge.style.color = '#fff';
      nameWrapper.appendChild(badge);
    }
    nameWrapper.appendChild(nameEl);

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
        selectedVertex = null;
        isNodeEditMode = false;
      }
      updateToolbar();
      renderLayers();
      render();
    });

    item.appendChild(visibilityBtn);
    item.appendChild(colorSwatch);
    item.appendChild(nameWrapper);

    if (isComponentInstance(s)) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'instance-context-actions';

      const overrideBtn = document.createElement('button');
      overrideBtn.className = 'instance-action-btn';
      overrideBtn.innerHTML = '🎨';
      overrideBtn.title = 'Instance Overrides';
      overrideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openInstanceOverrideDialog(s.id);
      });

      const unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'instance-action-btn';
      unlinkBtn.innerHTML = '⟳';
      unlinkBtn.title = 'Unlink Instance';
      unlinkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        unlinkInstance(s.id);
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'instance-action-btn';
      editBtn.innerHTML = '✎';
      editBtn.title = 'Edit Source Component';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enterComponentEditMode(s.componentId);
      });

      actionsDiv.appendChild(overrideBtn);
      actionsDiv.appendChild(unlinkBtn);
      actionsDiv.appendChild(editBtn);
      item.appendChild(actionsDiv);
    }

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
      selectedVertex = null;
      constraintSelection = [];
      updateToolbar();
      renderLayers();
      render();
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMaskShape(s)) {
        showLayerContextMenu(e.clientX, e.clientY, s);
      }
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
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
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

    return item;
  }

  function showLayerContextMenu(x, y, shape) {
    let menu = document.getElementById('layer-context-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'layer-context-menu';
      menu.className = 'context-menu';
      document.body.appendChild(menu);
    }
    menu.innerHTML = '';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const releaseItem = document.createElement('div');
    releaseItem.className = 'menu-item';
    releaseItem.innerHTML = '✂️ Release Mask';
    releaseItem.addEventListener('click', () => {
      pushHistory();
      releaseMask(shape.id);
      menu.classList.add('hidden');
      updateToolbar();
      renderLayers();
      render();
      showToast('Mask released', 'success');
    });
    menu.appendChild(releaseItem);

    menu.classList.remove('hidden');

    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.classList.add('hidden');
        document.removeEventListener('mousedown', closeMenu);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', closeMenu);
    }, 10);
  }

  function renderLayers() {
    if (editingComponentId !== null) return;
    layersListEl.innerHTML = '';
    if (shapes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-layers';
      empty.textContent = 'No layers yet';
      layersListEl.appendChild(empty);
      return;
    }

    const processed = new Set();

    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (processed.has(s.id)) continue;
      if (isMaskShape(s)) continue;

      const item = createLayerItem(s, false, 0);
      layersListEl.appendChild(item);
      processed.add(s.id);

      const masks = getMasksOfShape(s.id);
      for (const mask of masks) {
        const maskItem = createLayerItem(mask, true, 1);
        layersListEl.appendChild(maskItem);
        processed.add(mask.id);
      }
    }

    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (processed.has(s.id)) continue;
      const item = createLayerItem(s, false, 0);
      layersListEl.appendChild(item);
      processed.add(s.id);
    }
  }

  function drawComponentIcon(canvas, component) {
    const c = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    c.clearRect(0, 0, w, h);
    const bounds = computeComponentBounds(component);
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw < 1 || bh < 1) return;
    const padding = 4;
    const scale = Math.min((w - padding * 2) / bw, (h - padding * 2) / bh);
    const offsetX = (w - bw * scale) / 2 - bounds.minX * scale;
    const offsetY = (h - bh * scale) / 2 - bounds.minY * scale;
    c.save();
    c.translate(offsetX, offsetY);
    c.scale(scale, scale);
    const expanded = expandComponentShapes(component, { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    for (const s of expanded) {
      c.beginPath();
      const pts = s.points;
      if (pts.length > 0) {
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.closePath();
      }
      const holes = s.holes || [];
      for (const hole of holes) {
        if (hole.length > 0) {
          c.moveTo(hole[0].x, hole[0].y);
          for (let i = 1; i < hole.length; i++) c.lineTo(hole[i].x, hole[i].y);
          c.closePath();
        }
      }
      c.fillStyle = s.fill;
      c.fill('evenodd');
      c.lineWidth = 2 / scale;
      c.strokeStyle = s.stroke || '#000';
      c.stroke();
    }
    c.restore();
  }

  function renderComponentsList() {
    componentsListEl.innerHTML = '';
    const componentIds = Object.keys(components);
    if (componentIds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-components';
      empty.textContent = 'No components yet. Select shapes and press G to create.';
      componentsListEl.appendChild(empty);
      return;
    }
    for (const cid of componentIds) {
      const comp = components[cid];
      if (!comp) continue;
      const item = document.createElement('div');
      item.className = 'component-item';
      item.draggable = true;
      item.dataset.componentId = cid;

      const iconDiv = document.createElement('div');
      iconDiv.className = 'component-icon';
      const iconCanvas = document.createElement('canvas');
      iconCanvas.width = 56;
      iconCanvas.height = 56;
      iconDiv.appendChild(iconCanvas);

      const infoDiv = document.createElement('div');
      infoDiv.className = 'component-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'component-name';
      nameEl.textContent = comp.name;
      const countEl = document.createElement('div');
      countEl.className = 'component-count';
      const instCount = getInstancesOfComponent(parseInt(cid, 10)).length;
      countEl.textContent = instCount + ' instance' + (instCount !== 1 ? 's' : '');
      infoDiv.appendChild(nameEl);
      infoDiv.appendChild(countEl);

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'component-actions';
      const delBtn = document.createElement('button');
      delBtn.className = 'component-action-btn';
      delBtn.textContent = '×';
      delBtn.title = 'Delete Component';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tryDeleteComponent(parseInt(cid, 10));
      });
      actionsDiv.appendChild(delBtn);

      item.appendChild(iconDiv);
      item.appendChild(infoDiv);
      item.appendChild(actionsDiv);

      item.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        enterComponentEditMode(parseInt(cid, 10));
      });

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/component', cid);
      });

      item.addEventListener('click', () => {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const world = screenToWorld(centerX, centerY);
        const cidNum = parseInt(cid, 10);
        if (editingComponentId !== null) {
          if (checkCircularReference(cidNum, editingComponentId)) {
            showToast('Circular reference detected - cannot nest this component', 'error');
            return;
          }
          addInstanceToEditingComponent(cidNum, world.x, world.y);
        } else {
          createInstanceAt(cidNum, world.x, world.y);
        }
      });

      componentsListEl.appendChild(item);
      requestAnimationFrame(() => {
        drawComponentIcon(iconCanvas, comp);
      });
    }
  }

  function openCreateComponentDialog() {
    if (selectedIds.size === 0) {
      showToast('Select one or more shapes first', 'warning');
      return;
    }
    const existingCount = Object.keys(components).length;
    componentNameInputEl.value = 'Component ' + (existingCount + 1);
    createComponentDialogEl.classList.remove('hidden');
    setTimeout(() => componentNameInputEl.focus(), 50);
  }

  function closeCreateComponentDialog() {
    createComponentDialogEl.classList.add('hidden');
  }

  function collectConstraintsForShapes(shapeIds) {
    const result = [];
    for (const c of constraints) {
      const refs = c.getReferencedPoints();
      let allMatch = true;
      for (const pid of refs) {
        const { shapeId } = parsePointId(pid);
        if (!shapeIds.has(shapeId)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) result.push(c);
    }
    return result;
  }

  function createComponentFromSelection(name) {
    if (selectedIds.size === 0) {
      showToast('Select shapes first', 'warning');
      return;
    }
    const selIds = [...selectedIds];
    const selectedShapes = selIds.map(id => getShapeById(id)).filter(Boolean);

    pushHistory();

    const bounds = getShapesBounds(selectedShapes);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    const clonedShapes = selectedShapes.map(s => {
      const clone = JSON.parse(JSON.stringify(s));
      clone.localShapeId = clone.id;
      const t = clone.transform;
      clone.points = applyTransform(clone.points, t.tx - centerX, t.ty - centerY, t.rotation, t.scaleX, t.scaleY);
      clone.holes = (clone.holes || []).map(h => applyTransform(h, t.tx - centerX, t.ty - centerY, t.rotation, t.scaleX, t.scaleY));
      clone.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      return clone;
    });

    const idSet = new Set(selIds);
    const relatedConstraints = collectConstraintsForShapes(idSet);
    const idMap = {};
    for (const s of clonedShapes) {
      idMap[s.localShapeId] = s.localShapeId;
    }
    const remappedConstraints = relatedConstraints.map(c => {
      const clone = JSON.parse(JSON.stringify(serializeConstraint(c)));
      const remap = (pid) => {
        if (!pid) return pid;
        const parsed = parsePointId(pid);
        return makePointId(parsed.shapeId, parsed.isHole, parsed.holeIndex, parsed.pointIndex);
      };
      clone.pointA = remap(clone.pointA);
      clone.pointB = remap(clone.pointB);
      clone.point = remap(clone.point);
      clone.lineStart = remap(clone.lineStart);
      clone.lineEnd = remap(clone.lineEnd);
      clone.line1Start = remap(clone.line1Start);
      clone.line1End = remap(clone.line1End);
      clone.line2Start = remap(clone.line2Start);
      clone.line2End = remap(clone.line2End);
      return clone;
    });

    const componentId = nextComponentId++;
    components[componentId] = {
      id: componentId,
      name: name || ('Component ' + componentId),
      shapes: clonedShapes,
      constraints: remappedConstraints,
      offsetX: centerX,
      offsetY: centerY
    };

    const instanceShape = {
      id: nextId++,
      name: 'Instance of ' + (name || 'Component'),
      type: 'component-instance',
      componentId: componentId,
      visible: true,
      locked: false,
      fill: null,
      stroke: null,
      strokeWidth: 2,
      transform: { tx: centerX, ty: centerY, rotation: 0, scaleX: 1, scaleY: 1 },
      overrides: {}
    };
    shapes.push(instanceShape);

    for (const id of selIds) {
      const idx = shapes.findIndex(s => s.id === id);
      if (idx >= 0) shapes.splice(idx, 1);
    }
    constraints = constraints.filter(c => {
      const refs = c.getReferencedPoints();
      for (const pid of refs) {
        const { shapeId } = parsePointId(pid);
        if (idSet.has(shapeId)) return false;
      }
      return true;
    });

    selectedIds.clear();
    selectedIds.add(instanceShape.id);
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    updateDOFDisplay();
    renderLayers();
    renderConstraintList();
    renderComponentsList();
    render();
    scheduleSave();
    showToast('Component created: ' + (name || 'Component'), 'success');
  }

  function createInstanceAt(componentId, x, y) {
    const comp = getComponentById(componentId);
    if (!comp) {
      showToast('Component not found', 'error');
      return;
    }
    pushHistory();
    const instanceShape = {
      id: nextId++,
      name: 'Instance of ' + comp.name,
      type: 'component-instance',
      componentId: componentId,
      visible: true,
      locked: false,
      fill: null,
      stroke: null,
      strokeWidth: 2,
      transform: { tx: x, ty: y, rotation: 0, scaleX: 1, scaleY: 1 },
      overrides: {}
    };
    shapes.push(instanceShape);
    selectedIds.clear();
    selectedIds.add(instanceShape.id);
    updateToolbar();
    renderLayers();
    renderComponentsList();
    render();
    scheduleSave();
    showToast('Instance created', 'success');
  }

  function addInstanceToEditingComponent(componentId, x, y) {
    const comp = getComponentById(componentId);
    const editingComp = getComponentById(editingComponentId);
    if (!comp || !editingComp) {
      showToast('Component not found', 'error');
      return;
    }
    pushHistory();
    const instanceShape = {
      id: nextId++,
      localShapeId: 0,
      name: 'Instance of ' + comp.name,
      type: 'component-instance',
      componentId: componentId,
      visible: true,
      locked: false,
      fill: null,
      stroke: null,
      strokeWidth: 2,
      transform: { tx: x, ty: y, rotation: 0, scaleX: 1, scaleY: 1 },
      overrides: {}
    };
    instanceShape.localShapeId = instanceShape.id;
    editingComp.shapes.push(instanceShape);
    renderComponentsList();
    render();
    scheduleSave();
    showToast('Nested instance added to component', 'success');
  }

  function enterComponentEditMode(componentId) {
    const comp = getComponentById(componentId);
    if (!comp) {
      showToast('Component not found', 'error');
      return;
    }
    if (checkCircularReference(componentId, componentId)) {
      showToast('Circular reference detected', 'error');
      return;
    }
    pushHistory();
    savedViewportForComponentEdit = { ...viewport };
    savedSelectionForComponentEdit = new Set(selectedIds);
    savedConstraintsForComponentEdit = constraints.slice();
    editingComponentId = componentId;
    selectedIds.clear();
    selectedVertex = null;
    constraintSelection = [];
    constraintMode = null;
    selectedConstraintIdx = -1;
    isNodeEditMode = false;
    constraints = (comp.constraints || []).map(d => deserializeConstraint(d)).filter(Boolean);
    const bounds = computeComponentBounds(comp);
    viewport.x = (bounds.minX + bounds.maxX) / 2;
    viewport.y = (bounds.minY + bounds.maxY) / 2;
    componentEditNameEl.textContent = 'Editing: ' + comp.name;
    componentEditIndicatorEl.classList.remove('hidden');
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    renderLayers();
    renderComponentsList();
    renderConstraintList();
    renderParams();
    updateDOFDisplay();
    render();
  }

  function exitComponentEditMode() {
    if (editingComponentId === null) return;
    pushHistory();
    const comp = getComponentById(editingComponentId);
    if (comp) {
      comp.constraints = constraints.map(c => serializeConstraint(c));
    }
    if (savedConstraintsForComponentEdit !== null) {
      constraints = savedConstraintsForComponentEdit;
      savedConstraintsForComponentEdit = null;
    }
    editingComponentId = null;
    if (savedViewportForComponentEdit) {
      viewport = savedViewportForComponentEdit;
      savedViewportForComponentEdit = null;
    }
    if (savedSelectionForComponentEdit) {
      selectedIds = new Set([...savedSelectionForComponentEdit].filter(id => getShapeById(id)));
      savedSelectionForComponentEdit = null;
    }
    componentEditIndicatorEl.classList.add('hidden');
    selectedVertex = null;
    constraintSelection = [];
    constraintMode = null;
    selectedConstraintIdx = -1;
    isNodeEditMode = false;
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    renderLayers();
    renderComponentsList();
    renderConstraintList();
    renderParams();
    updateDOFDisplay();
    render();
    scheduleSave();
  }

  function unlinkInstance(instanceId) {
    const instance = getShapeById(instanceId);
    if (!instance || !isComponentInstance(instance)) return;
    pushHistory();
    const expanded = getInstanceExpandedShapes(instance);
    if (expanded.length === 0) {
      showToast('Nothing to unlink', 'warning');
      return;
    }
    const newShapes = [];
    for (const es of expanded) {
      const s = createShape(es.points, es.fill, es.holes);
      s.stroke = es.stroke || '#000';
      s.strokeWidth = es.strokeWidth || 2;
      s.name = instance.name + ' (unlinked)';
      newShapes.push(s);
    }
    const idx = shapes.findIndex(s => s.id === instanceId);
    if (idx >= 0) shapes.splice(idx, 1);
    for (const s of newShapes) shapes.push(s);
    selectedIds.clear();
    for (const s of newShapes) selectedIds.add(s.id);
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    updateDOFDisplay();
    renderLayers();
    renderConstraintList();
    renderComponentsList();
    render();
    scheduleSave();
    showToast('Instance unlinked into ' + newShapes.length + ' shape(s)', 'success');
  }

  function tryDeleteComponent(componentId) {
    const canvasInstances = getInstancesOfComponent(componentId);
    const referencingComps = getComponentsReferencing(componentId);
    if (canvasInstances.length > 0 || referencingComps.length > 0) {
      pendingComponentToDelete = componentId;
      const comp = getComponentById(componentId);
      let msg = `Component "<b>${comp ? comp.name : componentId}</b>" is in use. `;
      const parts = [];
      if (canvasInstances.length > 0) parts.push(`<b>${canvasInstances.length}</b> instance(s) on canvas`);
      if (referencingComps.length > 0) parts.push(`used by <b>${referencingComps.length}</b> other component(s)`);
      msg += parts.join(' and ') + '. Deleting it will unlink all nested references and remove canvas instances. Continue?';
      deleteComponentMessageEl.innerHTML = `<span>${msg}</span>`;
      deleteComponentDialogEl.classList.remove('hidden');
    } else {
      deleteComponent(componentId);
    }
  }

  function deleteComponent(componentId) {
    pushHistory();
    const referencingComps = getComponentsReferencing(componentId);
    for (const hostId of referencingComps) {
      const hostComp = getComponentById(hostId);
      if (!hostComp) continue;
      const instances = hostComp.shapes.filter(s => isComponentInstance(s) && s.componentId === componentId);
      for (const inst of instances) {
        unlinkInstanceInComponent(hostId, inst);
      }
    }
    const instances = getInstancesOfComponent(componentId);
    const instanceIds = instances.map(i => i.id);
    for (const id of instanceIds) {
      const idx = shapes.findIndex(s => s.id === id);
      if (idx >= 0) shapes.splice(idx, 1);
    }
    constraints = constraints.filter(c => {
      const refs = c.getReferencedPoints();
      for (const pid of refs) {
        const { shapeId } = parsePointId(pid);
        if (instanceIds.includes(shapeId)) return false;
      }
      return true;
    });
    delete components[componentId];
    if (editingComponentId === componentId) {
      editingComponentId = null;
      componentEditIndicatorEl.classList.add('hidden');
    } else if (editingComponentId !== null && referencingComps.includes(editingComponentId)) {
      const comp = getComponentById(editingComponentId);
      if (comp) {
        constraints = (comp.constraints || []).map(d => deserializeConstraint(d)).filter(Boolean);
      }
    }
    for (const id of instanceIds) {
      if (selectedIds.has(id)) selectedIds.delete(id);
    }
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    updateDOFDisplay();
    renderLayers();
    renderConstraintList();
    renderComponentsList();
    render();
    scheduleSave();
    showToast('Component deleted', 'success');
  }

  function closeDeleteComponentDialog() {
    deleteComponentDialogEl.classList.add('hidden');
    pendingComponentToDelete = null;
  }

  function openInstanceOverrideDialog(instanceId) {
    const instance = getShapeById(instanceId);
    if (!instance || !isComponentInstance(instance)) return;
    editingInstanceId = instanceId;
    tempOverrides = JSON.parse(JSON.stringify(instance.overrides || {}));
    if (!tempOverrides.children) tempOverrides.children = {};

    overrideFillColorEl.value = tempOverrides.fill || '#808080';
    overrideStrokeColorEl.value = tempOverrides.stroke || '#000000';

    while (instanceChildListEl.children.length > 1) {
      instanceChildListEl.removeChild(instanceChildListEl.lastChild);
    }

    const comp = getComponentById(instance.componentId);
    if (comp) {
      for (const child of comp.shapes) {
        if (isComponentInstance(child)) continue;
        const childId = child.localShapeId || child.id;
        const row = document.createElement('div');
        row.className = 'child-visibility-item';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !(tempOverrides.children[childId] && tempOverrides.children[childId].hidden);
        checkbox.dataset.childId = childId;
        checkbox.addEventListener('change', () => {
          const cid = parseInt(checkbox.dataset.childId, 10);
          if (!tempOverrides.children) tempOverrides.children = {};
          if (!checkbox.checked) {
            tempOverrides.children[cid] = tempOverrides.children[cid] || {};
            tempOverrides.children[cid].hidden = true;
          } else {
            if (tempOverrides.children[cid]) {
              delete tempOverrides.children[cid].hidden;
              if (Object.keys(tempOverrides.children[cid]).length === 0) {
                delete tempOverrides.children[cid];
              }
            }
          }
        });
        const label = document.createElement('span');
        label.textContent = child.name || ('Shape ' + childId);
        row.appendChild(checkbox);
        row.appendChild(label);
        instanceChildListEl.appendChild(row);
      }
    }

    instanceOverrideDialogEl.classList.remove('hidden');
  }

  function closeInstanceOverrideDialog() {
    instanceOverrideDialogEl.classList.add('hidden');
    editingInstanceId = null;
    tempOverrides = null;
  }

  function applyInstanceOverrides() {
    if (editingInstanceId === null) return;
    const instance = getShapeById(editingInstanceId);
    if (!instance) return;
    pushHistory();
    const overrides = tempOverrides || {};
    overrides.children = overrides.children || {};

    const checkboxes = instanceChildListEl.querySelectorAll('input[type="checkbox"]');
    for (const cb of checkboxes) {
      const childId = parseInt(cb.dataset.childId, 10);
      if (!cb.checked) {
        overrides.children[childId] = overrides.children[childId] || {};
        overrides.children[childId].hidden = true;
      } else {
        if (overrides.children[childId]) {
          delete overrides.children[childId].hidden;
          if (Object.keys(overrides.children[childId]).length === 0) {
            delete overrides.children[childId];
          }
        }
      }
    }

    if (!overrides.fill) delete overrides.fill;
    if (!overrides.stroke) delete overrides.stroke;
    if (overrides.children && Object.keys(overrides.children).length === 0) delete overrides.children;

    instance.overrides = overrides;
    closeInstanceOverrideDialog();
    renderLayers();
    render();
    scheduleSave();
    showToast('Overrides applied', 'success');
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
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  function renderConstraintList() {
    constraintListEl.innerHTML = '';
    if (constraints.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = 'No constraints yet. Enter Node Mode (N), then pick a constraint type.';
      constraintListEl.appendChild(empty);
      return;
    }
    for (let i = 0; i < constraints.length; i++) {
      const c = constraints[i];
      const item = document.createElement('div');
      item.className = 'constraint-item';
      if (selectedConstraintIdx === i) item.classList.add('selected');
      if (constraintSolver.conflictConstraints.has(i)) item.classList.add('conflict');
      const icon = document.createElement('div');
      icon.className = 'constraint-icon';
      icon.textContent = c.getLabel().length <= 2 ? c.getLabel() : '◆';
      const name = document.createElement('div');
      name.className = 'constraint-name';
      let typeName = c.type;
      switch (c.type) {
        case CONSTRAINT_TYPES.COINCIDENT: typeName = 'Coincident'; break;
        case CONSTRAINT_TYPES.POINT_ON_LINE: typeName = 'Point on Line'; break;
        case CONSTRAINT_TYPES.PARALLEL: typeName = 'Parallel'; break;
        case CONSTRAINT_TYPES.PERPENDICULAR: typeName = 'Perpendicular'; break;
        case CONSTRAINT_TYPES.EQUAL_LENGTH: typeName = 'Equal Length'; break;
        case CONSTRAINT_TYPES.FIXED_ANGLE: typeName = 'Angle ' + (c.paramRef || (c.angle.toFixed(0) + '°')); break;
        case CONSTRAINT_TYPES.DISTANCE: typeName = 'Dist ' + (c.paramRef || c.distance.toFixed(1)); break;
        case CONSTRAINT_TYPES.HORIZONTAL: typeName = 'Horizontal'; break;
        case CONSTRAINT_TYPES.VERTICAL: typeName = 'Vertical'; break;
      }
      name.textContent = typeName;
      name.title = c.getLabel();
      const delBtn = document.createElement('button');
      delBtn.className = 'constraint-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Delete constraint';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        constraints.splice(i, 1);
        selectedConstraintIdx = -1;
        rebuildSolverAndParams();
        initialSolve();
        updateDOFDisplay();
        renderConstraintList();
        render();
      });
      item.addEventListener('click', () => {
        selectedConstraintIdx = (selectedConstraintIdx === i) ? -1 : i;
        renderConstraintList();
        render();
      });
      item.addEventListener('dblclick', () => openConstraintEditDialog(i));
      item.appendChild(icon);
      item.appendChild(name);
      item.appendChild(delBtn);
      constraintListEl.appendChild(item);
    }
  }

  function renderParams() {
    paramsListEl.innerHTML = '';
    const paramNames = Object.keys(paramsData);
    if (paramNames.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      empty.textContent = 'No parameters. Click + above to add.';
      paramsListEl.appendChild(empty);
      return;
    }
    for (const name of paramNames) {
      const pd = paramsData[name];
      const item = document.createElement('div');
      item.className = 'param-item';
      const nameEl = document.createElement('div');
      nameEl.className = 'param-name';
      nameEl.textContent = name;
      nameEl.title = name;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'param-value' + (pd.expression ? ' expr' : '');
      input.value = pd.expression || pd.value.toString();
      input.title = pd.expression ? 'Expression' : 'Value (enter expression like 2*a+10)';
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      });
      input.addEventListener('blur', () => {
        const val = input.value.trim();
        if (val === '') return;
        pushHistory();
        if (/^[0-9.\-+eE]+$/.test(val)) {
          const num = parseFloat(val);
          if (!isNaN(num) && isFinite(num)) {
            pd.value = num;
            pd.expression = null;
            paramManager.setParam(name, num);
          }
        } else {
          try {
            pd.expression = val;
            paramManager.setExpression(name, val);
            pd.value = paramManager.getParam(name);
          } catch (e) {
            showToast('Invalid expression', 'error');
          }
        }
        updateSolverParams();
        initialSolve();
        updateDOFDisplay();
        renderParams();
        renderConstraintList();
        render();
      });
      const delBtn = document.createElement('button');
      delBtn.className = 'param-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Delete parameter';
      delBtn.addEventListener('click', () => {
        pushHistory();
        for (const c of constraints) {
          if (c.paramRef === name) c.paramRef = null;
        }
        delete paramsData[name];
        paramManager.removeParam(name);
        rebuildSolverAndParams();
        initialSolve();
        updateDOFDisplay();
        renderParams();
        renderConstraintList();
        render();
      });
      item.appendChild(nameEl);
      item.appendChild(input);
      item.appendChild(delBtn);
      paramsListEl.appendChild(item);
    }
  }

  function updateDOFDisplay() {
    const hasConstraints = constraints.length > 0;
    if (!hasConstraints) {
      dofValueEl.textContent = '-';
      dofValueEl.className = 'dof-value';
      dofHintEl.textContent = '(No constraints)';
    } else {
      const dof = constraintSolver.calculateDOF();
      dofValueEl.textContent = dof.toString();
      dofValueEl.className = 'dof-value ' + (dof > 0 ? 'positive' : (dof < 0 ? 'negative' : 'zero'));
      let hint = '';
      if (dof > 0) hint = '(Under-constrained)';
      else if (dof === 0) hint = '(Fully constrained)';
      else hint = '(Over-constrained!)';
      dofHintEl.textContent = hint;
    }
    if (constraintMode) {
      modeIndicatorEl.textContent = 'Adding: ' + constraintMode + ' (' + constraintSelection.length + ' sel)';
    } else {
      modeIndicatorEl.textContent = '';
    }
  }

  function openConstraintEditDialog(idx) {
    const c = constraints[idx];
    if (!c) return;
    editingConstraintIdx = idx;
    paramSelectEl.innerHTML = '<option value="">-- None --</option>';
    for (const name in paramsData) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name + ' = ' + paramsData[name].value.toFixed(2);
      paramSelectEl.appendChild(opt);
    }
    if (c.type === CONSTRAINT_TYPES.FIXED_ANGLE) {
      valueInputEl.value = c.angle;
      valueInputEl.step = 1;
      valueInputEl.disabled = false;
    } else if (c.type === CONSTRAINT_TYPES.DISTANCE) {
      valueInputEl.value = c.distance;
      valueInputEl.step = 0.1;
      valueInputEl.disabled = false;
    } else {
      valueInputEl.value = '';
      valueInputEl.disabled = true;
    }
    paramSelectEl.value = c.paramRef || '';
    paramSelectEl.disabled = (c.type !== CONSTRAINT_TYPES.FIXED_ANGLE && c.type !== CONSTRAINT_TYPES.DISTANCE);
    constraintDialogEl.classList.remove('hidden');
  }

  function closeConstraintEditDialog() {
    constraintDialogEl.classList.add('hidden');
    editingConstraintIdx = -1;
  }

  function applyConstraintEdit() {
    if (editingConstraintIdx < 0 || editingConstraintIdx >= constraints.length) return;
    const c = constraints[editingConstraintIdx];
    pushHistory();
    const val = parseFloat(valueInputEl.value);
    const param = paramSelectEl.value;
    if (c.type === CONSTRAINT_TYPES.FIXED_ANGLE) {
      if (!isNaN(val)) c.angle = val;
      c.paramRef = param || null;
    } else if (c.type === CONSTRAINT_TYPES.DISTANCE) {
      if (!isNaN(val)) c.distance = val;
      c.paramRef = param || null;
    }
    rebuildSolverAndParams();
    initialSolve();
    updateDOFDisplay();
    renderConstraintList();
    render();
    closeConstraintEditDialog();
  }

  function addParam() {
    const existingCount = Object.keys(paramsData).length;
    let name = 'p' + (existingCount + 1);
    let counter = 1;
    while (paramsData[name]) {
      name = 'p' + (existingCount + 1 + counter);
      counter++;
    }
    pushHistory();
    paramsData[name] = { value: 100, expression: null };
    paramManager.addParam(name, 100);
    rebuildSolverAndParams();
    renderParams();
    updateDOFDisplay();
    showToast('Parameter ' + name + ' created', 'success');
  }

  function clearAllConstraints() {
    if (constraints.length === 0) return;
    pushHistory();
    constraints = [];
    selectedConstraintIdx = -1;
    constraintMode = null;
    constraintSelection = [];
    rebuildSolverAndParams();
    updateDOFDisplay();
    renderConstraintList();
    render();
    showToast('All constraints cleared');
  }

  function canAddConstraint(type) {
    const n = constraintSelection.length;
    switch (type) {
      case CONSTRAINT_TYPES.COINCIDENT:
        return n === 2 && constraintSelection.every(s => s.type === 'vertex');
      case CONSTRAINT_TYPES.POINT_ON_LINE:
        return n === 2 &&
          ((constraintSelection[0].type === 'vertex' && constraintSelection[1].type === 'edge') ||
           (constraintSelection[1].type === 'vertex' && constraintSelection[0].type === 'edge'));
      case CONSTRAINT_TYPES.PARALLEL:
      case CONSTRAINT_TYPES.PERPENDICULAR:
      case CONSTRAINT_TYPES.EQUAL_LENGTH:
        return n === 2 && constraintSelection.every(s => s.type === 'edge');
      case CONSTRAINT_TYPES.FIXED_ANGLE:
        return n === 1 && constraintSelection[0].type === 'edge';
      case CONSTRAINT_TYPES.DISTANCE:
      case CONSTRAINT_TYPES.HORIZONTAL:
      case CONSTRAINT_TYPES.VERTICAL:
        return n === 2 && constraintSelection.every(s => s.type === 'vertex');
      default: return false;
    }
  }

  function createConstraintByType(type) {
    if (!canAddConstraint(type)) return null;
    switch (type) {
      case CONSTRAINT_TYPES.COINCIDENT: {
        const pidA = getVertexPointId(constraintSelection[0].data);
        const pidB = getVertexPointId(constraintSelection[1].data);
        return new CoincidentConstraint(pidA, pidB);
      }
      case CONSTRAINT_TYPES.POINT_ON_LINE: {
        const pointSel = constraintSelection.find(s => s.type === 'vertex');
        const edgeSel = constraintSelection.find(s => s.type === 'edge');
        const pid = getVertexPointId(pointSel.data);
        const eids = getEdgePointIds(edgeSel.data);
        return new PointOnLineConstraint(pid, eids.start, eids.end);
      }
      case CONSTRAINT_TYPES.PARALLEL: {
        const e1 = getEdgePointIds(constraintSelection[0].data);
        const e2 = getEdgePointIds(constraintSelection[1].data);
        return new ParallelConstraint(e1.start, e1.end, e2.start, e2.end);
      }
      case CONSTRAINT_TYPES.PERPENDICULAR: {
        const e1 = getEdgePointIds(constraintSelection[0].data);
        const e2 = getEdgePointIds(constraintSelection[1].data);
        return new PerpendicularConstraint(e1.start, e1.end, e2.start, e2.end);
      }
      case CONSTRAINT_TYPES.EQUAL_LENGTH: {
        const e1 = getEdgePointIds(constraintSelection[0].data);
        const e2 = getEdgePointIds(constraintSelection[1].data);
        return new EqualLengthConstraint(e1.start, e1.end, e2.start, e2.end);
      }
      case CONSTRAINT_TYPES.FIXED_ANGLE: {
        const e = getEdgePointIds(constraintSelection[0].data);
        const pts = constraintSelection[0].data.isHole ?
          worldHolesOf(constraintSelection[0].data.shape)[constraintSelection[0].data.holeIndex] :
          worldPointsOf(constraintSelection[0].data.shape);
        const a = pts[constraintSelection[0].data.edgeIndex];
        const b = pts[(constraintSelection[0].data.edgeIndex + 1) % pts.length];
        const ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        return new FixedAngleConstraint(e.start, e.end, ang);
      }
      case CONSTRAINT_TYPES.DISTANCE: {
        const pidA = getVertexPointId(constraintSelection[0].data);
        const pidB = getVertexPointId(constraintSelection[1].data);
        const pts0 = constraintSelection[0].data.isHole ?
          worldHolesOf(constraintSelection[0].data.shape)[constraintSelection[0].data.holeIndex] :
          worldPointsOf(constraintSelection[0].data.shape);
        const pts1 = constraintSelection[1].data.isHole ?
          worldHolesOf(constraintSelection[1].data.shape)[constraintSelection[1].data.holeIndex] :
          worldPointsOf(constraintSelection[1].data.shape);
        const a = pts0[constraintSelection[0].data.pointIndex];
        const b = pts1[constraintSelection[1].data.pointIndex];
        const d = dist(a, b);
        return new DistanceConstraint(pidA, pidB, d);
      }
      case CONSTRAINT_TYPES.HORIZONTAL: {
        const pidA = getVertexPointId(constraintSelection[0].data);
        const pidB = getVertexPointId(constraintSelection[1].data);
        return new HorizontalConstraint(pidA, pidB);
      }
      case CONSTRAINT_TYPES.VERTICAL: {
        const pidA = getVertexPointId(constraintSelection[0].data);
        const pidB = getVertexPointId(constraintSelection[1].data);
        return new VerticalConstraint(pidA, pidB);
      }
      default: return null;
    }
  }

  function tryAddConstraint(type) {
    const c = createConstraintByType(type);
    if (!c) { showToast('Select required elements first', 'warning'); return; }
    const testConstraints = constraints.concat([c]);
    const testSolver = new ConstraintSolver();
    for (const tc of testConstraints) testSolver.addConstraint(tc);
    const testDof = testSolver.calculateDOF();
    if (testDof < 0) {
      showToast('Over-constrained! DOF would be ' + testDof, 'error');
      return;
    }
    pushHistory();
    constraints.push(c);
    rebuildSolverAndParams();
    initialSolve();
    constraintSelection = [];
    constraintMode = null;
    selectedConstraintIdx = constraints.length - 1;
    updateDOFDisplay();
    renderConstraintList();
    render();
    showToast('Added: ' + type, 'success');
  }

  function startConstraintMode(type) {
    constraintMode = type;
    constraintSelection = [];
    isNodeEditMode = true;
    selectedVertex = null;
    selectedConstraintIdx = -1;
    updateToolbar();
    updateDOFDisplay();
    render();
    showToast('Select elements for ' + type + ' (Esc to cancel)');
  }

  function checkConstraintAutoComplete() {
    if (!constraintMode) return;
    if (canAddConstraint(constraintMode)) {
      tryAddConstraint(constraintMode);
    }
  }

  function toggleConstraintSelection(world) {
    if (!constraintMode) return;
    const vHit = hitTestVertex(world.x, world.y);
    if (vHit) {
      const idx = constraintSelection.findIndex(s =>
        s.type === 'vertex' &&
        s.data.shape.id === vHit.shape.id &&
        s.data.isHole === vHit.isHole &&
        s.data.holeIndex === vHit.holeIndex &&
        s.data.pointIndex === vHit.pointIndex
      );
      if (idx >= 0) constraintSelection.splice(idx, 1);
      else constraintSelection.push({ type: 'vertex', data: vHit });
      checkConstraintAutoComplete();
      render();
      updateDOFDisplay();
      return;
    }
    const eHit = hitTestEdge(world.x, world.y);
    if (eHit) {
      const idx = constraintSelection.findIndex(s =>
        s.type === 'edge' &&
        s.data.shape.id === eHit.shape.id &&
        s.data.isHole === eHit.isHole &&
        s.data.holeIndex === eHit.holeIndex &&
        s.data.edgeIndex === eHit.edgeIndex
      );
      if (idx >= 0) constraintSelection.splice(idx, 1);
      else constraintSelection.push({ type: 'edge', data: eHit });
      checkConstraintAutoComplete();
      render();
      updateDOFDisplay();
      return;
    }
  }

  function setShapeWorldPointsAndHoles(shape, newPts, newHoles) {
    shape.points = newPts.map(p => ({ ...p }));
    if (newHoles) shape.holes = newHoles.map(h => h.map(p => ({ ...p })));
    shape.transform = { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
  }

  function translatePoints(points, dx, dy) {
    return points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  }

  function updateToolbar() {
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.remove('active');
      b.classList.remove('measure-active');
    });
    if (currentTool && currentTool.startsWith('dim-') || currentTool === 'measure') {
    } else {
      const btnId = 'tool-' + currentTool;
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.add('active');
    }
    const dimTools = ['dim-distance', 'dim-angle', 'dim-radius'];
    if (dimTools.includes(currentTool)) {
      const btn = document.getElementById('tool-' + currentTool);
      if (btn) btn.classList.add('active');
    }
    if (currentTool === 'measure' || dimensionSystem.measureMode) {
      const btn = document.getElementById('tool-measure');
      if (btn) btn.classList.add('measure-active');
    }
    document.querySelectorAll('.op-btn').forEach(b => {
      b.disabled = selectedIds.size < 2;
    });

    const selectedShapes = getSelectedShapes();
    const canCreateMask = selectedShapes.length === 2 && !selectedShapes.some(s => isMaskShape(s));
    const hasMaskSelection = selectedShapes.some(s => isMaskShape(s));
    
    const maskClipBtn = document.getElementById('mask-clip');
    const maskAlphaBtn = document.getElementById('mask-alpha');
    const maskReleaseBtn = document.getElementById('mask-release');
    
    if (maskClipBtn) maskClipBtn.disabled = !canCreateMask;
    if (maskAlphaBtn) maskAlphaBtn.disabled = !canCreateMask;
    if (maskReleaseBtn) maskReleaseBtn.disabled = !hasMaskSelection;
    const alignDisabled = selectedIds.size < 2;
    document.querySelectorAll('.align-btn').forEach(b => {
      b.disabled = alignDisabled;
    });
    document.getElementById('distribute-h').disabled = selectedIds.size < 3;
    document.getElementById('distribute-v').disabled = selectedIds.size < 3;
    if (isNodeEditMode) {
      nodeEditIndicatorEl.classList.remove('hidden');
    } else {
      nodeEditIndicatorEl.classList.add('hidden');
    }

    if (dimensionSystem.measureMode) {
      modeIndicatorEl.classList.add('measure-mode');
      modeIndicatorEl.textContent = 'MEASURE MODE';
    } else if (currentTool.startsWith('dim-')) {
      const dimNames = {
        'dim-distance': 'DISTANCE DIM',
        'dim-angle': 'ANGLE DIM',
        'dim-radius': 'RADIUS DIM'
      };
      modeIndicatorEl.textContent = dimNames[currentTool] || 'DIM MODE';
      modeIndicatorEl.style.background = '#e3f2fd';
      modeIndicatorEl.style.color = '#1565c0';
    } else {
      modeIndicatorEl.classList.remove('measure-mode');
      modeIndicatorEl.textContent = '';
      modeIndicatorEl.style.background = '';
      modeIndicatorEl.style.color = '';
    }
  }

  function updateTextPanel() {
    const panel = document.getElementById('text-panel');
    if (!panel) return;

    const selectedShapes = getSelectedShapes();
    const textShapes = selectedShapes.filter(s => isTextShape(s));
    const hasTextSelection = textShapes.length > 0;
    const isTextTool = currentTool === 'text';

    if (isTextTool || hasTextSelection) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }

    if (hasTextSelection) {
      const firstText = textShapes[0];
      document.getElementById('text-input').value = firstText.textData.text;
      document.getElementById('text-size').value = firstText.textData.fontSize;
      document.getElementById('text-weight').value = firstText.textData.fontWeight;
      document.getElementById('text-weight-value').textContent = firstText.textData.fontWeight;
      document.getElementById('text-spacing').value = firstText.textData.letterSpacing;
    } else {
      document.getElementById('text-input').value = textSettings.text;
      document.getElementById('text-size').value = textSettings.fontSize;
      document.getElementById('text-weight').value = textSettings.fontWeight;
      document.getElementById('text-weight-value').textContent = textSettings.fontWeight;
      document.getElementById('text-spacing').value = textSettings.letterSpacing;
    }
  }

  function updateDimensionPanel() {
    const panel = document.getElementById('dimension-panel');
    if (!panel) return;

    const s = dimensionSystem.settings;
    document.getElementById('dim-unit').value = s.unit;
    document.getElementById('dim-scale').value = s.scaleFactor;
    document.getElementById('dim-precision').value = s.precision;
    document.getElementById('dim-textsize').value = s.textSize;
    document.getElementById('dim-textcolor').value = s.textColor;
    document.getElementById('dim-linecolor').value = s.lineColor;
    document.getElementById('dim-linewidth').value = s.lineWidth;
    document.getElementById('dim-offset').value = s.offset;
    document.getElementById('dim-arrowsize').value = s.arrowSize;
    document.getElementById('dim-showunits').checked = s.showUnits;

    renderDimensionList();
  }

  function renderDimensionList() {
    const listEl = document.getElementById('dimension-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (dimensionSystem.dimensions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-dimensions';
      empty.textContent = 'No dimensions yet';
      listEl.appendChild(empty);
      return;
    }

    const dimIcons = {
      [DIM_TYPES.DISTANCE_TWO_POINTS]: 'D',
      [DIM_TYPES.DISTANCE_EDGE]: 'D',
      [DIM_TYPES.ANGLE_TWO_EDGES]: '∠',
      [DIM_TYPES.RADIUS_ARC]: 'R'
    };

    for (const dim of dimensionSystem.dimensions) {
      const item = document.createElement('div');
      item.className = 'dimension-item';
      if (selectedDimensionId === dim.id) item.classList.add('selected');
      item.dataset.id = dim.id;

      const icon = document.createElement('div');
      icon.className = 'dimension-type-icon';
      icon.textContent = dimIcons[dim.type] || '?';
      item.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'dimension-info';
      let label = '';
      if (dim.type === DIM_TYPES.DISTANCE_TWO_POINTS || dim.type === DIM_TYPES.DISTANCE_EDGE) {
        const len = Math.hypot(dim.pointB.x - dim.pointA.x, dim.pointB.y - dim.pointA.y);
        label = dimensionSystem.formatValue(len);
      } else if (dim.type === DIM_TYPES.ANGLE_TWO_EDGES) {
        const deg = (dim.angle * 180 / Math.PI);
        const display = deg > 180 ? 360 - deg : deg;
        label = Number(display.toFixed(dimensionSystem.settings.precision)) + '°';
      } else if (dim.type === DIM_TYPES.RADIUS_ARC) {
        label = 'R' + dimensionSystem.formatValue(dim.radius);
      }
      info.textContent = label;
      info.title = 'Type: ' + dim.type + ', ID: ' + dim.id;
      item.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.className = 'dimension-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Delete dimension';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory();
        dimensionSystem.removeDimension(dim.id);
        if (selectedDimensionId === dim.id) selectedDimensionId = null;
        updateDimensionPanel();
        render();
        scheduleSave();
        showToast('Dimension deleted', 'success');
      });
      item.appendChild(delBtn);

      item.addEventListener('click', () => {
        selectedDimensionId = (selectedDimensionId === dim.id) ? null : dim.id;
        renderDimensionList();
        render();
      });

      listEl.appendChild(item);
    }
  }

  function getShapePointsById(shapeId, isHole, holeIndex) {
    const s = getShapeById(shapeId);
    if (!s) return null;
    if (isHole) {
      const holes = worldHolesOf(s);
      return holes[holeIndex] || null;
    }
    return worldPointsOf(s);
  }

  function handleDimToolClick(wx, wy) {
    const vertex = hitTestVertex(wx, wy);
    const edge = hitTestEdge(wx, wy);

    if (dimToolType === 'dim-distance') {
      if (vertex) {
        dimToolSelection.push({ type: 'vertex', data: vertex });
        showToast('Point ' + dimToolSelection.length + '/2 selected');
        if (dimToolSelection.length >= 2) {
          createDistanceFromVertices(dimToolSelection[0].data, dimToolSelection[1].data);
          dimToolSelection = [];
        }
      } else if (edge) {
        createDistanceFromEdge(edge);
        dimToolSelection = [];
      } else {
        showToast('Click a point or edge', 'warning');
      }
    } else if (dimToolType === 'dim-angle') {
      if (edge) {
        dimToolSelection.push({ type: 'edge', data: edge });
        showToast('Edge ' + dimToolSelection.length + '/2 selected');
        if (dimToolSelection.length >= 2) {
          createAngleFromEdges(dimToolSelection[0].data, dimToolSelection[1].data);
          dimToolSelection = [];
        }
      } else if (vertex) {
        showToast('For angle, click two edges sharing a vertex', 'warning');
      } else {
        showToast('Click two edges that share a vertex', 'warning');
      }
    } else if (dimToolType === 'dim-radius') {
      if (edge && edge.shape) {
        createRadiusFromShape(edge);
        dimToolSelection = [];
      } else {
        showToast('Click on a circle or arc edge', 'warning');
      }
    }
    render();
  }

  function createDistanceFromVertices(v1, v2) {
    pushHistory();
    const pts1 = getShapePointsById(v1.shape.id, v1.isHole, v1.holeIndex);
    const pts2 = getShapePointsById(v2.shape.id, v2.isHole, v2.holeIndex);
    if (!pts1 || !pts2) { showToast('Invalid points', 'error'); return; }
    const p1 = pts1[v1.pointIndex];
    const p2 = pts2[v2.pointIndex];
    if (!p1 || !p2) { showToast('Invalid points', 'error'); return; }
    const shapeIds = [v1.shape.id, v2.shape.id].filter((v, i, a) => a.indexOf(v) === i);
    dimensionSystem.addDistanceTwoPoints(p1, p2, shapeIds, 0);
    updateDimensionPanel();
    render();
    scheduleSave();
    showToast('Distance dimension added', 'success');
  }

  function createDistanceFromEdge(edgeInfo) {
    pushHistory();
    const pts = getShapePointsById(edgeInfo.shape.id, edgeInfo.isHole, edgeInfo.holeIndex);
    if (!pts) { showToast('Invalid edge', 'error'); return; }
    dimensionSystem.addDistanceEdge(
      edgeInfo.shape.id,
      edgeInfo.isHole,
      edgeInfo.holeIndex,
      edgeInfo.edgeIndex,
      pts
    );
    updateDimensionPanel();
    render();
    scheduleSave();
    showToast('Edge dimension added', 'success');
  }

  function createAngleFromEdges(e1, e2) {
    pushHistory();
    const pts1 = getShapePointsById(e1.shape.id, e1.isHole, e1.holeIndex);
    const pts2 = getShapePointsById(e2.shape.id, e2.isHole, e2.holeIndex);
    if (!pts1 || !pts2) { showToast('Invalid edges', 'error'); return; }
    const n1 = pts1.length, n2 = pts2.length;
    const a1 = pts1[e1.edgeIndex], b1 = pts1[(e1.edgeIndex + 1) % n1];
    const a2 = pts2[e2.edgeIndex], b2 = pts2[(e2.edgeIndex + 1) % n2];

    function pEq(p, q) { return Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5; }
    let vertex = null;
    if (pEq(a1, a2) || pEq(a1, b2)) vertex = a1;
    else if (pEq(b1, a2) || pEq(b1, b2)) vertex = b1;

    if (!vertex) {
      showToast('Edges must share a vertex', 'error');
      return;
    }
    const edgeInfo1 = {
      shapeId: e1.shape.id, isHole: e1.isHole, holeIndex: e1.holeIndex, edgeIndex: e1.edgeIndex
    };
    const edgeInfo2 = {
      shapeId: e2.shape.id, isHole: e2.isHole, holeIndex: e2.holeIndex, edgeIndex: e2.edgeIndex
    };
    dimensionSystem.addAngleTwoEdges(edgeInfo1, edgeInfo2, vertex, pts1, pts2);
    updateDimensionPanel();
    render();
    scheduleSave();
    showToast('Angle dimension added', 'success');
  }

  function createRadiusFromShape(edgeInfo) {
    pushHistory();
    const s = edgeInfo.shape;
    const pts = getShapePointsById(s.id, edgeInfo.isHole, edgeInfo.holeIndex);
    if (!pts || pts.length < 3) { showToast('Need at least 3 points', 'error'); return; }

    const startIdx = Math.max(0, edgeInfo.edgeIndex - 1);
    const arcPoints = [];
    for (let i = 0; i < Math.min(pts.length, 8); i++) {
      arcPoints.push(pts[(startIdx + i) % pts.length]);
    }
    if (arcPoints.length < 3) { showToast('Arc too small', 'error'); return; }

    const result = dimensionSystem.addRadiusArc(
      s.id, edgeInfo.isHole, edgeInfo.holeIndex,
      startIdx, arcPoints
    );
    if (!result) {
      showToast('Could not fit circle to points', 'error');
      return;
    }
    updateDimensionPanel();
    render();
    scheduleSave();
    showToast('Radius dimension added', 'success');
  }

  function handleMeasureClick(wx, wy) {
    const vertex = hitTestVertex(wx, wy);
    const edge = hitTestEdge(wx, wy);

    if (keys.shift && edge) {
      dimensionSystem.measureSelectedEdges.push({
        shapeId: edge.shape.id,
        isHole: edge.isHole,
        holeIndex: edge.holeIndex,
        edgeIndex: edge.edgeIndex
      });
      if (dimensionSystem.measureSelectedEdges.length >= 2) {
        setTimeout(() => {
          dimensionSystem.measureSelectedEdges = [];
          render();
        }, 3000);
      }
      showToast('Edge ' + dimensionSystem.measureSelectedEdges.length + '/2 selected');
    } else if (vertex) {
      dimensionSystem.measureSelectedPoints.push({ x: wx, y: wy });
      if (dimensionSystem.measureSelectedPoints.length >= 2) {
        setTimeout(() => {
          dimensionSystem.measureSelectedPoints = [];
          render();
        }, 3000);
      }
      showToast('Point ' + dimensionSystem.measureSelectedPoints.length + '/2 selected');
    } else {
      dimensionSystem.measureSelectedPoints = [];
      dimensionSystem.measureSelectedEdges = [];
      showToast('Measure cleared');
    }
    render();
  }

  function updateMotionPathPanel() {
    const panel = document.getElementById('motion-path-panel');
    if (!panel) return;

    const selectedShapes = getSelectedShapes();
    const pathShapes = selectedShapes.filter(s => s.type === 'motion-path');
    const nonPathShapes = selectedShapes.filter(s => s.type !== 'motion-path' && !isComponentInstance(s));

    if (pathShapes.length === 0 && nonPathShapes.length === 0) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const bindSection = document.getElementById('mp-bind-section');
    const pathSection = document.getElementById('mp-path-section');

    if (nonPathShapes.length > 0) {
      bindSection.classList.remove('hidden');
      const target = nonPathShapes[0];
      const existingBinding = motionPathManager.getBinding(target.id);

      const pathSelect = document.getElementById('mp-path-select');
      const allPaths = shapes.filter(s => s.type === 'motion-path');
      pathSelect.innerHTML = '<option value="">-- 选择运动轨迹 --</option>';
      for (const ps of allPaths) {
        const opt = document.createElement('option');
        opt.value = ps.id;
        opt.textContent = ps.name || ('Path ' + ps.id);
        if (existingBinding && existingBinding.pathShapeId === ps.id) {
          opt.selected = true;
        }
        pathSelect.appendChild(opt);
      }

      document.getElementById('mp-offset').value = existingBinding ? Math.round(existingBinding.startOffset * 100) : 0;
      document.getElementById('mp-offset-value').textContent = (existingBinding ? Math.round(existingBinding.startOffset * 100) : 0) + '%';
      document.getElementById('mp-orient').checked = existingBinding ? existingBinding.autoOrient : false;
      document.getElementById('mp-loop').value = existingBinding ? existingBinding.loopMode : 'loop';
    } else {
      bindSection.classList.add('hidden');
    }

    if (pathShapes.length > 0) {
      pathSection.classList.remove('hidden');
      const pathShape = pathShapes[0];
      selectedPathShapeIdForBinding = pathShape.id;
      const speedListEl = document.getElementById('mp-speed-list');
      speedListEl.innerHTML = '';
      const kfs = pathShape.motionPathData && pathShape.motionPathData.speedKeyframes
        ? [...pathShape.motionPathData.speedKeyframes].sort((a, b) => a.pathT - b.pathT)
        : [{ pathT: 0, speedFactor: 1 }, { pathT: 1, speedFactor: 1 }];
      for (let i = 0; i < kfs.length; i++) {
        const kf = kfs[i];
        const item = document.createElement('div');
        item.className = 'speed-kf-item';
        item.innerHTML = `
          <span class="kf-label">T${i}</span>
          <input type="number" min="0" max="1" step="0.01" value="${kf.pathT}" class="kf-t" style="width:60px">
          <input type="number" min="0.1" max="10" step="0.1" value="${kf.speedFactor}" class="kf-s" style="width:60px">
          <button class="kf-del" ${kfs.length <= 2 ? 'disabled' : ''} style="padding:2px 6px">×</button>
        `;
        speedListEl.appendChild(item);
        item.querySelector('.kf-t').addEventListener('change', (e) => {
          pushHistory();
          kf.pathT = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
          updateMotionPathPanel();
        });
        item.querySelector('.kf-s').addEventListener('change', (e) => {
          pushHistory();
          kf.speedFactor = Math.max(0.1, parseFloat(e.target.value) || 1);
          motionPathManager.invalidatePathCache(pathShape.id);
        });
        item.querySelector('.kf-del').addEventListener('click', () => {
          if (kfs.length <= 2) return;
          pushHistory();
          kfs.splice(i, 1);
          pathShape.motionPathData.speedKeyframes = kfs;
          motionPathManager.invalidatePathCache(pathShape.id);
          updateMotionPathPanel();
        });
      }
    } else {
      pathSection.classList.add('hidden');
    }
  }

  function getShapesBounds(shapeList) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapeList) {
      const pts = worldPointsOf(s);
      const b = getBounds(pts);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    return { minX, minY, maxX, maxY };
  }

  function alignShapes(alignment) {
    const sel = getSelectedShapes();
    if (sel.length < 2) return;

    pushHistory();

    const bounds = getShapesBounds(sel);
    const extraFixed = {};

    for (const s of sel) {
      const pts = worldPointsOf(s);
      const sb = getBounds(pts);
      let dx = 0, dy = 0;

      switch (alignment) {
        case 'left':
          dx = bounds.minX - sb.minX;
          break;
        case 'center':
          dx = (bounds.minX + bounds.maxX) / 2 - (sb.minX + sb.maxX) / 2;
          break;
        case 'right':
          dx = bounds.maxX - sb.maxX;
          break;
        case 'top':
          dy = bounds.minY - sb.minY;
          break;
        case 'middle':
          dy = (bounds.minY + bounds.maxY) / 2 - (sb.minY + sb.maxY) / 2;
          break;
        case 'bottom':
          dy = bounds.maxY - sb.maxY;
          break;
      }

      const newPts = pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
      for (let i = 0; i < newPts.length; i++) {
        const pid = makePointId(s.id, false, -1, i);
        extraFixed[pid + '_x'] = newPts[i].x;
        extraFixed[pid + '_y'] = newPts[i].y;
      }

      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        const newHole = hole.map(p => ({ x: p.x + dx, y: p.y + dy }));
        for (let i = 0; i < newHole.length; i++) {
          const pid = makePointId(s.id, true, h, i);
          extraFixed[pid + '_x'] = newHole[i].x;
          extraFixed[pid + '_y'] = newHole[i].y;
        }
      }
    }

    const fixedPoints = new Set();
    runSolver(fixedPoints, extraFixed, 100);
    rebuildSolverAndParams();
    initialSolve();
    updateDOFDisplay();
    renderLayers();
    render();
    showToast('Aligned: ' + alignment, 'success');
  }

  function distributeShapes(direction) {
    const sel = getSelectedShapes();
    if (sel.length < 3) return;

    pushHistory();

    const withBounds = sel.map(s => {
      const pts = worldPointsOf(s);
      const b = getBounds(pts);
      return {
        shape: s,
        bounds: b,
        centerX: (b.minX + b.maxX) / 2,
        centerY: (b.minY + b.maxY) / 2,
        left: b.minX,
        right: b.maxX,
        top: b.minY,
        bottom: b.maxY
      };
    });

    let sorted;
    if (direction === 'horizontal') {
      sorted = withBounds.slice().sort((a, b) => a.centerX - b.centerX);
      const totalSpan = sorted[sorted.length - 1].right - sorted[0].left;
      const totalWidth = sorted.reduce((sum, item) => sum + (item.right - item.left), 0);
      const gap = (totalSpan - totalWidth) / (sorted.length - 1);

      let currentX = sorted[0].left;
      for (const item of sorted) {
        const dx = currentX - item.left;
        item.offsetX = dx;
        item.offsetY = 0;
        currentX = item.right + dx + gap;
      }
    } else {
      sorted = withBounds.slice().sort((a, b) => a.centerY - b.centerY);
      const totalSpan = sorted[sorted.length - 1].bottom - sorted[0].top;
      const totalHeight = sorted.reduce((sum, item) => sum + (item.bottom - item.top), 0);
      const gap = (totalSpan - totalHeight) / (sorted.length - 1);

      let currentY = sorted[0].top;
      for (const item of sorted) {
        const dy = currentY - item.top;
        item.offsetX = 0;
        item.offsetY = dy;
        currentY = item.bottom + dy + gap;
      }
    }

    const extraFixed = {};
    for (const item of sorted) {
      const s = item.shape;
      const pts = worldPointsOf(s);
      const newPts = pts.map(p => ({ x: p.x + item.offsetX, y: p.y + item.offsetY }));
      for (let i = 0; i < newPts.length; i++) {
        const pid = makePointId(s.id, false, -1, i);
        extraFixed[pid + '_x'] = newPts[i].x;
        extraFixed[pid + '_y'] = newPts[i].y;
      }

      const holes = worldHolesOf(s);
      for (let h = 0; h < holes.length; h++) {
        const hole = holes[h];
        const newHole = hole.map(p => ({ x: p.x + item.offsetX, y: p.y + item.offsetY }));
        for (let i = 0; i < newHole.length; i++) {
          const pid = makePointId(s.id, true, h, i);
          extraFixed[pid + '_x'] = newHole[i].x;
          extraFixed[pid + '_y'] = newHole[i].y;
        }
      }
    }

    const fixedPoints = new Set();
    runSolver(fixedPoints, extraFixed, 100);
    rebuildSolverAndParams();
    initialSolve();
    updateDOFDisplay();
    renderLayers();
    render();
    showToast('Distributed: ' + direction, 'success');
  }

  function collectSnapTargets(excludeIds) {
    const targets = {
      vertices: [],
      edges: [],
      centers: [],
      midpoints: []
    };

    for (const s of shapes) {
      if (!s.visible || s.locked) continue;
      if (excludeIds && excludeIds.has(s.id)) continue;

      const pts = worldPointsOf(s);
      const b = getBounds(pts);
      const ctr = boundsCenter(b);

      targets.centers.push({ x: ctr.x, y: ctr.y, shapeId: s.id, type: 'center' });

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        targets.vertices.push({ x: p.x, y: p.y, shapeId: s.id, type: 'vertex' });
      }

      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const bPt = pts[(i + 1) % pts.length];
        targets.edges.push({ a, b: bPt, shapeId: s.id });
        targets.midpoints.push({
          x: (a.x + bPt.x) / 2,
          y: (a.y + bPt.y) / 2,
          shapeId: s.id,
          type: 'midpoint'
        });
      }

      const holes = worldHolesOf(s);
      for (const hole of holes) {
        for (let i = 0; i < hole.length; i++) {
          const p = hole[i];
          targets.vertices.push({ x: p.x, y: p.y, shapeId: s.id, type: 'vertex', isHole: true });
        }
        for (let i = 0; i < hole.length; i++) {
          const a = hole[i];
          const bPt = hole[(i + 1) % hole.length];
          targets.edges.push({ a, b: bPt, shapeId: s.id, isHole: true });
          targets.midpoints.push({
            x: (a.x + bPt.x) / 2,
            y: (a.y + bPt.y) / 2,
            shapeId: s.id,
            type: 'midpoint',
            isHole: true
          });
        }
      }
    }

    return targets;
  }

  function snapToGrid(x, y) {
    const threshold = SNAP_THRESHOLD / viewport.scale;
    const gridX = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.round(y / GRID_SIZE) * GRID_SIZE;
    let snapped = { x, y, snapped: false, lines: [] };

    if (Math.abs(x - gridX) < threshold) {
      snapped.x = gridX;
      snapped.snapped = true;
      snapped.lines.push({ type: 'vertical', x: gridX, kind: 'grid' });
    }
    if (Math.abs(y - gridY) < threshold) {
      snapped.y = gridY;
      snapped.snapped = true;
      snapped.lines.push({ type: 'horizontal', y: gridY, kind: 'grid' });
    }

    return snapped;
  }

  function computeSnap(point, excludeIds, isDragging) {
    snapInfo = { active: false, lines: [], distances: [] };
    if (!snapEnabled || keys.alt) return { x: point.x, y: point.y };

    const threshold = SNAP_THRESHOLD / viewport.scale;
    let bestX = point.x, bestY = point.y;
    let bestDistX = Infinity, bestDistY = Infinity;
    const lines = [];
    const distances = [];

    const gridSnap = snapToGrid(point.x, point.y);
    if (gridSnap.snapped) {
      if (gridSnap.lines.some(l => l.type === 'vertical')) {
        bestX = gridSnap.x;
        bestDistX = Math.abs(point.x - gridSnap.x);
      }
      if (gridSnap.lines.some(l => l.type === 'horizontal')) {
        bestY = gridSnap.y;
        bestDistY = Math.abs(point.y - gridSnap.y);
      }
      lines.push(...gridSnap.lines);
    }

    if (guideSystem && guideSystem.snapToGuides) {
      const guideSnap = guideSystem.snapPointToGuides(point);
      if (guideSnap.snapped) {
        if (guideSnap.x !== point.x) {
          const dx = Math.abs(point.x - guideSnap.x);
          if (dx < bestDistX) {
            bestX = guideSnap.x;
            bestDistX = dx;
          }
        }
        if (guideSnap.y !== point.y) {
          const dy = Math.abs(point.y - guideSnap.y);
          if (dy < bestDistY) {
            bestY = guideSnap.y;
            bestDistY = dy;
          }
        }
        const guideLines = guideSystem.getGuideLines();
        for (const gl of guideLines) {
          if (gl.type === 'vertical' && Math.abs(gl.x - bestX) < 0.001) {
            lines.push(gl);
          }
          if (gl.type === 'horizontal' && Math.abs(gl.y - bestY) < 0.001) {
            lines.push(gl);
          }
        }
      }
    }

    const targets = collectSnapTargets(excludeIds);

    const candidates = [
      ...targets.vertices,
      ...targets.midpoints,
      ...targets.centers
    ];

    for (const target of candidates) {
      const dx = Math.abs(point.x - target.x);
      const dy = Math.abs(point.y - target.y);

      if (dx < threshold && dx < bestDistX) {
        bestX = target.x;
        bestDistX = dx;
        lines.push({ type: 'vertical', x: target.x, kind: target.type, target });
        if (dx > 0.1) distances.push({ type: 'vertical', x1: point.x, x2: target.x, y: point.y, value: Math.abs(target.x - point.x) });
      }
      if (dy < threshold && dy < bestDistY) {
        bestY = target.y;
        bestDistY = dy;
        lines.push({ type: 'horizontal', y: target.y, kind: target.type, target });
        if (dy > 0.1) distances.push({ type: 'horizontal', y1: point.y, y2: target.y, x: point.x, value: Math.abs(target.y - point.y) });
      }
    }

    for (const edge of targets.edges) {
      const proj = projectPointToSegment(point, edge.a, edge.b);
      if (proj.onSegment) {
        const dx = Math.abs(point.x - proj.x);
        const dy = Math.abs(point.y - proj.y);
        const d = dist(point, proj);

        if (d < threshold) {
          if (dx < bestDistX) {
            bestX = proj.x;
            bestDistX = dx;
          }
          if (dy < bestDistY) {
            bestY = proj.y;
            bestDistY = dy;
          }
          lines.push({ type: 'edge', a: edge.a, b: edge.b, kind: 'edge', target: proj });
        }
      }
    }

    if (isDragging && excludeIds && excludeIds.size > 0) {
      const selBounds = [];
      for (const id of excludeIds) {
        const s = getShapeById(id);
        if (s) {
          const pts = worldPointsOf(s);
          const b = getBounds(pts);
          selBounds.push({
            left: b.minX,
            right: b.maxX,
            top: b.minY,
            bottom: b.maxY,
            centerX: (b.minX + b.maxX) / 2,
            centerY: (b.minY + b.maxY) / 2
          });
        }
      }

      if (selBounds.length > 0) {
        const selLeft = Math.min(...selBounds.map(b => b.left));
        const selRight = Math.max(...selBounds.map(b => b.right));
        const selTop = Math.min(...selBounds.map(b => b.top));
        const selBottom = Math.max(...selBounds.map(b => b.bottom));
        const selCenterX = (selLeft + selRight) / 2;
        const selCenterY = (selTop + selBottom) / 2;

        for (const s of shapes) {
          if (!s.visible || s.locked || excludeIds.has(s.id)) continue;
          const pts = worldPointsOf(s);
          const b = getBounds(pts);
          const targetCenterX = (b.minX + b.maxX) / 2;
          const targetCenterY = (b.minY + b.maxY) / 2;

          const dxCenter = Math.abs(selCenterX - targetCenterX);
          const dyCenter = Math.abs(selCenterY - targetCenterY);

          if (dxCenter < threshold && dxCenter < bestDistX) {
            bestDistX = dxCenter;
            lines.push({ type: 'vertical', x: targetCenterX, kind: 'centerline' });
            if (dxCenter > 0.1) distances.push({ type: 'vertical', x1: selCenterX, x2: targetCenterX, y: selCenterY, value: dxCenter });
          }
          if (dyCenter < threshold && dyCenter < bestDistY) {
            bestDistY = dyCenter;
            lines.push({ type: 'horizontal', y: targetCenterY, kind: 'centerline' });
            if (dyCenter > 0.1) distances.push({ type: 'horizontal', y1: selCenterY, y2: targetCenterY, x: selCenterX, value: dyCenter });
          }

          const dxLeft = Math.abs(selLeft - b.minX);
          const dxRight = Math.abs(selRight - b.maxX);
          const dyTop = Math.abs(selTop - b.minY);
          const dyBottom = Math.abs(selBottom - b.maxY);

          if (dxLeft < threshold && dxLeft < bestDistX) {
            bestDistX = dxLeft;
            lines.push({ type: 'vertical', x: b.minX, kind: 'edge-align' });
          }
          if (dxRight < threshold && dxRight < bestDistX) {
            bestDistX = dxRight;
            lines.push({ type: 'vertical', x: b.maxX, kind: 'edge-align' });
          }
          if (dyTop < threshold && dyTop < bestDistY) {
            bestDistY = dyTop;
            lines.push({ type: 'horizontal', y: b.minY, kind: 'edge-align' });
          }
          if (dyBottom < threshold && dyBottom < bestDistY) {
            bestDistY = dyBottom;
            lines.push({ type: 'horizontal', y: b.maxY, kind: 'edge-align' });
          }
        }
      }
    }

    if (lines.length > 0) {
      snapInfo = { active: true, lines, distances };
    }

    return { x: bestX, y: bestY };
  }

  function projectPointToSegment(p, a, b) {
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const ap = { x: p.x - a.x, y: p.y - a.y };
    const ab2 = ab.x * ab.x + ab.y * ab.y;
    if (ab2 < 1e-10) return { x: a.x, y: a.y, onSegment: true };
    let t = (ap.x * ab.x + ap.y * ab.y) / ab2;
    t = Math.max(0, Math.min(1, t));
    return {
      x: a.x + t * ab.x,
      y: a.y + t * ab.y,
      onSegment: t > 0 && t < 1
    };
  }

  function renderSnapGuides() {
    if (!snapInfo.active || snapInfo.lines.length === 0) return;

    ctx.save();
    const w = window.innerWidth, h = window.innerHeight;
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(w, h);

    for (const line of snapInfo.lines) {
      let color = '#e53935';
      if (line.kind === 'grid') color = '#43a047';
      else if (line.kind === 'centerline') color = '#1a73e8';
      else if (line.kind === 'edge-align') color = '#fb8c00';
      else if (line.kind === 'edge') color = '#8e24aa';
      else if (line.kind === 'guide') color = '#0d47a1';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);

      if (line.type === 'vertical') {
        ctx.beginPath();
        ctx.moveTo(line.x, tl.y - 100);
        ctx.lineTo(line.x, br.y + 100);
        ctx.stroke();
      } else if (line.type === 'horizontal') {
        ctx.beginPath();
        ctx.moveTo(tl.x - 100, line.y);
        ctx.lineTo(br.x + 100, line.y);
        ctx.stroke();
      } else if (line.type === 'edge' && line.a && line.b) {
        ctx.beginPath();
        ctx.moveTo(line.a.x, line.a.y);
        ctx.lineTo(line.b.x, line.b.y);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]);

    for (const d of snapInfo.distances) {
      ctx.fillStyle = '#e53935';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3 / viewport.scale;
      ctx.font = `700 ${12 / viewport.scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const label = d.value.toFixed(1);
      let x, y;
      if (d.type === 'vertical') {
        x = (d.x1 + d.x2) / 2;
        y = d.y - 10 / viewport.scale;
      } else {
        x = d.x + 10 / viewport.scale;
        y = (d.y1 + d.y2) / 2;
      }

      const padX = 8 / viewport.scale;
      const padY = 4 / viewport.scale;
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(229, 57, 53, 0.9)';
      ctx.fillRect(x - textW / 2 - padX, y - 8 / viewport.scale - padY, textW + padX * 2, 16 / viewport.scale + padY * 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x, y - 8 / viewport.scale);
    }

    ctx.restore();
  }

  function constrainToAxis(start, current) {
    if (!keys.shift) return current;
    const dx = Math.abs(current.x - start.x);
    const dy = Math.abs(current.y - start.y);
    if (dx > dy) {
      return { x: current.x, y: start.y };
    } else {
      return { x: start.x, y: current.y };
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    lastMouseWorld = { ...world };

    const cHit = hitTestConstraintIcon(world.x, world.y);
    if (cHit >= 0 && e.button === 0) {
      selectedConstraintIdx = (selectedConstraintIdx === cHit) ? -1 : cHit;
      constraintSelection = [];
      constraintMode = null;
      updateDOFDisplay();
      renderConstraintList();
      render();
      return;
    }

    if (e.button === 2) {
      if (isNodeEditMode) {
        const vHit = hitTestVertex(world.x, world.y);
        const eHit = hitTestEdge(world.x, world.y);
        if (vHit) {
          const idx = constraintSelection.findIndex(s =>
            s.type === 'vertex' &&
            s.data.shape.id === vHit.shape.id &&
            s.data.isHole === vHit.isHole &&
            s.data.holeIndex === vHit.holeIndex &&
            s.data.pointIndex === vHit.pointIndex
          );
          if (idx < 0 && !e.shiftKey) constraintSelection = [];
          if (idx < 0) constraintSelection.push({ type: 'vertex', data: vHit });
        } else if (eHit) {
          const idx = constraintSelection.findIndex(s =>
            s.type === 'edge' &&
            s.data.shape.id === eHit.shape.id &&
            s.data.isHole === eHit.isHole &&
            s.data.holeIndex === eHit.holeIndex &&
            s.data.edgeIndex === eHit.edgeIndex
          );
          if (idx < 0 && !e.shiftKey) constraintSelection = [];
          if (idx < 0) constraintSelection.push({ type: 'edge', data: eHit });
        }
      }
      if (constraintSelection.length > 0) {
        renderConstraintMenuAvailability();
        constraintMenuEl.style.left = e.clientX + 'px';
        constraintMenuEl.style.top = e.clientY + 'px';
        constraintMenuEl.classList.remove('hidden');
      }
      return;
    }

    if (constraintMode) {
      toggleConstraintSelection(world);
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, vp: { ...viewport } };
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (isNodeEditMode && e.button === 0) {
      const vHit = hitTestVertex(world.x, world.y);
      if (vHit) {
        selectedVertex = vHit;
        isDraggingVertex = true;
        dragVertexOriginalData = deepCloneState();
        const pts = vHit.isHole ? worldHolesOf(vHit.shape)[vHit.holeIndex] : worldPointsOf(vHit.shape);
        dragStart = { ...pts[vHit.pointIndex] };
        canvas.style.cursor = 'crosshair';
        render();
        return;
      }
      const eHit = hitTestEdge(world.x, world.y);
      if (eHit && selectedIds.size === 1) {
        const selShapes = getSelectedShapes();
        if (selShapes.length === 1 && eHit.shape.id === selShapes[0].id) {
          pushHistory();
          const pts = eHit.isHole ? eHit.shape.holes[eHit.holeIndex] : eHit.shape.points;
          const a = pts[eHit.edgeIndex];
          const b = pts[(eHit.edgeIndex + 1) % pts.length];
          const newPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          if (eHit.isHole) {
            eHit.shape.holes[eHit.holeIndex].splice(eHit.edgeIndex + 1, 0, newPt);
          } else {
            eHit.shape.points.splice(eHit.edgeIndex + 1, 0, newPt);
          }
          rebuildSolverAndParams();
          initialSolve();
          updateDOFDisplay();
          render();
          return;
        }
      }
    }

    if (e.button === 0) {
      if (currentTool === 'dim-distance' || currentTool === 'dim-angle' || currentTool === 'dim-radius') {
        dimToolType = currentTool;
        handleDimToolClick(world.x, world.y);
        return;
      }
      if (dimensionSystem.measureMode) {
        handleMeasureClick(world.x, world.y);
        return;
      }
      const handleHit = hitTestHandle(world.x, world.y);
      if (handleHit && selectedIds.size === 1) {
        const shape = getSelectedShapes()[0];
        if (!shape) return;
        isTransforming = true;
        transformHandle = handleHit.type;
        const masks = !isMaskShape(shape) ? getMasksOfShape(shape.id) : [];
        transformStart = {
          world: { ...world },
          shapeData: JSON.parse(JSON.stringify(shape)),
          maskData: masks.map(m => ({ shape: m, data: JSON.parse(JSON.stringify(m)) }))
        };
        transformOriginalData = deepCloneState();
        pushHistory();
        canvas.style.cursor = handleHit.type === 'rotate' ? 'grab' : (handleHit.type[0] + handleHit.type[handleHit.type.length - 1] + '-resize');
        return;
      }

      if (isNodeEditMode) {
        const shapeHit = hitTest(world.x, world.y);
        if (shapeHit) {
          selectedIds.clear();
          selectedIds.add(shapeHit.id);
          selectedVertex = null;
          updateToolbar();
          updateTextPanel();
          updateMotionPathPanel();
          renderLayers();
          render();
        } else {
          selectedIds.clear();
          selectedVertex = null;
          updateToolbar();
          updateTextPanel();
          updateMotionPathPanel();
          renderLayers();
          render();
        }
        return;
      }

      if (currentTool === 'select') {
        const shapeHit = hitTest(world.x, world.y);
        if (shapeHit) {
          if (e.shiftKey) {
            if (selectedIds.has(shapeHit.id)) selectedIds.delete(shapeHit.id);
            else selectedIds.add(shapeHit.id);
          } else {
            if (!selectedIds.has(shapeHit.id)) {
              selectedIds.clear();
              selectedIds.add(shapeHit.id);
            }
          }
          updateMotionPathPanel();
          isDraggingShape = true;
          dragStart = { x: world.x, y: world.y };
          dragOriginalWorldPts = [];
          pushHistory();
          
          const dragShapeIds = new Set([...selectedIds]);
          for (const sid of selectedIds) {
            const s = getShapeById(sid);
            if (s && !isMaskShape(s)) {
              const masks = getMasksOfShape(sid);
              for (const mask of masks) {
                dragShapeIds.add(mask.id);
              }
            }
          }
          
          for (const sid of dragShapeIds) {
            const s = getShapeById(sid);
            if (s && !s.locked) {
              dragOriginalWorldPts.push({
                shape: s,
                points: worldPointsOf(s).map(p => ({ ...p })),
                holes: worldHolesOf(s).map(h => h.map(p => ({ ...p })))
              });
            }
          }
          canvas.style.cursor = 'move';
          updateToolbar();
          updateTextPanel();
          renderLayers();
          render();
          return;
        } else {
          isMarquee = true;
          marqueeStart = { ...world };
          marqueeEnd = { ...world };
          if (!e.shiftKey) selectedIds.clear();
          updateToolbar();
          updateTextPanel();
          renderLayers();
          render();
          return;
        }
      } else if (currentTool === 'rect' || currentTool === 'circle') {
        isDrawing = true;
        drawStart = { ...world };
        drawEnd = { ...world };
        return;
      } else if (currentTool === 'polygon') {
        if (polygonPoints.length === 0) {
          polygonPoints = [{ ...world }];
        } else {
          const last = polygonPoints[polygonPoints.length - 1];
          if (dist(last, world) > 5 / viewport.scale) {
            polygonPoints.push({ ...world });
          }
        }
        render();
        return;
      } else if (currentTool === 'motionpath') {
        if (polygonPoints.length === 0) {
          polygonPoints = [{ ...world }];
        } else {
          const last = polygonPoints[polygonPoints.length - 1];
          if (dist(last, world) > 5 / viewport.scale) {
            polygonPoints.push({ ...world });
          }
        }
        render();
        return;
      } else if (currentTool === 'text') {
        pushHistory();
        const shape = createTextShape(
          textSettings.text,
          world.x,
          world.y,
          textSettings.fontSize,
          textSettings.fontWeight,
          textSettings.letterSpacing
        );
        if (shape) {
          shapes.push(shape);
          selectedIds.clear();
          selectedIds.add(shape.id);
          rebuildSolverAndParams();
          initialSolve();
          updateToolbar();
          updateDOFDisplay();
          updateTextPanel();
          renderLayers();
          renderConstraintList();
          render();
          showToast('Text created: ' + textSettings.text);
        }
        return;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);
    lastMouseWorld = { ...world };
    cursorEl.textContent = `x: ${world.x.toFixed(1)}, y: ${world.y.toFixed(1)}`;

    if (isPanning) {
      const dx = (e.clientX - panStart.x) / viewport.scale;
      const dy = (e.clientY - panStart.y) / viewport.scale;
      viewport.x = panStart.vp.x - dx;
      viewport.y = panStart.vp.y - dy;
      render();
      return;
    }

    if (constraintMode) {
      render();
      return;
    }

    if (dimensionSystem.measureMode && editingComponentId === null) {
      const eHit = hitTestEdge(world.x, world.y);
      if (eHit) {
        dimensionSystem.measureHoverEdge = {
          shapeId: eHit.shape.id,
          isHole: eHit.isHole,
          holeIndex: eHit.holeIndex,
          edgeIndex: eHit.edgeIndex
        };
      } else {
        dimensionSystem.measureHoverEdge = null;
      }
      canvas.style.cursor = 'crosshair';
      render();
      return;
    }

    if (isNodeEditMode && !isDraggingVertex) {
      hoveredEdge = hitTestEdge(world.x, world.y);
    }

    if (isDrawing) {
      drawEnd = { ...world };
      render();
      return;
    }

    if (isMarquee) {
      marqueeEnd = { ...world };
      render();
      return;
    }

    if (isDraggingVertex && selectedVertex) {
      const v = selectedVertex;
      const pts = v.isHole ? v.shape.holes[v.holeIndex] : v.shape.points;
      if (pts && pts[v.pointIndex]) {
        let targetPos = { x: world.x, y: world.y };

        if (keys.shift) {
          targetPos = constrainToAxis(dragStart, targetPos);
        }

        const snapped = computeSnap(targetPos, new Set([v.shape.id]), false);

        const vpid = getVertexPointId(v);
        const extraFixed = {};
        extraFixed[vpid + '_x'] = snapped.x;
        extraFixed[vpid + '_y'] = snapped.y;
        const fixedPoints = new Set();
        const res = runSolver(fixedPoints, extraFixed, 50);
      }
      updateDOFDisplay();
      render();
      return;
    }

    if (isDraggingShape && dragStart) {
      let dx = world.x - dragStart.x;
      let dy = world.y - dragStart.y;

      const firstEntry = dragOriginalWorldPts[0];
      if (firstEntry) {
        const origBounds = getBounds(firstEntry.points);
        const origCenter = {
          x: (origBounds.minX + origBounds.maxX) / 2,
          y: (origBounds.minY + origBounds.maxY) / 2
        };
        let targetCenter = { x: origCenter.x + dx, y: origCenter.y + dy };

        if (keys.shift) {
          targetCenter = constrainToAxis(origCenter, targetCenter);
          dx = targetCenter.x - origCenter.x;
          dy = targetCenter.y - origCenter.y;
        }

        const snapped = computeSnap(targetCenter, selectedIds, true);
        dx = snapped.x - origCenter.x;
        dy = snapped.y - origCenter.y;
      }

      const fixedPoints = new Set();
      const extraFixed = {};
      for (const entry of dragOriginalWorldPts) {
        const s = entry.shape;
        const origPts = entry.points;
        for (let i = 0; i < origPts.length; i++) {
          const pid = makePointId(s.id, false, -1, i);
          extraFixed[pid + '_x'] = origPts[i].x + dx;
          extraFixed[pid + '_y'] = origPts[i].y + dy;
        }
        for (let h = 0; h < entry.holes.length; h++) {
          const origHole = entry.holes[h];
          for (let i = 0; i < origHole.length; i++) {
            const pid = makePointId(s.id, true, h, i);
            extraFixed[pid + '_x'] = origHole[i].x + dx;
            extraFixed[pid + '_y'] = origHole[i].y + dy;
          }
        }
      }
      runSolver(fixedPoints, extraFixed, 50);
      updateDOFDisplay();
      render();
      return;
    }

    if (isTransforming && transformStart) {
      const s = getSelectedShapes()[0];
      if (!s) return;
      const orig = transformStart.shapeData;
      const origWp = applyTransform(orig.points, orig.transform.tx, orig.transform.ty, orig.transform.rotation, orig.transform.scaleX, orig.transform.scaleY);
      const origBounds = getBounds(origWp);
      const origCenter = boundsCenter(origBounds);
      const dx = world.x - transformStart.world.x;
      const dy = world.y - transformStart.world.y;

      let newPoints = origWp.map(p => ({ ...p }));
      const handle = transformHandle;

      if (handle === 'rotate') {
        const ang1 = Math.atan2(transformStart.world.y - origCenter.y, transformStart.world.x - origCenter.x);
        const ang2 = Math.atan2(world.y - origCenter.y, world.x - origCenter.x);
        let rot = ang2 - ang1;
        if (keys.shift) {
          const snapAngle = Math.PI / 12;
          rot = Math.round(rot / snapAngle) * snapAngle;
        }
        newPoints = origWp.map(p => {
          const rx = p.x - origCenter.x;
          const ry = p.y - origCenter.y;
          return {
            x: origCenter.x + rx * Math.cos(rot) - ry * Math.sin(rot),
            y: origCenter.y + rx * Math.sin(rot) + ry * Math.cos(rot)
          };
        });
      } else {
        const mapCorner = (type, b) => {
          switch (type) {
            case 'nw': return { x: b.minX, y: b.minY };
            case 'n':  return { x: (b.minX + b.maxX) / 2, y: b.minY };
            case 'ne': return { x: b.maxX, y: b.minY };
            case 'e':  return { x: b.maxX, y: (b.minY + b.maxY) / 2 };
            case 'se': return { x: b.maxX, y: b.maxY };
            case 's':  return { x: (b.minX + b.maxX) / 2, y: b.maxY };
            case 'sw': return { x: b.minX, y: b.maxY };
            case 'w':  return { x: b.minX, y: (b.minY + b.maxY) / 2 };
          }
        };
        const origCorner = mapCorner(handle, origBounds);
        const opp = {
          nw: 'se', n: 's', ne: 'sw', e: 'w',
          se: 'nw', s: 'n', sw: 'ne', w: 'e'
        };
        const oppCorner = mapCorner(opp[handle], origBounds);
        let newCorner = { x: origCorner.x + dx, y: origCorner.y + dy };
        let sx = 1, sy = 1;
        const origW = origBounds.maxX - origBounds.minX;
        const origH = origBounds.maxY - origBounds.minY;
        if (handle.includes('e') || handle.includes('w')) {
          const newW = Math.abs(newCorner.x - oppCorner.x);
          sx = origW > 0 ? newW / origW : 1;
        }
        if (handle.includes('n') || handle.includes('s')) {
          const newH = Math.abs(newCorner.y - oppCorner.y);
          sy = origH > 0 ? newH / origH : 1;
        }
        if (e.shiftKey) {
          const s = Math.max(sx, sy);
          sx = s; sy = s;
        }
        const anchor = oppCorner;
        newPoints = origWp.map(p => {
          const rx = p.x - anchor.x;
          const ry = p.y - anchor.y;
          return { x: anchor.x + rx * sx, y: anchor.y + ry * sy };
        });
      }

      const newBounds = getBounds(newPoints);
      const newCenter = boundsCenter(newBounds);
      const snapped = computeSnap(newCenter, new Set([s.id]), true);
      const snapDx = snapped.x - newCenter.x;
      const snapDy = snapped.y - newCenter.y;
      newPoints = newPoints.map(p => ({ x: p.x + snapDx, y: p.y + snapDy }));

      const localNewPts = applyTransformInverse(newPoints, orig.transform.tx, orig.transform.ty, orig.transform.rotation, orig.transform.scaleX, orig.transform.scaleY);
      const fixedPoints = new Set();
      const extraFixed = {};
      for (let i = 0; i < localNewPts.length; i++) {
        const pid = makePointId(s.id, false, -1, i);
        extraFixed[pid + '_x'] = localNewPts[i].x;
        extraFixed[pid + '_y'] = localNewPts[i].y;
      }
      s.points = orig.points.map(p => ({ ...p }));
      s.transform = { ...orig.transform };
      const origHoles = orig.holes || [];
      const worldHoles = applyTransformToHoles(origHoles, orig.transform);
      const localNewHoles = worldHoles.map(h => applyTransformInverse(h, orig.transform.tx, orig.transform.ty, orig.transform.rotation, orig.transform.scaleX, orig.transform.scaleY));
      if (s.holes) {
        for (let h = 0; h < s.holes.length; h++) {
          const origHole = origHoles[h] || [];
          s.holes[h] = origHole.map(p => ({ ...p }));
          if (localNewHoles[h]) {
            for (let i = 0; i < localNewHoles[h].length; i++) {
              const pid = makePointId(s.id, true, h, i);
              extraFixed[pid + '_x'] = localNewHoles[h][i].x;
              extraFixed[pid + '_y'] = localNewHoles[h][i].y;
            }
          }
        }
      }

      if (transformStart.maskData && transformStart.maskData.length > 0) {
        const handle = transformHandle;
        const origBounds = getBounds(origWp);
        let rot = 0;
        let sx = 1, sy = 1;
        let anchorX, anchorY;
        let moveDx = 0, moveDy = 0;

        if (handle === 'rotate') {
          const ang1 = Math.atan2(transformStart.world.y - origCenter.y, transformStart.world.x - origCenter.x);
          const ang2 = Math.atan2(world.y - origCenter.y, world.x - origCenter.x);
          rot = ang2 - ang1;
          if (keys.shift) {
            const snapAngle = Math.PI / 12;
            rot = Math.round(rot / snapAngle) * snapAngle;
          }
          anchorX = origCenter.x;
          anchorY = origCenter.y;
        } else {
          const mapCorner = (type, b) => {
            switch (type) {
              case 'nw': return { x: b.minX, y: b.minY };
              case 'n':  return { x: (b.minX + b.maxX) / 2, y: b.minY };
              case 'ne': return { x: b.maxX, y: b.minY };
              case 'e':  return { x: b.maxX, y: (b.minY + b.maxY) / 2 };
              case 'se': return { x: b.maxX, y: b.maxY };
              case 's':  return { x: (b.minX + b.maxX) / 2, y: b.maxY };
              case 'sw': return { x: b.minX, y: b.maxY };
              case 'w':  return { x: b.minX, y: (b.minY + b.maxY) / 2 };
            }
          };
          const opp = {
            nw: 'se', n: 's', ne: 'sw', e: 'w',
            se: 'nw', s: 'n', sw: 'ne', w: 'e'
          };
          const oppCorner = mapCorner(opp[handle], origBounds);
          const origCorner = mapCorner(handle, origBounds);
          let newCorner = { x: origCorner.x + dx, y: origCorner.y + dy };
          const origW = origBounds.maxX - origBounds.minX;
          const origH = origBounds.maxY - origBounds.minY;
          if (handle.includes('e') || handle.includes('w')) {
            const newW = Math.abs(newCorner.x - oppCorner.x);
            sx = origW > 0 ? newW / origW : 1;
          }
          if (handle.includes('n') || handle.includes('s')) {
            const newH = Math.abs(newCorner.y - oppCorner.y);
            sy = origH > 0 ? newH / origH : 1;
          }
          if (e.shiftKey) {
            const s = Math.max(sx, sy);
            sx = s; sy = s;
          }
          anchorX = oppCorner.x;
          anchorY = oppCorner.y;
        }

        const newBounds = getBounds(newPoints);
        const newCenter = boundsCenter(newBounds);
        const snapped = computeSnap(newCenter, new Set([s.id]), true);
        moveDx = snapped.x - newCenter.x;
        moveDy = snapped.y - newCenter.y;

        for (const maskItem of transformStart.maskData) {
          const maskShape = maskItem.shape;
          const maskOrig = maskItem.data;
          const maskOrigWp = applyTransform(maskOrig.points, maskOrig.transform.tx, maskOrig.transform.ty, maskOrig.transform.rotation, maskOrig.transform.scaleX, maskOrig.transform.scaleY);

          let maskNewWp = maskOrigWp.map(p => {
            let rx = p.x - anchorX;
            let ry = p.y - anchorY;
            if (rot !== 0) {
              const cos = Math.cos(rot);
              const sin = Math.sin(rot);
              const nx = rx * cos - ry * sin;
              const ny = rx * sin + ry * cos;
              rx = nx;
              ry = ny;
            }
            rx *= sx;
            ry *= sy;
            return {
              x: anchorX + rx + moveDx,
              y: anchorY + ry + moveDy
            };
          });

          const maskLocalNewPts = applyTransformInverse(maskNewWp, maskOrig.transform.tx, maskOrig.transform.ty, maskOrig.transform.rotation, maskOrig.transform.scaleX, maskOrig.transform.scaleY);
          maskShape.points = maskOrig.points.map(p => ({ ...p }));
          maskShape.transform = { ...maskOrig.transform };
          for (let i = 0; i < maskLocalNewPts.length; i++) {
            const pid = makePointId(maskShape.id, false, -1, i);
            extraFixed[pid + '_x'] = maskLocalNewPts[i].x;
            extraFixed[pid + '_y'] = maskLocalNewPts[i].y;
          }

          const maskOrigHoles = maskOrig.holes || [];
          if (maskShape.holes) {
            const maskWorldHoles = applyTransformToHoles(maskOrigHoles, maskOrig.transform);
            const maskLocalNewHoles = maskWorldHoles.map(h => {
              const transformed = h.map(p => {
                let rx = p.x - anchorX;
                let ry = p.y - anchorY;
                if (rot !== 0) {
                  const cos = Math.cos(rot);
                  const sin = Math.sin(rot);
                  const nx = rx * cos - ry * sin;
                  const ny = rx * sin + ry * cos;
                  rx = nx;
                  ry = ny;
                }
                rx *= sx;
                ry *= sy;
                return {
                  x: anchorX + rx + moveDx,
                  y: anchorY + ry + moveDy
                };
              });
              return applyTransformInverse(transformed, maskOrig.transform.tx, maskOrig.transform.ty, maskOrig.transform.rotation, maskOrig.transform.scaleX, maskOrig.transform.scaleY);
            });
            for (let h = 0; h < maskShape.holes.length; h++) {
              const origHole = maskOrigHoles[h] || [];
              maskShape.holes[h] = origHole.map(p => ({ ...p }));
              if (maskLocalNewHoles[h]) {
                for (let i = 0; i < maskLocalNewHoles[h].length; i++) {
                  const pid = makePointId(maskShape.id, true, h, i);
                  extraFixed[pid + '_x'] = maskLocalNewHoles[h][i].x;
                  extraFixed[pid + '_y'] = maskLocalNewHoles[h][i].y;
                }
              }
            }
          }
        }
      }

      runSolver(fixedPoints, extraFixed, 50);
      updateDOFDisplay();
      render();
      return;
    }

    if (!isDraggingShape && !isTransforming && !isDraggingVertex) {
      const handleHit = hitTestHandle(world.x, world.y);
      if (handleHit && selectedIds.size === 1) {
        canvas.style.cursor = handleHit.type === 'rotate' ? 'grab' : (handleHit.type[0] + handleHit.type[handleHit.type.length - 1] + '-resize');
      } else if (currentTool === 'select' && !isNodeEditMode) {
        const s = hitTest(world.x, world.y);
        canvas.style.cursor = s ? 'pointer' : 'default';
      } else if (isNodeEditMode) {
        const vHit = hitTestVertex(world.x, world.y);
        const cHit = hitTestConstraintIcon(world.x, world.y);
        canvas.style.cursor = (vHit || cHit >= 0) ? 'pointer' : 'crosshair';
      } else {
        canvas.style.cursor = 'crosshair';
      }
    }

    render();
  });

  canvas.addEventListener('mouseup', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    snapInfo = { active: false, lines: [], distances: [] };
    if (guideSystem) {
      guideSystem.clearHighlight();
    }

    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'default';
      return;
    }

    constraintMenuEl.classList.add('hidden');

    if (isDrawing) {
      isDrawing = false;
      if (drawStart && drawEnd) {
        const x = Math.min(drawStart.x, drawEnd.x);
        const y = Math.min(drawStart.y, drawEnd.y);
        const w = Math.abs(drawEnd.x - drawStart.x);
        const h = Math.abs(drawEnd.y - drawStart.y);

        if (w > 2 || h > 2) {
          pushHistory();
          if (currentTool === 'rect') {
            const pts = [
              { x: x, y: y },
              { x: x + w, y: y },
              { x: x + w, y: y + h },
              { x: x, y: y + h }
            ];
            const shape = createShape(pts);
            shapes.push(shape);
            selectedIds.clear();
            selectedIds.add(shape.id);
          } else if (currentTool === 'circle') {
            const r = Math.max(w, h) / 2;
            const cx = x + w / 2;
            const cy = y + h / 2;
            const sides = 32;
            const pts = [];
            for (let i = 0; i < sides; i++) {
              const ang = (i / sides) * Math.PI * 2;
              pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
            }
            const shape = createShape(pts);
            shapes.push(shape);
            selectedIds.clear();
            selectedIds.add(shape.id);
          }
          rebuildSolverAndParams();
          initialSolve();
          updateToolbar();
          updateDOFDisplay();
          renderLayers();
          renderConstraintList();
          render();
        }
      }
      drawStart = null;
      drawEnd = null;
      return;
    }

    if (isMarquee) {
      isMarquee = false;
      if (marqueeStart && marqueeEnd) {
        const minX = Math.min(marqueeStart.x, marqueeEnd.x);
        const maxX = Math.max(marqueeStart.x, marqueeEnd.x);
        const minY = Math.min(marqueeStart.y, marqueeEnd.y);
        const maxY = Math.max(marqueeStart.y, marqueeEnd.y);
        if (Math.abs(maxX - minX) > 2 && Math.abs(maxY - minY) > 2) {
          for (const s of shapes) {
            if (!s.visible || s.locked) continue;
            const pts = worldPointsOf(s);
            const b = getBounds(pts);
            if (b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY) {
              selectedIds.add(s.id);
            }
          }
        }
      }
      marqueeStart = null;
      marqueeEnd = null;
      canvas.style.cursor = 'default';
      updateToolbar();
      updateTextPanel();
      updateMotionPathPanel();
      renderLayers();
      render();
      return;
    }

    if (isDraggingVertex) {
      isDraggingVertex = false;
      canvas.style.cursor = 'crosshair';
      if (selectedVertex) {
        const shapeId = selectedVertex.shapeId;
        const s = getShapeById(shapeId);
        if (s && s.type === 'motion-path') {
          motionPathManager.invalidatePathCache(shapeId);
        } else {
          for (const ps of shapes) {
            if (ps.type === 'motion-path') motionPathManager.invalidatePathCache(ps.id);
          }
        }
      } else {
        for (const ps of shapes) {
          if (ps.type === 'motion-path') motionPathManager.invalidatePathCache(ps.id);
        }
      }
      selectedVertex = null;
      scheduleSave();
      render();
      return;
    }

    if (isDraggingShape) {
      isDraggingShape = false;
      dragStart = null;
      dragOriginalWorldPts = [];
      canvas.style.cursor = 'default';
      for (const ps of shapes) {
        if (ps.type === 'motion-path') motionPathManager.invalidatePathCache(ps.id);
      }
      updateToolbar();
      updateMotionPathPanel();
      scheduleSave();
      render();
      return;
    }

    if (isTransforming) {
      isTransforming = false;
      transformHandle = null;
      transformStart = null;
      transformOriginalData = [];
      canvas.style.cursor = 'default';
      for (const ps of shapes) {
        if (ps.type === 'motion-path') motionPathManager.invalidatePathCache(ps.id);
      }
      updateMotionPathPanel();
      scheduleSave();
      render();
      return;
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    viewport.scale = Math.max(0.1, Math.min(20, viewport.scale * factor));
    const after = screenToWorld(sx, sy);
    viewport.x += before.x - after.x;
    viewport.y += before.y - after.y;
    render();
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(sx, sy);

    const cHit = hitTestConstraintIcon(world.x, world.y);
    if (cHit >= 0) {
      openConstraintEditDialog(cHit);
      return;
    }

    if (!isNodeEditMode && editingComponentId === null && currentTool === 'select') {
      const shapeHit = hitTest(world.x, world.y);
      if (shapeHit && isComponentInstance(shapeHit)) {
        enterComponentEditMode(shapeHit.componentId);
        return;
      }
    }

    if (currentTool === 'polygon' && polygonPoints.length >= 3) {
      pushHistory();
      const pts = polygonPoints.slice(0, -1);
      if (pts.length >= 3) {
        const shape = createShape(pts);
        shapes.push(shape);
        selectedIds.clear();
        selectedIds.add(shape.id);
      }
      polygonPoints = [];
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      render();
      return;
    }

    if (currentTool === 'motionpath' && polygonPoints.length >= 2) {
      pushHistory();
      const pts = polygonPoints.slice();
      if (pts.length >= 2) {
        const shape = createMotionPathShape(pts);
        shapes.push(shape);
        selectedIds.clear();
        selectedIds.add(shape.id);
        selectedPathShapeIdForBinding = shape.id;
        updateMotionPathPanel();
      }
      polygonPoints = [];
      currentTool = 'select';
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      render();
      return;
    }

    if (isNodeEditMode) {
      const vHit = hitTestVertex(world.x, world.y);
      if (vHit) {
        const pts = vHit.isHole ? worldPointsOf(vHit.shape) : null;
        const regularPts = worldPointsOf(vHit.shape);
        if (!vHit.isHole && regularPts.length > 3) {
          pushHistory();
          vHit.shape.points.splice(vHit.pointIndex, 1);
          rebuildSolverAndParams();
          initialSolve();
          updateDOFDisplay();
          render();
          return;
        }
        if (vHit.isHole) {
          const holes = worldHolesOf(vHit.shape);
          if (holes[vHit.holeIndex] && holes[vHit.holeIndex].length > 3) {
            pushHistory();
            vHit.shape.holes[vHit.holeIndex].splice(vHit.pointIndex, 1);
            rebuildSolverAndParams();
            initialSolve();
            updateDOFDisplay();
            render();
            return;
          }
        }
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === 'Shift') keys.shift = true;
    if (e.key === 'Alt' || e.key === 'Option') keys.alt = true;

    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'c') {
      e.preventDefault();
      copySelectedShapes();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'v') {
      e.preventDefault();
      pasteShapes();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      addNewPage(true);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const currentIdx = pages.findIndex(p => p.id === currentPageId);
      if (e.key === 'ArrowLeft' && currentIdx > 0) {
        loadPageState(pages[currentIdx - 1].id);
        renderPageTabs();
      } else if (e.key === 'ArrowRight' && currentIdx < pages.length - 1) {
        loadPageState(pages[currentIdx + 1].id);
        renderPageTabs();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (editingComponentId !== null) {
        exitComponentEditMode();
        return;
      }
      if (constraintMode) {
        constraintMode = null;
        constraintSelection = [];
        updateDOFDisplay();
        showToast('Cancelled constraint mode');
        render();
        return;
      }
      if (polygonPoints.length > 0) {
        polygonPoints = [];
        render();
        return;
      }
      if (isNodeEditMode) {
        selectedVertex = null;
      }
      selectedIds.clear();
      selectedConstraintIdx = -1;
      updateToolbar();
      renderLayers();
      renderConstraintList();
      render();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
      e.preventDefault();
      redo();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === '7') {
      e.preventDefault();
      const sel = getSelectedShapes();
      if (sel.length === 2 && !sel.some(s => isMaskShape(s))) {
        const sorted = sel.slice().sort((a, b) => {
          return shapes.findIndex(s => s.id === a.id) - shapes.findIndex(s => s.id === b.id);
        });
        const maskedShape = sorted[0];
        const maskShape = sorted[1];
        pushHistory();
        const success = createClipMask(maskedShape.id, maskShape.id);
        if (success) {
          showToast('Clip mask created', 'success');
          selectedIds.clear();
          selectedIds.add(maskedShape.id);
          rebuildSolverAndParams();
          initialSolve();
          updateToolbar();
          updateDOFDisplay();
          renderLayers();
          renderConstraintList();
          render();
        }
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === '8') {
      e.preventDefault();
      const sel = getSelectedShapes();
      if (sel.length === 2 && !sel.some(s => isMaskShape(s))) {
        const sorted = sel.slice().sort((a, b) => {
          return shapes.findIndex(s => s.id === a.id) - shapes.findIndex(s => s.id === b.id);
        });
        const maskedShape = sorted[0];
        const maskShape = sorted[1];
        pushHistory();
        const success = createAlphaMask(maskedShape.id, maskShape.id);
        if (success) {
          showToast('Alpha mask created', 'success');
          selectedIds.clear();
          selectedIds.add(maskedShape.id);
          rebuildSolverAndParams();
          initialSolve();
          updateToolbar();
          updateDOFDisplay();
          renderLayers();
          renderConstraintList();
          render();
        }
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === '9') {
      e.preventDefault();
      const sel = getSelectedShapes();
      const maskShapes = sel.filter(s => isMaskShape(s));
      if (maskShapes.length > 0) {
        pushHistory();
        for (const mask of maskShapes) {
          releaseMask(mask.id);
        }
        showToast('Mask(s) released', 'success');
        rebuildSolverAndParams();
        initialSolve();
        updateToolbar();
        updateDOFDisplay();
        renderLayers();
        renderConstraintList();
        render();
      }
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && !isNodeEditMode) {
      if (selectedConstraintIdx >= 0) {
        pushHistory();
        constraints.splice(selectedConstraintIdx, 1);
        selectedConstraintIdx = -1;
        rebuildSolverAndParams();
        initialSolve();
        updateDOFDisplay();
        renderConstraintList();
        render();
        showToast('Constraint deleted');
        return;
      }
      if (selectedDimensionId !== null) {
        pushHistory();
        dimensionSystem.removeDimension(selectedDimensionId);
        selectedDimensionId = null;
        updateDimensionPanel();
        render();
        scheduleSave();
        showToast('Dimension deleted');
        return;
      }
      if (selectedIds.size > 0) {
        pushHistory();
        const ids = [...selectedIds];
        const idsToDelete = new Set(ids);
        for (const id of ids) {
          const shape = getShapeById(id);
          if (!shape) continue;
          if (isMaskShape(shape)) {
            // 蒙版图形被删除，不需要特殊处理，直接删
          } else {
            // 被蒙版图形被删除，同时删除它的所有蒙版
            const masks = getMasksOfShape(id);
            for (const mask of masks) {
              idsToDelete.add(mask.id);
            }
          }
          // 如果是蒙版图形，也释放蒙版关系（虽然要删除了，但清理一下）
          if (isMaskShape(shape)) {
            delete shape.maskOf;
            delete shape.maskType;
          }
        }
        // 清理所有相关的蒙版引用
        for (const s of shapes) {
          if (s.maskOf && idsToDelete.has(s.maskOf)) {
            idsToDelete.add(s.id);
          }
        }
        const finalIds = [...idsToDelete];
        for (const id of finalIds) {
          dimensionSystem.removeDimensionsForShape(id);
          const idx = shapes.findIndex(s => s.id === id);
          if (idx >= 0) shapes.splice(idx, 1);
          animationController.removeShapeAnimation(id);
          motionPathManager.removeShapeBindings(id);
        }
        motionPathManager.cleanupBindings(shapes.map(s => s.id));
        constraints = constraints.filter(c => {
          const rps = c.getReferencedPoints();
          for (const rp of rps) {
            const { shapeId } = parsePointId(rp);
            if (ids.includes(shapeId)) return false;
          }
          return true;
        });
        selectedIds.clear();
        rebuildSolverAndParams();
        initialSolve();
        updateToolbar();
        updateTextPanel();
        updateMotionPathPanel();
        updateDimensionPanel();
        updateDOFDisplay();
        renderLayers();
        renderConstraintList();
        render();
        scheduleSave();
        return;
      }
    }

    const key = e.key.toLowerCase();
    if (key === 'v') { currentTool = 'select'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); updateDOFDisplay(); render(); }
    else if (key === 'r' && !e.shiftKey) { currentTool = 'rect'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); }
    else if (key === 'r' && e.shiftKey) { currentTool = 'dim-radius'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); }
    else if (key === 'c') { currentTool = 'circle'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); }
    else if (key === 'p') { currentTool = 'polygon'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; polygonPoints = []; updateToolbar(); render(); }
    else if (key === 'm') { currentTool = 'motionpath'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; polygonPoints = []; updateToolbar(); render(); }
    else if (key === 't') { currentTool = 'text'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); updateTextPanel(); render(); }
    else if (key === 'd') { currentTool = 'dim-distance'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); }
    else if (key === 'a') { if (e.shiftKey) { selectedIds.clear(); for (const s of shapes) { if (s.visible && !s.locked) selectedIds.add(s.id); } updateToolbar(); updateTextPanel(); updateMotionPathPanel(); renderLayers(); render(); } else { currentTool = 'dim-angle'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); } }
    else if (key === 'q') { dimensionSystem.measureMode = !dimensionSystem.measureMode; currentTool = dimensionSystem.measureMode ? 'measure' : 'select'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureSelectedPoints = []; dimensionSystem.measureSelectedEdges = []; dimensionSystem.measureHoverEdge = null; updateToolbar(); render(); showToast(dimensionSystem.measureMode ? 'Measure Mode ON (Shift+click for angle)' : 'Measure Mode OFF'); }
    else if (key === 'n') { isNodeEditMode = !isNodeEditMode; if (!isNodeEditMode) selectedVertex = null; constraintMode = null; constraintSelection = []; updateToolbar(); updateDOFDisplay(); render(); showToast(isNodeEditMode ? 'Node Edit Mode ON' : 'Node Edit Mode OFF'); }
    else if (key === ';') { snapEnabled = !snapEnabled; showToast(snapEnabled ? 'Snap ON' : 'Snap OFF'); render(); }
    else if (key === 'g') { if (editingComponentId === null) openCreateComponentDialog(); }
    else if (key === 'escape') {
      dimToolSelection = [];
      dimensionSystem.measureSelectedPoints = [];
      dimensionSystem.measureSelectedEdges = [];
      dimensionSystem.measureHoverEdge = null;
      if (dimensionSystem.measureMode) {
        dimensionSystem.measureMode = false;
      }
      currentTool = 'select';
      selectedIds.clear();
      selectedVertex = null;
      constraintMode = null;
      constraintSelection = [];
      updateToolbar();
      render();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') keys.shift = false;
    if (e.key === 'Alt' || e.key === 'Option') keys.alt = false;
    if (isDraggingShape || isDraggingVertex || isTransforming) {
      render();
    }
  });

  document.getElementById('tool-select').addEventListener('click', () => { currentTool = 'select'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); updateDOFDisplay(); render(); });
  document.getElementById('tool-rect').addEventListener('click', () => { currentTool = 'rect'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); });
  document.getElementById('tool-circle').addEventListener('click', () => { currentTool = 'circle'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); });
  document.getElementById('tool-polygon').addEventListener('click', () => { currentTool = 'polygon'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; polygonPoints = []; updateToolbar(); render(); });
  document.getElementById('tool-motionpath').addEventListener('click', () => { currentTool = 'motionpath'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; polygonPoints = []; updateToolbar(); render(); });
  document.getElementById('tool-text').addEventListener('click', () => { currentTool = 'text'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); updateTextPanel(); render(); });
  document.getElementById('tool-dim-distance').addEventListener('click', () => { currentTool = 'dim-distance'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); });
  document.getElementById('tool-dim-angle').addEventListener('click', () => { currentTool = 'dim-angle'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); });
  document.getElementById('tool-dim-radius').addEventListener('click', () => { currentTool = 'dim-radius'; isNodeEditMode = false; selectedVertex = null; constraintMode = null; constraintSelection = []; dimToolSelection = []; dimensionSystem.measureMode = false; updateToolbar(); render(); });
  document.getElementById('tool-measure').addEventListener('click', () => {
    dimensionSystem.measureMode = !dimensionSystem.measureMode;
    currentTool = dimensionSystem.measureMode ? 'measure' : 'select';
    isNodeEditMode = false;
    selectedVertex = null;
    constraintMode = null;
    constraintSelection = [];
    dimToolSelection = [];
    dimensionSystem.measureSelectedPoints = [];
    dimensionSystem.measureSelectedEdges = [];
    dimensionSystem.measureHoverEdge = null;
    updateToolbar();
    render();
    showToast(dimensionSystem.measureMode ? 'Measure Mode ON (Shift+click for angle)' : 'Measure Mode OFF');
  });

  document.getElementById('text-input').addEventListener('input', (e) => {
    const value = e.target.value.toUpperCase();
    textSettings.text = value;
    const selectedShapes = getSelectedShapes().filter(s => isTextShape(s));
    if (selectedShapes.length > 0) {
      pushHistory();
      for (const s of selectedShapes) {
        updateTextShape(s, value);
      }
      rebuildSolverAndParams();
      initialSolve();
      updateDOFDisplay();
      renderLayers();
      render();
    }
  });

  document.getElementById('text-size').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) || 100;
    textSettings.fontSize = value;
    const selectedShapes = getSelectedShapes().filter(s => isTextShape(s));
    if (selectedShapes.length > 0) {
      pushHistory();
      for (const s of selectedShapes) {
        updateTextShape(s, undefined, value);
      }
      rebuildSolverAndParams();
      initialSolve();
      updateDOFDisplay();
      renderLayers();
      render();
    }
  });

  document.getElementById('text-weight').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) || 0;
    textSettings.fontWeight = value;
    document.getElementById('text-weight-value').textContent = value;
    const selectedShapes = getSelectedShapes().filter(s => isTextShape(s));
    if (selectedShapes.length > 0) {
      pushHistory();
      for (const s of selectedShapes) {
        updateTextShape(s, undefined, undefined, value);
      }
      rebuildSolverAndParams();
      initialSolve();
      updateDOFDisplay();
      renderLayers();
      render();
    }
  });

  document.getElementById('text-spacing').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value) || 0;
    textSettings.letterSpacing = value;
    const selectedShapes = getSelectedShapes().filter(s => isTextShape(s));
    if (selectedShapes.length > 0) {
      pushHistory();
      for (const s of selectedShapes) {
        updateTextShape(s, undefined, undefined, undefined, value);
      }
      rebuildSolverAndParams();
      initialSolve();
      updateDOFDisplay();
      renderLayers();
      render();
    }
  });

  document.getElementById('text-split').addEventListener('click', () => {
    const selectedShapes = getSelectedShapes().filter(s => isTextShape(s));
    if (selectedShapes.length === 0) {
      showToast('Select a text shape to split', 'warning');
      return;
    }
    pushHistory();
    const newShapes = [];
    const indicesToRemove = [];
    for (const textShape of selectedShapes) {
      const chars = splitTextIntoCharacters(textShape);
      if (chars.length > 0) {
        const idx = shapes.findIndex(s => s.id === textShape.id);
        if (idx >= 0) indicesToRemove.push(idx);
        newShapes.push(...chars);
      }
    }
    indicesToRemove.sort((a, b) => b - a);
    for (const idx of indicesToRemove) {
      shapes.splice(idx, 1);
    }
    selectedIds.clear();
    for (const s of newShapes) {
      shapes.push(s);
      selectedIds.add(s.id);
    }
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    updateDOFDisplay();
    updateTextPanel();
    renderLayers();
    renderConstraintList();
    render();
    showToast('Split into ' + newShapes.length + ' characters', 'success');
  });

  document.getElementById('text-on-path').addEventListener('click', () => {
    const selectedShapes = getSelectedShapes();
    const textShapes = selectedShapes.filter(s => isTextShape(s));
    const pathShapes = selectedShapes.filter(s => !isTextShape(s) && !isComponentInstance(s));
    
    if (textShapes.length === 0) {
      showToast('Select a text shape and a path shape', 'warning');
      return;
    }
    if (pathShapes.length === 0) {
      showToast('Select a path shape to put text on', 'warning');
      return;
    }
    if (textShapes.length > 1) {
      showToast('Select only one text shape', 'warning');
      return;
    }
    
    pushHistory();
    const textShape = textShapes[0];
    const pathShape = pathShapes[0];
    const pathPts = worldPointsOf(pathShape);
    
    const success = putTextOnPath(textShape, pathPts);
    if (success) {
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDOFDisplay();
      renderLayers();
      render();
      showToast('Text placed on path', 'success');
    } else {
      showToast('Failed to put text on path', 'error');
    }
  });

  document.getElementById('create-component').addEventListener('click', () => {
    if (editingComponentId === null) openCreateComponentDialog();
  });

  document.getElementById('create-component-close').addEventListener('click', closeCreateComponentDialog);
  document.getElementById('create-component-cancel').addEventListener('click', closeCreateComponentDialog);
  document.getElementById('create-component-ok').addEventListener('click', () => {
    const name = componentNameInputEl.value.trim() || ('Component ' + (Object.keys(components).length + 1));
    createComponentFromSelection(name);
    closeCreateComponentDialog();
  });
  componentNameInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('create-component-ok').click();
    else if (e.key === 'Escape') closeCreateComponentDialog();
  });

  document.getElementById('exit-component-edit').addEventListener('click', exitComponentEditMode);

  document.getElementById('delete-component-close').addEventListener('click', closeDeleteComponentDialog);
  document.getElementById('delete-component-cancel').addEventListener('click', closeDeleteComponentDialog);
  document.getElementById('delete-component-ok').addEventListener('click', () => {
    if (pendingComponentToDelete !== null) {
      deleteComponent(pendingComponentToDelete);
      pendingComponentToDelete = null;
    }
    closeDeleteComponentDialog();
  });

  document.getElementById('instance-override-close').addEventListener('click', closeInstanceOverrideDialog);
  document.getElementById('instance-override-cancel').addEventListener('click', closeInstanceOverrideDialog);
  document.getElementById('instance-override-ok').addEventListener('click', applyInstanceOverrides);

  document.getElementById('reset-override-fill').addEventListener('click', () => {
    overrideFillColorEl.value = '#808080';
    if (tempOverrides) delete tempOverrides.fill;
  });
  document.getElementById('reset-override-stroke').addEventListener('click', () => {
    overrideStrokeColorEl.value = '#000000';
    if (tempOverrides) delete tempOverrides.stroke;
  });
  overrideFillColorEl.addEventListener('input', () => {
    if (tempOverrides) tempOverrides.fill = overrideFillColorEl.value;
  });
  overrideStrokeColorEl.addEventListener('input', () => {
    if (tempOverrides) tempOverrides.stroke = overrideStrokeColorEl.value;
  });

  const mpCloseBtn = document.getElementById('motion-path-close');
  if (mpCloseBtn) {
    mpCloseBtn.addEventListener('click', () => {
      const panel = document.getElementById('motion-path-panel');
      if (panel) panel.classList.add('hidden');
    });
  }

  const mpPathSelect = document.getElementById('mp-path-select');
  if (mpPathSelect) {
    mpPathSelect.addEventListener('change', (e) => {
      const selectedShapes = getSelectedShapes();
      const targets = selectedShapes.filter(s => s.type !== 'motion-path' && !isComponentInstance(s));
      if (targets.length === 0) return;
      pushHistory();
      const pathId = e.target.value ? parseInt(e.target.value, 10) : null;
      for (const target of targets) {
        if (pathId) {
          const existing = motionPathManager.getBinding(target.id);
          motionPathManager.setBinding(target.id, {
            pathShapeId: pathId,
            startOffset: existing ? existing.startOffset : 0,
            autoOrient: existing ? existing.autoOrient : false,
            loopMode: existing ? existing.loopMode : 'loop'
          });
        } else {
          motionPathManager.removeBinding(target.id);
        }
      }
      scheduleSave();
      render();
    });
  }

  const mpOffset = document.getElementById('mp-offset');
  const mpOffsetValue = document.getElementById('mp-offset-value');
  if (mpOffset) {
    mpOffset.addEventListener('input', (e) => {
      const selectedShapes = getSelectedShapes();
      const targets = selectedShapes.filter(s => s.type !== 'motion-path' && !isComponentInstance(s));
      if (mpOffsetValue) mpOffsetValue.textContent = e.target.value + '%';
      if (targets.length === 0) return;
      const offsetVal = (parseFloat(e.target.value) || 0) / 100;
      for (const target of targets) {
        const b = motionPathManager.getBinding(target.id);
        if (b) b.startOffset = offsetVal;
      }
      scheduleSave();
      render();
    });
  }

  const mpOrient = document.getElementById('mp-orient');
  if (mpOrient) {
    mpOrient.addEventListener('change', (e) => {
      const selectedShapes = getSelectedShapes();
      const targets = selectedShapes.filter(s => s.type !== 'motion-path' && !isComponentInstance(s));
      if (targets.length === 0) return;
      pushHistory();
      for (const target of targets) {
        const b = motionPathManager.getBinding(target.id);
        if (b) b.autoOrient = e.target.checked;
      }
      scheduleSave();
      render();
    });
  }

  const mpLoop = document.getElementById('mp-loop');
  if (mpLoop) {
    mpLoop.addEventListener('change', (e) => {
      const selectedShapes = getSelectedShapes();
      const targets = selectedShapes.filter(s => s.type !== 'motion-path' && !isComponentInstance(s));
      if (targets.length === 0) return;
      pushHistory();
      for (const target of targets) {
        const b = motionPathManager.getBinding(target.id);
        if (b) b.loopMode = e.target.value;
      }
      scheduleSave();
      render();
    });
  }

  const mpAddKf = document.getElementById('mp-add-kf');
  if (mpAddKf) {
    mpAddKf.addEventListener('click', () => {
      const selectedShapes = getSelectedShapes();
      const pathShapes = selectedShapes.filter(s => s.type === 'motion-path');
      if (pathShapes.length === 0) return;
      pushHistory();
      const ps = pathShapes[0];
      if (!ps.motionPathData) ps.motionPathData = {};
      if (!ps.motionPathData.speedKeyframes) ps.motionPathData.speedKeyframes = [{pathT:0,speedFactor:1},{pathT:1,speedFactor:1}];
      let newT = 0.5;
      if (ps.motionPathData.speedKeyframes.length >= 2) {
        const sorted = [...ps.motionPathData.speedKeyframes].sort((a,b)=>a.pathT-b.pathT);
        newT = (sorted[0].pathT + sorted[sorted.length-1].pathT) / 2;
      }
      ps.motionPathData.speedKeyframes.push({ pathT: newT, speedFactor: 1 });
      motionPathManager.invalidatePathCache(ps.id);
      updateMotionPathPanel();
      render();
    });
  }

  canvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const cidStr = e.dataTransfer.getData('application/component');
    if (cidStr) {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      if (editingComponentId !== null) {
        if (checkCircularReference(parseInt(cidStr, 10), editingComponentId)) {
          showToast('Circular reference detected - cannot nest this component', 'error');
          return;
        }
        addInstanceToEditingComponent(parseInt(cidStr, 10), world.x, world.y);
      } else {
        createInstanceAt(parseInt(cidStr, 10), world.x, world.y);
      }
    }
  });

  document.getElementById('export-svg').addEventListener('click', () => {
    showExportDialog();
  });

  function runBooleanOp(operation) {
    const sel = getSelectedShapes();
    if (sel.length < 2) { showToast('Select 2 shapes first', 'warning'); return; }
    // 蒙版图形不能参与布尔运算
    if (sel.some(s => isMaskShape(s))) {
      showToast('Mask shapes cannot participate in boolean operations', 'warning');
      return;
    }
    const subject = sel[0];
    const clip = sel[1];
    const subjectPts = worldPointsOf(subject);
    const clipPts = worldPointsOf(clip);
    try {
      const result = weilerAtherton(subjectPts, clipPts, operation);
      if (!result.polygons || result.polygons.length === 0) {
        showToast('No result for this operation', 'warning');
        return;
      }
      pushHistory();
      const newShapes = [];
      const baseFill = subject.fill;
      for (let i = 0; i < result.polygons.length; i++) {
        const poly = result.polygons[i];
        if (poly.length < 3) continue;
        const holes = result.holes && result.holes[i] ? [result.holes[i]] : [];
        const s = createShape(poly, baseFill, holes);
        newShapes.push(s);
      }
      if (newShapes.length === 0) {
        showToast('No valid result', 'warning');
        return;
      }
      const removeIds = [subject.id, clip.id];
      for (const rid of removeIds) {
        dimensionSystem.removeDimensionsForShape(rid);
      }
      shapes = shapes.filter(s => !removeIds.includes(s.id));
      constraints = constraints.filter(c => {
        const rps = c.getReferencedPoints();
        for (const rp of rps) {
          const { shapeId } = parsePointId(rp);
          if (removeIds.includes(shapeId)) return false;
        }
        return true;
      });
      for (const s of newShapes) shapes.push(s);
      selectedIds.clear();
      for (const s of newShapes) selectedIds.add(s.id);
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDimensionPanel();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      render();
      const opName = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect' }[operation];
      showToast(opName + ': ' + newShapes.length + ' shape(s)', 'success');
    } catch (e) {
      console.error(e);
      showToast('Boolean op failed: ' + e.message, 'error');
    }
  }

  document.getElementById('op-union').addEventListener('click', () => runBooleanOp('union'));
  document.getElementById('op-subtract').addEventListener('click', () => runBooleanOp('subtract'));
  document.getElementById('op-intersect').addEventListener('click', () => runBooleanOp('intersect'));

  document.getElementById('mask-clip').addEventListener('click', () => {
    const sel = getSelectedShapes();
    if (sel.length !== 2) return;
    const sorted = sel.slice().sort((a, b) => {
      return shapes.findIndex(s => s.id === a.id) - shapes.findIndex(s => s.id === b.id);
    });
    const maskedShape = sorted[0];
    const maskShape = sorted[1];
    pushHistory();
    const success = createClipMask(maskedShape.id, maskShape.id);
    if (success) {
      showToast('Clip mask created', 'success');
      selectedIds.clear();
      selectedIds.add(maskedShape.id);
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      render();
    } else {
      showToast('Failed to create clip mask', 'error');
    }
  });

  document.getElementById('mask-alpha').addEventListener('click', () => {
    const sel = getSelectedShapes();
    if (sel.length !== 2) return;
    const sorted = sel.slice().sort((a, b) => {
      return shapes.findIndex(s => s.id === a.id) - shapes.findIndex(s => s.id === b.id);
    });
    const maskedShape = sorted[0];
    const maskShape = sorted[1];
    pushHistory();
    const success = createAlphaMask(maskedShape.id, maskShape.id);
    if (success) {
      showToast('Alpha mask created', 'success');
      selectedIds.clear();
      selectedIds.add(maskedShape.id);
      rebuildSolverAndParams();
      initialSolve();
      updateToolbar();
      updateDOFDisplay();
      renderLayers();
      renderConstraintList();
      render();
    } else {
      showToast('Failed to create alpha mask', 'error');
    }
  });

  document.getElementById('mask-release').addEventListener('click', () => {
    const sel = getSelectedShapes();
    const maskShapes = sel.filter(s => isMaskShape(s));
    if (maskShapes.length === 0) return;
    pushHistory();
    for (const mask of maskShapes) {
      releaseMask(mask.id);
    }
    showToast('Mask(s) released', 'success');
    rebuildSolverAndParams();
    initialSolve();
    updateToolbar();
    updateDOFDisplay();
    renderLayers();
    renderConstraintList();
    render();
  });

  document.querySelectorAll('.constraint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      startConstraintMode(type);
    });
  });

  document.querySelectorAll('#constraint-menu .menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type;
      constraintMenuEl.classList.add('hidden');
      if (canAddConstraint(type)) {
        tryAddConstraint(type);
      } else {
        constraintMode = type;
        isNodeEditMode = true;
        updateToolbar();
        updateDOFDisplay();
        showToast('Select more elements for ' + type + ' (need ' + getConstraintSelectionHint(type));
      }
    });
  });

  function getConstraintSelectionHint(type) {
    switch (type) {
      case CONSTRAINT_TYPES.COINCIDENT: return '2 points';
      case CONSTRAINT_TYPES.POINT_ON_LINE: return '1 point + 1 edge';
      case CONSTRAINT_TYPES.PARALLEL:
      case CONSTRAINT_TYPES.PERPENDICULAR:
      case CONSTRAINT_TYPES.EQUAL_LENGTH: return '2 edges';
      case CONSTRAINT_TYPES.FIXED_ANGLE: return '1 edge';
      case CONSTRAINT_TYPES.DISTANCE:
      case CONSTRAINT_TYPES.HORIZONTAL:
      case CONSTRAINT_TYPES.VERTICAL: return '2 points';
      default: return '';
    }
  }

  function renderConstraintMenuAvailability() {
    document.querySelectorAll('#constraint-menu .menu-item').forEach(item => {
      const type = item.dataset.type;
      if (canAddConstraint(type)) {
        item.classList.remove('disabled');
      } else {
        item.classList.add('disabled');
      }
    });
  }

  document.addEventListener('click', (e) => {
    if (!constraintMenuEl.contains(e.target)) {
      constraintMenuEl.classList.add('hidden');
    }
  });

  document.getElementById('dim-unit').addEventListener('change', (e) => {
    dimensionSystem.settings.unit = e.target.value;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    updateDimensionPanel();
    render();
    scheduleSave();
  });
  document.getElementById('dim-scale').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) || 1;
    dimensionSystem.settings.scaleFactor = v;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    render();
    scheduleSave();
  });
  document.getElementById('dim-precision').addEventListener('input', (e) => {
    const v = parseInt(e.target.value) || 2;
    dimensionSystem.settings.precision = v;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    render();
    scheduleSave();
  });
  document.getElementById('dim-textsize').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) || 14;
    dimensionSystem.settings.textSize = v;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    render();
    scheduleSave();
  });
  document.getElementById('dim-linecolor').addEventListener('input', (e) => {
    dimensionSystem.settings.lineColor = e.target.value;
    render();
    scheduleSave();
  });
  document.getElementById('dim-textcolor').addEventListener('input', (e) => {
    dimensionSystem.settings.textColor = e.target.value;
    render();
    scheduleSave();
  });
  document.getElementById('dim-linewidth').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) || 1.5;
    dimensionSystem.settings.lineWidth = v;
    render();
    scheduleSave();
  });
  document.getElementById('dim-arrowsize').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) || 8;
    dimensionSystem.settings.arrowSize = v;
    render();
    scheduleSave();
  });
  document.getElementById('dim-offset').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value) || 20;
    dimensionSystem.settings.offset = v;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    render();
    scheduleSave();
  });
  document.getElementById('dim-showunits').addEventListener('change', (e) => {
    dimensionSystem.settings.showUnits = e.target.checked;
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    render();
    scheduleSave();
  });
  document.getElementById('clear-dimensions').addEventListener('click', () => {
    if (dimensionSystem.dimensions.length === 0) return;
    if (!confirm('Clear all dimensions?')) return;
    pushHistory();
    dimensionSystem.clearAll();
    selectedDimensionId = null;
    updateDimensionPanel();
    render();
    scheduleSave();
    showToast('All dimensions cleared');
  });

  document.getElementById('clear-constraints').addEventListener('click', clearAllConstraints);
  document.getElementById('add-param').addEventListener('click', addParam);

  document.getElementById('align-left').addEventListener('click', () => alignShapes('left'));
  document.getElementById('align-center').addEventListener('click', () => alignShapes('center'));
  document.getElementById('align-right').addEventListener('click', () => alignShapes('right'));
  document.getElementById('align-top').addEventListener('click', () => alignShapes('top'));
  document.getElementById('align-middle').addEventListener('click', () => alignShapes('middle'));
  document.getElementById('align-bottom').addEventListener('click', () => alignShapes('bottom'));
  document.getElementById('distribute-h').addEventListener('click', () => distributeShapes('horizontal'));
  document.getElementById('distribute-v').addEventListener('click', () => distributeShapes('vertical'));

  document.getElementById('constraint-edit-close').addEventListener('click', closeConstraintEditDialog);
  document.getElementById('constraint-edit-cancel').addEventListener('click', closeConstraintEditDialog);
  document.getElementById('constraint-edit-ok').addEventListener('click', applyConstraintEdit);

  function applyTransform(points, tx, ty, rot, sx, sy) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    return points.map(p => {
      const rx = p.x * sx, ry = p.y * sy;
      return {
        x: rx * cos - ry * sin + tx,
        y: rx * sin + ry * cos + ty
      };
    });
  }

  function applyTransformInverse(points, tx, ty, rot, sx, sy) {
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const isx = Math.abs(sx) < 1e-10 ? 0 : 1 / sx;
    const isy = Math.abs(sy) < 1e-10 ? 0 : 1 / sy;
    return points.map(p => {
      const px = (p.x - tx) * cos - (p.y - ty) * sin;
      const py = (p.x - tx) * sin + (p.y - ty) * cos;
      return { x: px * isx, y: py * isy };
    });
  }

  function applyTransformToHoles(holes, t) {
    return holes.map(h => applyTransform(h, t.tx, t.ty, t.rotation, t.scaleX, t.scaleY));
  }

  function pointInPolygonOrOnEdge(pt, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      if (pointToSegmentDist(pt, poly[i], poly[j]) < EPS) return true;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointToSegmentDist(pt, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = pt.x - a.x, apy = pt.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx, cy = a.y + t * aby;
    return Math.hypot(pt.x - cx, pt.y - cy);
  }

  function randomFillColor() {
    const palette = [
      '#e3f2fd', '#bbdefb', '#90caf9', '#64b5f6', '#42a5f5',
      '#e8f5e9', '#c8e6c9', '#a5d6a7', '#81c784', '#66bb6a',
      '#fff3e0', '#ffe0b2', '#ffcc80', '#ffb74d', '#ffa726',
      '#fce4ec', '#f8bbd0', '#f48fb1', '#f06292',
      '#f3e5f5', '#e1bee7', '#ce93d8', '#ba68c8',
      '#e0f7fa', '#b2ebf2', '#80deea', '#4dd0e1',
      '#fff8e1', '#ffecb3', '#ffe082', '#ffd54f',
      '#efebe9', '#d7ccc8', '#bcaaa4', '#a1887f'
    ];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  function initDemo() {
    try {
      if (pages.length === 0) {
        const page = createPageData('Page 1');
        pages.push(page);
        currentPageId = page.id;
      }

      const r1pts = [
        { x: -200, y: -100 }, { x: -50, y: -100 }, { x: -50, y: 50 }, { x: -200, y: 50 }
      ];
      const r1 = createShape(r1pts, '#bbdefb');
      shapes.push(r1);

      const r2pts = [
        { x: 50, y: -80 }, { x: 200, y: -80 }, { x: 200, y: 70 }, { x: 50, y: 70 }
      ];
      const r2 = createShape(r2pts, '#c8e6c9');
      shapes.push(r2);

      try {
        paramsData.width = { value: 150, expression: null };
        paramManager.addParam('width', 150);
        paramsData.height = { value: 130, expression: null };
        paramManager.addParam('height', 130);

        rebuildSolverAndParams();
        initialSolve();
      } catch (e) {
        console.warn('Constraint setup failed in initDemo:', e);
      }

      updateDOFDisplay();
    } catch (e) {
      console.warn('initDemo partially failed:', e);
    }

    try {
      saveCurrentPageState();
    } catch (e) {
      console.warn('saveCurrentPageState failed in initDemo:', e);
    }

    try {
      renderPageTabs();
      renderLayers();
      renderConstraintList();
      renderParams();
      renderComponentsList();
      render();
    } catch (e) {
      console.warn('Render failed in initDemo:', e);
    }

    try {
      scheduleSave();
    } catch (e) {
      console.warn('scheduleSave failed in initDemo:', e);
    }
  }

  function saveOriginalShapes() {
    originalShapeData = shapes.map(s => ({
      id: s.id,
      points: s.points.map(p => ({ ...p })),
      holes: s.holes.map(h => h.map(p => ({ ...p }))),
      transform: { ...s.transform },
      fill: s.fill,
      opacity: s.opacity
    }));
  }

  function restoreOriginalShapes() {
    if (!originalShapeData) return;
    for (const data of originalShapeData) {
      const shape = getShapeById(data.id);
      if (shape) {
        shape.points = data.points.map(p => ({ ...p }));
        shape.holes = data.holes.map(h => h.map(p => ({ ...p })));
        shape.transform = { ...data.transform };
        shape.fill = data.fill;
        if (shape.opacity !== undefined) {
          shape.opacity = data.opacity;
        }
      }
    }
  }

  function applyAnimationToShapes(frame) {
    for (const s of shapes) {
      if (!s.visible) continue;
      if (isComponentInstance(s)) continue;

      const baseProps = {
        tx: s.transform.tx,
        ty: s.transform.ty,
        rotation: s.transform.rotation,
        scaleX: s.transform.scaleX,
        scaleY: s.transform.scaleY,
        fill: s.fill,
        opacity: s.opacity !== undefined ? s.opacity : 1
      };

      const animProps = animationController.getShapePropertiesAtFrame(s.id, frame, baseProps);

      s.transform.tx = animProps.tx;
      s.transform.ty = animProps.ty;
      s.transform.rotation = animProps.rotation;
      s.transform.scaleX = animProps.scaleX;
      s.transform.scaleY = animProps.scaleY;
      s.fill = animProps.fill;
      s.opacity = animProps.opacity;
    }
  }

  function solveWithAnimation() {
    if (constraints.length === 0) return;

    const fixedPoints = new Set();
    for (const s of shapes) {
      if (!s.visible || s.locked) continue;
      if (isComponentInstance(s)) continue;
      const pts = s.points;
      for (let i = 0; i < pts.length; i++) {
        fixedPoints.add(makePointId(s.id, false, -1, i) + '_x');
        fixedPoints.add(makePointId(s.id, false, -1, i) + '_y');
      }
      if (s.holes) {
        for (let h = 0; h < s.holes.length; h++) {
          const hole = s.holes[h];
          for (let i = 0; i < hole.length; i++) {
            fixedPoints.add(makePointId(s.id, true, h, i) + '_x');
            fixedPoints.add(makePointId(s.id, true, h, i) + '_y');
          }
        }
      }
    }

    const wasLocked = {};
    for (const s of shapes) {
      wasLocked[s.id] = s.locked;
      s.locked = true;
    }

    runSolver(fixedPoints, null, 20);

    for (const s of shapes) {
      s.locked = wasLocked[s.id] || false;
    }
  }

  function updateAnimationFrame(frame) {
    const isPreviewing = frame > 0 || animationController.isPlaying;

    if (isPreviewing && originalShapeData === null) {
      saveOriginalShapes();
    }

    if (originalShapeData !== null) {
      restoreOriginalShapes();
    }

    if (frame > 0 || animationController.isPlaying) {
      applyAnimationToShapes(frame);

      if (constraints.length > 0) {
        const fixedPoints = new Set();
        for (const s of shapes) {
          if (!s.visible) continue;
          if (isComponentInstance(s)) continue;
          if (animationController.shapeHasKeyframes(s.id)) {
            const pts = s.points;
            for (let i = 0; i < pts.length; i++) {
              fixedPoints.add(makePointId(s.id, false, -1, i) + '_x');
              fixedPoints.add(makePointId(s.id, false, -1, i) + '_y');
            }
            if (s.holes) {
              for (let h = 0; h < s.holes.length; h++) {
                const hole = s.holes[h];
                for (let i = 0; i < hole.length; i++) {
                  fixedPoints.add(makePointId(s.id, true, h, i) + '_x');
                  fixedPoints.add(makePointId(s.id, true, h, i) + '_y');
                }
              }
            }
          }
        }

        const pointMap = buildPointMap();
        constraintSolver.solve(pointMap, fixedPoints, null, 20);
        applyPointMap(pointMap);
      }
    }

    updatePlayheadPosition();
    updateFrameInfo();
    render();

    if (!isPreviewing && originalShapeData !== null) {
      originalShapeData = null;
    }
  }

  function initTimeline() {
    animationController.onFrameChange((frame) => {
      updateAnimationFrame(frame);
      scheduleSave();
    });

    animationController.onPlayStateChange((isPlaying) => {
      updatePlayPauseButton();
      if (isPlaying && originalShapeData === null && animationController.currentFrame > 0) {
        saveOriginalShapes();
      }
    });

    const timelinePanel = document.getElementById('timeline-panel');
    const toggleBtn = document.getElementById('timeline-toggle');
    const header = document.querySelector('.timeline-header');

    header.addEventListener('click', (e) => {
      if (e.target.closest('.timeline-controls')) return;
      toggleTimeline();
    });
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimeline();
    });

    document.getElementById('btn-play-pause').addEventListener('click', togglePlayPause);
    document.getElementById('btn-go-start').addEventListener('click', goToStart);
    document.getElementById('btn-go-end').addEventListener('click', goToEnd);
    document.getElementById('btn-prev-frame').addEventListener('click', prevFrame);
    document.getElementById('btn-next-frame').addEventListener('click', nextFrame);

    document.getElementById('chk-loop').addEventListener('change', (e) => {
      animationController.setLoop(e.target.checked);
    });

    document.getElementById('sel-speed').addEventListener('change', (e) => {
      animationController.setSpeed(parseFloat(e.target.value));
    });

    document.getElementById('sel-fps').addEventListener('change', (e) => {
      const fps = parseInt(e.target.value, 10);
      animationController.setFPS(fps);
      renderTimelineRuler();
      renderTimelineTracks();
      updatePlayheadPosition();
      updateFrameInfo();
    });

    document.getElementById('input-duration').addEventListener('change', (e) => {
      const duration = parseFloat(e.target.value);
      if (duration > 0) {
        animationController.setDuration(duration);
        renderTimelineRuler();
        renderTimelineTracks();
        updatePlayheadPosition();
        updateFrameInfo();
      }
    });

    document.getElementById('btn-add-keyframe').addEventListener('click', addKeyframeFromUI);

    const ruler = document.getElementById('timeline-ruler');
    let isDraggingPlayhead = false;

    ruler.addEventListener('mousedown', (e) => {
      isDraggingPlayhead = true;
      scrubPlayhead(e);
    });

    document.addEventListener('mousemove', (e) => {
      if (isDraggingPlayhead) {
        scrubPlayhead(e);
      }
    });

    document.addEventListener('mouseup', () => {
      isDraggingPlayhead = false;
    });

    document.getElementById('btn-export-png').addEventListener('click', exportPNGSequence);
    document.getElementById('btn-export-gif').addEventListener('click', exportGIF);

    renderTimelineRuler();
    renderTimelineTracks();
    updatePlayheadPosition();
    updateFrameInfo();
    updatePlayPauseButton();

    setTimeout(() => {
      renderTimelineRuler();
      renderTimelineTracks();
      updatePlayheadPosition();
    }, 100);
  }

  function toggleTimeline() {
    const panel = document.getElementById('timeline-panel');
    timelineCollapsed = !timelineCollapsed;
    if (timelineCollapsed) {
      panel.classList.add('collapsed');
    } else {
      panel.classList.remove('collapsed');
      setTimeout(() => {
        renderTimelineRuler();
        renderTimelineTracks();
        updatePlayheadPosition();
      }, 200);
    }
    setTimeout(resize, 250);
  }

  function scrubPlayhead(e) {
    const ruler = document.getElementById('timeline-ruler');
    const rect = ruler.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const frame = Math.round(ratio * animationController.getTotalFrames());
    animationController.goToFrame(frame);
  }

  function togglePlayPause() {
    if (animationController.isPlaying) {
      animationController.pause();
    } else {
      animationController.play();
    }
  }

  function goToStart() {
    animationController.goToFrame(0);
  }

  function goToEnd() {
    animationController.goToFrame(animationController.getTotalFrames());
  }

  function prevFrame() {
    animationController.prevFrame();
  }

  function nextFrame() {
    animationController.nextFrame();
  }

  function updatePlayPauseButton() {
    const playIcon = document.getElementById('icon-play');
    const pauseIcon = document.getElementById('icon-pause');
    if (animationController.isPlaying) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }

  function updatePlayheadPosition() {
    const playhead = document.getElementById('playhead');
    const ruler = document.getElementById('timeline-ruler');
    if (!ruler || ruler.offsetWidth === 0) return;
    const totalFrames = animationController.getTotalFrames();
    const ratio = totalFrames > 0 ? animationController.currentFrame / totalFrames : 0;
    playhead.style.left = (ratio * ruler.offsetWidth) + 'px';
  }

  function updateFrameInfo() {
    const frame = animationController.currentFrame;
    const total = animationController.getTotalFrames();
    const time = animationController.getCurrentTime();
    document.getElementById('timeline-frame-info').textContent =
      `Frame: ${frame} / ${total} (${time.toFixed(2)}s)`;
  }

  function renderTimelineRuler() {
    const canvas = document.getElementById('ruler-canvas');
    const container = document.getElementById('timeline-ruler');
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const totalFrames = animationController.getTotalFrames();
    const fps = animationController.fps;

    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';

    const majorInterval = fps;
    const minorInterval = fps / 6;

    for (let i = 0; i <= totalFrames; i++) {
      const x = (i / totalFrames) * width;
      if (i % majorInterval === 0) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 18);
        ctx.stroke();
        const seconds = (i / fps).toFixed(0);
        const text = seconds + 's';
        ctx.fillText(text, x + 3, 10);
      } else if (i % minorInterval === 0) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 10);
        ctx.stroke();
      }
    }
  }

  function renderTimelineTracks() {
    const container = document.getElementById('timeline-tracks-content');
    if (!container) return;

    container.innerHTML = '';

    const animatedShapes = animationController.getAnimatedShapes();

    if (animatedShapes.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-tracks';
      empty.textContent = 'Select a shape and add keyframes to start animating';
      container.appendChild(empty);
      return;
    }

    for (const shapeIdStr of animatedShapes) {
      const shapeId = parseInt(shapeIdStr, 10);
      const shape = getShapeById(shapeId);
      if (!shape) continue;

      const shapeAnim = animationController.shapeAnimations[shapeIdStr];
      if (!shapeAnim) continue;

      const group = document.createElement('div');
      group.className = 'shape-track-group';

      const header = document.createElement('div');
      header.className = 'shape-track-header';
      header.innerHTML = `
        <span class="shape-color" style="background:${shape.fill}"></span>
        <span>${shape.name}</span>
      `;
      group.appendChild(header);

      const props = ['tx', 'ty', 'rotation', 'scaleX', 'opacity', 'fill'];
      const propLabels = {
        tx: 'Position X',
        ty: 'Position Y',
        rotation: 'Rotation',
        scaleX: 'Scale',
        opacity: 'Opacity',
        fill: 'Fill Color'
      };

      for (const prop of props) {
        const track = shapeAnim.getPropertyTrack(prop);
        if (!track || track.keyframes.length === 0) continue;

        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.shapeId = shapeId;
        row.dataset.prop = prop;

        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = propLabels[prop] || prop;
        row.appendChild(label);

        const trackCanvas = document.createElement('div');
        trackCanvas.className = 'track-canvas';
        trackCanvas.dataset.shapeId = shapeId;
        trackCanvas.dataset.prop = prop;

        const canvasEl = document.createElement('canvas');
        trackCanvas.appendChild(canvasEl);

        for (const kf of track.keyframes) {
          const dot = document.createElement('div');
          dot.className = 'keyframe-dot';
          dot.dataset.shapeId = shapeId;
          dot.dataset.prop = prop;
          dot.dataset.frame = kf.frame;
          const totalFrames = animationController.getTotalFrames();
          dot.style.left = ((kf.frame / totalFrames) * 100) + '%';

          if (selectedKeyframeShapeId === shapeId &&
              selectedKeyframeProp === prop &&
              selectedKeyframeFrame === kf.frame) {
            dot.classList.add('selected');
          }

          dot.addEventListener('click', (e) => {
            e.stopPropagation();
            selectKeyframe(shapeId, prop, kf.frame);
          });

          dot.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (confirm('Delete this keyframe?')) {
              animationController.removeKeyframe(shapeId, prop, kf.frame);
              selectedKeyframeShapeId = null;
              selectedKeyframeProp = null;
              selectedKeyframeFrame = null;
              renderTimelineTracks();
              scheduleSave();
            }
          });

          trackCanvas.appendChild(dot);
        }

        trackCanvas.addEventListener('click', (e) => {
          const rect = trackCanvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const ratio = x / rect.width;
          const frame = Math.round(ratio * animationController.getTotalFrames());
          animationController.goToFrame(frame);
        });

        row.appendChild(trackCanvas);
        group.appendChild(row);
      }

      container.appendChild(group);
    }
  }

  function selectKeyframe(shapeId, prop, frame) {
    selectedKeyframeShapeId = shapeId;
    selectedKeyframeProp = prop;
    selectedKeyframeFrame = frame;
    renderTimelineTracks();

    const easing = animationController.getKeyframeEasing(shapeId, prop, frame);
    if (easing) {
      document.getElementById('sel-easing').value = easing;
    }
  }

  function addKeyframeFromUI() {
    if (selectedIds.size === 0) {
      showToast('Select a shape to add keyframe', 'warning');
      return;
    }

    const frame = animationController.currentFrame;
    const easing = document.getElementById('sel-easing').value;

    for (const id of selectedIds) {
      const shape = getShapeById(id);
      if (!shape) continue;

      const props = [
        { name: 'tx', value: shape.transform.tx },
        { name: 'ty', value: shape.transform.ty },
        { name: 'rotation', value: shape.transform.rotation },
        { name: 'scaleX', value: shape.transform.scaleX },
        { name: 'opacity', value: shape.opacity !== undefined ? shape.opacity : 1 },
        { name: 'fill', value: shape.fill }
      ];

      for (const p of props) {
        animationController.addKeyframe(id, p.name, frame, p.value, easing);
      }
    }

    renderTimelineTracks();
    scheduleSave();
    showToast('Keyframe added', 'success');
  }

  document.getElementById('sel-easing').addEventListener('change', (e) => {
    if (selectedKeyframeShapeId !== null && selectedKeyframeProp !== null && selectedKeyframeFrame !== null) {
      animationController.setKeyframeEasing(
        selectedKeyframeShapeId,
        selectedKeyframeProp,
        selectedKeyframeFrame,
        e.target.value
      );
      scheduleSave();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      togglePlayPause();
    }

    if (e.key === '.' || e.key === '>') {
      e.preventDefault();
      nextFrame();
    }
    if (e.key === ',' || e.key === '<') {
      e.preventDefault();
      prevFrame();
    }

    if (e.key === 'Delete' && selectedKeyframeShapeId !== null) {
      e.preventDefault();
      animationController.removeKeyframe(
        selectedKeyframeShapeId,
        selectedKeyframeProp,
        selectedKeyframeFrame
      );
      selectedKeyframeShapeId = null;
      selectedKeyframeProp = null;
      selectedKeyframeFrame = null;
      renderTimelineTracks();
      scheduleSave();
    }
  });

  function getAnimationBounds() {
    const totalFrames = animationController.getTotalFrames();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const originalFrame = animationController.currentFrame;
    const originalPlaying = animationController.isPlaying;
    animationController.pause();

    for (let i = 0; i <= totalFrames; i++) {
      animationController.goToFrame(i);
      for (const s of shapes) {
        if (!s.visible) continue;
        if (s.type === 'motion-path') continue;
        let pts = getAnimatedWorldPoints(s, i);
        for (const p of pts) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
    }

    animationController.goToFrame(originalFrame);
    if (originalPlaying) animationController.play();

    if (minX === Infinity) {
      return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    }

    return { minX, minY, maxX, maxY };
  }

  function drawFrameToContext(ctx, frame, bounds, padding) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.translate(padding - bounds.minX, padding - bounds.minY);

    function drawPolygonPath(ctx, pts, holes) {
      ctx.beginPath();
      if (pts.length > 0) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let j = 1; j < pts.length; j++) {
          ctx.lineTo(pts[j].x, pts[j].y);
        }
        ctx.closePath();
      }
      if (holes && holes.length > 0) {
        for (const hole of holes) {
          if (hole.length > 0) {
            ctx.moveTo(hole[0].x, hole[0].y);
            for (let j = 1; j < hole.length; j++) {
              ctx.lineTo(hole[j].x, hole[j].y);
            }
            ctx.closePath();
          }
        }
      }
    }

    function applyClipMasksToCtx(ctx, masks, frame) {
      if (masks.length === 0) return;
      const clipMasks = masks.filter(m => getMaskType(m) === 'clip');
      if (clipMasks.length === 0) return;
      for (const mask of clipMasks) {
        const maskPts = getAnimatedWorldPoints(mask, frame);
        const maskHoles = getAnimatedWorldHoles(mask, frame);
        drawPolygonPath(ctx, maskPts, maskHoles);
      }
      ctx.clip('evenodd');
    }

    function drawShapeWithAlphaMask(ctx, s, masks, frame, animProps, fillTransform, rawFill, pts, holes) {
      const alphaMasks = masks.filter(m => getMaskType(m) === 'alpha');
      if (alphaMasks.length === 0) {
        drawShapeSimple(ctx, s, animProps, fillTransform, rawFill, pts, holes);
        return;
      }

      const allBounds = getBounds(pts);
      for (const mask of alphaMasks) {
        const maskPts = getAnimatedWorldPoints(mask, frame);
        const mb = getBounds(maskPts);
        allBounds.minX = Math.min(allBounds.minX, mb.minX);
        allBounds.minY = Math.min(allBounds.minY, mb.minY);
        allBounds.maxX = Math.max(allBounds.maxX, mb.maxX);
        allBounds.maxY = Math.max(allBounds.maxY, mb.maxY);
      }

      const pad = 2;
      const x = allBounds.minX - pad;
      const y = allBounds.minY - pad;
      const w = allBounds.maxX - allBounds.minX + pad * 2;
      const h = allBounds.maxY - allBounds.minY + pad * 2;

      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const octx = offscreen.getContext('2d');
      octx.translate(-x, -y);

      const savedCtx = ctx;
      ctx = octx;
      drawShapeSimple(ctx, s, animProps, fillTransform, rawFill, pts, holes);
      ctx = savedCtx;

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = w;
      maskCanvas.height = h;
      const mctx = maskCanvas.getContext('2d');
      mctx.translate(-x, -y);

      for (let i = 0; i < alphaMasks.length; i++) {
        const mask = alphaMasks[i];
        const maskPts = getAnimatedWorldPoints(mask, frame);
        const maskHoles = getAnimatedWorldHoles(mask, frame);
        
        const maskFill = ensureFillStructure(mask.fill);
        const maskFillColor = getFillDisplayColor(maskFill);

        if (i === 0) {
          mctx.save();
          drawPolygonPath(mctx, maskPts, maskHoles);
          mctx.fillStyle = maskFillColor;
          mctx.globalAlpha = 1;
          mctx.fill('evenodd');
          mctx.restore();
        } else {
          mctx.globalCompositeOperation = 'destination-in';
          mctx.save();
          drawPolygonPath(mctx, maskPts, maskHoles);
          mctx.fillStyle = maskFillColor;
          mctx.fill('evenodd');
          mctx.restore();
          mctx.globalCompositeOperation = 'source-over';
        }
      }

      const maskImgData = mctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      const shapeImgData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
      const maskData = maskImgData.data;
      const shapeData = shapeImgData.data;

      for (let i = 0; i < shapeData.length; i += 4) {
        const maskAlpha = maskData[i] / 255;
        shapeData[i + 3] = shapeData[i + 3] * maskAlpha;
      }

      octx.putImageData(shapeImgData, 0, 0);
      savedCtx.drawImage(offscreen, x, y, w, h);
    }

    function drawShapeSimple(ctx, s, animProps, fillTransform, rawFill, pts, holes) {
      ctx.save();
      ctx.globalAlpha = animProps.opacity;
      if (typeof rawFill === 'string') {
        ctx.fillStyle = rawFill;
      } else {
        ctx.fillStyle = getCanvasFillStyle(ctx, rawFill, fillTransform, pts);
      }
      ctx.strokeStyle = s.stroke || '#000';
      ctx.lineWidth = s.strokeWidth || 2;
      drawPolygonPath(ctx, pts, holes);
      ctx.fill('evenodd');
      ctx.stroke();
      ctx.restore();
    }

    for (const s of shapes) {
      if (!s.visible) continue;
      if (s.type === 'motion-path') continue;
      if (isMaskShape(s)) continue;

      if (isComponentInstance(s)) {
        const expanded = getInstanceExpandedShapes(s);
        const animProps = getAnimatedShapeProps(s, frame);
        for (const es of expanded) {
          const ePts = es.points;
          const eHoles = es.holes || [];
          ctx.save();
          ctx.globalAlpha = animProps.opacity;
          const rawFill = ensureFillStructure(animProps.fill);
          if (typeof rawFill === 'string') {
            ctx.fillStyle = rawFill;
          } else {
            ctx.fillStyle = getCanvasFillStyle(ctx, rawFill, { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 }, ePts);
          }
          ctx.strokeStyle = es.stroke || '#000';
          ctx.lineWidth = es.strokeWidth || 2;

          ctx.beginPath();
          if (ePts.length > 0) {
            ctx.moveTo(ePts[0].x, ePts[0].y);
            for (let j = 1; j < ePts.length; j++) {
              ctx.lineTo(ePts[j].x, ePts[j].y);
            }
            ctx.closePath();
          }
          ctx.fill('evenodd');
          ctx.stroke();
          ctx.restore();
        }
        continue;
      }

      const pts = getAnimatedWorldPoints(s, frame);
      const holes = getAnimatedWorldHoles(s, frame);
      const animProps = getAnimatedShapeProps(s, frame);
      const rawFill = ensureFillStructure(animProps.fill);
      const fillTransform = {
        tx: animProps.tx, ty: animProps.ty,
        rotation: animProps.rotation,
        scaleX: animProps.scaleX, scaleY: animProps.scaleY
      };

      const masks = getMasksOfShape(s.id);
      if (masks.length === 0) {
        drawShapeSimple(ctx, s, animProps, fillTransform, rawFill, pts, holes);
      } else {
        const clipMasks = masks.filter(m => getMaskType(m) === 'clip');
        const alphaMasks = masks.filter(m => getMaskType(m) === 'alpha');
        
        if (alphaMasks.length === 0) {
          ctx.save();
          applyClipMasksToCtx(ctx, masks, frame);
          drawShapeSimple(ctx, s, animProps, fillTransform, rawFill, pts, holes);
          ctx.restore();
        } else {
          ctx.save();
          applyClipMasksToCtx(ctx, clipMasks, frame);
          drawShapeWithAlphaMask(ctx, s, alphaMasks, frame, animProps, fillTransform, rawFill, pts, holes);
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }

  async function exportPNGSequence() {
    showToast('Rendering PNG sequence...', 'info');

    try {
      const totalFrames = animationController.getTotalFrames();
      const pngData = [];

      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');

      const wasPlaying = animationController.isPlaying;
      const originalFrame = animationController.currentFrame;
      animationController.pause();

      showToast('Calculating bounds...', 'info');
      const bounds = getAnimationBounds();
      const padding = 20;

      const exportW = Math.ceil((bounds.maxX - bounds.minX + padding * 2));
      const exportH = Math.ceil((bounds.maxY - bounds.minY + padding * 2));

      tempCanvas.width = exportW;
      tempCanvas.height = exportH;

      for (let i = 0; i <= totalFrames; i++) {
        animationController.goToFrame(i);
        drawFrameToContext(tempCtx, i, bounds, padding);

        const dataUrl = tempCanvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        const frameNum = String(i).padStart(String(totalFrames).length, '0');
        pngData.push({
          filename: `frame_${frameNum}.png`,
          data: base64
        });

        if (i % 10 === 0) {
          showToast(`Rendering frame ${i}/${totalFrames}...`, 'info');
          await new Promise(r => setTimeout(r, 10));
        }
      }

      animationController.goToFrame(originalFrame);
      if (wasPlaying) animationController.play();

      const zip = new window.ZIPWriter();
      for (const item of pngData) {
        const binaryStr = atob(item.data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        zip.addFile(item.filename, bytes);
      }
      const zipData = zip.generate();
      const blob = new Blob([zipData], { type: 'application/zip' });
      downloadBlob(blob, 'animation_frames.zip');

      showToast('PNG sequence exported', 'success');
    } catch (err) {
      console.error('Export failed:', err);
      showToast('Export failed: ' + err.message, 'error');
    }
  }

  function getCanvasContentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const s of shapes) {
      if (!s.visible) continue;
      const pts = worldPointsOf(s);
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }

    if (minX === Infinity) {
      return { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    }

    return { minX, minY, maxX, maxY };
  }

  async function exportGIF() {
    showToast('Rendering GIF...', 'info');

    try {
      const totalFrames = animationController.getTotalFrames();
      const fps = animationController.fps;
      const delay = Math.round(100 / fps);

      const wasPlaying = animationController.isPlaying;
      const originalFrame = animationController.currentFrame;
      animationController.pause();

      showToast('Calculating bounds...', 'info');
      const bounds = getAnimationBounds();
      const padding = 20;
      const exportW = Math.ceil((bounds.maxX - bounds.minX + padding * 2));
      const exportH = Math.ceil((bounds.maxY - bounds.minY + padding * 2));

      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      tempCanvas.width = exportW;
      tempCanvas.height = exportH;

      const gifEncoder = new window.GIFEncoder(exportW, exportH);
      gifEncoder.start();
      gifEncoder.setRepeat(0);
      gifEncoder.setDelay(delay);

      for (let i = 0; i <= totalFrames; i++) {
        animationController.goToFrame(i);
        drawFrameToContext(tempCtx, i, bounds, padding);

        const imageData = tempCtx.getImageData(0, 0, exportW, exportH);
        gifEncoder.addFrame(imageData);

        if (i % 5 === 0) {
          showToast(`Encoding GIF frame ${i}/${totalFrames}...`, 'info');
          await new Promise(r => setTimeout(r, 10));
        }
      }

      gifEncoder.finish();

      animationController.goToFrame(originalFrame);
      if (wasPlaying) animationController.play();

      const gifData = gifEncoder.out.getData();
      const byteArray = new Uint8Array(gifData.length);
      for (let i = 0; i < gifData.length; i++) {
        byteArray[i] = gifData.charCodeAt(i) & 0xff;
      }
      const blob = new Blob([byteArray], { type: 'image/gif' });
      downloadBlob(blob, 'animation.gif');

      showToast('GIF exported successfully', 'success');
    } catch (err) {
      console.error('GIF export failed:', err);
      showToast('GIF export failed: ' + err.message, 'error');
    }
  }

  function base64ToBlob(base64, type) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: type });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.addEventListener('resize', () => {
    if (!timelineCollapsed) {
      setTimeout(() => {
        renderTimelineRuler();
        renderTimelineTracks();
        updatePlayheadPosition();
      }, 50);
    }
  });

  function drawPatternTile(ctx, patternType, size, fgColor, bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = fgColor;
    ctx.fillStyle = fgColor;
    ctx.lineWidth = Math.max(1, size / 10);

    switch (patternType) {
      case 'diagonal':
        ctx.beginPath();
        ctx.moveTo(-size * 0.5, size * 0.5);
        ctx.lineTo(size * 0.5, -size * 0.5);
        ctx.moveTo(0, size);
        ctx.lineTo(size, 0);
        ctx.moveTo(size * 0.5, size * 1.5);
        ctx.lineTo(size * 1.5, size * 0.5);
        ctx.stroke();
        break;
      case 'grid':
        ctx.beginPath();
        ctx.moveTo(0, size / 2);
        ctx.lineTo(size, size / 2);
        ctx.moveTo(size / 2, 0);
        ctx.lineTo(size / 2, size);
        ctx.stroke();
        ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
        break;
      case 'dots':
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'checkerboard':
        ctx.fillRect(0, 0, size / 2, size / 2);
        ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
        break;
    }
  }

  function createPatternCanvas(patternType, fgColor, bgColor) {
    const baseSize = 20;
    const size = Math.max(4, baseSize);
    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = size;
    patternCanvas.height = size;
    const pctx = patternCanvas.getContext('2d');
    drawPatternTile(pctx, patternType, size, fgColor, bgColor);
    return patternCanvas;
  }

  function getCanvasFillStyle(ctx, fill, shapeTransform, shapePoints) {
    if (!fill) return '#ccc';
    if (typeof fill === 'string') return fill;

    if (fill.type === 'solid') {
      return fill.color || '#ccc';
    }

    if (fill.type === 'linear') {
      const t = shapeTransform;
      const p1 = applyTransform([{ x: fill.x1, y: fill.y1 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const p2 = applyTransform([{ x: fill.x2, y: fill.y2 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      const stops = fill.stops || [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }];
      for (const stop of stops) {
        gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
      }
      return gradient;
    }

    if (fill.type === 'radial') {
      const t = shapeTransform;
      const center = applyTransform([{ x: fill.cx, y: fill.cy }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const scaleFactor = Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY));
      const radius = (fill.r || 50) * scaleFactor;
      const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(1, radius));
      const stops = fill.stops || [{ offset: 0, color: '#000' }, { offset: 1, color: '#fff' }];
      for (const stop of stops) {
        gradient.addColorStop(Math.max(0, Math.min(1, stop.offset)), stop.color);
      }
      return gradient;
    }

    if (fill.type === 'pattern') {
      const patternCanvas = createPatternCanvas(
        fill.pattern || 'diagonal',
        fill.fgColor || '#000',
        fill.bgColor || '#fff'
      );
      const pattern = ctx.createPattern(patternCanvas, 'repeat');
      if (pattern) {
        const t = shapeTransform;
        const patternRot = (fill.rotation || 0) * Math.PI / 180;
        const totalRot = t.rotation + patternRot;
        const cos = Math.cos(totalRot);
        const sin = Math.sin(totalRot);
        const patternScale = fill.scale || 1;
        pattern.setTransform(new DOMMatrix([
          cos * t.scaleX * patternScale, sin * t.scaleX * patternScale,
          -sin * t.scaleY * patternScale, cos * t.scaleY * patternScale,
          t.tx, t.ty
        ]));
      }
      return pattern;
    }

    return '#ccc';
  }

  function renderGradientHandles() {
    if (selectedIds.size !== 1) return;
    const shape = getShapeById([...selectedIds][0]);
    if (!shape || !shape.fill || typeof shape.fill === 'string') return;

    const t = shape.transform;
    const hitRadius = 10 / viewport.scale;

    if (shape.fill.type === 'linear') {
      const p1 = applyTransform([{ x: shape.fill.x1, y: shape.fill.y1 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const p2 = applyTransform([{ x: shape.fill.x2, y: shape.fill.y2 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];

      ctx.save();
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, hitRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e53935';
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, hitRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (shape.fill.type === 'radial') {
      const center = applyTransform([{ x: shape.fill.cx, y: shape.fill.cy }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const scaleFactor = Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY));
      const radius = (shape.fill.r || 50) * scaleFactor;
      const edgePoint = { x: center.x + radius, y: center.y };

      ctx.save();
      ctx.strokeStyle = '#1a73e8';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(edgePoint.x, edgePoint.y);
      ctx.stroke();

      ctx.fillStyle = '#1a73e8';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / viewport.scale;
      ctx.beginPath();
      ctx.arc(center.x, center.y, hitRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e53935';
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(edgePoint.x, edgePoint.y, hitRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function hitTestGradientHandle(wx, wy) {
    if (selectedIds.size !== 1) return null;
    const shape = getShapeById([...selectedIds][0]);
    if (!shape || !shape.fill || typeof shape.fill === 'string') return null;

    const t = shape.transform;
    const hitRadius = 12 / viewport.scale;

    if (shape.fill.type === 'linear') {
      const p1 = applyTransform([{ x: shape.fill.x1, y: shape.fill.y1 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const p2 = applyTransform([{ x: shape.fill.x2, y: shape.fill.y2 }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      if (dist({ x: wx, y: wy }, p1) < hitRadius) return { type: 'linear-p1', shapeId: shape.id };
      if (dist({ x: wx, y: wy }, p2) < hitRadius) return { type: 'linear-p2', shapeId: shape.id };
    } else if (shape.fill.type === 'radial') {
      const center = applyTransform([{ x: shape.fill.cx, y: shape.fill.cy }], t.tx, t.ty, t.rotation, t.scaleX, t.scaleY)[0];
      const scaleFactor = Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY));
      const radius = (shape.fill.r || 50) * scaleFactor;
      const edgePoint = { x: center.x + radius, y: center.y };
      if (dist({ x: wx, y: wy }, center) < hitRadius) return { type: 'radial-center', shapeId: shape.id };
      if (dist({ x: wx, y: wy }, edgePoint) < hitRadius) return { type: 'radial-radius', shapeId: shape.id };
    }
    return null;
  }

  function updateRenderShape() {
    const originalRenderShape = renderShape;
    window._originalRenderShape = originalRenderShape;
  }

  function renderPatternPreviews() {
    document.querySelectorAll('.pattern-preview').forEach(canvas => {
      const patternType = canvas.dataset.pattern;
      if (!patternType) return;
      const pctx = canvas.getContext('2d');
      pctx.clearRect(0, 0, canvas.width, canvas.height);
      drawPatternTile(pctx, patternType, canvas.width, '#333', '#fff');
    });
  }

  function renderStopsBar(barEl, stops) {
    if (!stops || stops.length === 0) return;
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    const gradientParts = sorted.map(s => `${s.color} ${(s.offset * 100).toFixed(1)}%`);
    barEl.style.background = `linear-gradient(90deg, ${gradientParts.join(', ')})`;
  }

  function renderStopsList(listEl, stops, onStopChange, onStopDelete) {
    listEl.innerHTML = '';
    if (!stops) return;
    stops.forEach((stop, idx) => {
      const row = document.createElement('div');
      row.className = 'stop-item';

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = stop.color;
      colorInput.addEventListener('input', () => {
        stop.color = colorInput.value;
        onStopChange();
      });

      const offsetInput = document.createElement('input');
      offsetInput.type = 'number';
      offsetInput.min = '0';
      offsetInput.max = '1';
      offsetInput.step = '0.01';
      offsetInput.value = stop.offset.toFixed(2);
      offsetInput.addEventListener('input', () => {
        let val = parseFloat(offsetInput.value);
        if (isNaN(val)) val = 0;
        val = Math.max(0, Math.min(1, val));
        stop.offset = val;
        onStopChange();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'stop-delete';
      delBtn.textContent = '×';
      delBtn.title = 'Delete stop';
      delBtn.disabled = stops.length <= 2;
      delBtn.style.opacity = stops.length <= 2 ? '0.3' : '1';
      delBtn.style.cursor = stops.length <= 2 ? 'not-allowed' : 'pointer';
      delBtn.addEventListener('click', () => {
        if (stops.length > 2) {
          onStopDelete(idx);
        }
      });

      row.appendChild(colorInput);
      row.appendChild(offsetInput);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  function updateFillPanel() {
    const fillTypeEl = document.getElementById('fill-type');
    const solidSection = document.getElementById('fill-solid-section');
    const linearSection = document.getElementById('fill-linear-section');
    const radialSection = document.getElementById('fill-radial-section');
    const patternSection = document.getElementById('fill-pattern-section');

    if (selectedIds.size !== 1) {
      fillTypeEl.disabled = true;
      solidSection.classList.add('hidden');
      linearSection.classList.add('hidden');
      radialSection.classList.add('hidden');
      patternSection.classList.add('hidden');
      return;
    }

    const shape = getShapeById([...selectedIds][0]);
    if (!shape) {
      fillTypeEl.disabled = true;
      return;
    }

    shape.fill = ensureFillStructure(shape.fill);
    fillTypeEl.disabled = false;
    fillTypeEl.value = shape.fill.type;

    solidSection.classList.add('hidden');
    linearSection.classList.add('hidden');
    radialSection.classList.add('hidden');
    patternSection.classList.add('hidden');

    if (shape.fill.type === 'solid') {
      solidSection.classList.remove('hidden');
      document.getElementById('fill-solid-color').value = shape.fill.color || '#4d9fff';
    } else if (shape.fill.type === 'linear') {
      linearSection.classList.remove('hidden');
      const barEl = document.getElementById('linear-stops-bar');
      const listEl = document.getElementById('linear-stops-list');
      renderStopsBar(barEl, shape.fill.stops);
      renderStopsList(listEl, shape.fill.stops,
        () => {
          renderStopsBar(barEl, shape.fill.stops);
          render();
          scheduleSave();
        },
        (idx) => {
          shape.fill.stops.splice(idx, 1);
          renderStopsBar(barEl, shape.fill.stops);
          renderStopsList(listEl, shape.fill.stops,
            () => { renderStopsBar(barEl, shape.fill.stops); render(); scheduleSave(); },
            (i) => { shape.fill.stops.splice(i, 1); renderStopsBar(barEl, shape.fill.stops); render(); scheduleSave(); }
          );
          render();
          scheduleSave();
        }
      );
    } else if (shape.fill.type === 'radial') {
      radialSection.classList.remove('hidden');
      const barEl = document.getElementById('radial-stops-bar');
      const listEl = document.getElementById('radial-stops-list');
      renderStopsBar(barEl, shape.fill.stops);
      renderStopsList(listEl, shape.fill.stops,
        () => {
          renderStopsBar(barEl, shape.fill.stops);
          render();
          scheduleSave();
        },
        (idx) => {
          shape.fill.stops.splice(idx, 1);
          renderStopsBar(barEl, shape.fill.stops);
          renderStopsList(listEl, shape.fill.stops,
            () => { renderStopsBar(barEl, shape.fill.stops); render(); scheduleSave(); },
            (i) => { shape.fill.stops.splice(i, 1); renderStopsBar(barEl, shape.fill.stops); render(); scheduleSave(); }
          );
          render();
          scheduleSave();
        }
      );
    } else if (shape.fill.type === 'pattern') {
      patternSection.classList.remove('hidden');
      document.querySelectorAll('.pattern-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.pattern === shape.fill.pattern);
      });
      document.getElementById('pattern-scale').value = shape.fill.scale || 1;
      document.getElementById('pattern-scale-value').textContent = (shape.fill.scale || 1).toFixed(1) + 'x';
      document.getElementById('pattern-rotation').value = shape.fill.rotation || 0;
      document.getElementById('pattern-fg-color').value = shape.fill.fgColor || '#000000';
      document.getElementById('pattern-bg-color').value = shape.fill.bgColor || '#ffffff';
    }
  }

  function initFillPanel() {
    renderPatternPreviews();

    document.getElementById('fill-type').addEventListener('change', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape) return;
      pushHistory();

      const pts = shape.points;
      const bounds = getBounds(pts);
      const newType = e.target.value;

      if (newType === 'solid') {
        const existingColor = getFillDisplayColor(shape.fill);
        shape.fill = { type: 'solid', color: existingColor };
      } else if (newType === 'linear') {
        shape.fill = createDefaultLinearGradient(bounds);
      } else if (newType === 'radial') {
        shape.fill = createDefaultRadialGradient(bounds);
      } else if (newType === 'pattern') {
        shape.fill = createDefaultPattern();
      }

      updateFillPanel();
      renderLayers();
      render();
      scheduleSave();
    });

    document.getElementById('fill-solid-color').addEventListener('input', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'solid') return;
      pushHistory();
      shape.fill.color = e.target.value;
      renderLayers();
      render();
      scheduleSave();
    });

    document.getElementById('add-linear-stop').addEventListener('click', () => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'linear') return;
      if (shape.fill.stops.length >= 8) {
        showToast('Maximum 8 color stops allowed', 'warning');
        return;
      }
      pushHistory();
      shape.fill.stops.push({ offset: 0.5, color: '#ffffff' });
      shape.fill.stops.sort((a, b) => a.offset - b.offset);
      updateFillPanel();
      render();
      scheduleSave();
    });

    document.getElementById('add-radial-stop').addEventListener('click', () => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'radial') return;
      if (shape.fill.stops.length >= 8) {
        showToast('Maximum 8 color stops allowed', 'warning');
        return;
      }
      pushHistory();
      shape.fill.stops.push({ offset: 0.5, color: '#ffffff' });
      shape.fill.stops.sort((a, b) => a.offset - b.offset);
      updateFillPanel();
      render();
      scheduleSave();
    });

    document.querySelectorAll('.pattern-item').forEach(item => {
      item.addEventListener('click', () => {
        if (selectedIds.size !== 1) return;
        const shape = getShapeById([...selectedIds][0]);
        if (!shape || !shape.fill || shape.fill.type !== 'pattern') return;
        pushHistory();
        shape.fill.pattern = item.dataset.pattern;
        updateFillPanel();
        render();
        scheduleSave();
      });
    });

    document.getElementById('pattern-scale').addEventListener('input', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'pattern') return;
      const val = parseFloat(e.target.value);
      shape.fill.scale = val;
      document.getElementById('pattern-scale-value').textContent = val.toFixed(1) + 'x';
      render();
      scheduleSave();
    });

    document.getElementById('pattern-rotation').addEventListener('input', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'pattern') return;
      pushHistory();
      let val = parseFloat(e.target.value);
      if (isNaN(val)) val = 0;
      val = ((val % 360) + 360) % 360;
      shape.fill.rotation = val;
      render();
      scheduleSave();
    });

    document.getElementById('pattern-fg-color').addEventListener('input', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'pattern') return;
      pushHistory();
      shape.fill.fgColor = e.target.value;
      render();
      scheduleSave();
    });

    document.getElementById('pattern-bg-color').addEventListener('input', (e) => {
      if (selectedIds.size !== 1) return;
      const shape = getShapeById([...selectedIds][0]);
      if (!shape || !shape.fill || shape.fill.type !== 'pattern') return;
      pushHistory();
      shape.fill.bgColor = e.target.value;
      render();
      scheduleSave();
    });
  }

  function exportFillToSVGDefs(fill, defsMap, shapeId, transform) {
    if (!fill || typeof fill === 'string' || fill.type === 'solid') return null;

    const fillWithTransform = { ...fill, _transform: transform };

    if (fill.type === 'linear') {
      const gradId = `linearGrad_${shapeId}`;
      defsMap[gradId] = fillWithTransform;
      return `url(#${gradId})`;
    }
    if (fill.type === 'radial') {
      const gradId = `radialGrad_${shapeId}`;
      defsMap[gradId] = fillWithTransform;
      return `url(#${gradId})`;
    }
    if (fill.type === 'pattern') {
      const patternId = `pattern_${shapeId}`;
      defsMap[patternId] = fillWithTransform;
      return `url(#${patternId})`;
    }
    return null;
  }

  function generateSVGDefs(defsMap) {
    let defs = '<defs>';
    for (const id in defsMap) {
      const fill = defsMap[id];
      const t = fill._transform || { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 };
      const cos = Math.cos(t.rotation);
      const sin = Math.sin(t.rotation);
      const transformStr = `matrix(${cos * t.scaleX} ${sin * t.scaleX} ${-sin * t.scaleY} ${cos * t.scaleY} ${t.tx} ${t.ty})`;

      if (fill.type === 'linear') {
        defs += `<linearGradient id="${id}" x1="${fill.x1}" y1="${fill.y1}" x2="${fill.x2}" y2="${fill.y2}" gradientUnits="userSpaceOnUse" gradientTransform="${transformStr}">`;
        for (const stop of fill.stops || []) {
          defs += `<stop offset="${(stop.offset * 100).toFixed(1)}%" stop-color="${stop.color}"/>`;
        }
        defs += '</linearGradient>';
      } else if (fill.type === 'radial') {
        defs += `<radialGradient id="${id}" cx="${fill.cx}" cy="${fill.cy}" r="${fill.r}" gradientUnits="userSpaceOnUse" gradientTransform="${transformStr}">`;
        for (const stop of fill.stops || []) {
          defs += `<stop offset="${(stop.offset * 100).toFixed(1)}%" stop-color="${stop.color}"/>`;
        }
        defs += '</radialGradient>';
      } else if (fill.type === 'pattern') {
        const baseSize = 20;
        const patternRot = fill.rotation || 0;
        let patternTransform = '';
        if (patternRot) {
          patternTransform = `rotate(${patternRot}) `;
        }
        const fillScale = fill.scale || 1;
        patternTransform += `scale(${fillScale}) `;
        patternTransform += transformStr;
        defs += `<pattern id="${id}" width="${baseSize}" height="${baseSize}" patternUnits="userSpaceOnUse" patternTransform="${patternTransform.trim()}">`;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = baseSize;
        tempCanvas.height = baseSize;
        const tctx = tempCanvas.getContext('2d');
        drawPatternTile(tctx, fill.pattern || 'diagonal', baseSize, fill.fgColor || '#000', fill.bgColor || '#fff');
        const dataUrl = tempCanvas.toDataURL('image/png');
        defs += `<rect width="${baseSize}" height="${baseSize}" fill="${fill.bgColor || '#fff'}"/>`;
        defs += `<image width="${baseSize}" height="${baseSize}" href="${dataUrl}"/>`;
        defs += '</pattern>';
      }
    }
    defs += '</defs>';
    return defs;
  }

  function patchRenderShape() {
    const originalRenderShape = renderShape;
    renderShape = function(s) {
      const currentFrame = animationController.currentFrame;
      const useAnimation = animationController.isPlaying || animationController.currentFrame > 0;

      if (s.type === 'motion-path') {
        const pts = worldPointsOf(s);
        const opacity = s.opacity !== undefined ? s.opacity : 1;
        ctx.save();
        ctx.globalAlpha = opacity;
        drawOpenPath(pts);
        ctx.lineWidth = (s.strokeWidth || 2) / viewport.scale;
        ctx.strokeStyle = s.stroke || '#8e24aa';
        ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (s.fill) {
          ctx.fillStyle = s.fill;
          drawOpenPath(pts);
          ctx.globalAlpha = opacity * 0.08;
          ctx.fill();
        }
        for (let i = 0; i < pts.length; i++) {
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 3 / viewport.scale, 0, Math.PI * 2);
          ctx.fillStyle = '#8e24aa';
          ctx.globalAlpha = opacity;
          ctx.fill();
        }
        ctx.restore();
        return;
      }

      if (isComponentInstance(s)) {
        if (editingComponentId !== null) {
          if (editingComponentId === s.componentId) {
            return;
          }
        }
        const expanded = getInstanceExpandedShapes(s);
        for (const es of expanded) {
          const pts = es.points;
          const holes = es.holes || [];
          ctx.save();
          let fillColor = es.fill;
          let opacity = 1;
          if (useAnimation) {
            const animProps = getAnimatedShapeProps(s, currentFrame);
            fillColor = animProps.fill;
            opacity = animProps.opacity;
          }
          ctx.globalAlpha = opacity;
          drawPolygonPath(pts, holes);
          const esFill = ensureFillStructure(fillColor);
          if (typeof esFill === 'string') {
            ctx.fillStyle = esFill;
          } else {
            ctx.fillStyle = getCanvasFillStyle(ctx, esFill, { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 }, pts);
          }
          ctx.fill('evenodd');
          ctx.lineWidth = (es.strokeWidth || 2) / viewport.scale;
          ctx.strokeStyle = es.stroke || '#000';
          ctx.stroke();
          ctx.restore();
        }
      } else {
        let animProps = null;
        if (useAnimation) {
          animProps = getAnimatedShapeProps(s, currentFrame);
        }
        let pts = useAnimation ? getAnimatedWorldPoints(s, currentFrame) : worldPointsOf(s);
        let holes = useAnimation ? getAnimatedWorldHoles(s, currentFrame) : worldHolesOf(s);
        let fillColor = useAnimation && animProps ? animProps.fill : s.fill;
        let opacity = useAnimation && animProps ? animProps.opacity : (s.opacity !== undefined ? s.opacity : 1);
        const fillTransform = useAnimation && animProps
          ? { tx: animProps.tx, ty: animProps.ty, rotation: animProps.rotation, scaleX: animProps.scaleX, scaleY: animProps.scaleY }
          : s.transform;

        ctx.save();
        ctx.globalAlpha = opacity;
        drawPolygonPath(pts, holes);
        const shapeFill = ensureFillStructure(fillColor);
        if (typeof shapeFill === 'string') {
          ctx.fillStyle = shapeFill;
        } else {
          ctx.fillStyle = getCanvasFillStyle(ctx, shapeFill, fillTransform, pts);
        }
        ctx.fill('evenodd');
        ctx.lineWidth = (s.strokeWidth || 2) / viewport.scale;
        ctx.strokeStyle = s.stroke || '#000';
        ctx.stroke();
        ctx.restore();
      }
    };
  }

  function patchRender() {
    const originalRender = render;
    render = function() {
      const w = window.innerWidth, h = window.innerHeight;
      if (editingComponentId !== null) {
        ctx.fillStyle = '#faf6f2';
      } else {
        ctx.fillStyle = '#f0f0f0';
      }
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(viewport.scale, viewport.scale);
      ctx.translate(-viewport.x, -viewport.y);
      drawGrid();

      if (editingComponentId !== null) {
        const comp = getComponentById(editingComponentId);
        if (comp) {
          for (const s of comp.shapes) {
            if (s.visible) renderShape(s);
          }
          renderConstraintIcons();
        }
      } else {
        for (const s of shapes) {
          if (s.visible) renderShape(s);
        }

        renderConstraintIcons();
      }

      if (isNodeEditMode) {
        renderNodeEditGlobal();
      } else {
        for (const id of selectedIds) {
          const s = getShapeById(id);
          if (s && s.visible && !s.locked) renderSelection(s);
        }
      }

      if (!isNodeEditMode) {
        renderGradientHandles();
      }

      if (isDrawing && currentTool === 'rect' && drawStart && drawEnd) {
        const x = Math.min(drawStart.x, drawEnd.x), y = Math.min(drawStart.y, drawEnd.y);
        const w2 = Math.abs(drawEnd.x - drawStart.x), h2 = Math.abs(drawEnd.y - drawStart.y);
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
        for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
        if (lastMouseWorld) ctx.lineTo(lastMouseWorld.x, lastMouseWorld.y);
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
        const x = Math.min(marqueeStart.x, marqueeEnd.x), y = Math.min(marqueeStart.y, marqueeEnd.y);
        const w3 = Math.abs(marqueeEnd.x - marqueeStart.x), h3 = Math.abs(marqueeEnd.y - marqueeStart.y);
        ctx.save();
        ctx.fillStyle = 'rgba(77, 159, 255, 0.15)';
        ctx.strokeStyle = '#4d9fff';
        ctx.lineWidth = 1.5 / viewport.scale;
        ctx.setLineDash([4 / viewport.scale, 3 / viewport.scale]);
        ctx.fillRect(x, y, w3, h3);
        ctx.strokeRect(x, y, w3, h3);
        ctx.restore();
      }

      renderConstraintSelection();
      renderSnapGuides();
      ctx.restore();
      zoomEl.textContent = Math.round(viewport.scale * 100) + '%';
    };
  }

  function patchRenderLayers() {
    const originalRenderLayers = renderLayers;
    renderLayers = function() {
      if (editingComponentId !== null) return;
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
        if (isComponentInstance(s)) item.classList.add('is-instance');

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
          if (!s.visible && selectedIds.has(s.id)) {
            selectedIds.delete(s.id);
            if (selectedIds.size === 0) { isNodeEditMode = false; selectedVertex = null; }
          }
          updateToolbar();
          updateFillPanel();
          renderLayers();
          renderComponentsList();
          render();
        });

        const colorSwatch = document.createElement('div');
        colorSwatch.className = 'layer-color';
        let displayFill = getFillDisplayColor(s.fill);
        if (isComponentInstance(s) && s.overrides && s.overrides.fill) {
          displayFill = getFillDisplayColor(s.overrides.fill);
        }
        colorSwatch.style.background = displayFill;

        const nameWrapper = document.createElement('div');
        nameWrapper.style.display = 'flex';
        nameWrapper.style.alignItems = 'center';
        nameWrapper.style.flex = '1';
        nameWrapper.style.minWidth = '0';

        const nameEl = document.createElement('span');
        nameEl.className = 'layer-name';
        if (isComponentInstance(s)) {
          const comp = getComponentById(s.componentId);
          nameEl.textContent = comp ? comp.name : s.name;
        } else {
          nameEl.textContent = s.name;
        }
        nameEl.title = isComponentInstance(s) ? 'Component Instance - Double-click to edit component' : 'Double-click to rename';
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (isComponentInstance(s)) {
            enterComponentEditMode(s.componentId);
          } else {
            startRenameLayer(item, s, nameEl);
          }
        });

        if (isComponentInstance(s)) {
          const badge = document.createElement('span');
          badge.className = 'layer-badge';
          badge.textContent = 'C';
          nameWrapper.appendChild(badge);
        }
        nameWrapper.appendChild(nameEl);

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
            selectedVertex = null;
            isNodeEditMode = false;
          }
          updateToolbar();
          updateFillPanel();
          renderLayers();
          render();
        });

        item.appendChild(visibilityBtn);
        item.appendChild(colorSwatch);
        item.appendChild(nameWrapper);

        if (isComponentInstance(s)) {
          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'instance-context-actions';

          const overrideBtn = document.createElement('button');
          overrideBtn.className = 'instance-action-btn';
          overrideBtn.innerHTML = '🎨';
          overrideBtn.title = 'Instance Overrides';
          overrideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openInstanceOverrideDialog(s.id);
          });

          const unlinkBtn = document.createElement('button');
          unlinkBtn.className = 'instance-action-btn';
          unlinkBtn.innerHTML = '⟳';
          unlinkBtn.title = 'Unlink Instance';
          unlinkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            unlinkInstance(s.id);
          });

          const editBtn = document.createElement('button');
          editBtn.className = 'instance-action-btn';
          editBtn.innerHTML = '✎';
          editBtn.title = 'Edit Source Component';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            enterComponentEditMode(s.componentId);
          });

          actionsDiv.appendChild(overrideBtn);
          actionsDiv.appendChild(unlinkBtn);
          actionsDiv.appendChild(editBtn);
          item.appendChild(actionsDiv);
        }

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
          selectedVertex = null;
          constraintSelection = [];
          updateToolbar();
          updateFillPanel();
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
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
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
    };
  }

  function patchExportSVG() {
    const exportBtn = document.getElementById('export-svg');
    const oldListeners = exportBtn.cloneNode(true);
    exportBtn.parentNode.replaceChild(oldListeners, exportBtn);

    document.getElementById('export-svg').addEventListener('click', () => {
      showExportDialog();
    });
  }

  function patchBooleanOp() {
    const originalRunBooleanOp = runBooleanOp;
    runBooleanOp = function(operation) {
      const sel = getSelectedShapes();
      if (sel.length < 2) { showToast('Select 2 shapes first', 'warning'); return; }
      const subject = sel[0];
      const clip = sel[1];
      const subjectPts = worldPointsOf(subject);
      const clipPts = worldPointsOf(clip);
      try {
        const result = weilerAtherton(subjectPts, clipPts, operation);
        if (!result.polygons || result.polygons.length === 0) {
          showToast('No result for this operation', 'warning');
          return;
        }
        pushHistory();
        const newShapes = [];
        const baseFill = JSON.parse(JSON.stringify(ensureFillStructure(subject.fill)));
        for (let i = 0; i < result.polygons.length; i++) {
          const poly = result.polygons[i];
          if (poly.length < 3) continue;
          const holes = result.holes && result.holes[i] ? [result.holes[i]] : [];
          const s = createShape(poly, baseFill, holes);
          s.fill = JSON.parse(JSON.stringify(baseFill));
          s.stroke = subject.stroke || '#000';
          s.strokeWidth = subject.strokeWidth || 2;
          newShapes.push(s);
        }
        if (newShapes.length === 0) {
          showToast('No valid result', 'warning');
          return;
        }
        const removeIds = [subject.id, clip.id];
        shapes = shapes.filter(s => !removeIds.includes(s.id));
        constraints = constraints.filter(c => {
          const rps = c.getReferencedPoints();
          for (const rp of rps) {
            const { shapeId } = parsePointId(rp);
            if (removeIds.includes(shapeId)) return false;
          }
          return true;
        });
        for (const s of newShapes) shapes.push(s);
        selectedIds.clear();
        for (const s of newShapes) selectedIds.add(s.id);
        rebuildSolverAndParams();
        initialSolve();
        updateToolbar();
        updateFillPanel();
        updateDOFDisplay();
        renderLayers();
        renderConstraintList();
        render();
        const opName = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect' }[operation];
        showToast(opName + ': ' + newShapes.length + ' shape(s)', 'success');
      } catch (e) {
        console.error(e);
        showToast('Boolean op failed: ' + e.message, 'error');
      }
    };
  }

  function patchMouseHandlers() {
    const canvasEl = document.getElementById('canvas');

    const originalMouseDown = canvasEl.onmousedown;
    canvasEl.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);

      if (!isNodeEditMode && !isDrawing && !isPanning && !isMarquee) {
        const handleHit = hitTestGradientHandle(world.x, world.y);
        if (handleHit) {
          e.preventDefault();
          e.stopPropagation();
          isDraggingGradientHandle = true;
          gradientDragType = handleHit.type;
          gradientDragShapeId = handleHit.shapeId;
          pushHistory();
          return;
        }
      }
    }, true);

    const originalMouseMove = window.onmousemove;
    window.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);
      lastMouseWorld = world;

      if (isDraggingGradientHandle && gradientDragShapeId !== null) {
        const shape = getShapeById(gradientDragShapeId);
        if (!shape || !shape.fill || typeof shape.fill === 'string') return;

        const t = shape.transform;
        const invCos = Math.cos(-t.rotation);
        const invSin = Math.sin(-t.rotation);
        const isx = Math.abs(t.scaleX) < 1e-10 ? 0 : 1 / t.scaleX;
        const isy = Math.abs(t.scaleY) < 1e-10 ? 0 : 1 / t.scaleY;
        const localX = (world.x - t.tx) * invCos - (world.y - t.ty) * invSin;
        const localY = (world.x - t.tx) * invSin + (world.y - t.ty) * invCos;
        const localPoint = { x: localX * isx, y: localY * isy };

        if (gradientDragType === 'linear-p1') {
          shape.fill.x1 = localPoint.x;
          shape.fill.y1 = localPoint.y;
        } else if (gradientDragType === 'linear-p2') {
          shape.fill.x2 = localPoint.x;
          shape.fill.y2 = localPoint.y;
        } else if (gradientDragType === 'radial-center') {
          shape.fill.cx = localPoint.x;
          shape.fill.cy = localPoint.y;
        } else if (gradientDragType === 'radial-radius') {
          const center = { x: shape.fill.cx, y: shape.fill.cy };
          shape.fill.r = Math.max(5, dist(localPoint, center));
        }
        updateFillPanel();
        render();
        return;
      }

      if (!isNodeEditMode && !isDrawing && !isDraggingShape && !isTransforming && !isPanning && !isMarquee) {
        const handleHit = hitTestGradientHandle(world.x, world.y);
        if (handleHit) {
          canvas.style.cursor = 'pointer';
        }
      }
    });

    const originalMouseUp = window.onmouseup;
    window.addEventListener('mouseup', () => {
      if (isDraggingGradientHandle) {
        isDraggingGradientHandle = false;
        gradientDragType = null;
        gradientDragShapeId = null;
        scheduleSave();
      }
    });
  }

  function patchLoadState() {
    const originalLoadState = loadStateFromStorage;
    loadStateFromStorage = function() {
      const result = originalLoadState();
      if (result) {
        for (const s of shapes) {
          s.fill = ensureFillStructure(s.fill);
        }
      }
      return result;
    };
  }

  function patchDrawComponentIcon() {
    const originalDraw = drawComponentIcon;
    drawComponentIcon = function(canvas, component) {
      const c = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      c.clearRect(0, 0, w, h);
      const bounds = computeComponentBounds(component);
      const bw = bounds.maxX - bounds.minX;
      const bh = bounds.maxY - bounds.minY;
      if (bw < 1 || bh < 1) return;
      const padding = 4;
      const scale = Math.min((w - padding * 2) / bw, (h - padding * 2) / bh);
      const offsetX = (w - bw * scale) / 2 - bounds.minX * scale;
      const offsetY = (h - bh * scale) / 2 - bounds.minY * scale;
      c.save();
      c.translate(offsetX, offsetY);
      c.scale(scale, scale);
      const expanded = expandComponentShapes(component, { tx: 0, ty: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      for (const s of expanded) {
        c.beginPath();
        const pts = s.points;
        if (pts.length > 0) {
          c.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
          c.closePath();
        }
        const holes = s.holes || [];
        for (const hole of holes) {
          if (hole.length > 0) {
            c.moveTo(hole[0].x, hole[0].y);
            for (let i = 1; i < hole.length; i++) c.lineTo(hole[i].x, hole[i].y);
            c.closePath();
          }
        }
        const fill = ensureFillStructure(s.fill);
        if (fill.type === 'solid' || typeof fill === 'string') {
          c.fillStyle = getFillDisplayColor(fill);
        } else {
          c.fillStyle = getFillDisplayColor(fill);
        }
        c.fill('evenodd');
        c.lineWidth = 2 / scale;
        c.strokeStyle = s.stroke || '#000';
        c.stroke();
      }
      c.restore();
    };
  }

  function patchAnimationSystem() {
    if (typeof saveOriginalShapes === 'function') {
      const orig = saveOriginalShapes;
      saveOriginalShapes = function() {
        originalShapeData = shapes.map(s => ({
          id: s.id,
          points: s.points.map(p => ({ ...p })),
          holes: (s.holes || []).map(h => h.map(p => ({ ...p }))),
          transform: { ...s.transform },
          fill: JSON.parse(JSON.stringify(ensureFillStructure(s.fill))),
          opacity: s.opacity
        }));
      };
    }

    if (typeof restoreOriginalShapes === 'function') {
      const orig = restoreOriginalShapes;
      restoreOriginalShapes = function() {
        if (!originalShapeData) return;
        for (const data of originalShapeData) {
          const shape = getShapeById(data.id);
          if (shape) {
            shape.points = data.points.map(p => ({ ...p }));
            shape.holes = (data.holes || []).map(h => h.map(p => ({ ...p })));
            shape.transform = { ...data.transform };
            shape.fill = JSON.parse(JSON.stringify(data.fill));
            if (shape.opacity !== undefined) {
              shape.opacity = data.opacity;
            }
          }
        }
      };
    }

    if (typeof applyAnimationToShapes === 'function') {
      const orig = applyAnimationToShapes;
      applyAnimationToShapes = function(frame) {
        for (const s of shapes) {
          if (!s.visible) continue;
          if (isComponentInstance(s)) continue;

          const baseFill = ensureFillStructure(s.fill);
          const baseFillAnim = baseFill.type === 'solid' ? baseFill.color : getFillDisplayColor(baseFill);

          const baseProps = {
            tx: s.transform.tx,
            ty: s.transform.ty,
            rotation: s.transform.rotation,
            scaleX: s.transform.scaleX,
            scaleY: s.transform.scaleY,
            fill: baseFillAnim,
            opacity: s.opacity !== undefined ? s.opacity : 1
          };

          const animProps = animationController.getShapePropertiesAtFrame(s.id, frame, baseProps);

          s.transform.tx = animProps.tx;
          s.transform.ty = animProps.ty;
          s.transform.rotation = animProps.rotation;
          s.transform.scaleX = animProps.scaleX;
          s.transform.scaleY = animProps.scaleY;
          if (s.fill && (typeof s.fill === 'string' || s.fill.type === 'solid')) {
            if (typeof s.fill === 'string') {
              s.fill = { type: 'solid', color: animProps.fill };
            } else {
              s.fill.color = animProps.fill;
            }
          }
          s.opacity = animProps.opacity;
        }
      };
    }
  }

  function patchSaveOriginalShapesRef() {
    window.addEventListener('selectionchange', () => {});
  }

  initFillPanel();
  patchRenderShape();
  patchRender();
  patchRenderLayers();
  patchExportSVG();
  patchBooleanOp();
  patchMouseHandlers();
  patchLoadState();
  patchDrawComponentIcon();
  patchAnimationSystem();

  window.addEventListener('beforeunload', saveStateToStorage);

  if (window.GuideSystem) {
    guideSystem = new window.GuideSystem();
    guideSystem.init();
    guideSystem.setViewport(viewport);
    guideSystem.onGuidesChanged = function() {
      scheduleSave();
    };
  }

  resize();

  const addPageBtn = document.getElementById('add-page-btn');
  if (addPageBtn) {
    addPageBtn.addEventListener('click', () => addNewPage(true));
  }

  const loaded = loadStateFromStorage();
  if (loaded) {
    rebuildSolverAndParams();
    initialSolve();
    dimensionSystem.updateFromShapes(getShapePointsForDim, getShapeHolesForDim);
    updateToolbar();
    updateDimensionPanel();
    updateFillPanel();
    updateMotionPathPanel();
    updateDOFDisplay();
    renderPageTabs();
    renderLayers();
    renderConstraintList();
    renderParams();
    renderComponentsList();
    render();
  } else {
    initDemo();
    updateDimensionPanel();
    updateFillPanel();
    updateMotionPathPanel();
  }

  initTimeline();
})();
