(function(global) {
  'use strict';

  const CS_EPS = 1e-8;
  const MAX_ITER = 100;
  const TOLERANCE = 1e-6;

  const CONSTRAINT_TYPES = {
    COINCIDENT: 'coincident',
    POINT_ON_LINE: 'point-on-line',
    PARALLEL: 'parallel',
    PERPENDICULAR: 'perpendicular',
    EQUAL_LENGTH: 'equal-length',
    FIXED_ANGLE: 'fixed-angle',
    DISTANCE: 'distance',
    HORIZONTAL: 'horizontal',
    VERTICAL: 'vertical'
  };

  function matCreate(rows, cols) {
    const m = new Array(rows);
    for (let i = 0; i < rows; i++) {
      m[i] = new Array(cols).fill(0);
    }
    return m;
  }

  function vecCreate(n) {
    return new Array(n).fill(0);
  }

  function gaussianElimination(A, b) {
    const n = A.length;
    const m = A[0].length;
    const aug = matCreate(n, m + 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        aug[i][j] = A[i][j];
      }
      aug[i][m] = b[i];
    }

    const pivotCols = [];
    let pivotRow = 0;

    for (let col = 0; col < m && pivotRow < n; col++) {
      let maxVal = Math.abs(aug[pivotRow][col]);
      let maxRow = pivotRow;
      for (let row = pivotRow + 1; row < n; row++) {
        const val = Math.abs(aug[row][col]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = row;
        }
      }

      if (maxVal < CS_EPS) continue;

      if (maxRow !== pivotRow) {
        const tmp = aug[pivotRow];
        aug[pivotRow] = aug[maxRow];
        aug[maxRow] = tmp;
      }

      pivotCols.push(col);

      const pivot = aug[pivotRow][col];
      for (let j = col; j <= m; j++) {
        aug[pivotRow][j] /= pivot;
      }

      for (let row = 0; row < n; row++) {
        if (row === pivotRow) continue;
        const factor = aug[row][col];
        if (Math.abs(factor) < CS_EPS) continue;
        for (let j = col; j <= m; j++) {
          aug[row][j] -= factor * aug[pivotRow][j];
        }
      }

      pivotRow++;
    }

    for (let row = pivotRow; row < n; row++) {
      if (Math.abs(aug[row][m]) > CS_EPS) {
        return { solution: null, rank: pivotRow, singular: true };
      }
    }

    const x = vecCreate(m);
    for (let i = 0; i < pivotCols.length; i++) {
      const col = pivotCols[i];
      x[col] = aug[i][m];
    }

    return { solution: x, rank: pivotRow, singular: false };
  }

  function Constraint() {}

  Constraint.prototype.getDOFCost = function() { return 0; };
  Constraint.prototype.getEquationCount = function() { return 0; };
  Constraint.prototype.evaluate = function(pointMap, params) { return []; };
  Constraint.prototype.evaluateJacobian = function(pointMap, params, varMap) { return []; };
  Constraint.prototype.getReferencedPoints = function() { return []; };
  Constraint.prototype.getIconPosition = function(pointMap) { return null; };
  Constraint.prototype.getLabel = function() { return ''; };

  class CoincidentConstraint extends Constraint {
    constructor(pointA, pointB) {
      super();
      this.type = CONSTRAINT_TYPES.COINCIDENT;
      this.pointA = pointA;
      this.pointB = pointB;
    }

    getDOFCost() { return 2; }
    getEquationCount() { return 2; }

    getReferencedPoints() {
      return [this.pointA, this.pointB];
    }

    evaluate(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return [
        pA.x - pB.x,
        pA.y - pB.y
      ];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const idxAx = varMap[this.pointA + '_x'];
      const idxAy = varMap[this.pointA + '_y'];
      const idxBx = varMap[this.pointB + '_x'];
      const idxBy = varMap[this.pointB + '_y'];
      const nVars = Object.keys(varMap).length;

      const row1 = vecCreate(nVars);
      if (idxAx !== undefined) row1[idxAx] = 1;
      if (idxBx !== undefined) row1[idxBx] = -1;

      const row2 = vecCreate(nVars);
      if (idxAy !== undefined) row2[idxAy] = 1;
      if (idxBy !== undefined) row2[idxBy] = -1;

      return [row1, row2];
    }

    getIconPosition(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return {
        x: (pA.x + pB.x) / 2,
        y: (pA.y + pB.y) / 2
      };
    }

    getLabel() { return '◉'; }
  }

  class PointOnLineConstraint extends Constraint {
    constructor(point, lineStart, lineEnd) {
      super();
      this.type = CONSTRAINT_TYPES.POINT_ON_LINE;
      this.point = point;
      this.lineStart = lineStart;
      this.lineEnd = lineEnd;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.point, this.lineStart, this.lineEnd];
    }

    evaluate(pointMap) {
      const p = pointMap[this.point];
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];
      const val = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      return [val];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const p = pointMap[this.point];
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];

      const idxPx = varMap[this.point + '_x'];
      const idxPy = varMap[this.point + '_y'];
      const idxAx = varMap[this.lineStart + '_x'];
      const idxAy = varMap[this.lineStart + '_y'];
      const idxBx = varMap[this.lineEnd + '_x'];
      const idxBy = varMap[this.lineEnd + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxPx !== undefined) row[idxPx] = -(b.y - a.y);
      if (idxPy !== undefined) row[idxPy] = (b.x - a.x);
      if (idxAx !== undefined) row[idxAx] = -(p.y - b.y);
      if (idxAy !== undefined) row[idxAy] = (p.x - b.x);
      if (idxBx !== undefined) row[idxBx] = (p.y - a.y);
      if (idxBy !== undefined) row[idxBy] = -(p.x - a.x);

      return [row];
    }

    getIconPosition(pointMap) {
      const p = pointMap[this.point];
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      if (len2 < CS_EPS) return { x: p.x, y: p.y };
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      return {
        x: a.x + t * abx,
        y: a.y + t * aby
      };
    }

    getLabel() { return '⊓'; }
  }

  class ParallelConstraint extends Constraint {
    constructor(line1Start, line1End, line2Start, line2End) {
      super();
      this.type = CONSTRAINT_TYPES.PARALLEL;
      this.line1Start = line1Start;
      this.line1End = line1End;
      this.line2Start = line2Start;
      this.line2End = line2End;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.line1Start, this.line1End, this.line2Start, this.line2End];
    }

    evaluate(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      const val = (b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x);
      return [val];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];

      const idxA1x = varMap[this.line1Start + '_x'];
      const idxA1y = varMap[this.line1Start + '_y'];
      const idxB1x = varMap[this.line1End + '_x'];
      const idxB1y = varMap[this.line1End + '_y'];
      const idxA2x = varMap[this.line2Start + '_x'];
      const idxA2y = varMap[this.line2Start + '_y'];
      const idxB2x = varMap[this.line2End + '_x'];
      const idxB2y = varMap[this.line2End + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxA1x !== undefined) row[idxA1x] = -(b2.y - a2.y);
      if (idxA1y !== undefined) row[idxA1y] = (b2.x - a2.x);
      if (idxB1x !== undefined) row[idxB1x] = (b2.y - a2.y);
      if (idxB1y !== undefined) row[idxB1y] = -(b2.x - a2.x);
      if (idxA2x !== undefined) row[idxA2x] = (b1.y - a1.y);
      if (idxA2y !== undefined) row[idxA2y] = -(b1.x - a1.x);
      if (idxB2x !== undefined) row[idxB2x] = -(b1.y - a1.y);
      if (idxB2y !== undefined) row[idxB2y] = (b1.x - a1.x);

      return [row];
    }

    getIconPosition(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      return {
        x: (a1.x + b1.x + a2.x + b2.x) / 4,
        y: (a1.y + b1.y + a2.y + b2.y) / 4
      };
    }

    getLabel() { return '∥'; }
  }

  class PerpendicularConstraint extends Constraint {
    constructor(line1Start, line1End, line2Start, line2End) {
      super();
      this.type = CONSTRAINT_TYPES.PERPENDICULAR;
      this.line1Start = line1Start;
      this.line1End = line1End;
      this.line2Start = line2Start;
      this.line2End = line2End;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.line1Start, this.line1End, this.line2Start, this.line2End];
    }

    evaluate(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      const val = (b1.x - a1.x) * (b2.x - a2.x) + (b1.y - a1.y) * (b2.y - a2.y);
      return [val];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];

      const idxA1x = varMap[this.line1Start + '_x'];
      const idxA1y = varMap[this.line1Start + '_y'];
      const idxB1x = varMap[this.line1End + '_x'];
      const idxB1y = varMap[this.line1End + '_y'];
      const idxA2x = varMap[this.line2Start + '_x'];
      const idxA2y = varMap[this.line2Start + '_y'];
      const idxB2x = varMap[this.line2End + '_x'];
      const idxB2y = varMap[this.line2End + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxA1x !== undefined) row[idxA1x] = -(b2.x - a2.x);
      if (idxA1y !== undefined) row[idxA1y] = -(b2.y - a2.y);
      if (idxB1x !== undefined) row[idxB1x] = (b2.x - a2.x);
      if (idxB1y !== undefined) row[idxB1y] = (b2.y - a2.y);
      if (idxA2x !== undefined) row[idxA2x] = -(b1.x - a1.x);
      if (idxA2y !== undefined) row[idxA2y] = -(b1.y - a1.y);
      if (idxB2x !== undefined) row[idxB2x] = (b1.x - a1.x);
      if (idxB2y !== undefined) row[idxB2y] = (b1.y - a1.y);

      return [row];
    }

    getIconPosition(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      return {
        x: (a1.x + b1.x + a2.x + b2.x) / 4,
        y: (a1.y + b1.y + a2.y + b2.y) / 4
      };
    }

    getLabel() { return '⟂'; }
  }

  class EqualLengthConstraint extends Constraint {
    constructor(line1Start, line1End, line2Start, line2End) {
      super();
      this.type = CONSTRAINT_TYPES.EQUAL_LENGTH;
      this.line1Start = line1Start;
      this.line1End = line1End;
      this.line2Start = line2Start;
      this.line2End = line2End;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.line1Start, this.line1End, this.line2Start, this.line2End];
    }

    evaluate(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      const len1sq = (b1.x - a1.x) ** 2 + (b1.y - a1.y) ** 2;
      const len2sq = (b2.x - a2.x) ** 2 + (b2.y - a2.y) ** 2;
      return [len1sq - len2sq];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];

      const idxA1x = varMap[this.line1Start + '_x'];
      const idxA1y = varMap[this.line1Start + '_y'];
      const idxB1x = varMap[this.line1End + '_x'];
      const idxB1y = varMap[this.line1End + '_y'];
      const idxA2x = varMap[this.line2Start + '_x'];
      const idxA2y = varMap[this.line2Start + '_y'];
      const idxB2x = varMap[this.line2End + '_x'];
      const idxB2y = varMap[this.line2End + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxA1x !== undefined) row[idxA1x] = -2 * (b1.x - a1.x);
      if (idxA1y !== undefined) row[idxA1y] = -2 * (b1.y - a1.y);
      if (idxB1x !== undefined) row[idxB1x] = 2 * (b1.x - a1.x);
      if (idxB1y !== undefined) row[idxB1y] = 2 * (b1.y - a1.y);
      if (idxA2x !== undefined) row[idxA2x] = 2 * (b2.x - a2.x);
      if (idxA2y !== undefined) row[idxA2y] = 2 * (b2.y - a2.y);
      if (idxB2x !== undefined) row[idxB2x] = -2 * (b2.x - a2.x);
      if (idxB2y !== undefined) row[idxB2y] = -2 * (b2.y - a2.y);

      return [row];
    }

    getIconPosition(pointMap) {
      const a1 = pointMap[this.line1Start];
      const b1 = pointMap[this.line1End];
      const a2 = pointMap[this.line2Start];
      const b2 = pointMap[this.line2End];
      return {
        x: (a1.x + b1.x + a2.x + b2.x) / 4,
        y: (a1.y + b1.y + a2.y + b2.y) / 4
      };
    }

    getLabel() { return '≅'; }
  }

  class FixedAngleConstraint extends Constraint {
    constructor(lineStart, lineEnd, angle, paramRef) {
      super();
      this.type = CONSTRAINT_TYPES.FIXED_ANGLE;
      this.lineStart = lineStart;
      this.lineEnd = lineEnd;
      this.angle = angle || 0;
      this.paramRef = paramRef || null;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.lineStart, this.lineEnd];
    }

    _resolveAngle(params) {
      if (this.paramRef && params && params[this.paramRef] !== undefined) {
        return params[this.paramRef] * Math.PI / 180;
      }
      return this.angle * Math.PI / 180;
    }

    evaluate(pointMap, params) {
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];
      const rad = this._resolveAngle(params);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const targetDx = Math.cos(rad);
      const targetDy = Math.sin(rad);
      const val = dx * targetDy - dy * targetDx;
      return [val];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];
      const rad = this._resolveAngle(params);

      const idxAx = varMap[this.lineStart + '_x'];
      const idxAy = varMap[this.lineStart + '_y'];
      const idxBx = varMap[this.lineEnd + '_x'];
      const idxBy = varMap[this.lineEnd + '_y'];
      const nVars = Object.keys(varMap).length;

      const targetDx = Math.cos(rad);
      const targetDy = Math.sin(rad);

      const row = vecCreate(nVars);
      if (idxAx !== undefined) row[idxAx] = -targetDy;
      if (idxAy !== undefined) row[idxAy] = targetDx;
      if (idxBx !== undefined) row[idxBx] = targetDy;
      if (idxBy !== undefined) row[idxBy] = -targetDx;

      return [row];
    }

    getIconPosition(pointMap) {
      const a = pointMap[this.lineStart];
      const b = pointMap[this.lineEnd];
      return {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      };
    }

    getLabel() { return '∠' + (this.paramRef ? this.paramRef : this.angle.toFixed(0) + '°'); }
  }

  class DistanceConstraint extends Constraint {
    constructor(pointA, pointB, distance, paramRef) {
      super();
      this.type = CONSTRAINT_TYPES.DISTANCE;
      this.pointA = pointA;
      this.pointB = pointB;
      this.distance = distance || 0;
      this.paramRef = paramRef || null;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.pointA, this.pointB];
    }

    _resolveDistance(params) {
      if (this.paramRef && params && params[this.paramRef] !== undefined) {
        return params[this.paramRef];
      }
      return this.distance;
    }

    evaluate(pointMap, params) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      const d = this._resolveDistance(params);
      const val = (pA.x - pB.x) ** 2 + (pA.y - pB.y) ** 2 - d * d;
      return [val];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];

      const idxAx = varMap[this.pointA + '_x'];
      const idxAy = varMap[this.pointA + '_y'];
      const idxBx = varMap[this.pointB + '_x'];
      const idxBy = varMap[this.pointB + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxAx !== undefined) row[idxAx] = 2 * (pA.x - pB.x);
      if (idxAy !== undefined) row[idxAy] = 2 * (pA.y - pB.y);
      if (idxBx !== undefined) row[idxBx] = -2 * (pA.x - pB.x);
      if (idxBy !== undefined) row[idxBy] = -2 * (pA.y - pB.y);

      return [row];
    }

    getIconPosition(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return {
        x: (pA.x + pB.x) / 2,
        y: (pA.y + pB.y) / 2
      };
    }

    getLabel() {
      const d = this.distance;
      return 'd=' + (this.paramRef ? this.paramRef : d.toFixed(1));
    }
  }

  class HorizontalConstraint extends Constraint {
    constructor(pointA, pointB) {
      super();
      this.type = CONSTRAINT_TYPES.HORIZONTAL;
      this.pointA = pointA;
      this.pointB = pointB;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.pointA, this.pointB];
    }

    evaluate(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return [pA.y - pB.y];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const idxAy = varMap[this.pointA + '_y'];
      const idxBy = varMap[this.pointB + '_y'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxAy !== undefined) row[idxAy] = 1;
      if (idxBy !== undefined) row[idxBy] = -1;

      return [row];
    }

    getIconPosition(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return {
        x: (pA.x + pB.x) / 2,
        y: (pA.y + pB.y) / 2
      };
    }

    getLabel() { return '↔'; }
  }

  class VerticalConstraint extends Constraint {
    constructor(pointA, pointB) {
      super();
      this.type = CONSTRAINT_TYPES.VERTICAL;
      this.pointA = pointA;
      this.pointB = pointB;
    }

    getDOFCost() { return 1; }
    getEquationCount() { return 1; }

    getReferencedPoints() {
      return [this.pointA, this.pointB];
    }

    evaluate(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return [pA.x - pB.x];
    }

    evaluateJacobian(pointMap, params, varMap) {
      const idxAx = varMap[this.pointA + '_x'];
      const idxBx = varMap[this.pointB + '_x'];
      const nVars = Object.keys(varMap).length;

      const row = vecCreate(nVars);
      if (idxAx !== undefined) row[idxAx] = 1;
      if (idxBx !== undefined) row[idxBx] = -1;

      return [row];
    }

    getIconPosition(pointMap) {
      const pA = pointMap[this.pointA];
      const pB = pointMap[this.pointB];
      return {
        x: (pA.x + pB.x) / 2,
        y: (pA.y + pB.y) / 2
      };
    }

    getLabel() { return '↕'; }
  }

  class ConstraintSolver {
    constructor() {
      this.constraints = [];
      this.params = {};
      this.conflictConstraints = new Set();
    }

    addConstraint(constraint) {
      this.constraints.push(constraint);
      return this._checkDOF();
    }

    removeConstraint(index) {
      this.constraints.splice(index, 1);
    }

    clear() {
      this.constraints = [];
      this.conflictConstraints.clear();
    }

    setParam(name, value) {
      this.params[name] = value;
    }

    _collectPoints() {
      const pointSet = new Set();
      for (const c of this.constraints) {
        for (const p of c.getReferencedPoints()) {
          pointSet.add(p);
        }
      }
      return [...pointSet];
    }

    calculateDOF() {
      const points = this._collectPoints();
      let dof = points.length * 2;
      for (const c of this.constraints) {
        dof -= c.getDOFCost();
      }
      return dof;
    }

    _checkDOF() {
      const dof = this.calculateDOF();
      return dof >= 0;
    }

    _buildVarMap(points, fixedPoints) {
      const varMap = {};
      let varIndex = 0;
      for (const pid of points) {
        if (!fixedPoints || !fixedPoints.has(pid + '_x')) {
          varMap[pid + '_x'] = varIndex++;
        }
        if (!fixedPoints || !fixedPoints.has(pid + '_y')) {
          varMap[pid + '_y'] = varIndex++;
        }
      }
      return { varMap, varCount: varIndex };
    }

    _flattenPointMap(pointMap, varMap) {
      const x = vecCreate(Object.keys(varMap).length);
      for (const key in varMap) {
        const idx = varMap[key];
        const [pid, coord] = key.split('_');
        const p = pointMap[pid];
        if (p) {
          x[idx] = coord === 'x' ? p.x : p.y;
        }
      }
      return x;
    }

    _unflattenToPointMap(pointMap, varMap, x) {
      for (const key in varMap) {
        const idx = varMap[key];
        const [pid, coord] = key.split('_');
        if (pointMap[pid]) {
          if (coord === 'x') {
            pointMap[pid] = { ...pointMap[pid], x: x[idx] };
          } else {
            pointMap[pid] = { ...pointMap[pid], y: x[idx] };
          }
        }
      }
    }

    _buildResidualAndJacobian(pointMap, varMap, extraFixed) {
      const nVars = Object.keys(varMap).length;
      const allResiduals = [];
      const allJacobian = [];

      for (const c of this.constraints) {
        const res = c.evaluate(pointMap, this.params);
        const jac = c.evaluateJacobian(pointMap, this.params, varMap);
        for (let i = 0; i < res.length; i++) {
          allResiduals.push(res[i]);
          allJacobian.push(jac[i]);
        }
      }

      if (extraFixed) {
        for (const key in extraFixed) {
          const [pid, coord] = key.split('_');
          const varIdx = varMap[key];
          if (varIdx !== undefined) {
            const target = extraFixed[key];
            const p = pointMap[pid];
            const current = coord === 'x' ? p.x : p.y;
            allResiduals.push(current - target);
            const row = vecCreate(nVars);
            row[varIdx] = 1;
            allJacobian.push(row);
          }
        }
      }

      return { residuals: allResiduals, jacobian: allJacobian };
    }

    solve(pointMap, fixedPoints, extraFixed, maxIter) {
      maxIter = maxIter || MAX_ITER;
      const points = this._collectPoints();
      const { varMap, varCount } = this._buildVarMap(points, fixedPoints);

      if (varCount === 0) {
        return { success: true, iterations: 0, residual: 0 };
      }

      this.conflictConstraints.clear();

      for (let iter = 0; iter < maxIter; iter++) {
        const { residuals, jacobian } = this._buildResidualAndJacobian(pointMap, varMap, extraFixed);

        const totalRes = residuals.reduce((s, r) => s + r * r, 0);
        if (Math.sqrt(totalRes) < TOLERANCE) {
          return { success: true, iterations: iter, residual: Math.sqrt(totalRes) };
        }

        if (residuals.length < varCount) {
          const x = this._flattenPointMap(pointMap, varMap);
          for (let i = 0; i < varCount; i++) {
            if (jacobian.length > i) {
              const row = jacobian[i];
              if (row) {
                for (let j = 0; j < row.length; j++) {
                  if (Math.abs(row[j]) > CS_EPS) {
                    x[j] -= residuals[i] * row[j] / (row.reduce((s, v) => s + v * v, 0) + CS_EPS);
                  }
                }
              }
            }
          }
          this._unflattenToPointMap(pointMap, varMap, x);
          continue;
        }

        const A = jacobian.map(r => r.slice());
        const b = residuals.map(v => -v);

        const result = gaussianElimination(A, b);

        if (result.singular) {
          this._detectConflicts(pointMap, varMap, residuals, jacobian);
          return { success: false, iterations: iter, residual: Math.sqrt(totalRes), singular: true };
        }

        if (!result.solution) {
          this._detectConflicts(pointMap, varMap, residuals, jacobian);
          return { success: false, iterations: iter, residual: Math.sqrt(totalRes), singular: true };
        }

        const dx = result.solution;
        const x = this._flattenPointMap(pointMap, varMap);
        for (let i = 0; i < x.length; i++) {
          if (i < dx.length && isFinite(dx[i])) {
            x[i] += dx[i];
          }
        }
        this._unflattenToPointMap(pointMap, varMap, x);
      }

      const { residuals: finalRes } = this._buildResidualAndJacobian(pointMap, varMap, extraFixed);
      const finalTotal = Math.sqrt(finalRes.reduce((s, r) => s + r * r, 0));

      if (finalTotal > TOLERANCE * 10) {
        this._detectConflicts(pointMap, varMap, finalRes, this._buildResidualAndJacobian(pointMap, varMap, extraFixed).jacobian);
      }

      return {
        success: finalTotal < TOLERANCE * 10,
        iterations: maxIter,
        residual: finalTotal
      };
    }

    _detectConflicts(pointMap, varMap, residuals, jacobian) {
      let resIdx = 0;
      for (let ci = 0; ci < this.constraints.length; ci++) {
        const c = this.constraints[ci];
        const eqCount = c.getEquationCount();
        let maxErr = 0;
        for (let i = 0; i < eqCount && resIdx + i < residuals.length; i++) {
          maxErr = Math.max(maxErr, Math.abs(residuals[resIdx + i]));
        }
        if (maxErr > TOLERANCE * 100) {
          this.conflictConstraints.add(ci);
        }
        resIdx += eqCount;
      }
    }

    getPointStatusMap() {
      const points = this._collectPoints();
      const dof = this.calculateDOF();
      const statusMap = {};
      if (dof < 0) {
        for (const p of points) {
          statusMap[p] = 'over';
        }
      } else if (dof > 0) {
        for (const p of points) {
          statusMap[p] = 'under';
        }
      } else {
        for (const p of points) {
          statusMap[p] = 'full';
        }
      }
      return statusMap;
    }
  }

  class ParamManager {
    constructor() {
      this.params = {};
    }

    addParam(name, value) {
      if (!this._isValidName(name)) return false;
      this.params[name] = { value: value, expression: null };
      return true;
    }

    removeParam(name) {
      delete this.params[name];
    }

    setParam(name, value) {
      if (this.params[name]) {
        this.params[name].value = value;
        this.params[name].expression = null;
      }
    }

    setExpression(name, expr) {
      if (this.params[name]) {
        this.params[name].expression = expr;
        this._evaluateExpression(name);
      }
    }

    getParam(name) {
      if (this.params[name]) return this.params[name].value;
      return undefined;
    }

    getAllParams() {
      const result = {};
      for (const name in this.params) {
        result[name] = this.params[name].value;
      }
      return result;
    }

    _isValidName(name) {
      return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
    }

    _evaluateExpression(name) {
      const p = this.params[name];
      if (!p.expression) return;
      try {
        const vars = {};
        for (const n in this.params) {
          vars[n] = this.params[n].value;
        }
        const fn = new Function(...Object.keys(vars), `return (${p.expression});`);
        const val = fn(...Object.values(vars));
        if (typeof val === 'number' && isFinite(val)) {
          p.value = val;
        }
      } catch (e) {
      }
    }

    reevaluateAll() {
      for (const name in this.params) {
        if (this.params[name].expression) {
          this._evaluateExpression(name);
        }
      }
    }
  }

  function makePointId(shapeId, isHole, holeIndex, pointIndex) {
    return `${shapeId}:${isHole ? 'h' : 'p'}:${holeIndex}:${pointIndex}`;
  }

  function parsePointId(id) {
    const parts = id.split(':');
    return {
      shapeId: parseInt(parts[0], 10),
      isHole: parts[1] === 'h',
      holeIndex: parseInt(parts[2], 10),
      pointIndex: parseInt(parts[3], 10)
    };
  }

  global.ConstraintSystem = {
    CS_EPS,
    MAX_ITER,
    TOLERANCE,
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
    parsePointId,
    matCreate,
    vecCreate,
    gaussianElimination
  };

})(typeof window !== 'undefined' ? window : this);
