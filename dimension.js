(function() {
  const DIMENSION_EPS = 1e-6;

  const DIMENSION_TYPES = {
    DISTANCE_TWO_POINTS: 'distance-two-points',
    DISTANCE_EDGE: 'distance-edge',
    ANGLE_TWO_EDGES: 'angle-two-edges',
    RADIUS_ARC: 'radius-arc'
  };

  const UNIT_TYPES = {
    PX: 'px',
    MM: 'mm',
    CM: 'cm'
  };

  const DEFAULT_SETTINGS = {
    unit: UNIT_TYPES.PX,
    scaleFactor: 1,
    textSize: 12,
    textColor: '#1a73e8',
    lineColor: '#1a73e8',
    lineWidth: 1.5,
    arrowSize: 8,
    offset: 20,
    precision: 2,
    showUnits: true
  };

  class DimensionSystem {
    constructor() {
      this.dimensions = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.nextId = 1;
      this.measureMode = false;
      this.measureHoverEdge = null;
      this.measureSelectedPoints = [];
      this.measureSelectedEdges = [];
    }

    convertValue(pixels) {
      let value = pixels / this.settings.scaleFactor;
      switch (this.settings.unit) {
        case UNIT_TYPES.MM:
          value = value * (25.4 / 96);
          break;
        case UNIT_TYPES.CM:
          value = value * (2.54 / 96);
          break;
        case UNIT_TYPES.PX:
        default:
          break;
      }
      return value;
    }

    formatValue(pixels) {
      const value = this.convertValue(pixels);
      const rounded = Number(value.toFixed(this.settings.precision));
      let str = String(rounded);
      if (this.settings.showUnits) {
        str += this.settings.unit;
      }
      return str;
    }

    getUnitLabel() {
      return this.settings.unit;
    }

    addDistanceTwoPoints(pointA, pointB, associatedShapeIds, offsetAngle) {
      const dim = {
        id: this.nextId++,
        type: DIMENSION_TYPES.DISTANCE_TWO_POINTS,
        pointA: { ...pointA },
        pointB: { ...pointB },
        associatedShapeIds: [...associatedShapeIds],
        offset: this.settings.offset,
        offsetAngle: offsetAngle !== undefined ? offsetAngle : this._defaultOffsetAngle(pointA, pointB),
        textPosition: null,
        visible: true,
        locked: false
      };
      dim.textPosition = this._calculateDistanceTextPosition(dim);
      this.dimensions.push(dim);
      return dim;
    }

    addDistanceEdge(shapeId, isHole, holeIndex, edgeIndex, points) {
      const a = points[edgeIndex];
      const b = points[(edgeIndex + 1) % points.length];
      const dim = {
        id: this.nextId++,
        type: DIMENSION_TYPES.DISTANCE_EDGE,
        shapeId: shapeId,
        isHole: isHole,
        holeIndex: holeIndex,
        edgeIndex: edgeIndex,
        pointA: { ...a },
        pointB: { ...b },
        associatedShapeIds: [shapeId],
        offset: this.settings.offset,
        offsetAngle: this._perpendicularAngle(a, b),
        textPosition: null,
        visible: true,
        locked: false
      };
      dim.textPosition = this._calculateDistanceTextPosition(dim);
      this.dimensions.push(dim);
      return dim;
    }

    addAngleTwoEdges(edge1Info, edge2Info, vertexPoint, points1, points2) {
      const a1 = points1[edge1Info.edgeIndex];
      const b1 = points1[(edge1Info.edgeIndex + 1) % points1.length];
      const a2 = points2[edge2Info.edgeIndex];
      const b2 = points2[(edge2Info.edgeIndex + 1) % points2.length];

      const dir1 = this._getEdgeDirectionFromVertex(a1, b1, vertexPoint);
      const dir2 = this._getEdgeDirectionFromVertex(a2, b2, vertexPoint);
      const angle = this._angleBetween(dir1, dir2);

      const dim = {
        id: this.nextId++,
        type: DIMENSION_TYPES.ANGLE_TWO_EDGES,
        edge1: {
          shapeId: edge1Info.shapeId,
          isHole: edge1Info.isHole,
          holeIndex: edge1Info.holeIndex,
          edgeIndex: edge1Info.edgeIndex
        },
        edge2: {
          shapeId: edge2Info.shapeId,
          isHole: edge2Info.isHole,
          holeIndex: edge2Info.holeIndex,
          edgeIndex: edge2Info.edgeIndex
        },
        vertex: { ...vertexPoint },
        direction1: { ...dir1 },
        direction2: { ...dir2 },
        angle: angle,
        radius: this.settings.offset,
        associatedShapeIds: [edge1Info.shapeId, edge2Info.shapeId].filter((v, i, a) => a.indexOf(v) === i),
        textPosition: null,
        visible: true,
        locked: false
      };
      dim.textPosition = this._calculateAngleTextPosition(dim);
      this.dimensions.push(dim);
      return dim;
    }

    addRadiusArc(shapeId, isHole, holeIndex, startIndex, arcPoints) {
      const { center, radius } = this._fitCircle(arcPoints);
      if (!center || !radius) return null;

      const dim = {
        id: this.nextId++,
        type: DIMENSION_TYPES.RADIUS_ARC,
        shapeId: shapeId,
        isHole: isHole,
        holeIndex: holeIndex,
        arcStartIndex: startIndex,
        arcPointCount: arcPoints.length,
        center: { ...center },
        radius: radius,
        associatedShapeIds: [shapeId],
        offset: this.settings.offset,
        textPosition: null,
        visible: true,
        locked: false
      };
      const midPoint = arcPoints[Math.floor(arcPoints.length / 2)];
      dim.textPosition = this._calculateRadiusTextPosition(dim, midPoint);
      this.dimensions.push(dim);
      return dim;
    }

    removeDimension(id) {
      const idx = this.dimensions.findIndex(d => d.id === id);
      if (idx >= 0) {
        this.dimensions.splice(idx, 1);
        return true;
      }
      return false;
    }

    removeDimensionsForShape(shapeId) {
      const removed = [];
      this.dimensions = this.dimensions.filter(d => {
        const hasShape = d.associatedShapeIds && d.associatedShapeIds.includes(shapeId);
        if (hasShape) removed.push(d.id);
        return !hasShape;
      });
      return removed;
    }

    updateFromShapes(getShapePointsFn, getShapeHolesFn) {
      for (const dim of this.dimensions) {
        if (!dim.visible || dim.locked) continue;

        switch (dim.type) {
          case DIMENSION_TYPES.DISTANCE_EDGE:
            this._updateDistanceEdge(dim, getShapePointsFn, getShapeHolesFn);
            break;
          case DIMENSION_TYPES.ANGLE_TWO_EDGES:
            this._updateAngleTwoEdges(dim, getShapePointsFn, getShapeHolesFn);
            break;
          case DIMENSION_TYPES.RADIUS_ARC:
            this._updateRadiusArc(dim, getShapePointsFn, getShapeHolesFn);
            break;
        }
      }
    }

    _updateDistanceEdge(dim, getShapePointsFn, getShapeHolesFn) {
      const pts = dim.isHole
        ? (getShapeHolesFn(dim.shapeId) || [])[dim.holeIndex]
        : getShapePointsFn(dim.shapeId);
      if (!pts || pts.length === 0) return;

      const n = pts.length;
      const i = dim.edgeIndex;
      dim.pointA = { ...pts[i] };
      dim.pointB = { ...pts[(i + 1) % n] };
      dim.textPosition = this._calculateDistanceTextPosition(dim);
    }

    _updateAngleTwoEdges(dim, getShapePointsFn, getShapeHolesFn) {
      const pts1 = dim.edge1.isHole
        ? (getShapeHolesFn(dim.edge1.shapeId) || [])[dim.edge1.holeIndex]
        : getShapePointsFn(dim.edge1.shapeId);
      const pts2 = dim.edge2.isHole
        ? (getShapeHolesFn(dim.edge2.shapeId) || [])[dim.edge2.holeIndex]
        : getShapePointsFn(dim.edge2.shapeId);
      if (!pts1 || !pts2) return;

      const n1 = pts1.length, n2 = pts2.length;
      const e1a = pts1[dim.edge1.edgeIndex];
      const e1b = pts1[(dim.edge1.edgeIndex + 1) % n1];
      const e2a = pts2[dim.edge2.edgeIndex];
      const e2b = pts2[(dim.edge2.edgeIndex + 1) % n2];

      const vertex = this._findCommonVertex(e1a, e1b, e2a, e2b);
      if (vertex) {
        dim.vertex = { ...vertex };
        dim.direction1 = this._getEdgeDirectionFromVertex(e1a, e1b, vertex);
        dim.direction2 = this._getEdgeDirectionFromVertex(e2a, e2b, vertex);
        dim.angle = this._angleBetween(dim.direction1, dim.direction2);
      }
      dim.textPosition = this._calculateAngleTextPosition(dim);
    }

    _updateRadiusArc(dim, getShapePointsFn, getShapeHolesFn) {
      const pts = dim.isHole
        ? (getShapeHolesFn(dim.shapeId) || [])[dim.holeIndex]
        : getShapePointsFn(dim.shapeId);
      if (!pts || pts.length === 0) return;

      const arcPoints = [];
      for (let i = 0; i < dim.arcPointCount; i++) {
        const idx = (dim.arcStartIndex + i) % pts.length;
        arcPoints.push(pts[idx]);
      }
      if (arcPoints.length < 3) return;

      const fitted = this._fitCircle(arcPoints);
      if (fitted.center && fitted.radius) {
        dim.center = { ...fitted.center };
        dim.radius = fitted.radius;
        const midPoint = arcPoints[Math.floor(arcPoints.length / 2)];
        dim.textPosition = this._calculateRadiusTextPosition(dim, midPoint);
      }
    }

    _calculateDistanceTextPosition(dim) {
      const a = dim.pointA, b = dim.pointB;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < DIMENSION_EPS) return mid;

      const nx = -dy / len, ny = dx / len;
      const offset = dim.offset || this.settings.offset;
      return {
        x: mid.x + nx * offset * Math.cos(dim.offsetAngle) - ny * offset * Math.sin(dim.offsetAngle),
        y: mid.y + nx * offset * Math.sin(dim.offsetAngle) + ny * offset * Math.cos(dim.offsetAngle)
      };
    }

    _calculateAngleTextPosition(dim) {
      const v = dim.vertex;
      const a1 = Math.atan2(dim.direction1.y, dim.direction1.x);
      const a2 = Math.atan2(dim.direction2.y, dim.direction2.x);
      let midAngle = (a1 + a2) / 2;
      if (Math.abs(a2 - a1) > Math.PI) {
        midAngle += Math.PI;
      }
      const r = (dim.radius || this.settings.offset) * 1.5;
      return {
        x: v.x + Math.cos(midAngle) * r,
        y: v.y + Math.sin(midAngle) * r
      };
    }

    _calculateRadiusTextPosition(dim, arcMidPoint) {
      const dx = arcMidPoint.x - dim.center.x;
      const dy = arcMidPoint.y - dim.center.y;
      const len = Math.hypot(dx, dy);
      if (len < DIMENSION_EPS) {
        return { x: dim.center.x + dim.radius + dim.offset, y: dim.center.y };
      }
      const ux = dx / len, uy = dy / len;
      const r = dim.radius + (dim.offset || this.settings.offset);
      return {
        x: dim.center.x + ux * r,
        y: dim.center.y + uy * r
      };
    }

    _defaultOffsetAngle(a, b) {
      return 0;
    }

    _perpendicularAngle(a, b) {
      return 0;
    }

    _getEdgeDirectionFromVertex(a, b, vertex) {
      const da = { x: a.x - vertex.x, y: a.y - vertex.y };
      const db = { x: b.x - vertex.x, y: b.y - vertex.y };
      const la = Math.hypot(da.x, da.y);
      const lb = Math.hypot(db.x, db.y);
      if (la > lb && la > DIMENSION_EPS) {
        return { x: da.x / la, y: da.y / la };
      }
      if (lb > DIMENSION_EPS) {
        return { x: db.x / lb, y: db.y / lb };
      }
      return { x: 1, y: 0 };
    }

    _findCommonVertex(a1, b1, a2, b2) {
      const candidates = [a1, b1];
      for (const p of candidates) {
        if (this._pointsEqual(p, a2) || this._pointsEqual(p, b2)) return p;
      }
      return null;
    }

    _pointsEqual(a, b, eps = DIMENSION_EPS * 100) {
      return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
    }

    _angleBetween(dir1, dir2) {
      const cross = dir1.x * dir2.y - dir1.y * dir2.x;
      const dot = dir1.x * dir2.x + dir1.y * dir2.y;
      let angle = Math.atan2(cross, dot);
      if (angle < 0) angle += Math.PI * 2;
      return angle;
    }

    _fitCircle(points) {
      if (points.length < 3) return { center: null, radius: 0 };
      const n = points.length;
      let A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0;
      for (const p of points) {
        const x2 = p.x * p.x, y2 = p.y * p.y;
        A += p.x; B += p.y;
        C += x2 + y2;
        D += p.x * p.y;
        E += x2; F += y2;
        G += p.x * (x2 + y2);
        H += p.y * (x2 + y2);
      }
      const a = n * E - A * A;
      const b = n * D - A * B;
      const c = n * F - B * B;
      const d = n * G - A * C;
      const e = n * H - B * C;
      const det = a * c - b * b;
      if (Math.abs(det) < DIMENSION_EPS) {
        return { center: null, radius: 0 };
      }
      const cx = (d * c - b * e) / (2 * det);
      const cy = (a * e - b * d) / (2 * det);
      let rSum = 0;
      for (const p of points) {
        rSum += Math.hypot(p.x - cx, p.y - cy);
      }
      return { center: { x: cx, y: cy }, radius: rSum / n };
    }

    serialize() {
      return {
        dimensions: JSON.parse(JSON.stringify(this.dimensions)),
        settings: JSON.parse(JSON.stringify(this.settings)),
        nextId: this.nextId
      };
    }

    deserialize(data) {
      if (!data) return;
      if (data.dimensions) {
        this.dimensions = JSON.parse(JSON.stringify(data.dimensions));
      }
      if (data.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      }
      if (data.nextId) {
        this.nextId = data.nextId;
      }
    }

    deepClone() {
      const cloned = new DimensionSystem();
      cloned.deserialize(this.serialize());
      cloned.measureMode = this.measureMode;
      cloned.measureHoverEdge = this.measureHoverEdge ? { ...this.measureHoverEdge } : null;
      cloned.measureSelectedPoints = this.measureSelectedPoints.map(p => ({ ...p }));
      cloned.measureSelectedEdges = this.measureSelectedEdges.map(e => ({ ...e }));
      return cloned;
    }

    render(ctx, viewportScale) {
      for (const dim of this.dimensions) {
        if (!dim.visible) continue;
        switch (dim.type) {
          case DIMENSION_TYPES.DISTANCE_TWO_POINTS:
          case DIMENSION_TYPES.DISTANCE_EDGE:
            this._renderDistanceDimension(ctx, dim, viewportScale);
            break;
          case DIMENSION_TYPES.ANGLE_TWO_EDGES:
            this._renderAngleDimension(ctx, dim, viewportScale);
            break;
          case DIMENSION_TYPES.RADIUS_ARC:
            this._renderRadiusDimension(ctx, dim, viewportScale);
            break;
        }
      }
    }

    _renderDistanceDimension(ctx, dim, viewportScale) {
      const a = dim.pointA, b = dim.pointB;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < DIMENSION_EPS) return;

      const s = this.settings;
      const lw = s.lineWidth / viewportScale;
      const arrow = s.arrowSize / viewportScale;
      const textSize = s.textSize / viewportScale;

      const dx = b.x - a.x, dy = b.y - a.y;
      const ux = dx / len, uy = dy / len;
      const perpX = -uy, perpY = ux;

      const off = dim.offset || s.offset;
      const ax = Math.cos(dim.offsetAngle), ay = Math.sin(dim.offsetAngle);
      const offX = perpX * off * ax - uy * off * ay + ux * 0;
      const offY = perpY * off * ax + ux * off * ay + uy * 0;
      const pureOffX = perpX * off;
      const pureOffY = perpY * off;

      const a2 = { x: a.x + pureOffX, y: a.y + pureOffY };
      const b2 = { x: b.x + pureOffX, y: b.y + pureOffY };

      ctx.save();
      ctx.strokeStyle = s.lineColor;
      ctx.fillStyle = s.textColor;
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

      this._drawArrow(ctx, a2, ux, uy, arrow, s.lineColor);
      this._drawArrow(ctx, b2, -ux, -uy, arrow, s.lineColor);

      const text = this.formatValue(len);
      const tp = dim.textPosition || this._calculateDistanceTextPosition(dim);
      ctx.font = `600 ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const pad = 4 / viewportScale;
      const bgW = metrics.width + pad * 2;
      const bgH = textSize + pad;

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);
      ctx.strokeStyle = s.lineColor;
      ctx.lineWidth = 0.5 / viewportScale;
      ctx.strokeRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);

      ctx.fillStyle = s.textColor;
      ctx.fillText(text, tp.x, tp.y);

      ctx.restore();
    }

    _renderAngleDimension(ctx, dim, viewportScale) {
      const v = dim.vertex;
      const s = this.settings;
      const lw = s.lineWidth / viewportScale;
      const arrow = s.arrowSize / viewportScale;
      const textSize = s.textSize / viewportScale;
      const r = (dim.radius || s.offset) * 0.7;

      const a1 = Math.atan2(dim.direction1.y, dim.direction1.x);
      const a2 = a1 + dim.angle;

      ctx.save();
      ctx.strokeStyle = s.lineColor;
      ctx.fillStyle = s.textColor;
      ctx.lineWidth = lw;

      const p1 = { x: v.x + Math.cos(a1) * r, y: v.y + Math.sin(a1) * r };
      const p2 = { x: v.x + Math.cos(a2) * r, y: v.y + Math.sin(a2) * r };

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
      const ccw = dim.angle > Math.PI;
      ctx.arc(v.x, v.y, r, a1, a2, ccw);
      ctx.stroke();

      const arrowAngle = a1 + dim.angle * 0.25;
      const arrowDir = Math.atan2(Math.sin(arrowAngle + Math.PI / 2) * (ccw ? -1 : 1), Math.cos(arrowAngle + Math.PI / 2) * (ccw ? -1 : 1));
      this._drawArrowAtPoint(ctx, p1, a1 + Math.PI / 2 + 0.3, arrow, s.lineColor);
      this._drawArrowAtPoint(ctx, p2, a2 - Math.PI / 2 - 0.3, arrow, s.lineColor);

      const deg = (dim.angle * 180 / Math.PI);
      const displayAngle = deg > 180 ? 360 - deg : deg;
      const text = Number(displayAngle.toFixed(s.precision)) + '°';

      const tp = dim.textPosition || this._calculateAngleTextPosition(dim);
      ctx.font = `600 ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const pad = 4 / viewportScale;
      const bgW = metrics.width + pad * 2;
      const bgH = textSize + pad;

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);
      ctx.strokeStyle = s.lineColor;
      ctx.lineWidth = 0.5 / viewportScale;
      ctx.strokeRect(tp.x - bgW / 2, tp.y - bgH / 2, bgW, bgH);

      ctx.fillStyle = s.textColor;
      ctx.fillText(text, tp.x, tp.y);

      ctx.restore();
    }

    _renderRadiusDimension(ctx, dim, viewportScale) {
      const s = this.settings;
      const lw = s.lineWidth / viewportScale;
      const arrow = s.arrowSize / viewportScale;
      const textSize = s.textSize / viewportScale;

      ctx.save();
      ctx.strokeStyle = s.lineColor;
      ctx.fillStyle = s.textColor;
      ctx.lineWidth = lw;

      const tp = dim.textPosition || { x: dim.center.x + dim.radius + s.offset, y: dim.center.y };
      const dx = tp.x - dim.center.x, dy = tp.y - dim.center.y;
      const len = Math.hypot(dx, dy);
      if (len < DIMENSION_EPS) { ctx.restore(); return; }
      const ux = dx / len, uy = dy / len;

      const arcPoint = { x: dim.center.x + ux * dim.radius, y: dim.center.y + uy * dim.radius };

      ctx.beginPath();
      ctx.moveTo(dim.center.x, dim.center.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();

      this._drawArrow(ctx, arcPoint, -ux, -uy, arrow, s.lineColor);

      ctx.beginPath();
      ctx.arc(dim.center.x, dim.center.y, 3 / viewportScale, 0, Math.PI * 2);
      ctx.fillStyle = s.lineColor;
      ctx.fill();

      const text = 'R' + this.formatValue(dim.radius);
      ctx.font = `600 ${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const pad = 4 / viewportScale;
      const bgW = metrics.width + pad * 2;
      const bgH = textSize + pad;
      const labelX = tp.x + 4 / viewportScale;
      const labelY = tp.y;

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(labelX - pad, labelY - bgH / 2, bgW, bgH);
      ctx.strokeStyle = s.lineColor;
      ctx.lineWidth = 0.5 / viewportScale;
      ctx.strokeRect(labelX - pad, labelY - bgH / 2, bgW, bgH);

      ctx.fillStyle = s.textColor;
      ctx.fillText(text, labelX, labelY);

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

    renderMeasureOverlay(ctx, viewportScale, hoverInfo, getPointsFn) {
      const s = this.settings;
      if (this.measureHoverEdge && getPointsFn) {
        const pts = this.measureHoverEdge.isHole
          ? (getPointsFn(this.measureHoverEdge.shapeId, true) || [])[this.measureHoverEdge.holeIndex]
          : getPointsFn(this.measureHoverEdge.shapeId, false);
        if (pts && pts.length > 0) {
          const n = pts.length;
          const a = pts[this.measureHoverEdge.edgeIndex];
          const b = pts[(this.measureHoverEdge.edgeIndex + 1) % n];
          const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);

          ctx.save();
          ctx.strokeStyle = '#ff9800';
          ctx.lineWidth = (s.lineWidth * 2) / viewportScale;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();

          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const text = this.formatValue(edgeLen);
          const textSize = s.textSize / viewportScale;
          ctx.font = `700 ${textSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const metrics = ctx.measureText(text);
          const pad = 4 / viewportScale;
          const bgW = metrics.width + pad * 2;
          const bgH = textSize + pad;
          ctx.fillStyle = 'rgba(255,152,0,0.95)';
          ctx.fillRect(mid.x - bgW / 2, mid.y - bgH / 2 - 20 / viewportScale, bgW, bgH);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, mid.x, mid.y - 20 / viewportScale);
          ctx.restore();
        }
      }

      if (this.measureSelectedPoints.length === 1) {
        const p = this.measureSelectedPoints[0];
        ctx.save();
        ctx.strokeStyle = '#4caf50';
        ctx.fillStyle = '#4caf50';
        ctx.lineWidth = 2 / viewportScale;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 / viewportScale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 / viewportScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (this.measureSelectedPoints.length === 2) {
        const [p1, p2] = this.measureSelectedPoints;
        const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        ctx.save();
        ctx.strokeStyle = '#4caf50';
        ctx.fillStyle = '#4caf50';
        ctx.lineWidth = 2 / viewportScale;
        ctx.setLineDash([4 / viewportScale, 3 / viewportScale]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const p of [p1, p2]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6 / viewportScale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2 / viewportScale, 0, Math.PI * 2);
          ctx.fill();
        }

        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const text = this.formatValue(d);
        const textSize = s.textSize / viewportScale;
        ctx.font = `700 ${textSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const metrics = ctx.measureText(text);
        const pad = 4 / viewportScale;
        const bgW = metrics.width + pad * 2;
        const bgH = textSize + pad;
        ctx.fillStyle = 'rgba(76,175,80,0.95)';
        ctx.fillRect(mid.x - bgW / 2, mid.y - bgH / 2 - 24 / viewportScale, bgW, bgH);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, mid.x, mid.y - 24 / viewportScale);
        ctx.restore();
      }

      if (this.measureSelectedEdges.length === 1 && getPointsFn) {
        const e = this.measureSelectedEdges[0];
        const pts = e.isHole
          ? (getPointsFn(e.shapeId, true) || [])[e.holeIndex]
          : getPointsFn(e.shapeId, false);
        if (pts && pts.length > 0) {
          const n = pts.length;
          const a = pts[e.edgeIndex];
          const b = pts[(e.edgeIndex + 1) % n];
          ctx.save();
          ctx.strokeStyle = '#9c27b0';
          ctx.lineWidth = 3 / viewportScale;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      } else if (this.measureSelectedEdges.length === 2 && getPointsFn) {
        const edges = [];
        for (const e of this.measureSelectedEdges) {
          const pts = e.isHole
            ? (getPointsFn(e.shapeId, true) || [])[e.holeIndex]
            : getPointsFn(e.shapeId, false);
          if (pts && pts.length > 0) {
            const n = pts.length;
            edges.push({
              a: pts[e.edgeIndex],
              b: pts[(e.edgeIndex + 1) % n]
            });
          }
        }
        if (edges.length === 2) {
          const vertex = this._findCommonVertex(edges[0].a, edges[0].b, edges[1].a, edges[1].b);
          if (vertex) {
            const dir1 = this._getEdgeDirectionFromVertex(edges[0].a, edges[0].b, vertex);
            const dir2 = this._getEdgeDirectionFromVertex(edges[1].a, edges[1].b, vertex);
            const angle = this._angleBetween(dir1, dir2);
            const deg = (angle * 180 / Math.PI);
            const displayAngle = deg > 180 ? 360 - deg : deg;
            const a1 = Math.atan2(dir1.y, dir1.x);
            const a2 = a1 + angle;
            const r = 50 / viewportScale;

            ctx.save();
            ctx.strokeStyle = '#9c27b0';
            ctx.fillStyle = '#9c27b0';
            ctx.lineWidth = 3 / viewportScale;

            for (const edge of edges) {
              ctx.beginPath();
              ctx.moveTo(edge.a.x, edge.a.y);
              ctx.lineTo(edge.b.x, edge.b.y);
              ctx.stroke();
            }

            ctx.lineWidth = 2 / viewportScale;
            ctx.beginPath();
            const ccw = angle > Math.PI;
            ctx.arc(vertex.x, vertex.y, r, a1, a2, ccw);
            ctx.stroke();

            let midAngle = (a1 + a2) / 2;
            if (Math.abs(a2 - a1) > Math.PI) midAngle += Math.PI;
            const labelPos = {
              x: vertex.x + Math.cos(midAngle) * r * 1.5,
              y: vertex.y + Math.sin(midAngle) * r * 1.5
            };
            const text = Number(displayAngle.toFixed(s.precision)) + '°';
            const textSize = s.textSize / viewportScale;
            ctx.font = `700 ${textSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const metrics = ctx.measureText(text);
            const pad = 4 / viewportScale;
            const bgW = metrics.width + pad * 2;
            const bgH = textSize + pad;
            ctx.fillStyle = 'rgba(156,39,176,0.95)';
            ctx.fillRect(labelPos.x - bgW / 2, labelPos.y - bgH / 2, bgW, bgH);
            ctx.fillStyle = '#fff';
            ctx.fillText(text, labelPos.x, labelPos.y);
            ctx.restore();
          }
        }
      }
    }

    exportToSVG(svgContent, getPointsFn, getHolesFn, pad, minX, minY) {
      let result = '';
      const defsAdded = new Set();

      result += `  <defs>\n`;
      result += `    <marker id="dim-arrow-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
      result += `      <path d="M 0 0 L 10 5 L 0 10 z" fill="${this.settings.lineColor}" />\n`;
      result += `    </marker>\n`;
      result += `    <marker id="dim-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto">\n`;
      result += `      <path d="M 10 0 L 0 5 L 10 10 z" fill="${this.settings.lineColor}" />\n`;
      result += `    </marker>\n`;
      result += `  </defs>\n`;

      for (const dim of this.dimensions) {
        if (!dim.visible) continue;
        switch (dim.type) {
          case DIMENSION_TYPES.DISTANCE_TWO_POINTS:
          case DIMENSION_TYPES.DISTANCE_EDGE:
            result += this._exportDistanceToSVG(dim);
            break;
          case DIMENSION_TYPES.ANGLE_TWO_EDGES:
            result += this._exportAngleToSVG(dim);
            break;
          case DIMENSION_TYPES.RADIUS_ARC:
            result += this._exportRadiusToSVG(dim);
            break;
        }
      }
      return result;
    }

    _exportDistanceToSVG(dim) {
      const s = this.settings;
      const a = dim.pointA, b = dim.pointB;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < DIMENSION_EPS) return '';

      const dx = b.x - a.x, dy = b.y - a.y;
      const ux = dx / len, uy = dy / len;
      const perpX = -uy, perpY = ux;
      const off = dim.offset || s.offset;

      const a2 = { x: a.x + perpX * off, y: a.y + perpY * off };
      const b2 = { x: b.x + perpX * off, y: b.y + perpY * off };
      const tp = dim.textPosition || this._calculateDistanceTextPosition(dim);
      const text = this.formatValue(len);

      let svg = '';
      svg += `  <g id="dimension-${dim.id}" class="dimension distance">\n`;
      svg += `    <line x1="${a.x}" y1="${a.y}" x2="${a2.x}" y2="${a2.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" />\n`;
      svg += `    <line x1="${b.x}" y1="${b.y}" x2="${b2.x}" y2="${b2.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" />\n`;
      svg += `    <line x1="${a2.x}" y1="${a2.y}" x2="${b2.x}" y2="${b2.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" marker-start="url(#dim-arrow-start)" marker-end="url(#dim-arrow-end)" />\n`;
      svg += `    <g transform="translate(${tp.x}, ${tp.y})">\n`;
      svg += `      <rect x="-${s.textSize * 1.5}" y="-${s.textSize * 0.7}" width="${s.textSize * 3}" height="${s.textSize * 1.4}" rx="2" fill="white" fill-opacity="0.9" stroke="${s.lineColor}" stroke-width="0.5"/>\n`;
      svg += `      <text x="0" y="${s.textSize * 0.35}" text-anchor="middle" font-family="sans-serif" font-size="${s.textSize}" font-weight="600" fill="${s.textColor}">${text}</text>\n`;
      svg += `    </g>\n`;
      svg += `  </g>\n`;
      return svg;
    }

    _exportAngleToSVG(dim) {
      const s = this.settings;
      const v = dim.vertex;
      const r = (dim.radius || s.offset) * 0.7;
      const a1 = Math.atan2(dim.direction1.y, dim.direction1.x);
      const a2 = a1 + dim.angle;
      const ccw = dim.angle > Math.PI;

      const p1 = { x: v.x + Math.cos(a1) * r, y: v.y + Math.sin(a1) * r };
      const p2 = { x: v.x + Math.cos(a2) * r, y: v.y + Math.sin(a2) * r };
      const extR = r * 1.4;
      const ext1 = { x: v.x + Math.cos(a1) * extR, y: v.y + Math.sin(a1) * extR };
      const ext2 = { x: v.x + Math.cos(a2) * extR, y: v.y + Math.sin(a2) * extR };

      const largeArc = Math.abs(dim.angle) > Math.PI ? 1 : 0;
      const sweep = ccw ? 0 : 1;
      const arcPath = `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p2.x} ${p2.y}`;

      const deg = (dim.angle * 180 / Math.PI);
      const displayAngle = deg > 180 ? 360 - deg : deg;
      const text = Number(displayAngle.toFixed(s.precision)) + '°';
      const tp = dim.textPosition || this._calculateAngleTextPosition(dim);

      let svg = '';
      svg += `  <g id="dimension-${dim.id}" class="dimension angle">\n`;
      svg += `    <line x1="${v.x}" y1="${v.y}" x2="${ext1.x}" y2="${ext1.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" />\n`;
      svg += `    <line x1="${v.x}" y1="${v.y}" x2="${ext2.x}" y2="${ext2.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" />\n`;
      svg += `    <path d="${arcPath}" fill="none" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" marker-start="url(#dim-arrow-start)" marker-end="url(#dim-arrow-end)" />\n`;
      svg += `    <g transform="translate(${tp.x}, ${tp.y})">\n`;
      svg += `      <rect x="-${s.textSize * 1.5}" y="-${s.textSize * 0.7}" width="${s.textSize * 3}" height="${s.textSize * 1.4}" rx="2" fill="white" fill-opacity="0.9" stroke="${s.lineColor}" stroke-width="0.5"/>\n`;
      svg += `      <text x="0" y="${s.textSize * 0.35}" text-anchor="middle" font-family="sans-serif" font-size="${s.textSize}" font-weight="600" fill="${s.textColor}">${text}</text>\n`;
      svg += `    </g>\n`;
      svg += `  </g>\n`;
      return svg;
    }

    _exportRadiusToSVG(dim) {
      const s = this.settings;
      const tp = dim.textPosition || { x: dim.center.x + dim.radius + s.offset, y: dim.center.y };
      const text = 'R' + this.formatValue(dim.radius);

      let svg = '';
      svg += `  <g id="dimension-${dim.id}" class="dimension radius">\n`;
      svg += `    <circle cx="${dim.center.x}" cy="${dim.center.y}" r="3" fill="${s.lineColor}" />\n`;
      svg += `    <line x1="${dim.center.x}" y1="${dim.center.y}" x2="${tp.x}" y2="${tp.y}" stroke="${s.lineColor}" stroke-width="${s.lineWidth}" marker-end="url(#dim-arrow-end)" />\n`;
      svg += `    <g transform="translate(${tp.x + 4}, ${tp.y})">\n`;
      svg += `      <rect x="-2" y="-${s.textSize * 0.7}" width="${s.textSize * 3.5}" height="${s.textSize * 1.4}" rx="2" fill="white" fill-opacity="0.9" stroke="${s.lineColor}" stroke-width="0.5"/>\n`;
      svg += `      <text x="2" y="${s.textSize * 0.35}" text-anchor="start" font-family="sans-serif" font-size="${s.textSize}" font-weight="600" fill="${s.textColor}">${text}</text>\n`;
      svg += `    </g>\n`;
      svg += `  </g>\n`;
      return svg;
    }
  }

  window.DimensionSystem = DimensionSystem;
  window.DIMENSION_TYPES = DIMENSION_TYPES;
  window.UNIT_TYPES = UNIT_TYPES;
})();
