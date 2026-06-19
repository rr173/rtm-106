(function() {
  const RULER_SIZE = 24;
  const GUIDE_SNAP_THRESHOLD = 5;
  const MIN_PIXELS_PER_TICK = 50;

  class GuideSystem {
    constructor() {
      this.guides = [];
      this.rulerH = null;
      this.rulerV = null;
      this.ctxH = null;
      this.ctxV = null;
      this.rulerContainer = null;
      
      this.mouseScreenX = 0;
      this.mouseScreenY = 0;
      
      this.showRulers = true;
      this.showGuides = true;
      this.lockGuides = false;
      this.snapToGuides = true;
      
      this.isDraggingNewGuide = false;
      this.dragGuideOrientation = null;
      this.dragGuidePosition = 0;
      
      this.isDraggingGuide = false;
      this.draggingGuideIndex = -1;
      this.dragOffset = 0;
      
      this.highlightedGuides = new Set();
      
      this.viewport = { x: 0, y: 0, scale: 1 };
      this.nextGuideId = 1;
    }

    init() {
      this.rulerContainer = document.getElementById('ruler-container');
      this.rulerH = document.getElementById('ruler-horizontal');
      this.rulerV = document.getElementById('ruler-vertical');
      this.ctxH = this.rulerH.getContext('2d');
      this.ctxV = this.rulerV.getContext('2d');
      
      this.setupEventListeners();
      this.setupUIListeners();
      this.resizeRulers();
      this.renderRulers();
    }

    setViewport(vp) {
      this.viewport = { ...vp };
      this.renderRulers();
      this.updateGuidePositions();
    }

    setupEventListeners() {
      window.addEventListener('resize', () => {
        this.resizeRulers();
        this.renderRulers();
        this.updateGuidePositions();
      });

      window.addEventListener('mousemove', (e) => {
        this.mouseScreenX = e.clientX;
        this.mouseScreenY = e.clientY;
        this.renderRulers();
        
        if (this.isDraggingNewGuide) {
          this.handleNewGuideDrag(e);
        } else if (this.isDraggingGuide) {
          this.handleGuideDrag(e);
        }
      });

      this.rulerH.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !this.lockGuides) {
          this.startDragNewGuide('horizontal', e.clientY);
        }
      });

      this.rulerV.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !this.lockGuides) {
          this.startDragNewGuide('vertical', e.clientX);
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (this.isDraggingNewGuide) {
          this.finishDragNewGuide();
        } else if (this.isDraggingGuide) {
          this.finishGuideDrag();
        }
      });
    }

    setupUIListeners() {
      const showRulersEl = document.getElementById('guides-show-rulers');
      const showGuidesEl = document.getElementById('guides-show-guides');
      const lockGuidesEl = document.getElementById('guides-lock-guides');
      const snapGuidesEl = document.getElementById('guides-snap-guides');
      const clearAllBtn = document.getElementById('guides-clear-all');

      if (showRulersEl) {
        showRulersEl.addEventListener('change', (e) => {
          this.setShowRulers(e.target.checked);
        });
      }
      
      if (showGuidesEl) {
        showGuidesEl.addEventListener('change', (e) => {
          this.setShowGuides(e.target.checked);
        });
      }
      
      if (lockGuidesEl) {
        lockGuidesEl.addEventListener('change', (e) => {
          this.setLockGuides(e.target.checked);
        });
      }
      
      if (snapGuidesEl) {
        snapGuidesEl.addEventListener('change', (e) => {
          this.snapToGuides = e.target.checked;
        });
      }
      
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
          this.clearAllGuides();
        });
      }
    }

    resizeRulers() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      const dpr = window.devicePixelRatio || 1;
      
      this.rulerH.width = (w - RULER_SIZE) * dpr;
      this.rulerH.height = RULER_SIZE * dpr;
      this.rulerH.style.width = (w - RULER_SIZE) + 'px';
      this.rulerH.style.height = RULER_SIZE + 'px';
      this.ctxH.scale(dpr, dpr);
      
      this.rulerV.width = RULER_SIZE * dpr;
      this.rulerV.height = (h - RULER_SIZE) * dpr;
      this.rulerV.style.width = RULER_SIZE + 'px';
      this.rulerV.style.height = (h - RULER_SIZE) + 'px';
      this.ctxV.scale(dpr, dpr);
    }

    setShowRulers(show) {
      this.showRulers = show;
      if (this.rulerContainer) {
        if (show) {
          this.rulerContainer.classList.remove('rulers-hidden');
        } else {
          this.rulerContainer.classList.add('rulers-hidden');
        }
      }
      this.renderRulers();
    }

    setShowGuides(show) {
      this.showGuides = show;
      const guideLines = document.querySelectorAll('.guide-line');
      const guideLabels = document.querySelectorAll('.guide-label');
      
      guideLines.forEach(el => {
        el.style.display = show ? '' : 'none';
      });
      guideLabels.forEach(el => {
        el.style.display = show ? '' : 'none';
      });
    }

    setLockGuides(lock) {
      this.lockGuides = lock;
    }

    clearAllGuides() {
      this.guides = [];
      this.highlightedGuides.clear();
      this.renderGuideLines();
      this.onGuidesChanged && this.onGuidesChanged();
    }

    startDragNewGuide(orientation, screenPos) {
      this.isDraggingNewGuide = true;
      this.dragGuideOrientation = orientation;
      
      if (orientation === 'horizontal') {
        this.dragGuidePosition = this.screenYToWorld(screenPos);
      } else {
        this.dragGuidePosition = this.screenXToWorld(screenPos);
      }
      
      this.createTempGuideElement(orientation);
    }

    createTempGuideElement(orientation) {
      this.removeTempGuideElement();
      
      const guide = document.createElement('div');
      guide.className = 'guide-line dragging ' + orientation;
      guide.id = 'temp-guide';
      this.rulerContainer.appendChild(guide);
      
      const label = document.createElement('div');
      label.className = 'guide-label ' + orientation;
      label.id = 'temp-guide-label';
      this.rulerContainer.appendChild(label);
      
      this.updateTempGuidePosition();
    }

    removeTempGuideElement() {
      const tempGuide = document.getElementById('temp-guide');
      const tempLabel = document.getElementById('temp-guide-label');
      if (tempGuide) tempGuide.remove();
      if (tempLabel) tempLabel.remove();
    }

    updateTempGuidePosition() {
      const guide = document.getElementById('temp-guide');
      const label = document.getElementById('temp-guide-label');
      if (!guide || !label) return;
      
      const screenPos = this.worldToScreenPos(
        this.dragGuideOrientation,
        this.dragGuidePosition
      );
      
      if (this.dragGuideOrientation === 'horizontal') {
        guide.style.top = screenPos + 'px';
        label.style.left = (this.mouseScreenX + 10) + 'px';
        label.style.top = (screenPos + 4) + 'px';
        label.textContent = this.dragGuidePosition.toFixed(1) + ' px';
      } else {
        guide.style.left = screenPos + 'px';
        label.style.left = (screenPos + 4) + 'px';
        label.style.top = (this.mouseScreenY + 10) + 'px';
        label.textContent = this.dragGuidePosition.toFixed(1) + ' px';
      }
    }

    handleNewGuideDrag(e) {
      if (this.dragGuideOrientation === 'horizontal') {
        this.dragGuidePosition = this.screenYToWorld(e.clientY);
      } else {
        this.dragGuidePosition = this.screenXToWorld(e.clientX);
      }
      this.updateTempGuidePosition();
    }

    finishDragNewGuide() {
      this.isDraggingNewGuide = false;
      
      const screenPos = this.worldToScreenPos(
        this.dragGuideOrientation,
        this.dragGuidePosition
      );
      
      const isOnRuler = this.dragGuideOrientation === 'horizontal'
        ? (screenPos <= RULER_SIZE)
        : (screenPos <= RULER_SIZE);
      
      if (!isOnRuler) {
        this.addGuide(this.dragGuideOrientation, this.dragGuidePosition);
      }
      
      this.removeTempGuideElement();
      this.dragGuideOrientation = null;
    }

    addGuide(orientation, position) {
      const guide = {
        id: this.nextGuideId++,
        orientation: orientation,
        position: position
      };
      this.guides.push(guide);
      this.renderGuideLines();
      this.onGuidesChanged && this.onGuidesChanged();
      return guide;
    }

    renderGuideLines() {
      document.querySelectorAll('.guide-line:not(#temp-guide)').forEach(el => el.remove());
      document.querySelectorAll('.guide-label:not(#temp-guide-label)').forEach(el => el.remove());
      
      if (!this.showGuides) return;
      
      for (let i = 0; i < this.guides.length; i++) {
        const guide = this.guides[i];
        const screenPos = this.worldToScreenPos(guide.orientation, guide.position);
        
        const line = document.createElement('div');
        line.className = 'guide-line ' + guide.orientation;
        line.dataset.guideIndex = i;
        line.dataset.guideId = guide.id;
        line.style.pointerEvents = this.lockGuides ? 'none' : 'auto';
        line.style.cursor = this.lockGuides ? 'default' : 'move';
        
        if (this.highlightedGuides.has(guide.id)) {
          line.classList.add('highlight');
        }
        
        if (guide.orientation === 'horizontal') {
          line.style.top = screenPos + 'px';
        } else {
          line.style.left = screenPos + 'px';
        }
        
        line.addEventListener('mousedown', (e) => {
          if (!this.lockGuides && e.button === 0) {
            e.preventDefault();
            e.stopPropagation();
            this.startDragGuide(i, e.clientX, e.clientY);
          }
        });
        
        this.rulerContainer.appendChild(line);
        
        const label = document.createElement('div');
        label.className = 'guide-label ' + guide.orientation;
        label.textContent = guide.position.toFixed(1) + ' px';
        
        if (guide.orientation === 'horizontal') {
          label.style.left = '30px';
          label.style.top = (screenPos + 4) + 'px';
        } else {
          label.style.left = '4px';
          label.style.top = '30px';
          label.style.transform = 'none';
        }
        
        this.rulerContainer.appendChild(label);
      }
    }

    updateGuidePositions() {
      for (let i = 0; i < this.guides.length; i++) {
        const guide = this.guides[i];
        const screenPos = this.worldToScreenPos(guide.orientation, guide.position);
        const line = document.querySelector(`.guide-line[data-guide-id="${guide.id}"]`);
        const label = document.querySelectorAll('.guide-label')[i];
        
        if (line) {
          if (guide.orientation === 'horizontal') {
            line.style.top = screenPos + 'px';
          } else {
            line.style.left = screenPos + 'px';
          }
        }
        
        if (label) {
          if (guide.orientation === 'horizontal') {
            label.style.top = (screenPos + 4) + 'px';
          }
        }
      }
    }

    startDragGuide(index, clientX, clientY) {
      if (this.lockGuides) return;
      
      this.isDraggingGuide = true;
      this.draggingGuideIndex = index;
      
      const guide = this.guides[index];
      const screenPos = this.worldToScreenPos(guide.orientation, guide.position);
      
      if (guide.orientation === 'horizontal') {
        this.dragOffset = clientY - screenPos;
      } else {
        this.dragOffset = clientX - screenPos;
      }
      
      const line = document.querySelector(`.guide-line[data-guide-id="${guide.id}"]`);
      if (line) line.classList.add('dragging');
    }

    handleGuideDrag(e) {
      if (this.draggingGuideIndex < 0) return;
      
      const guide = this.guides[this.draggingGuideIndex];
      let newScreenPos;
      
      if (guide.orientation === 'horizontal') {
        newScreenPos = e.clientY - this.dragOffset;
      } else {
        newScreenPos = e.clientX - this.dragOffset;
      }
      
      const line = document.querySelector(`.guide-line[data-guide-id="${guide.id}"]`);
      if (line) {
        if (guide.orientation === 'horizontal') {
          line.style.top = newScreenPos + 'px';
        } else {
          line.style.left = newScreenPos + 'px';
        }
      }
    }

    finishGuideDrag() {
      if (this.draggingGuideIndex < 0) return;
      
      const guide = this.guides[this.draggingGuideIndex];
      const line = document.querySelector(`.guide-line[data-guide-id="${guide.id}"]`);
      
      if (guide.orientation === 'horizontal') {
        const screenY = parseFloat(line.style.top);
        if (screenY <= RULER_SIZE) {
          this.guides.splice(this.draggingGuideIndex, 1);
        } else {
          guide.position = this.screenYToWorld(screenY);
        }
      } else {
        const screenX = parseFloat(line.style.left);
        if (screenX <= RULER_SIZE) {
          this.guides.splice(this.draggingGuideIndex, 1);
        } else {
          guide.position = this.screenXToWorld(screenX);
        }
      }
      
      this.isDraggingGuide = false;
      this.draggingGuideIndex = -1;
      this.dragOffset = 0;
      
      this.renderGuideLines();
      this.onGuidesChanged && this.onGuidesChanged();
    }

    screenXToWorld(sx) {
      return (sx - window.innerWidth / 2) / this.viewport.scale + this.viewport.x;
    }

    screenYToWorld(sy) {
      return (sy - window.innerHeight / 2) / this.viewport.scale + this.viewport.y;
    }

    worldXToScreen(wx) {
      return (wx - this.viewport.x) * this.viewport.scale + window.innerWidth / 2;
    }

    worldYToScreen(wy) {
      return (wy - this.viewport.y) * this.viewport.scale + window.innerHeight / 2;
    }

    worldToScreenPos(orientation, worldPos) {
      if (orientation === 'horizontal') {
        return this.worldYToScreen(worldPos);
      } else {
        return this.worldXToScreen(worldPos);
      }
    }

    renderRulers() {
      if (!this.showRulers) return;
      
      this.renderHorizontalRuler();
      this.renderVerticalRuler();
    }

    renderHorizontalRuler() {
      const ctx = this.ctxH;
      const w = window.innerWidth - RULER_SIZE;
      const h = RULER_SIZE;
      
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, w, h);
      
      const scale = this.viewport.scale;
      const vpX = this.viewport.x;
      
      const tickStep = this.calculateTickStep(scale);
      const startX = Math.floor((vpX - window.innerWidth / 2 / scale) / tickStep) * tickStep;
      const endX = Math.ceil((vpX + window.innerWidth / 2 / scale) / tickStep) * tickStep;
      
      ctx.strokeStyle = '#999';
      ctx.fillStyle = '#666';
      ctx.font = '10px "SF Mono", Monaco, Consolas, monospace';
      ctx.textBaseline = 'top';
      
      const subTickStep = tickStep / 5;
      
      for (let wx = startX; wx <= endX; wx += subTickStep) {
        const sx = this.worldXToScreen(wx) - RULER_SIZE;
        const isMajor = Math.abs(wx % tickStep) < 0.001;
        const tickHeight = isMajor ? 10 : 5;
        
        ctx.beginPath();
        ctx.moveTo(sx, h - tickHeight);
        ctx.lineTo(sx, h);
        ctx.stroke();
        
        if (isMajor) {
          ctx.fillText(Math.round(wx).toString(), sx + 3, 2);
        }
      }
      
      const mouseSx = this.mouseScreenX - RULER_SIZE;
      if (mouseSx >= 0 && mouseSx <= w) {
        ctx.fillStyle = '#e53935';
        ctx.beginPath();
        ctx.moveTo(mouseSx, h);
        ctx.lineTo(mouseSx - 5, h - 8);
        ctx.lineTo(mouseSx + 5, h - 8);
        ctx.closePath();
        ctx.fill();
      }
    }

    renderVerticalRuler() {
      const ctx = this.ctxV;
      const w = RULER_SIZE;
      const h = window.innerHeight - RULER_SIZE;
      
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(0, 0, w, h);
      
      const scale = this.viewport.scale;
      const vpY = this.viewport.y;
      
      const tickStep = this.calculateTickStep(scale);
      const startY = Math.floor((vpY - window.innerHeight / 2 / scale) / tickStep) * tickStep;
      const endY = Math.ceil((vpY + window.innerHeight / 2 / scale) / tickStep) * tickStep;
      
      ctx.strokeStyle = '#999';
      ctx.fillStyle = '#666';
      ctx.font = '10px "SF Mono", Monaco, Consolas, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      
      const subTickStep = tickStep / 5;
      
      for (let wy = startY; wy <= endY; wy += subTickStep) {
        const sy = this.worldYToScreen(wy) - RULER_SIZE;
        const isMajor = Math.abs(wy % tickStep) < 0.001;
        const tickWidth = isMajor ? 10 : 5;
        
        ctx.beginPath();
        ctx.moveTo(w - tickWidth, sy);
        ctx.lineTo(w, sy);
        ctx.stroke();
        
        if (isMajor) {
          ctx.save();
          ctx.translate(w - 12, sy);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(Math.round(wy).toString(), 0, 0);
          ctx.restore();
        }
      }
      
      const mouseSy = this.mouseScreenY - RULER_SIZE;
      if (mouseSy >= 0 && mouseSy <= h) {
        ctx.fillStyle = '#e53935';
        ctx.beginPath();
        ctx.moveTo(w, mouseSy);
        ctx.lineTo(w - 8, mouseSy - 5);
        ctx.lineTo(w - 8, mouseSy + 5);
        ctx.closePath();
        ctx.fill();
      }
    }

    calculateTickStep(scale) {
      const pixelsPerUnit = scale;
      
      const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
      
      for (const step of niceSteps) {
        const pixelsPerTick = step * pixelsPerUnit;
        if (pixelsPerTick >= MIN_PIXELS_PER_TICK) {
          return step;
        }
      }
      
      return niceSteps[niceSteps.length - 1];
    }

    snapPointToGuides(point) {
      if (!this.snapToGuides || !this.showGuides || this.guides.length === 0) {
        return { x: point.x, y: point.y, snapped: false };
      }
      
      const threshold = GUIDE_SNAP_THRESHOLD / this.viewport.scale;
      let bestX = point.x;
      let bestY = point.y;
      let bestDistX = Infinity;
      let bestDistY = Infinity;
      let snappedGuideIds = [];
      
      for (const guide of this.guides) {
        if (guide.orientation === 'vertical') {
          const dx = Math.abs(point.x - guide.position);
          if (dx < threshold && dx < bestDistX) {
            bestX = guide.position;
            bestDistX = dx;
          }
        } else {
          const dy = Math.abs(point.y - guide.position);
          if (dy < threshold && dy < bestDistY) {
            bestY = guide.position;
            bestDistY = dy;
          }
        }
      }
      
      const snapped = bestDistX < Infinity || bestDistY < Infinity;
      
      this.highlightedGuides.clear();
      if (snapped) {
        for (const guide of this.guides) {
          if (guide.orientation === 'vertical' && Math.abs(guide.position - bestX) < 0.001) {
            this.highlightedGuides.add(guide.id);
          }
          if (guide.orientation === 'horizontal' && Math.abs(guide.position - bestY) < 0.001) {
            this.highlightedGuides.add(guide.id);
          }
        }
      }
      
      this.renderGuideLines();
      
      return {
        x: bestX,
        y: bestY,
        snapped: snapped,
        guideIds: Array.from(this.highlightedGuides)
      };
    }

    clearHighlight() {
      this.highlightedGuides.clear();
      this.renderGuideLines();
    }

    getGuideLines() {
      return this.guides.map(g => ({
        type: g.orientation === 'vertical' ? 'vertical' : 'horizontal',
        [g.orientation === 'vertical' ? 'x' : 'y']: g.position,
        kind: 'guide'
      }));
    }

    serialize() {
      return {
        guides: JSON.parse(JSON.stringify(this.guides)),
        nextGuideId: this.nextGuideId,
        showRulers: this.showRulers,
        showGuides: this.showGuides,
        lockGuides: this.lockGuides,
        snapToGuides: this.snapToGuides
      };
    }

    deserialize(data) {
      if (!data) return;
      
      try {
        if (data.guides && Array.isArray(data.guides)) {
          this.guides = JSON.parse(JSON.stringify(data.guides));
        }
        if (data.nextGuideId !== undefined) {
          this.nextGuideId = data.nextGuideId;
        }
        if (data.showRulers !== undefined) {
          this.showRulers = data.showRulers;
          const el = document.getElementById('guides-show-rulers');
          if (el) el.checked = data.showRulers;
          this.setShowRulers(data.showRulers);
        }
        if (data.showGuides !== undefined) {
          this.showGuides = data.showGuides;
          const el = document.getElementById('guides-show-guides');
          if (el) el.checked = data.showGuides;
        }
        if (data.lockGuides !== undefined) {
          this.lockGuides = data.lockGuides;
          const el = document.getElementById('guides-lock-guides');
          if (el) el.checked = data.lockGuides;
        }
        if (data.snapToGuides !== undefined) {
          this.snapToGuides = data.snapToGuides;
          const el = document.getElementById('guides-snap-guides');
          if (el) el.checked = data.snapToGuides;
        }
        
        this.renderGuideLines();
      } catch (e) {
        console.warn('Failed to deserialize guide data:', e);
      }
    }
  }

  window.GuideSystem = GuideSystem;
})();
