(function(global) {
  'use strict';

  var EPS = 1e-6;

  function cubicBezier(p0, p1, p2, p3, t) {
    var u = 1 - t;
    var uu = u * u;
    var uuu = uu * u;
    var tt = t * t;
    var ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
    };
  }

  function cubicBezierDerivative(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function normalize(v) {
    var l = Math.hypot(v.x, v.y);
    if (l < EPS) return { x: 0, y: 0 };
    return { x: v.x / l, y: v.y / l };
  }

  function FreeDeformation(bounds) {
    this.rows = 4;
    this.cols = 4;
    this.bounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY
    };
    this.controlPoints = [];
    this.handleIn = [];
    this.handleOut = [];
    this.handleTop = [];
    this.handleBottom = [];
    this._initGrid();
  }

  FreeDeformation.prototype._initGrid = function() {
    var b = this.bounds;
    var rows = this.rows;
    var cols = this.cols;
    this.controlPoints = [];
    this.handleIn = [];
    this.handleOut = [];
    this.handleTop = [];
    this.handleBottom = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x = lerp(b.minX, b.maxX, c / (cols - 1));
        var y = lerp(b.minY, b.maxY, r / (rows - 1));
        this.controlPoints.push({ x: x, y: y });
        var hLenX = Math.min(b.maxX - b.minX, b.maxY - b.minY) / (Math.max(rows, cols) * 3);
        var hLenY = Math.min(b.maxX - b.minX, b.maxY - b.minY) / (Math.max(rows, cols) * 3);
        this.handleIn.push({ x: x - hLenX, y: y });
        this.handleOut.push({ x: x + hLenX, y: y });
        this.handleTop.push({ x: x, y: y - hLenY });
        this.handleBottom.push({ x: x, y: y + hLenY });
      }
    }
  };

  FreeDeformation.prototype.getPoint = function(row, col) {
    return this.controlPoints[row * this.cols + col];
  };

  FreeDeformation.prototype.getHandleIn = function(row, col) {
    return this.handleIn[row * this.cols + col];
  };

  FreeDeformation.prototype.getHandleOut = function(row, col) {
    return this.handleOut[row * this.cols + col];
  };

  FreeDeformation.prototype.getHandleTop = function(row, col) {
    return this.handleTop[row * this.cols + col];
  };

  FreeDeformation.prototype.getHandleBottom = function(row, col) {
    return this.handleBottom[row * this.cols + col];
  };

  FreeDeformation.prototype.setPoint = function(row, col, x, y) {
    this.controlPoints[row * this.cols + col] = { x: x, y: y };
  };

  FreeDeformation.prototype.setHandleIn = function(row, col, x, y) {
    this.handleIn[row * this.cols + col] = { x: x, y: y };
  };

  FreeDeformation.prototype.setHandleOut = function(row, col, x, y) {
    this.handleOut[row * this.cols + col] = { x: x, y: y };
  };

  FreeDeformation.prototype.setHandleTop = function(row, col, x, y) {
    this.handleTop[row * this.cols + col] = { x: x, y: y };
  };

  FreeDeformation.prototype.setHandleBottom = function(row, col, x, y) {
    this.handleBottom[row * this.cols + col] = { x: x, y: y };
  };

  FreeDeformation.prototype.worldToGrid = function(px, py) {
    var b = this.bounds;
    var u = (b.maxX - b.minX) > EPS ? (px - b.minX) / (b.maxX - b.minX) : 0.5;
    var v = (b.maxY - b.minY) > EPS ? (py - b.minY) / (b.maxY - b.minY) : 0.5;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));
    return { u: u, v: v };
  };

  FreeDeformation.prototype._evalBezierRow = function(row, u) {
    var p0 = this.getPoint(row, 0);
    var h0o = this.getHandleOut(row, 0);
    var p1 = this.getPoint(row, 1);
    var h1i = this.getHandleIn(row, 1);
    var h1o = this.getHandleOut(row, 1);
    var p2 = this.getPoint(row, 2);
    var h2i = this.getHandleIn(row, 2);
    var h2o = this.getHandleOut(row, 2);
    var p3 = this.getPoint(row, 3);

    var seg = u * 3;
    if (seg <= 1) {
      var t = seg;
      return cubicBezier(p0, h0o, h1i, p1, t);
    } else if (seg <= 2) {
      var t = seg - 1;
      return cubicBezier(p1, h1o, h2i, p2, t);
    } else {
      var t = seg - 2;
      return cubicBezier(p2, h2o, p3, p3, t);
    }
  };

  FreeDeformation.prototype._evalHandleRow = function(row, handleArr, u) {
    var cols = this.cols;
    var p0 = handleArr[row * cols + 0];
    var h0o = this.getHandleOut(row, 0);
    var p1 = handleArr[row * cols + 1];
    var h1i = this.getHandleIn(row, 1);
    var h1o = this.getHandleOut(row, 1);
    var p2 = handleArr[row * cols + 2];
    var h2i = this.getHandleIn(row, 2);
    var h2o = this.getHandleOut(row, 2);
    var p3 = handleArr[row * cols + 3];

    var seg = u * 3;
    if (seg <= 1) {
      var t = seg;
      return cubicBezier(p0, h0o, h1i, p1, t);
    } else if (seg <= 2) {
      var t = seg - 1;
      return cubicBezier(p1, h1o, h2i, p2, t);
    } else {
      var t = seg - 2;
      return cubicBezier(p2, h2o, p3, p3, t);
    }
  };

  FreeDeformation.prototype._evalBezierCol = function(colPts, colTopHandles, colBotHandles, v) {
    var p0 = colPts[0];
    var h0b = colBotHandles[0];
    var p1 = colPts[1];
    var h1t = colTopHandles[1];
    var h1b = colBotHandles[1];
    var p2 = colPts[2];
    var h2t = colTopHandles[2];
    var h2b = colBotHandles[2];
    var p3 = colPts[3];
    var h3t = colTopHandles[3];

    var seg = v * 3;
    if (seg <= 1) {
      var t = seg;
      return cubicBezier(p0, h0b, h1t, p1, t);
    } else if (seg <= 2) {
      var t = seg - 1;
      return cubicBezier(p1, h1b, h2t, p2, t);
    } else {
      var t = seg - 2;
      return cubicBezier(p2, h2b, h3t, p3, t);
    }
  };

  FreeDeformation.prototype.deformPoint = function(px, py) {
    var gv = this.worldToGrid(px, py);
    var u = gv.u;
    var v = gv.v;

    var rows = this.rows;
    var pRows = [];
    var topHandlesRow = [];
    var botHandlesRow = [];
    for (var r = 0; r < rows; r++) {
      pRows.push(this._evalBezierRow(r, u));
      topHandlesRow.push(this._evalHandleRow(r, this.handleTop, u));
      botHandlesRow.push(this._evalHandleRow(r, this.handleBottom, u));
    }

    return this._evalBezierCol(pRows, topHandlesRow, botHandlesRow, v);
  };

  FreeDeformation.prototype.deformPoints = function(points) {
    var result = [];
    for (var i = 0; i < points.length; i++) {
      result.push(this.deformPoint(points[i].x, points[i].y));
    }
    return result;
  };

  FreeDeformation.prototype.serialize = function() {
    return {
      type: 'free',
      bounds: JSON.parse(JSON.stringify(this.bounds)),
      rows: this.rows,
      cols: this.cols,
      controlPoints: this.controlPoints.map(function(p) { return { x: p.x, y: p.y }; }),
      handleIn: this.handleIn.map(function(p) { return { x: p.x, y: p.y }; }),
      handleOut: this.handleOut.map(function(p) { return { x: p.x, y: p.y }; }),
      handleTop: this.handleTop.map(function(p) { return { x: p.x, y: p.y }; }),
      handleBottom: this.handleBottom.map(function(p) { return { x: p.x, y: p.y }; })
    };
  };

  FreeDeformation.deserialize = function(data) {
    var fd = new FreeDeformation(data.bounds);
    fd.rows = data.rows || 4;
    fd.cols = data.cols || 4;
    fd.controlPoints = data.controlPoints.map(function(p) { return { x: p.x, y: p.y }; });
    fd.handleIn = data.handleIn.map(function(p) { return { x: p.x, y: p.y }; });
    fd.handleOut = data.handleOut.map(function(p) { return { x: p.x, y: p.y }; });
    if (data.handleTop) {
      fd.handleTop = data.handleTop.map(function(p) { return { x: p.x, y: p.y }; });
    }
    if (data.handleBottom) {
      fd.handleBottom = data.handleBottom.map(function(p) { return { x: p.x, y: p.y }; });
    }
    return fd;
  };

  FreeDeformation.prototype.isIdentity = function() {
    var b = this.bounds;
    for (var r = 0; r < this.rows; r++) {
      for (var c = 0; c < this.cols; c++) {
        var idx = r * this.cols + c;
        var expected = {
          x: lerp(b.minX, b.maxX, c / (this.cols - 1)),
          y: lerp(b.minY, b.maxY, r / (this.rows - 1))
        };
        if (dist(this.controlPoints[idx], expected) > 0.5) return false;
        var hLen = Math.min(b.maxX - b.minX, b.maxY - b.minY) / (Math.max(this.rows, this.cols) * 3);
        if (this.handleTop && dist(this.handleTop[idx], { x: expected.x, y: expected.y - hLen }) > 0.5) return false;
        if (this.handleBottom && dist(this.handleBottom[idx], { x: expected.x, y: expected.y + hLen }) > 0.5) return false;
      }
    }
    return true;
  };

  FreeDeformation.prototype.bake = function(points, holes) {
    var deformedPts = this.deformPoints(points);
    var deformedHoles = [];
    if (holes) {
      for (var h = 0; h < holes.length; h++) {
        deformedHoles.push(this.deformPoints(holes[h]));
      }
    }
    return { points: deformedPts, holes: deformedHoles };
  };

  function EnvelopeDeformation(bounds) {
    this.bounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY
    };
    this.topCurve = [];
    this.bottomCurve = [];
    this._initCurves();
  }

  EnvelopeDeformation.prototype._initCurves = function() {
    var b = this.bounds;
    var w = b.maxX - b.minX;
    var h = b.maxY - b.minY;
    var cy_top = b.minY;
    var cy_bot = b.maxY;

    this.topCurve = [
      { x: b.minX, y: cy_top, inHandle: { x: b.minX + w * 0.33, y: cy_top }, outHandle: { x: b.minX + w * 0.33, y: cy_top } },
      { x: b.minX + w * 0.33, y: cy_top, inHandle: { x: b.minX + w * 0.17, y: cy_top }, outHandle: { x: b.minX + w * 0.50, y: cy_top } },
      { x: b.minX + w * 0.67, y: cy_top, inHandle: { x: b.minX + w * 0.50, y: cy_top }, outHandle: { x: b.minX + w * 0.83, y: cy_top } },
      { x: b.maxX, y: cy_top, inHandle: { x: b.minX + w * 0.67, y: cy_top }, outHandle: { x: b.minX + w * 0.67, y: cy_top } }
    ];

    this.bottomCurve = [
      { x: b.minX, y: cy_bot, inHandle: { x: b.minX + w * 0.33, y: cy_bot }, outHandle: { x: b.minX + w * 0.33, y: cy_bot } },
      { x: b.minX + w * 0.33, y: cy_bot, inHandle: { x: b.minX + w * 0.17, y: cy_bot }, outHandle: { x: b.minX + w * 0.50, y: cy_bot } },
      { x: b.minX + w * 0.67, y: cy_bot, inHandle: { x: b.minX + w * 0.50, y: cy_bot }, outHandle: { x: b.minX + w * 0.83, y: cy_bot } },
      { x: b.maxX, y: cy_bot, inHandle: { x: b.minX + w * 0.67, y: cy_bot }, outHandle: { x: b.minX + w * 0.67, y: cy_bot } }
    ];
  };

  EnvelopeDeformation.prototype._evalCurve = function(curve, t) {
    var n = curve.length - 1;
    if (n < 1) return { x: curve[0].x, y: curve[0].y };
    var seg = t * n;
    var i = Math.min(Math.floor(seg), n - 1);
    var lt = seg - i;

    var p0 = { x: curve[i].x, y: curve[i].y };
    var p1 = { x: curve[i].outHandle.x, y: curve[i].outHandle.y };
    var p2 = { x: curve[i + 1].inHandle.x, y: curve[i + 1].inHandle.y };
    var p3 = { x: curve[i + 1].x, y: curve[i + 1].y };
    return cubicBezier(p0, p1, p2, p3, lt);
  };

  EnvelopeDeformation.prototype.deformPoint = function(px, py) {
    var b = this.bounds;
    var w = b.maxX - b.minX;
    var h = b.maxY - b.minY;

    if (w < EPS || h < EPS) return { x: px, y: py };

    var u = (px - b.minX) / w;
    var v = (py - b.minY) / h;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    var topPt = this._evalCurve(this.topCurve, u);
    var botPt = this._evalCurve(this.bottomCurve, u);

    return {
      x: lerp(topPt.x, botPt.x, v),
      y: lerp(topPt.y, botPt.y, v)
    };
  };

  EnvelopeDeformation.prototype.deformPoints = function(points) {
    var result = [];
    for (var i = 0; i < points.length; i++) {
      result.push(this.deformPoint(points[i].x, points[i].y));
    }
    return result;
  };

  EnvelopeDeformation.prototype.isIdentity = function() {
    var b = this.bounds;
    for (var i = 0; i < this.topCurve.length; i++) {
      if (Math.abs(this.topCurve[i].y - b.minY) > 0.5) return false;
      if (dist(this.topCurve[i].inHandle, { x: this.topCurve[i].inHandle.x, y: b.minY }) > 0.5) return false;
      if (dist(this.topCurve[i].outHandle, { x: this.topCurve[i].outHandle.x, y: b.minY }) > 0.5) return false;
    }
    for (var i = 0; i < this.bottomCurve.length; i++) {
      if (Math.abs(this.bottomCurve[i].y - b.maxY) > 0.5) return false;
      if (dist(this.bottomCurve[i].inHandle, { x: this.bottomCurve[i].inHandle.x, y: b.maxY }) > 0.5) return false;
      if (dist(this.bottomCurve[i].outHandle, { x: this.bottomCurve[i].outHandle.x, y: b.maxY }) > 0.5) return false;
    }
    return true;
  };

  EnvelopeDeformation.prototype.bake = function(points, holes) {
    var deformedPts = this.deformPoints(points);
    var deformedHoles = [];
    if (holes) {
      for (var h = 0; h < holes.length; h++) {
        deformedHoles.push(this.deformPoints(holes[h]));
      }
    }
    return { points: deformedPts, holes: deformedHoles };
  };

  EnvelopeDeformation.prototype.serialize = function() {
    function serCurve(curve) {
      return curve.map(function(pt) {
        return {
          x: pt.x, y: pt.y,
          inHandle: { x: pt.inHandle.x, y: pt.inHandle.y },
          outHandle: { x: pt.outHandle.x, y: pt.outHandle.y }
        };
      });
    }
    return {
      type: 'envelope',
      bounds: JSON.parse(JSON.stringify(this.bounds)),
      topCurve: serCurve(this.topCurve),
      bottomCurve: serCurve(this.bottomCurve)
    };
  };

  EnvelopeDeformation.deserialize = function(data) {
    var ed = new EnvelopeDeformation(data.bounds);
    ed.topCurve = data.topCurve.map(function(pt) {
      return {
        x: pt.x, y: pt.y,
        inHandle: { x: pt.inHandle.x, y: pt.inHandle.y },
        outHandle: { x: pt.outHandle.x, y: pt.outHandle.y }
      };
    });
    ed.bottomCurve = data.bottomCurve.map(function(pt) {
      return {
        x: pt.x, y: pt.y,
        inHandle: { x: pt.inHandle.x, y: pt.inHandle.y },
        outHandle: { x: pt.outHandle.x, y: pt.outHandle.y }
      };
    });
    return ed;
  };

  function createDeformation(type, shapePoints, shapeHoles) {
    var allPts = shapePoints.slice();
    if (shapeHoles) {
      for (var h = 0; h < shapeHoles.length; h++) {
        allPts = allPts.concat(shapeHoles[h]);
      }
    }
    if (allPts.length === 0) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < allPts.length; i++) {
      if (allPts[i].x < minX) minX = allPts[i].x;
      if (allPts[i].y < minY) minY = allPts[i].y;
      if (allPts[i].x > maxX) maxX = allPts[i].x;
      if (allPts[i].y > maxY) maxY = allPts[i].y;
    }
    var pad = 5;
    var bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

    if (type === 'free') {
      return new FreeDeformation(bounds);
    } else if (type === 'envelope') {
      return new EnvelopeDeformation(bounds);
    }
    return null;
  }

  function deserializeDeformation(data) {
    if (!data) return null;
    if (data.type === 'free') return FreeDeformation.deserialize(data);
    if (data.type === 'envelope') return EnvelopeDeformation.deserialize(data);
    return null;
  }

  function interpolatePoint(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t)
    };
  }

  function interpolatePointArray(arrA, arrB, t) {
    var result = [];
    var n = Math.min(arrA.length, arrB.length);
    for (var i = 0; i < n; i++) {
      result.push(interpolatePoint(arrA[i], arrB[i], t));
    }
    return result;
  }

  function interpolateEnvelopeCurve(curveA, curveB, t) {
    var result = [];
    var n = Math.min(curveA.length, curveB.length);
    for (var i = 0; i < n; i++) {
      result.push({
        x: lerp(curveA[i].x, curveB[i].x, t),
        y: lerp(curveA[i].y, curveB[i].y, t),
        inHandle: interpolatePoint(curveA[i].inHandle, curveB[i].inHandle, t),
        outHandle: interpolatePoint(curveA[i].outHandle, curveB[i].outHandle, t)
      });
    }
    return result;
  }

  function interpolateDeformation(defA, defB, t) {
    if (!defA && !defB) return null;
    if (!defA) return JSON.parse(JSON.stringify(defB));
    if (!defB) return JSON.parse(JSON.stringify(defA));
    if (defA.type !== defB.type) return t < 0.5 ? JSON.parse(JSON.stringify(defA)) : JSON.parse(JSON.stringify(defB));

    if (defA.type === 'free') {
      var result = {
        type: 'free',
        bounds: {
          minX: lerp(defA.bounds.minX, defB.bounds.minX, t),
          minY: lerp(defA.bounds.minY, defB.bounds.minY, t),
          maxX: lerp(defA.bounds.maxX, defB.bounds.maxX, t),
          maxY: lerp(defA.bounds.maxY, defB.bounds.maxY, t)
        },
        rows: defA.rows,
        cols: defA.cols,
        controlPoints: interpolatePointArray(defA.controlPoints, defB.controlPoints, t),
        handleIn: interpolatePointArray(defA.handleIn, defB.handleIn, t),
        handleOut: interpolatePointArray(defA.handleOut, defB.handleOut, t)
      };
      if (defA.handleTop && defB.handleTop) {
        result.handleTop = interpolatePointArray(defA.handleTop, defB.handleTop, t);
      }
      if (defA.handleBottom && defB.handleBottom) {
        result.handleBottom = interpolatePointArray(defA.handleBottom, defB.handleBottom, t);
      }
      return result;
    } else if (defA.type === 'envelope') {
      return {
        type: 'envelope',
        bounds: {
          minX: lerp(defA.bounds.minX, defB.bounds.minX, t),
          minY: lerp(defA.bounds.minY, defB.bounds.minY, t),
          maxX: lerp(defA.bounds.maxX, defB.bounds.maxX, t),
          maxY: lerp(defA.bounds.maxY, defB.bounds.maxY, t)
        },
        topCurve: interpolateEnvelopeCurve(defA.topCurve, defB.topCurve, t),
        bottomCurve: interpolateEnvelopeCurve(defA.bottomCurve, defB.bottomCurve, t)
      };
    }
    return t < 0.5 ? JSON.parse(JSON.stringify(defA)) : JSON.parse(JSON.stringify(defB));
  }

  global.DeformationSystem = {
    FreeDeformation: FreeDeformation,
    EnvelopeDeformation: EnvelopeDeformation,
    createDeformation: createDeformation,
    deserializeDeformation: deserializeDeformation,
    cubicBezier: cubicBezier,
    interpolateDeformation: interpolateDeformation
  };

})(window);
