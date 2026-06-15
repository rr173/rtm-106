(function(global) {
  'use strict';

  const EPS = 1e-6;

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function computePathLengths(points) {
    const segLens = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const d = dist(points[i], points[i + 1]);
      segLens.push(d);
      total += d;
    }
    return { segLens, totalLength: total };
  }

  function sampleAlongPath(points, t, lengthData) {
    if (points.length < 2) {
      return {
        point: points[0] ? { ...points[0] } : { x: 0, y: 0 },
        tangent: { x: 1, y: 0 },
        angle: 0,
        segmentIndex: 0,
        localT: 0
      };
    }

    const { segLens, totalLength } = lengthData || computePathLengths(points);
    if (totalLength < EPS) {
      return {
        point: { ...points[0] },
        tangent: { x: 1, y: 0 },
        angle: 0,
        segmentIndex: 0,
        localT: 0
      };
    }

    t = Math.max(0, Math.min(1, t));
    let targetDist = t * totalLength;

    for (let i = 0; i < segLens.length; i++) {
      if (targetDist <= segLens[i] || i === segLens.length - 1) {
        const localT = segLens[i] < EPS ? 0 : targetDist / segLens[i];
        const a = points[i];
        const b = points[i + 1];
        const x = a.x + (b.x - a.x) * localT;
        const y = a.y + (b.y - a.y) * localT;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        const tx = len < EPS ? 1 : dx / len;
        const ty = len < EPS ? 0 : dy / len;
        const angle = Math.atan2(ty, tx);
        return {
          point: { x, y },
          tangent: { x: tx, y: ty },
          angle,
          segmentIndex: i,
          localT
        };
      }
      targetDist -= segLens[i];
    }

    const last = points[points.length - 1];
    return {
      point: { ...last },
      tangent: { x: 1, y: 0 },
      angle: 0,
      segmentIndex: segLens.length - 1,
      localT: 1
    };
  }

  class SpeedKeyframe {
    constructor(pathT, speedFactor) {
      this.pathT = pathT;
      this.speedFactor = speedFactor;
    }
  }

  function buildSpeedLookup(speedKeyframes, totalFrames) {
    const kfs = [...(speedKeyframes || [])];
    if (kfs.length === 0) {
      kfs.push(new SpeedKeyframe(0, 1));
      kfs.push(new SpeedKeyframe(1, 1));
    }
    kfs.sort((a, b) => a.pathT - b.pathT);
    if (kfs[0].pathT > 0) kfs.unshift(new SpeedKeyframe(0, kfs[0].speedFactor));
    if (kfs[kfs.length - 1].pathT < 1) kfs.push(new SpeedKeyframe(1, kfs[kfs.length - 1].speedFactor));

    return kfs;
  }

  function interpolateSpeed(speedKfs, pathT) {
    const kfs = buildSpeedLookup(speedKfs);
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (pathT >= a.pathT && pathT <= b.pathT) {
        const span = b.pathT - a.pathT;
        const t = span < EPS ? 0 : (pathT - a.pathT) / span;
        return a.speedFactor + (b.speedFactor - a.speedFactor) * t;
      }
    }
    return 1;
  }

  function computePathTWithSpeed(animProgress, speedKfs, loopMode) {
    const kfs = buildSpeedLookup(speedKfs);
    const totalIntegral = computeSpeedIntegral(kfs, 0, 1);
    if (totalIntegral < EPS) return animProgress;

    let target = animProgress * totalIntegral;
    let lo = 0, hi = 1;
    for (let iter = 0; iter < 50; iter++) {
      const mid = (lo + hi) / 2;
      const val = computeSpeedIntegral(kfs, 0, mid);
      if (val < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function computeSpeedIntegral(kfs, t0, t1) {
    let sum = 0;
    const samples = 50;
    for (let i = 0; i < samples; i++) {
      const a = t0 + (t1 - t0) * (i / samples);
      const b = t0 + (t1 - t0) * ((i + 1) / samples);
      const sa = interpolateSpeedFromKfs(kfs, a);
      const sb = interpolateSpeedFromKfs(kfs, b);
      sum += (sa + sb) * 0.5 * ((t1 - t0) / samples);
    }
    return sum;
  }

  function interpolateSpeedFromKfs(kfs, pathT) {
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (pathT >= a.pathT && pathT <= b.pathT) {
        const span = b.pathT - a.pathT;
        const t = span < EPS ? 0 : (pathT - a.pathT) / span;
        return a.speedFactor + (b.speedFactor - a.speedFactor) * t;
      }
    }
    return 1;
  }

  const LOOP_ONCE = 'once';
  const LOOP_LOOP = 'loop';
  const LOOP_PINGPONG = 'pingpong';

  function resolveLoopProgress(animProgress, loopMode) {
    animProgress = Math.max(0, animProgress);
    switch (loopMode) {
      case LOOP_ONCE:
        return Math.min(1, animProgress);
      case LOOP_LOOP:
        return animProgress - Math.floor(animProgress);
      case LOOP_PINGPONG: {
        const cycle = Math.floor(animProgress);
        const frac = animProgress - cycle;
        return cycle % 2 === 0 ? frac : 1 - frac;
      }
      default:
        return Math.min(1, animProgress);
    }
  }

  class MotionPathManager {
    constructor() {
      this.bindings = {};
      this._pathLengthCache = new Map();
    }

    _getPathLengthCache(pathId, points) {
      const key = pathId + '_' + points.length;
      let cached = this._pathLengthCache.get(key);
      if (!cached) {
        cached = computePathLengths(points);
        this._pathLengthCache.set(key, cached);
      }
      return cached;
    }

    invalidatePathCache(pathId) {
      const keys = [];
      for (const k of this._pathLengthCache.keys()) {
        if (k.startsWith(pathId + '_')) keys.push(k);
      }
      for (const k of keys) this._pathLengthCache.delete(k);
    }

    addBinding(binding) {
      this.bindings[binding.shapeId] = binding;
    }

    setBinding(shapeId, bindingData) {
      const defaults = {
        shapeId: shapeId,
        pathShapeId: null,
        startOffset: 0,
        autoOrient: false,
        loopMode: LOOP_LOOP,
        speedKeyframes: null,
        duration: 1,
        offsetX: 0,
        offsetY: 0
      };
      this.bindings[shapeId] = { ...defaults, ...bindingData, shapeId: shapeId };
    }

    removeBinding(shapeId) {
      delete this.bindings[shapeId];
    }

    removeShapeBindings(shapeId) {
      delete this.bindings[shapeId];
      for (const sid in this.bindings) {
        if (this.bindings[sid].pathShapeId === shapeId) {
          delete this.bindings[sid];
        }
      }
    }

    cleanupBindings(existingShapeIds) {
      const ids = new Set(existingShapeIds);
      for (const sid in this.bindings) {
        const b = this.bindings[sid];
        const nid = parseInt(sid, 10);
        if (!ids.has(nid) || !ids.has(b.pathShapeId)) {
          delete this.bindings[sid];
        }
      }
    }

    getBinding(shapeId) {
      return this.bindings[shapeId] || null;
    }

    getBindingsForPath(pathShapeId) {
      return Object.values(this.bindings).filter(b => b.pathShapeId === pathShapeId);
    }

    hasBindings(pathShapeId) {
      return this.getBindingsForPath(pathShapeId).length > 0;
    }

    computeBindingState(binding, pathPoints, frame, totalFrames, baseTx, baseTy, baseRotation) {
      const total = Math.max(1, totalFrames);
      const durationScale = (binding.duration || 1);
      let animProgress = (frame / total) / durationScale + (binding.startOffset || 0);
      const progress = resolveLoopProgress(animProgress, binding.loopMode || LOOP_ONCE);
      const pathT = computePathTWithSpeed(progress, binding.speedKeyframes, binding.loopMode);

      const lengthData = this._getPathLengthCache(binding.pathShapeId, pathPoints);
      const sample = sampleAlongPath(pathPoints, pathT, lengthData);

      const offsetX = binding.offsetX || 0;
      const offsetY = binding.offsetY || 0;
      const autoRot = binding.autoOrient || binding.autoRotate || false;
      const rotAdd = autoRot ? sample.angle : 0;

      return {
        tx: sample.point.x + offsetX + (baseTx || 0),
        ty: sample.point.y + offsetY + (baseTy || 0),
        rotation: rotAdd + (baseRotation || 0),
        pathProgress: pathT,
        point: sample.point,
        currentPosition: sample.point,
        tangent: sample.tangent,
        tangentAngle: sample.angle,
        autoRotated: autoRot
      };
    }

    serialize() {
      return {
        bindings: JSON.parse(JSON.stringify(this.bindings))
      };
    }

    deserialize(data) {
      this.bindings = {};
      if (data && data.bindings) {
        for (const sid in data.bindings) {
          const b = data.bindings[sid];
          if (b && b.speedKeyframes) {
            b.speedKeyframes = b.speedKeyframes.map(k => new SpeedKeyframe(k.pathT, k.speedFactor));
          }
          this.bindings[sid] = b;
        }
      }
    }

    getAllShapeIdsWithBinding() {
      return Object.keys(this.bindings).map(k => parseInt(k, 10)).filter(n => !isNaN(n));
    }
  }

  function isMotionPathShape(shape) {
    return shape && shape.type === 'motion-path';
  }

  function createMotionPath(points) {
    return {
      type: 'motion-path',
      motionPathData: {
        speedKeyframes: [
          { pathT: 0, speedFactor: 1 },
          { pathT: 1, speedFactor: 1 }
        ],
        closed: false
      }
    };
  }

  global.PathMotion = {
    MotionPathManager,
    SpeedKeyframe,
    sampleAlongPath,
    computePathLengths,
    interpolateSpeed,
    computePathTWithSpeed,
    resolveLoopProgress,
    isMotionPathShape,
    createMotionPath,
    LOOP_ONCE,
    LOOP_LOOP,
    LOOP_PINGPONG
  };

})(window);
