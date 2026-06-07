const EPS = 1e-6;
const PRECISION = 1e6;

function roundPoint(p) {
  return {
    x: Math.round(p.x * PRECISION) / PRECISION,
    y: Math.round(p.y * PRECISION) / PRECISION
  };
}

function pointEq(a, b) {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y; }
function cross(a, b) { return a.x * b.y - a.y * b.x; }
function len(a) { return Math.hypot(a.x, a.y); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function segIntersect(p1, p2, p3, p4) {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const denom = cross(d1, d2);

  if (Math.abs(denom) < EPS) {
    return [];
  }

  const diff = sub(p3, p1);
  const t = cross(diff, d2) / denom;
  const u = cross(diff, d1) / denom;

  if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
    return [{
      x: p1.x + t * d1.x,
      y: p1.y + t * d1.y,
      t, u
    }];
  }
  return [];
}

function polygonArea(points) {
  let a = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    a += cross(p1, p2);
  }
  return a / 2;
}

function isCounterClockwise(points) {
  return polygonArea(points) > 0;
}

function reversePolygon(points) {
  return points.slice().reverse();
}

function ensureCCW(points) {
  return isCounterClockwise(points) ? points.slice() : reversePolygon(points);
}

function ensureCW(points) {
  return !isCounterClockwise(points) ? points.slice() : reversePolygon(points);
}

function pointInPolygon(pt, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;

    if ((yi > pt.y) !== (yj > pt.y) &&
        pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment(pt, a, b, tol = EPS) {
  if (Math.abs(cross(sub(b, a), sub(pt, a))) > tol) return false;
  const d = dot(sub(pt, a), sub(b, a));
  const len2 = dot(sub(b, a), sub(b, a));
  if (d < -tol || d > len2 + tol) return false;
  return true;
}

function pointOnPolygonEdge(pt, poly, tol = EPS) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (pointOnSegment(pt, a, b, tol)) return true;
  }
  return false;
}

function pointInPolygonOrOnEdge(pt, poly) {
  return pointInPolygon(pt, poly) || pointOnPolygonEdge(pt, poly);
}

function pointToSegmentDist(p, a, b) {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / Math.max(EPS, dot(ab, ab))));
  const proj = add(a, mul(ab, t));
  return dist(p, proj);
}

function centroid(points) {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  return { x: cx / points.length, y: cy / points.length };
}

function circleToPolygon(cx, cy, r, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function rectToPolygon(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ];
}

function applyTransform(points, tx, ty, rotation, sx, sy) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  return points.map(p => {
    const x1 = p.x * sx;
    const y1 = p.y * sy;
    const x2 = x1 * cos - y1 * sin;
    const y2 = x1 * sin + y1 * cos;
    return { x: x2 + tx, y: y2 + ty };
  });
}

function randomFillColor() {
  const h = Math.floor(Math.random() * 360);
  return `hsla(${h}, 60%, 70%, 0.4)`;
}

function closePolygon(points) {
  if (points.length < 3) return points;
  const p = points.slice();
  if (pointEq(p[0], p[p.length - 1])) p.pop();
  return p;
}

function dedupePoints(points, eps = EPS) {
  if (points.length < 2) return points.slice();
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (!pointEq(points[i], result[result.length - 1])) {
      result.push(points[i]);
    }
  }
  if (result.length > 1 && pointEq(result[0], result[result.length - 1])) {
    result.pop();
  }
  return result;
}

function simplifyPolygon(points, tol = 0.05) {
  let pts = closePolygon(dedupePoints(points));
  if (pts.length <= 3) return pts;

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 5) {
    changed = false;
    iterations++;
    const result = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const d = pointToSegmentDist(cur, prev, next);
      if (d > tol) {
        result.push(cur);
      } else {
        changed = true;
      }
    }
    if (result.length >= 3) pts = result;
    else break;
  }
  return pts;
}

function buildPolyList(points, polyName) {
  const list = [];
  for (let i = 0; i < points.length; i++) {
    list.push({
      point: roundPoint({ ...points[i] }),
      poly: polyName,
      index: i,
      isIntersection: false,
      isEntering: null,
      processed: false,
      prev: null,
      next: null,
      mate: null,
      alpha: 0
    });
  }
  for (let i = 0; i < list.length; i++) {
    list[i].prev = list[(i - 1 + list.length) % list.length];
    list[i].next = list[(i + 1) % list.length];
  }
  return list;
}

function insertIntersection(listHead, segStartNode, point, t) {
  const newNode = {
    point: roundPoint({ ...point }),
    poly: listHead.poly,
    index: -1,
    isIntersection: true,
    isEntering: null,
    processed: false,
    prev: null,
    next: null,
    mate: null,
    alpha: t
  };

  let cur = segStartNode;
  const segEnd = segStartNode.next;

  while (cur.next !== segEnd && cur.next.isIntersection && cur.next.alpha < newNode.alpha) {
    cur = cur.next;
  }

  newNode.prev = cur;
  newNode.next = cur.next;
  cur.next.prev = newNode;
  cur.next = newNode;

  return newNode;
}

function traverseList(head, callback) {
  if (!head) return;
  let cur = head;
  let count = 0;
  do {
    callback(cur);
    cur = cur.next;
    count++;
    if (count > 100000) break;
  } while (cur !== head);
}

function listToArray(head) {
  const arr = [];
  traverseList(head, (n) => arr.push(n));
  return arr;
}

function weilerAtherton(subjectRaw, clipRaw, operation) {
  let subjectPts = ensureCCW(closePolygon(simplifyPolygon(subjectRaw)));
  let clipPts = ensureCCW(closePolygon(simplifyPolygon(clipRaw)));

  if (subjectPts.length < 3 || clipPts.length < 3) {
    return { polygons: [], holes: [] };
  }

  const subjInClip = pointInPolygonOrOnEdge(subjectPts[0], clipPts);
  const clipInSubj = pointInPolygonOrOnEdge(clipPts[0], subjectPts);

  const sb = polygonBounds(subjectPts);
  const cb = polygonBounds(clipPts);
  const disjoint = sb.maxX < cb.minX || sb.minX > cb.maxX || sb.maxY < cb.minY || sb.minY > cb.maxY;

  if (disjoint) {
    if (operation === 'union') {
      return { polygons: [subjectPts, clipPts], holes: [] };
    } else if (operation === 'intersect') {
      return { polygons: [], holes: [] };
    } else {
      return { polygons: [subjectPts], holes: [] };
    }
  }

  if (subjInClip && !intersectsEdge(subjectPts, clipPts)) {
    if (operation === 'union') {
      return { polygons: [clipPts], holes: [] };
    } else if (operation === 'intersect') {
      return { polygons: [subjectPts], holes: [] };
    } else {
      return { polygons: [], holes: [] };
    }
  }

  if (clipInSubj && !intersectsEdge(clipPts, subjectPts)) {
    if (operation === 'union') {
      return { polygons: [subjectPts], holes: [] };
    } else if (operation === 'intersect') {
      return { polygons: [clipPts], holes: [] };
    } else {
      return { polygons: [subjectPts], holes: [ensureCW(clipPts)] };
    }
  }

  const sHead = buildPolyList(subjectPts, 'subject')[0];
  const cHead = buildPolyList(clipPts, 'clip')[0];

  const sArr = listToArray(sHead);
  const allIntersections = [];

  for (const sNode of sArr) {
    if (sNode.isIntersection) continue;
    const sNext = sNode.next;

    const cArr = listToArray(cHead);
    for (const cNode of cArr) {
      if (cNode.isIntersection) continue;
      const cNext = cNode.next;

      const ints = segIntersect(sNode.point, sNext.point, cNode.point, cNext.point);
      for (const hit of ints) {
        const sInt = insertIntersection(sHead, sNode, hit, hit.t);
        const cInt = insertIntersection(cHead, cNode, hit, hit.u);
        sInt.mate = cInt;
        cInt.mate = sInt;
        allIntersections.push(sInt);
      }
    }
  }

  if (allIntersections.length === 0) {
    if (operation === 'union') {
      return { polygons: [subjectPts, clipPts], holes: [] };
    } else if (operation === 'intersect') {
      return { polygons: [], holes: [] };
    } else {
      return { polygons: [subjectPts], holes: [] };
    }
  }

  const fullSArr = listToArray(sHead);
  for (const node of fullSArr) {
    if (!node.isIntersection) continue;
    const midPoint = {
      x: (node.point.x + node.next.point.x) / 2,
      y: (node.point.y + node.next.point.y) / 2
    };
    const wasInside = pointInPolygonOrOnEdge(node.prev.point, clipPts);
    node.isEntering = !wasInside;
    node.mate.isEntering = wasInside;
  }

  const resultPolys = [];
  const resultHoles = [];

  for (const start of allIntersections) {
    if (start.processed) continue;

    let useStart = null;
    if (operation === 'union') {
      if (!start.isEntering) useStart = start;
    } else if (operation === 'intersect') {
      if (start.isEntering) useStart = start;
    } else if (operation === 'subtract') {
      if (!start.isEntering) useStart = start;
    }

    if (!useStart) continue;

    const polyPoints = [];
    let cur = useStart;
    let currentList = useStart.poly;
    let safety = 0;

    while (safety++ < 5000) {
      polyPoints.push({ ...cur.point });
      cur.processed = true;
      if (cur.mate) cur.mate.processed = true;

      if (cur.isIntersection) {
        cur = cur.mate;
        currentList = cur.poly;
      }

      let found = false;
      let innerSafety = 0;
      cur = cur.next;

      while (innerSafety++ < 5000) {
        if (cur === useStart || cur === useStart.mate) {
          polyPoints.push({ ...cur.point });
          cur.processed = true;
          if (cur.mate) cur.mate.processed = true;
          found = true;
          break;
        }

        if (cur.isIntersection && !cur.processed) {
          let correct = false;
          if (operation === 'union' && !cur.isEntering) correct = true;
          if (operation === 'intersect' && cur.isEntering) correct = true;
          if (operation === 'subtract' && !cur.isEntering) correct = true;
          if (correct) {
            found = true;
            break;
          }
        }

        polyPoints.push({ ...cur.point });
        cur.processed = true;
        if (cur.mate) cur.mate.processed = true;

        cur = cur.next;
      }

      if (!found) {
        break;
      }

      if (cur === useStart || cur === useStart.mate) break;
    }

    if (polyPoints.length >= 3) {
      let final = closePolygon(dedupePoints(polyPoints));
      final = simplifyPolygon(final, 0.1);
      if (final.length >= 3) {
        const area = Math.abs(polygonArea(final));
        if (area > 0.5) {
          if (operation === 'subtract') {
            if (isCounterClockwise(final)) {
              resultPolys.push(ensureCCW(final));
            } else {
              resultHoles.push(ensureCW(final));
            }
          } else {
            resultPolys.push(ensureCCW(final));
          }
        }
      }
    }
  }

  if (resultPolys.length === 0) {
    if (operation === 'union') {
      if (subjInClip) resultPolys.push(clipPts);
      else if (clipInSubj) resultPolys.push(subjectPts);
      else { resultPolys.push(subjectPts); resultPolys.push(clipPts); }
    } else if (operation === 'intersect') {
      if (subjInClip) resultPolys.push(subjectPts);
      else if (clipInSubj) resultPolys.push(clipPts);
    } else if (operation === 'subtract') {
      if (subjInClip) {
      } else if (clipInSubj) {
        resultPolys.push(subjectPts);
        resultHoles.push(ensureCW(clipPts));
      } else {
        resultPolys.push(subjectPts);
      }
    }
  }

  return { polygons: resultPolys, holes: resultHoles };
}

function polygonBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function intersectsEdge(polyA, polyB) {
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i], a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j], b2 = polyB[(j + 1) % polyB.length];
      if (segIntersect(a1, a2, b1, b2).length > 0) return true;
    }
  }
  return false;
}
