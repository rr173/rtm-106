(function() {
  'use strict';

  const LA_EPS = 1e-6;

  const ANNOTATION_TYPES = {
    DISTANCE: 'distance',
    ANGLE: 'angle',
    FORMULA: 'formula'
  };

  const ANNOTATION_VALUE_MODES = {
    MEASURED: 'measured',
    FIXED: 'fixed',
    PARAM: 'param',
    FORMULA: 'formula'
  };

  const DEFAULT_SETTINGS = {
    textSize: 14,
    textColor: '#e91e63',
    lineColor: '#e91e63',
    lineWidth: 2,
    arrowSize: 10,
    offset: 30,
    precision: 2,
    bgColor: 'rgba(255,255,255,0.95)',
    editableBgColor: 'rgba(255,233,243,0.95)',
    formulaColor: '#673ab7',
    formulaBgColor: 'rgba(243,229,245,0.95)'
  };

  class ExpressionEngine {
    constructor() {
      this._safeFns = {
        abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan,
        atan2: Math.atan2, ceil: Math.ceil, cos: Math.cos, exp: Math.exp,
        floor: Math.floor, log: Math.log, log2: Math.log2, log10: Math.log10,
        max: Math.max, min: Math.min, pow: Math.pow, round: Math.round,
        sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan, PI: Math.PI, E: Math.E
      };
    }

    extractVariables(expr) {
      const vars = new Set();
      const regex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
      let match;
      while ((match = regex.exec(expr)) !== null) {
        const name = match[0];
        if (!this._safeFns.hasOwnProperty(name)) {
          vars.add(name);
        }
      }
      return [...vars];
    }

    evaluate(expr, variableResolver) {
      try {
        const vars = this.extractVariables(expr);
        const values = {};
        for (const v of vars) {
          const val = variableResolver(v);
          if (val === undefined || val === null || isNaN(val)) {
            return { success: false, error: `Variable '${v}' not defined` };
          }
          values[v] = val;
        }
        const allKeys = [...Object.keys(values), ...Object.keys(this._safeFns)];
        const allVals = [...Object.values(values), ...Object.values(this._safeFns)];
        const fn = new Function(...allKeys, `"use strict"; return (${expr});`);
        const result = fn(...allVals);
        if (typeof result === 'number' && isFinite(result)) {
          return { success: true, value: result };
        }
        return { success: false, error: 'Expression must evaluate to a finite number' };
      } catch (e) {
        return { success: false, error: e.message || 'Invalid expression' };
      }
    }
  }

  class DependencyGraph {
    constructor() {
      this.nodes = new Map();
    }

    addNode(id) {
      if (!this.nodes.has(id)) {
        this.nodes.set(id, new Set());
      }
    }

    removeNode(id) {
      this.nodes.delete(id);
      for (const deps of this.nodes.values()) {
        deps.delete(id);
      }
    }

    addEdge(fromId, toId) {
      this.addNode(fromId);
      this.addNode(toId);
      this.nodes.get(fromId).add(toId);
    }

    setDependencies(id, depIds) {
      this.addNode(id);
      this.nodes.set(id, new Set(depIds));
    }

    detectCycle(startId) {
      const visited = new Set();
      const path = new Set();
      const cycle = [];

      function dfs(nodeId, graph) {
        visited.add(nodeId);
        path.add(nodeId);
        const deps = graph.nodes.get(nodeId);
        if (deps) {
          for (const depId of deps) {
            if (!visited.has(depId)) {
              if (dfs(depId, graph)) {
                if (cycle.length === 0 || cycle[0] !== cycle[cycle.length - 1]) {
                  cycle.unshift(depId);
                }
                return true;
              }
            } else if (path.has(depId)) {
              cycle.unshift(depId);
              cycle.unshift(nodeId);
              return true;
            }
          }
        }
        path.delete(nodeId);
        return false;
      }

      if (dfs(startId, this)) {
        if (cycle.length > 0 && cycle[0] !== cycle[cycle.length - 1]) {
          cycle.push(cycle[0]);
        }
        return cycle;
      }
      return null;
    }

    topologicalSort() {
      const inDegree = new Map();
      for (const [id] of this.nodes) {
        inDegree.set(id, 0);
      }
      for (const [, deps] of this.nodes) {
        for (const depId of deps) {
          inDegree.set(depId, (inDegree.get(depId) || 0) + 1);
        }
      }

      const queue = [];
      for (const [id, deg] of inDegree) {
        if (deg === 0) queue.push(id);
      }

      const result = [];
      while (queue.length > 0) {
        const id = queue.shift();
        result.push(id);
        const deps = this.nodes.get(id);
        if (deps) {
          for (const depId of deps) {
            inDegree.set(depId, inDegree.get(depId) - 1);
            if (inDegree.get(depId) === 0) {
              queue.push(depId);
            }
          }
        }
      }
      return result.length === this.nodes.size ? result : null;
    }
  }

  class LiveAnnotationSystem {
    constructor() {
      this.annotations = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.nextId = 1;
      this.expressionEngine = new ExpressionEngine();
      this.dependencyGraph = new DependencyGraph();
      this.toolMode = null;
      this.toolSelection = [];
      this.selectedAnnotationId = null;
      this.editingAnnotationId = null;
      this._paramGetter = null;
      this._shapePointsGetter = null;
      this._shapeHolesGetter = null;
      this._shapeModifier = null;
    }

    setCallbacks(opts) {
      this._paramGetter = opts.paramGetter || null;
      this._shapePointsGetter = opts.shapePointsGetter || null;
      this._shapeHolesGetter = opts.shapeHolesGetter || null;
      this._shapeModifier = opts.shapeModifier || null;
    }

    _getShapePoints(shapeId) {
      if (this._shapePointsGetter) return this._shapePointsGetter(shapeId);
      return null;
    }

    _getShapeHoles(shapeId) {
      if (this._shapeHolesGetter) return this._shapeHolesGetter(shapeId);
      return null;
    }

    _getParam(name) {
      if (this._paramGetter) return this._paramGetter(name);
      return undefined;
    }

    _resolveAnnotationValue(annId) {
      const ann = this.annotations.find(a => a.id === annId);
      if (!ann) return undefined;
      if (ann.computedValue !== undefined) return ann.computedValue;
      return this._measureAnnotation(ann);
    }

    _resolveVariable(varName) {
      if (varName.startsWith('ann_')) {
        const annId = parseInt(varName.slice(4), 10);
        return this._resolveAnnotationValue(annId);
      }
      return this._getParam(varName);
    }

    addDistanceAnnotation(pointAInfo, pointBInfo, opts) {
      opts = opts || {};
      const ptsA = this._getPointsFromVertexInfo(pointAInfo);
      const ptsB = this._getPointsFromVertexInfo(pointBInfo);
      if (!ptsA || !ptsB) return null;

      const ann = {
        id: this.nextId++,
        type: ANNOTATION_TYPES.DISTANCE,
        valueMode: ANNOTATION_VALUE_MODES.MEASURED,
        pointA: { ...pointAInfo },
        pointB: { ...pointBInfo },
        worldPointA: { x: ptsA.x, y: ptsA.y },
        worldPointB: { x: ptsB.x, y: ptsB.y },
        measuredValue: 0,
        fixedValue: 0,
        paramRef: null,
        formula: null,
        computedValue: undefined,
        offset: opts.offset !== undefined ? opts.offset : this.settings.offset,
        offsetAngle: opts.offsetAngle || 0,
        textPosition: null,
        visible: true,
        locked: false,
        name: opts.name || null,
        error: null
      };
      this._updateDistanceGeometry(ann);
      this.annotations.push(ann);
      this._recomputeAll();
      return ann;
    }

    addAngleAnnotation(edgeAInfo, edgeBInfo, vertexInfo, opts) {
      opts = opts || {};
      const vertex = this._getPointsFromVertexInfo(vertexInfo);
      const edgeA = this._getEdgePoints(edgeAInfo);
      const edgeB = this._getEdgePoints(edgeBInfo);
      if (!vertex || !edgeA || !edgeB) return null;

      const ann = {
        id: this.nextId++,
        type: ANNOTATION_TYPES.ANGLE,
        valueMode: ANNOTATION_VALUE_MODES.MEASURED,
        edgeA: { ...edgeAInfo },
        edgeB: { ...edgeBInfo },
        vertex: { ...vertexInfo },
        worldVertex: { x: vertex.x, y: vertex.y },
        direction1: { x: 0, y: 0 },
        direction2: { x: 0, y: 0 },
        measuredValue: 0,
        fixedValue: 0,
        paramRef: null,
        formula: null,
        computedValue: undefined,
        radius: opts.radius || this.settings.offset,
        textPosition: null,
        visible: true,
        locked: false,
        name: opts.name || null,
        error: null
      };
      this._updateAngleGeometry(ann);
      this.annotations.push(ann);
      this._recomputeAll();
      return ann;
    }

    addFormulaAnnotation(formula, anchorPointInfo, opts) {
      opts = opts || {};
      const exprResult = this.expressionEngine.evaluate(formula, (v) => this._resolveVariable(v));
      if (!exprResult.success) {
        return { success: false, error: exprResult.error };
      }

      const vars = this.expressionEngine.extractVariables(formula);
      const ann = {
        id: this.nextId++,
        type: ANNOTATION_TYPES.FORMULA,
        valueMode: ANNOTATION_VALUE_MODES.FORMULA,
        formula: formula,
        formulaVars: vars,
        computedValue: exprResult.value,
        anchor: { ...anchorPointInfo },
        worldAnchor: { x: anchorPointInfo.x || 0, y: anchorPointInfo.y || 0 },
        textPosition: { x: anchorPointInfo.x || 0, y: anchorPointInfo.y || 0 },
        visible: true,
        locked: false,
        name: opts.name || null,
        error: null
      };

      const tempGraph = new DependencyGraph();
      for (const a of this.annotations) {
        if (a.formulaVars) {
          const deps = [];
          for (const v of a.formulaVars) {
            if (v.startsWith('ann_')) deps.push(parseInt(v.slice(4), 10));
          }
          tempGraph.setDependencies(a.id, deps);
        }
      }
      const newDeps = [];
      for (const v of vars) {
        if (v.startsWith('ann_')) newDeps.push(parseInt(v.slice(4), 10));
      }
      tempGraph.setDependencies(ann.id, newDeps);
      const cycle = tempGraph.detectCycle(ann.id);
      if (cycle) {
        return { success: false, error: `Circular dependency detected: ${cycle.join(' → ')}` };
      }

      this.annotations.push(ann);
      this._recomputeAll();
      return { success: true, annotation: ann };
    }

    removeAnnotation(id) {
      const idx = this.annotations.findIndex(a => a.id === id);
      if (idx < 0) return false;
      this.annotations.splice(idx, 1);
      this.dependencyGraph.removeNode(id);
      if (this.selectedAnnotationId === id) this.selectedAnnotationId = null;
      if (this.editingAnnotationId === id) this.editingAnnotationId = null;
      this._recomputeAll();
      return true;
    }

    removeAnnotationsForShape(shapeId) {
      const removed = [];
      this.annotations = this.annotations.filter(a => {
        const refs = this._getReferencedShapeIds(a);
        if (refs.includes(shapeId)) {
          removed.push(a.id);
          this.dependencyGraph.removeNode(a.id);
          return false;
        }
        return true;
      });
      if (removed.includes(this.selectedAnnotationId)) this.selectedAnnotationId = null;
      if (removed.includes(this.editingAnnotationId)) this.editingAnnotationId = null;
      this._recomputeAll();
      return removed;
    }

    removeAnnotationsForShapes(shapeIds) {
      const idSet = new Set(shapeIds);
      const allRemoved = [];
      for (const sid of shapeIds) {
        const removed = this.removeAnnotationsForShape(sid);
        allRemoved.push(...removed);
      }
      return allRemoved;
    }

    _getReferencedShapeIds(ann) {
      const ids = [];
      if (ann.pointA && ann.pointA.shapeId !== undefined) ids.push(ann.pointA.shapeId);
      if (ann.pointB && ann.pointB.shapeId !== undefined) ids.push(ann.pointB.shapeId);
      if (ann.vertex && ann.vertex.shapeId !== undefined) ids.push(ann.vertex.shapeId);
      if (ann.edgeA && ann.edgeA.shapeId !== undefined) ids.push(ann.edgeA.shapeId);
      if (ann.edgeB && ann.edgeB.shapeId !== undefined) ids.push(ann.edgeB.shapeId);
      return [...new Set(ids)];
    }

    setAnnotationValueMode(id, mode, value) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann) return false;
      if (ann.type === ANNOTATION_TYPES.FORMULA && mode !== ANNOTATION_VALUE_MODES.FORMULA) return false;

      ann.valueMode = mode;
      ann.error = null;

      if (mode === ANNOTATION_VALUE_MODES.FIXED) {
        ann.fixedValue = (value !== undefined) ? Number(value) : ann.measuredValue || 0;
      } else if (mode === ANNOTATION_VALUE_MODES.PARAM) {
        ann.paramRef = value || null;
      } else if (mode === ANNOTATION_VALUE_MODES.FORMULA) {
        if (value) {
          const result = this.setAnnotationFormula(id, value);
          return result.success;
        }
      }
      this._recomputeAll();
      return true;
    }

    setAnnotationFormula(id, formula) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann) return { success: false, error: 'Annotation not found' };

      const vars = this.expressionEngine.extractVariables(formula);
      const exprResult = this.expressionEngine.evaluate(formula, (v) => this._resolveVariable(v));
      if (!exprResult.success) {
        return { success: false, error: exprResult.error };
      }

      const tempGraph = new DependencyGraph();
      for (const a of this.annotations) {
        if (a.id === id) continue;
        if (a.formulaVars) {
          const deps = [];
          for (const v of a.formulaVars) {
            if (v.startsWith('ann_')) deps.push(parseInt(v.slice(4), 10));
          }
          tempGraph.setDependencies(a.id, deps);
        }
      }
      const newDeps = [];
      for (const v of vars) {
        if (v.startsWith('ann_')) newDeps.push(parseInt(v.slice(4), 10));
      }
      tempGraph.setDependencies(id, newDeps);
      const cycle = tempGraph.detectCycle(id);
      if (cycle) {
        return { success: false, error: `Circular dependency detected: ${cycle.join(' → ')}` };
      }

      ann.formula = formula;
      ann.formulaVars = vars;
      ann.valueMode = ANNOTATION_VALUE_MODES.FORMULA;
      ann.computedValue = exprResult.value;
      ann.error = null;
      this._recomputeAll();
      return { success: true };
    }

    setAnnotationFixedValue(id, value) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann) return false;
      ann.fixedValue = Number(value);
      this._recomputeAll();
      this._applyAnnotationToGeometry(id);
      return true;
    }

    _getPointsFromVertexInfo(info) {
      if (!info) return null;
      if (info.x !== undefined && info.y !== undefined) return { x: info.x, y: info.y };
      if (info.shapeId !== undefined && info.pointIndex !== undefined) {
        const pts = info.isHole ? this._getShapeHoles(info.shapeId) : this._getShapePoints(info.shapeId);
        if (pts) {
          const arr = info.isHole ? pts[info.holeIndex] : pts;
          if (arr && arr[info.pointIndex]) return arr[info.pointIndex];
        }
      }
      return null;
    }

    _getEdgePoints(edgeInfo) {
      if (!edgeInfo || edgeInfo.shapeId === undefined || edgeInfo.edgeIndex === undefined) return null;
      const pts = edgeInfo.isHole ? this._getShapeHoles(edgeInfo.shapeId) : this._getShapePoints(edgeInfo.shapeId);
      if (!pts) return null;
      const arr = edgeInfo.isHole ? pts[edgeInfo.holeIndex] : pts;
      if (!arr) return null;
      const n = arr.length;
      return {
        a: arr[edgeInfo.edgeIndex],
        b: arr[(edgeInfo.edgeIndex + 1) % n]
      };
    }

    _updateDistanceGeometry(ann) {
      const pa = this._getPointsFromVertexInfo(ann.pointA);
      const pb = this._getPointsFromVertexInfo(ann.pointB);
      if (!pa || !pb) return;
      ann.worldPointA = { x: pa.x, y: pa.y };
      ann.worldPointB = { x: pb.x, y: pb.y };
      ann.measuredValue = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (!ann.textPosition || ann.valueMode === ANNOTATION_VALUE_MODES.MEASURED) {
        ann.textPosition = this._calcDistanceTextPos(ann);
      }
    }

    _updateAngleGeometry(ann) {
      const v = this._getPointsFromVertexInfo(ann.vertex);
      const edgeA = this._getEdgePoints(ann.edgeA);
      const edgeB = this._getEdgePoints(ann.edgeB);
      if (!v || !edgeA || !edgeB) return;
      ann.worldVertex = { x: v.x, y: v.y };

      const dir1 = this._edgeDirFromVertex(edgeA.a, edgeA.b, v);
      const dir2 = this._edgeDirFromVertex(edgeB.a, edgeB.b, v);
      ann.direction1 = { x: dir1.x, y: dir1.y };
      ann.direction2 = { x: dir2.x, y: dir2.y };

      const cross = dir1.x * dir2.y - dir1.y * dir2.x;
      const dot = dir1.x * dir2.x + dir1.y * dir2.y;
      let angle = Math.atan2(cross, dot);
      if (angle < 0) angle += Math.PI * 2;
      ann.measuredValue = angle * 180 / Math.PI;

      if (!ann.textPosition || ann.valueMode === ANNOTATION_VALUE_MODES.MEASURED) {
        ann.textPosition = this._calcAngleTextPos(ann);
      }
    }

    _edgeDirFromVertex(a, b, vertex) {
      const da = { x: a.x - vertex.x, y: a.y - vertex.y };
      const db = { x: b.x - vertex.x, y: b.y - vertex.y };
      const la = Math.hypot(da.x, da.y);
      const lb = Math.hypot(db.x, db.y);
      if (la > lb && la > LA_EPS) return { x: da.x / la, y: da.y / la };
      if (lb > LA_EPS) return { x: db.x / lb, y: db.y / lb };
      return { x: 1, y: 0 };
    }

    _calcDistanceTextPos(ann) {
      const a = ann.worldPointA, b = ann.worldPointB;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < LA_EPS) return mid;
      const nx = -dy / len, ny = dx / len;
      const off = ann.offset;
      const ax = Math.cos(ann.offsetAngle), ay = Math.sin(ann.offsetAngle);
      return {
        x: mid.x + nx * off * ax - ny * off * ay,
        y: mid.y + nx * off * ay + ny * off * ax
      };
    }

    _calcAngleTextPos(ann) {
      const v = ann.worldVertex;
      const a1 = Math.atan2(ann.direction1.y, ann.direction1.x);
      const a2 = a1 + ann.measuredValue * Math.PI / 180;
      let midAngle = (a1 + a2) / 2;
      if (Math.abs(a2 - a1) > Math.PI) midAngle += Math.PI;
      const r = ann.radius * 1.5;
      return { x: v.x + Math.cos(midAngle) * r, y: v.y + Math.sin(midAngle) * r };
    }

    updateFromShapes() {
      for (const ann of this.annotations) {
        if (!ann.visible) continue;
        if (ann.type === ANNOTATION_TYPES.DISTANCE) {
          this._updateDistanceGeometry(ann);
        } else if (ann.type === ANNOTATION_TYPES.ANGLE) {
          this._updateAngleGeometry(ann);
        } else if (ann.type === ANNOTATION_TYPES.FORMULA) {
          if (ann.anchor && ann.anchor.shapeId !== undefined) {
            const p = this._getPointsFromVertexInfo(ann.anchor);
            if (p) {
              ann.worldAnchor = { x: p.x, y: p.y };
              ann.textPosition = { x: p.x, y: p.y };
            }
          }
        }
      }
      this._recomputeAll();
    }

    _recomputeAll() {
      for (const a of this.annotations) {
        a.error = null;
        if (a.type !== ANNOTATION_TYPES.FORMULA) {
          a.computedValue = this._getAnnotationDisplayValue(a);
        }
      }

      const formulaAnns = this.annotations.filter(a => a.type === ANNOTATION_TYPES.FORMULA || a.valueMode === ANNOTATION_VALUE_MODES.FORMULA);
      for (const a of formulaAnns) {
        if (a.formulaVars) {
          const deps = [];
          for (const v of a.formulaVars) {
            if (v.startsWith('ann_')) deps.push(parseInt(v.slice(4), 10));
          }
          this.dependencyGraph.setDependencies(a.id, deps);
        }
      }

      const order = this.dependencyGraph.topologicalSort();
      if (order) {
        for (const id of order) {
          const ann = this.annotations.find(a => a.id === id);
          if (ann && (ann.type === ANNOTATION_TYPES.FORMULA || ann.valueMode === ANNOTATION_VALUE_MODES.FORMULA) && ann.formula) {
            const result = this.expressionEngine.evaluate(ann.formula, (v) => this._resolveVariable(v));
            if (result.success) {
              ann.computedValue = result.value;
              ann.error = null;
            } else {
              ann.error = result.error;
              ann.computedValue = NaN;
            }
          }
        }
      }

      for (const a of this.annotations) {
        if (a.type !== ANNOTATION_TYPES.FORMULA && a.valueMode !== ANNOTATION_VALUE_MODES.FORMULA) {
          a.computedValue = this._getAnnotationDisplayValue(a);
        }
      }
    }

    _getAnnotationDisplayValue(ann) {
      switch (ann.valueMode) {
        case ANNOTATION_VALUE_MODES.MEASURED:
          return ann.measuredValue;
        case ANNOTATION_VALUE_MODES.FIXED:
          return ann.fixedValue;
        case ANNOTATION_VALUE_MODES.PARAM:
          if (ann.paramRef) {
            const v = this._getParam(ann.paramRef);
            return v !== undefined ? v : ann.measuredValue;
          }
          return ann.measuredValue;
        case ANNOTATION_VALUE_MODES.FORMULA:
          return ann.computedValue;
        default:
          return ann.measuredValue;
      }
    }

    _applyAnnotationToGeometry(id) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann || !this._shapeModifier) return false;
      if (ann.valueMode === ANNOTATION_VALUE_MODES.MEASURED) return false;
      if (ann.type === ANNOTATION_TYPES.FORMULA) return false;

      const targetValue = this._getAnnotationDisplayValue(ann);
      if (targetValue === undefined || isNaN(targetValue)) return false;

      if (ann.type === ANNOTATION_TYPES.DISTANCE) {
        return this._shapeModifier.modifyDistance(ann, targetValue);
      } else if (ann.type === ANNOTATION_TYPES.ANGLE) {
        return this._shapeModifier.modifyAngle(ann, targetValue);
      }
      return false;
    }

    applyAllToGeometry() {
      for (const ann of this.annotations) {
        if (ann.valueMode !== ANNOTATION_VALUE_MODES.MEASURED && ann.type !== ANNOTATION_TYPES.FORMULA) {
          this._applyAnnotationToGeometry(ann.id);
        }
      }
    }

    hitTest(wx, wy, viewportScale) {
      const hitRadius = 15 / (viewportScale || 1);
      for (const ann of this.annotations) {
        if (!ann.visible) continue;
        const tp = ann.textPosition;
        if (!tp) continue;
        if (Math.hypot(wx - tp.x, wy - tp.y) < hitRadius * 2) {
          return ann.id;
        }
      }
      return null;
    }

    formatValue(ann) {
      if (ann.error) return '#ERR';
      const val = this._getAnnotationDisplayValue(ann);
      if (val === undefined || isNaN(val)) return '-';
      if (ann.type === ANNOTATION_TYPES.ANGLE) {
        return Number(val.toFixed(this.settings.precision)) + '°';
      }
      if (ann.type === ANNOTATION_TYPES.FORMULA) {
        return Number(val.toFixed(this.settings.precision)).toString();
      }
      return Number(val.toFixed(this.settings.precision)).toString();
    }

    getDisplayLabel(ann) {
      if (ann.name) return ann.name;
      if (ann.valueMode === ANNOTATION_VALUE_MODES.PARAM && ann.paramRef) {
        return ann.paramRef;
      }
      if ((ann.type === ANNOTATION_TYPES.FORMULA || ann.valueMode === ANNOTATION_VALUE_MODES.FORMULA) && ann.formula) {
        return ann.formula;
      }
      return this.formatValue(ann);
    }

    serialize() {
      return {
        annotations: JSON.parse(JSON.stringify(this.annotations)),
        settings: JSON.parse(JSON.stringify(this.settings)),
        nextId: this.nextId
      };
    }

    deserialize(data) {
      if (!data) return;
      if (data.annotations) {
        this.annotations = JSON.parse(JSON.stringify(data.annotations));
      }
      if (data.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      }
      if (data.nextId) {
        this.nextId = data.nextId;
      }
      this.dependencyGraph = new DependencyGraph();
      this._recomputeAll();
    }

    render(ctx, viewportScale) {
      for (const ann of this.annotations) {
        if (!ann.visible) continue;
        switch (ann.type) {
          case ANNOTATION_TYPES.DISTANCE:
            this._renderDistance(ctx, ann, viewportScale);
            break;
          case ANNOTATION_TYPES.ANGLE:
            this._renderAngle(ctx, ann, viewportScale);
            break;
          case ANNOTATION_TYPES.FORMULA:
            this._renderFormula(ctx, ann, viewportScale);
            break;
        }
      }
    }

    _renderDistance(ctx, ann, viewportScale) {
      const a = ann.worldPointA, b = ann.worldPointB;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < LA_EPS) return;

      const s = this.settings;
      const isFormula = ann.valueMode === ANNOTATION_VALUE_MODES.FORMULA;
      const isEditable = ann.valueMode !== ANNOTATION_VALUE_MODES.MEASURED;
      const lw = s.lineWidth / viewportScale;
      const arrow = s.arrowSize / viewportScale;
      const textSize = s.textSize / viewportScale;

      const dx = b.x - a.x, dy = b.y - a.y;
      const ux = dx / len, uy = dy / len;
      const perpX = -uy, perpY = ux;

      const off = ann.offset;
      const a2 = { x: a.x + perpX * off, y: a.y + perpY * off };
      const b2 = { x: b.x + perpX * off, y: b.y + perpY * off };

      const lineColor = isFormula ? s.formulaColor : s.lineColor;
      const textColor = isFormula ? s.formulaColor : s.textColor;
      const bgColor = ann.error ? 'rgba(255,200,200,0.95)' :
        (isFormula ? s.formulaBgColor : (isEditable ? s.editableBgColor : s.bgColor));

      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.fillStyle = textColor;
      ctx.lineWidth = lw;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(a2.x, a2.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.stroke();

      this._drawArrow(ctx, a2, ux, uy, arrow, lineColor);
      this._drawArrow(ctx, b2, -ux, -uy, arrow, lineColor);

      ctx.fillStyle = '#e91e63';
      ctx.beginPath();
      ctx.arc(a.x, a.y, 3 / viewportScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3 / viewportScale, 0, Math.PI * 2);
      ctx.fill();

      const text = this.formatValue(ann);
      const tp = ann.textPosition || this._calcDistanceTextPos(ann);
      ctx.font = `${isEditable ? '700' : '600'} ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const pad = 6 / viewportScale;
      const bgW = metrics.width + pad * 2;
      const bgH = textSize + pad * 1.2;

      if (ann.id === this.selectedAnnotationId) {
        ctx.strokeStyle = '#ff5722';
        ctx.lineWidth = 2.5 / viewportScale;
        ctx.fillStyle = bgColor;
      } else {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1 / viewportScale;
        ctx.fillStyle = bgColor;
      }
      ctx.fillRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);
      ctx.strokeRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);

      if (ann.valueMode === ANNOTATION_VALUE_MODES.PARAM && ann.paramRef) {
        ctx.fillStyle = '#888';
        ctx.font = `${textSize * 0.7}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(ann.paramRef, tp.x - bgW / 2 + pad / 2, tp.y - bgH / 2 + textSize * 0.45);
      }
      if (ann.name) {
        ctx.fillStyle = '#666';
        ctx.font = `${textSize * 0.65}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(ann.name, tp.x + bgW / 2 - pad / 2, tp.y - bgH / 2 + textSize * 0.45);
      }

      ctx.fillStyle = textColor;
      ctx.font = `${isEditable ? '700' : '600'} ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tp.x, tp.y + 2 / viewportScale);

      if (isEditable && ann.id !== this.editingAnnotationId) {
        ctx.fillStyle = '#ff5722';
        ctx.font = `${textSize * 0.55}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✎', tp.x + bgW / 2 - 3 / viewportScale, tp.y - bgH / 2 + 4 / viewportScale);
      }

      ctx.restore();
    }

    _renderAngle(ctx, ann, viewportScale) {
      const v = ann.worldVertex;
      const s = this.settings;
      const isFormula = ann.valueMode === ANNOTATION_VALUE_MODES.FORMULA;
      const isEditable = ann.valueMode !== ANNOTATION_VALUE_MODES.MEASURED;
      const lw = s.lineWidth / viewportScale;
      const arrow = s.arrowSize / viewportScale;
      const textSize = s.textSize / viewportScale;
      const r = ann.radius * 0.7;

      const a1 = Math.atan2(ann.direction1.y, ann.direction1.x);
      const a2 = a1 + ann.measuredValue * Math.PI / 180;
      const ccw = ann.measuredValue > 180;

      const lineColor = isFormula ? s.formulaColor : s.lineColor;
      const textColor = isFormula ? s.formulaColor : s.textColor;
      const bgColor = ann.error ? 'rgba(255,200,200,0.95)' :
        (isFormula ? s.formulaBgColor : (isEditable ? s.editableBgColor : s.bgColor));

      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.fillStyle = textColor;
      ctx.lineWidth = lw;

      const extR = r * 1.4;
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x + Math.cos(a1) * extR, v.y + Math.sin(a1) * extR);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(v.x, v.y);
      ctx.lineTo(v.x + Math.cos(a2) * extR, v.y + Math.sin(a2) * extR);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(v.x, v.y, r, a1, a2, ccw);
      ctx.stroke();

      const p1 = { x: v.x + Math.cos(a1) * r, y: v.y + Math.sin(a1) * r };
      const p2 = { x: v.x + Math.cos(a2) * r, y: v.y + Math.sin(a2) * r };
      this._drawArrowAtPoint(ctx, p1, a1 + Math.PI / 2 + 0.3, arrow, lineColor);
      this._drawArrowAtPoint(ctx, p2, a2 - Math.PI / 2 - 0.3, arrow, lineColor);

      ctx.fillStyle = '#e91e63';
      ctx.beginPath();
      ctx.arc(v.x, v.y, 4 / viewportScale, 0, Math.PI * 2);
      ctx.fill();

      const text = this.formatValue(ann);
      const tp = ann.textPosition || this._calcAngleTextPos(ann);
      ctx.font = `${isEditable ? '700' : '600'} ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const pad = 6 / viewportScale;
      const bgW = metrics.width + pad * 2;
      const bgH = textSize + pad * 1.2;

      if (ann.id === this.selectedAnnotationId) {
        ctx.strokeStyle = '#ff5722';
        ctx.lineWidth = 2.5 / viewportScale;
        ctx.fillStyle = bgColor;
      } else {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1 / viewportScale;
        ctx.fillStyle = bgColor;
      }
      ctx.fillRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);
      ctx.strokeRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);

      if (ann.valueMode === ANNOTATION_VALUE_MODES.PARAM && ann.paramRef) {
        ctx.fillStyle = '#888';
        ctx.font = `${textSize * 0.7}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(ann.paramRef, tp.x - bgW / 2 + pad / 2, tp.y - bgH / 2 + textSize * 0.45);
      }

      ctx.fillStyle = textColor;
      ctx.font = `${isEditable ? '700' : '600'} ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tp.x, tp.y + 2 / viewportScale);

      if (isEditable && ann.id !== this.editingAnnotationId) {
        ctx.fillStyle = '#ff5722';
        ctx.font = `${textSize * 0.55}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✎', tp.x + bgW / 2 - 3 / viewportScale, tp.y - bgH / 2 + 4 / viewportScale);
      }

      ctx.restore();
    }

    _renderFormula(ctx, ann, viewportScale) {
      const s = this.settings;
      const textSize = s.textSize / viewportScale;
      const lineColor = ann.error ? '#e53935' : s.formulaColor;
      const textColor = ann.error ? '#e53935' : s.formulaColor;
      const bgColor = ann.error ? 'rgba(255,200,200,0.95)' : s.formulaBgColor;

      const tp = ann.textPosition || ann.worldAnchor;
      if (!tp) return;

      ctx.save();
      ctx.font = `700 ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const valueText = this.formatValue(ann);
      const formulaText = ann.formula || '';
      const metrics = ctx.measureText(Math.max(valueText, formulaText));
      const pad = 8 / viewportScale;
      const bgW = Math.max(metrics.width + pad * 2, (ann.name ? ctx.measureText(ann.name).width : 0) + pad * 2);
      const bgH = textSize * 2.2 + pad;

      if (ann.id === this.selectedAnnotationId) {
        ctx.strokeStyle = '#ff5722';
        ctx.lineWidth = 2.5 / viewportScale;
      } else {
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1 / viewportScale;
      }
      ctx.fillStyle = bgColor;
      ctx.fillRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);
      ctx.strokeRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);

      if (ann.name) {
        ctx.fillStyle = '#673ab7';
        ctx.font = `700 ${textSize * 0.7}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('ƒ ' + ann.name, tp.x - bgW / 2 + pad / 2, tp.y - bgH / 2 + textSize * 0.55);
      } else {
        ctx.fillStyle = '#673ab7';
        ctx.font = `${textSize * 0.7}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText('ƒ', tp.x - bgW / 2 + pad / 2, tp.y - bgH / 2 + textSize * 0.55);
      }

      ctx.fillStyle = textColor;
      ctx.font = `700 ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(valueText, tp.x, tp.y + textSize * 0.35);

      ctx.fillStyle = '#999';
      ctx.font = `${textSize * 0.55}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('= ' + formulaText, tp.x, tp.y + bgH / 2 - textSize * 0.4);

      if (ann.id !== this.editingAnnotationId) {
        ctx.fillStyle = '#673ab7';
        ctx.font = `${textSize * 0.55}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('✎', tp.x + bgW / 2 - 3 / viewportScale, tp.y - bgH / 2 + 4 / viewportScale);
      }

      ctx.restore();
    }

    _drawArrow(ctx, point, dirX, dirY, size, color) {
      const perpX = -dirY, perpY = dirX;
      const tip = { x: point.x + dirX * size, y: point.y + dirY * size };
      const b1 = { x: point.x - perpX * size * 0.4, y: point.y - perpY * size * 0.4 };
      const b2 = { x: point.x + perpX * size * 0.4, y: point.y + perpY * size * 0.4 };
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    _drawArrowAtPoint(ctx, point, angle, size, color) {
      const dx = Math.cos(angle), dy = Math.sin(angle);
      this._drawArrow(ctx, point, dx, dy, size, color);
    }

    getAllAnnotations() {
      return this.annotations.map(a => ({
        id: a.id,
        type: a.type,
        valueMode: a.valueMode,
        name: a.name,
        displayValue: this._getAnnotationDisplayValue(a),
        errorMessage: a.error,
        fixedValue: a.fixedValue,
        paramName: a.paramRef,
        formula: a.formula
      }));
    }

    getAnnotation(id) {
      return this.annotations.find(a => a.id === id) || null;
    }

    setAnnotationName(id, name) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann) return false;
      ann.name = name;
      return true;
    }

    setAnnotationMode(id, mode) {
      return this.setAnnotationValueMode(id, mode);
    }

    setAnnotationParamBinding(id, paramName) {
      const ann = this.annotations.find(a => a.id === id);
      if (!ann) return { success: false, error: 'Annotation not found' };
      if (ann.type === ANNOTATION_TYPES.FORMULA) {
        return { success: false, error: 'Formula annotations cannot bind to parameters' };
      }
      ann.valueMode = ANNOTATION_VALUE_MODES.PARAM;
      ann.paramRef = paramName || null;
      ann.error = null;
      this._recomputeAll();
      return { success: true };
    }

    validateFormula(formula) {
      if (!formula || typeof formula !== 'string') {
        return { success: false, error: 'Empty formula' };
      }
      const vars = this.expressionEngine.extractVariables(formula);
      const safeFns = this.expressionEngine._safeFns || {};
      const tempResolver = (v) => {
        if (safeFns[v] !== undefined) return 0;
        return 0;
      };
      const result = this.expressionEngine.evaluate(formula, tempResolver);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, variables: vars };
    }

    clearAll() {
      this.annotations = [];
      this.dependencyGraph = new DependencyGraph();
      this.selectedAnnotationId = null;
      this.editingAnnotationId = null;
    }

    cleanupForShapeIds(deletedShapeIds, retainedShapeIds) {
      const deleted = new Set(deletedShapeIds || []);
      const retained = new Set(retainedShapeIds || []);
      const toRemove = [];
      for (const ann of this.annotations) {
        const refs = this._getReferencedShapeIds(ann);
        const hasDeletedRef = refs.some(id => deleted.has(id));
        const hasRetainedRef = refs.some(id => retained.has(id));
        if (ann.type !== ANNOTATION_TYPES.FORMULA && hasDeletedRef && !hasRetainedRef) {
          toRemove.push(ann.id);
        }
      }
      for (const id of toRemove) {
        this.removeAnnotation(id);
      }
      return toRemove.length;
    }

    getPrecision() {
      return this.settings.precision;
    }

    setPrecision(v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 0 && n <= 6) {
        this.settings.precision = n;
      }
    }

    getTextSize() {
      return this.settings.textSize;
    }

    setTextSize(v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 6 && n <= 72) {
        this.settings.textSize = n;
      }
    }

    hitTestAnnotationText(wx, wy, viewportScale) {
      return this.hitTest(wx, wy, viewportScale);
    }
  }

  window.LiveAnnotationSystem = LiveAnnotationSystem;
  window.LIVE_ANNOTATION_TYPES = ANNOTATION_TYPES;
  window.LIVE_ANNOTATION_VALUE_MODES = ANNOTATION_VALUE_MODES;

})();
