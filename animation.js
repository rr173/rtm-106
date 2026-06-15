(function(global) {
  'use strict';

  const DEFAULT_FPS = 30;
  const DEFAULT_DURATION = 5;
  const ANIMATABLE_PROPS = ['tx', 'ty', 'rotation', 'scaleX', 'scaleY', 'opacity', 'fill'];

  const EASING_LINEAR = 'linear';
  const EASING_EASE_IN_OUT = 'ease-in-out';

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  function interpolateColor(color1, color2, t, easing) {
    const rgb1 = hexToRgb(color1);
    const rgb2 = hexToRgb(color2);
    if (!rgb1 || !rgb2) return color1;

    const hsl1 = rgbToHsl(rgb1.r, rgb1.g, rgb1.b);
    const hsl2 = rgbToHsl(rgb2.r, rgb2.g, rgb2.b);

    let dh = hsl2.h - hsl1.h;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;

    const et = easing === EASING_EASE_IN_OUT ? easeInOut(t) : t;
    const h = hsl1.h + dh * et;
    const s = hsl1.s + (hsl2.s - hsl1.s) * et;
    const l = hsl1.l + (hsl2.l - hsl1.l) * et;

    const rgb = hslToRgb(h, s, l);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function interpolateNumber(v1, v2, t, easing) {
    const et = easing === EASING_EASE_IN_OUT ? easeInOut(t) : t;
    return v1 + (v2 - v1) * et;
  }

  class Keyframe {
    constructor(frame, value, easing) {
      this.frame = frame;
      this.value = value;
      this.easing = easing || EASING_LINEAR;
    }
  }

  class PropertyTrack {
    constructor(propName) {
      this.propName = propName;
      this.keyframes = [];
    }

    addKeyframe(frame, value, easing) {
      const kf = new Keyframe(frame, value, easing);
      const idx = this.keyframes.findIndex(k => k.frame === frame);
      if (idx >= 0) {
        this.keyframes[idx] = kf;
      } else {
        this.keyframes.push(kf);
        this.keyframes.sort((a, b) => a.frame - b.frame);
      }
      return kf;
    }

    removeKeyframe(frame) {
      const idx = this.keyframes.findIndex(k => k.frame === frame);
      if (idx >= 0) {
        this.keyframes.splice(idx, 1);
        return true;
      }
      return false;
    }

    getKeyframeAt(frame) {
      return this.keyframes.find(k => k.frame === frame) || null;
    }

    getValueAt(frame, defaultValue) {
      if (this.keyframes.length === 0) return defaultValue;
      if (this.keyframes.length === 1) return this.keyframes[0].value;

      const first = this.keyframes[0];
      const last = this.keyframes[this.keyframes.length - 1];

      if (frame <= first.frame) return first.value;
      if (frame >= last.frame) return last.value;

      for (let i = 0; i < this.keyframes.length - 1; i++) {
        const kf1 = this.keyframes[i];
        const kf2 = this.keyframes[i + 1];
        if (frame >= kf1.frame && frame <= kf2.frame) {
          const t = (frame - kf1.frame) / (kf2.frame - kf1.frame);
          if (this.propName === 'fill') {
            return interpolateColor(kf1.value, kf2.value, t, kf1.easing);
          } else {
            return interpolateNumber(kf1.value, kf2.value, t, kf1.easing);
          }
        }
      }
      return defaultValue;
    }

    hasKeyframes() {
      return this.keyframes.length > 0;
    }
  }

  class ShapeAnimation {
    constructor(shapeId) {
      this.shapeId = shapeId;
      this.tracks = {};
    }

    getTrack(propName, createIfMissing) {
      if (!this.tracks[propName] && createIfMissing) {
        this.tracks[propName] = new PropertyTrack(propName);
      }
      return this.tracks[propName] || null;
    }

    addKeyframe(propName, frame, value, easing) {
      const track = this.getTrack(propName, true);
      return track.addKeyframe(frame, value, easing);
    }

    removeKeyframe(propName, frame) {
      const track = this.getTrack(propName, false);
      if (track) {
        const result = track.removeKeyframe(frame);
        if (!track.hasKeyframes()) {
          delete this.tracks[propName];
        }
        return result;
      }
      return false;
    }

    getValueAt(propName, frame, defaultValue) {
      const track = this.getTrack(propName, false);
      return track ? track.getValueAt(frame, defaultValue) : defaultValue;
    }

    hasKeyframes() {
      for (const p in this.tracks) {
        if (this.tracks[p].hasKeyframes()) return true;
      }
      return false;
    }

    hasPropertyKeyframes(propName) {
      const track = this.getTrack(propName, false);
      return track ? track.hasKeyframes() : false;
    }

    getAnimatedProperties() {
      return Object.keys(this.tracks).filter(p => this.tracks[p].hasKeyframes());
    }
  }

  class AnimationController {
    constructor() {
      this.fps = DEFAULT_FPS;
      this.duration = DEFAULT_DURATION;
      this.currentFrame = 0;
      this.isPlaying = false;
      this.loop = true;
      this.speed = 1;
      this.shapeAnimations = {};
      this._lastTime = 0;
      this._playbackFrameAccum = 0;
      this._onFrameChange = null;
      this._onPlayStateChange = null;
    }

    get totalFrames() {
      return Math.floor(this.fps * this.duration);
    }

    get currentTime() {
      return this.currentFrame / this.fps;
    }

    setDuration(seconds) {
      this.duration = Math.max(1, seconds);
      if (this.currentFrame >= this.totalFrames) {
        this.currentFrame = this.totalFrames - 1;
      }
    }

    setFPS(fps) {
      this.fps = Math.max(1, Math.min(120, fps));
      if (this.currentFrame >= this.totalFrames) {
        this.currentFrame = this.totalFrames - 1;
      }
    }

    setCurrentFrame(frame) {
      const maxFrame = this.totalFrames - 1;
      this.currentFrame = Math.max(0, Math.min(maxFrame, Math.floor(frame)));
      if (this._onFrameChange) {
        this._onFrameChange(this.currentFrame);
      }
    }

    setCurrentTime(seconds) {
      this.setCurrentFrame(Math.floor(seconds * this.fps));
    }

    getShapeAnimation(shapeId, createIfMissing) {
      if (!this.shapeAnimations[shapeId] && createIfMissing) {
        this.shapeAnimations[shapeId] = new ShapeAnimation(shapeId);
      }
      return this.shapeAnimations[shapeId] || null;
    }

    removeShapeAnimation(shapeId) {
      if (this.shapeAnimations[shapeId]) {
        delete this.shapeAnimations[shapeId];
        return true;
      }
      return false;
    }

    shapeHasKeyframes(shapeId) {
      const anim = this.getShapeAnimation(shapeId, false);
      return anim ? anim.hasKeyframes() : false;
    }

    addKeyframe(shapeId, propName, frame, value, easing) {
      const anim = this.getShapeAnimation(shapeId, true);
      return anim.addKeyframe(propName, frame, value, easing);
    }

    removeKeyframe(shapeId, propName, frame) {
      const anim = this.getShapeAnimation(shapeId, false);
      if (anim) {
        const result = anim.removeKeyframe(propName, frame);
        if (!anim.hasKeyframes()) {
          delete this.shapeAnimations[shapeId];
        }
        return result;
      }
      return false;
    }

    hasAnimation(shapeId) {
      const anim = this.getShapeAnimation(shapeId, false);
      return anim ? anim.hasKeyframes() : false;
    }

    getAnimatedShapes() {
      return Object.keys(this.shapeAnimations).filter(id => {
        const anim = this.shapeAnimations[id];
        return anim && anim.hasKeyframes();
      });
    }

    getShapePropertiesAtFrame(shapeId, frame, baseProps) {
      const result = { ...baseProps };
      const anim = this.getShapeAnimation(shapeId, false);
      if (!anim || !anim.hasKeyframes()) return result;

      for (const prop of ANIMATABLE_PROPS) {
        if (anim.hasPropertyKeyframes(prop) && baseProps.hasOwnProperty(prop)) {
          result[prop] = anim.getValueAt(prop, frame, baseProps[prop]);
        }
      }
      return result;
    }

    play() {
      if (this.isPlaying) return;
      this.isPlaying = true;
      this._lastTime = performance.now();
      this._playbackFrameAccum = 0;
      if (this._onPlayStateChange) {
        this._onPlayStateChange(true);
      }
      this._tick();
    }

    pause() {
      if (!this.isPlaying) return;
      this.isPlaying = false;
      if (this._onPlayStateChange) {
        this._onPlayStateChange(false);
      }
    }

    toggle() {
      if (this.isPlaying) this.pause();
      else this.play();
    }

    stop() {
      this.pause();
      this.setCurrentFrame(0);
    }

    nextFrame() {
      const next = this.currentFrame + 1;
      if (next >= this.totalFrames) {
        if (this.loop) {
          this.setCurrentFrame(0);
        }
      } else {
        this.setCurrentFrame(next);
      }
    }

    prevFrame() {
      const prev = this.currentFrame - 1;
      if (prev < 0) {
        if (this.loop) {
          this.setCurrentFrame(this.totalFrames - 1);
        }
      } else {
        this.setCurrentFrame(prev);
      }
    }

    goToStart() {
      this.setCurrentFrame(0);
    }

    goToEnd() {
      this.setCurrentFrame(this.totalFrames - 1);
    }

    _tick() {
      if (!this.isPlaying) return;

      const now = performance.now();
      const deltaMs = now - this._lastTime;
      this._lastTime = now;

      const frameTime = 1000 / (this.fps * this.speed);
      this._playbackFrameAccum += deltaMs / frameTime;

      while (this._playbackFrameAccum >= 1) {
        this._playbackFrameAccum -= 1;
        this.nextFrameInternal();
      }

      requestAnimationFrame(() => this._tick());
    }

    nextFrameInternal() {
      const next = this.currentFrame + 1;
      if (next >= this.totalFrames) {
        if (this.loop) {
          this.setCurrentFrame(0);
        } else {
          this.pause();
        }
      } else {
        this.setCurrentFrame(next);
      }
    }

    onFrameChange(callback) {
      this._onFrameChange = callback;
    }

    onPlayStateChange(callback) {
      this._onPlayStateChange = callback;
    }

    serialize() {
      const data = {
        fps: this.fps,
        duration: this.duration,
        loop: this.loop,
        speed: this.speed,
        shapeAnimations: {}
      };
      for (const shapeId in this.shapeAnimations) {
        const anim = this.shapeAnimations[shapeId];
        const tracksData = {};
        for (const prop in anim.tracks) {
          const track = anim.tracks[prop];
          tracksData[prop] = track.keyframes.map(kf => ({
            frame: kf.frame,
            value: kf.value,
            easing: kf.easing
          }));
        }
        data.shapeAnimations[shapeId] = { tracks: tracksData };
      }
      return data;
    }

    deserialize(data) {
      if (!data) return;
      this.fps = data.fps || DEFAULT_FPS;
      this.duration = data.duration || DEFAULT_DURATION;
      this.loop = data.loop !== undefined ? data.loop : true;
      this.speed = data.speed || 1;
      this.currentFrame = 0;
      this.shapeAnimations = {};

      if (data.shapeAnimations) {
        for (const shapeId in data.shapeAnimations) {
          const animData = data.shapeAnimations[shapeId];
          const anim = new ShapeAnimation(parseInt(shapeId, 10));
          if (animData.tracks) {
            for (const prop in animData.tracks) {
              const kfs = animData.tracks[prop];
              for (const kf of kfs) {
                anim.addKeyframe(prop, kf.frame, kf.value, kf.easing);
              }
            }
          }
          this.shapeAnimations[shapeId] = anim;
        }
      }
    }
  }

  class LZWEncoder {
    constructor() {}

    encode(pixels, width, height, colorTableSize) {
      const minCodeSize = Math.max(2, Math.ceil(Math.log2(colorTableSize)));
      const clearCode = 1 << minCodeSize;
      const eoiCode = clearCode + 1;
      let nextCode = eoiCode + 1;
      let codeSize = minCodeSize + 1;

      const dict = new Map();
      const initDict = () => {
        dict.clear();
        for (let i = 0; i < colorTableSize; i++) {
          dict.set(String.fromCharCode(i), i);
        }
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      };
      initDict();

      const outputBytes = [];
      let bitBuffer = 0;
      let bitCount = 0;

      const writeCode = (code) => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
          outputBytes.push(bitBuffer & 0xff);
          bitBuffer >>= 8;
          bitCount -= 8;
        }
      };

      writeCode(clearCode);

      let w = String.fromCharCode(pixels[0]);

      for (let i = 1; i < pixels.length; i++) {
        const c = String.fromCharCode(pixels[i]);
        const wc = w + c;

        if (dict.has(wc)) {
          w = wc;
        } else {
          writeCode(dict.get(w));
          if (nextCode < 4096) {
            dict.set(wc, nextCode++);
            if (nextCode > (1 << codeSize) && codeSize < 12) {
              codeSize++;
            }
          } else {
            writeCode(clearCode);
            initDict();
          }
          w = c;
        }
      }

      if (w) {
        writeCode(dict.get(w));
      }

      writeCode(eoiCode);

      if (bitCount > 0) {
        outputBytes.push(bitBuffer & 0xff);
      }

      const subBlocks = [];
      for (let i = 0; i < outputBytes.length; i += 255) {
        const block = outputBytes.slice(i, i + 255);
        subBlocks.push(block.length, ...block);
      }
      subBlocks.push(0);

      return { minCodeSize, data: new Uint8Array(subBlocks) };
    }
  }

  class GIFFrame {
    constructor(imageData, delayMs) {
      this.imageData = imageData;
      this.delayMs = delayMs;
    }
  }

  class GIFEncoder {
    constructor() {
      this.frames = [];
      this.width = 0;
      this.height = 0;
    }

    addFrame(imageData, delayMs) {
      if (this.frames.length === 0) {
        this.width = imageData.width;
        this.height = imageData.height;
      }
      this.frames.push(new GIFFrame(imageData, delayMs));
    }

    _quantize(imageData, colors) {
      const pixels = imageData.data;
      const colorMap = new Map();
      const pixelIndices = new Uint8Array(pixels.length / 4);

      const colorList = [];
      let nextColor = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];

        const key = (r << 16) | (g << 8) | b;

        if (!colorMap.has(key)) {
          if (nextColor >= colors) {
            let nearestIdx = 0;
            let nearestDist = Infinity;
            for (let j = 0; j < colorList.length; j++) {
              const cr = (colorList[j] >> 16) & 0xff;
              const cg = (colorList[j] >> 8) & 0xff;
              const cb = colorList[j] & 0xff;
              const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
              if (dist < nearestDist) {
                nearestDist = dist;
                nearestIdx = j;
              }
            }
            pixelIndices[i / 4] = nearestIdx;
            continue;
          }
          colorMap.set(key, nextColor);
          colorList.push(key);
          nextColor++;
        }
        pixelIndices[i / 4] = colorMap.get(key);
      }

      const paletteSize = Math.max(2, 1 << Math.ceil(Math.log2(Math.max(nextColor, 2))));
      const palette = new Uint8Array(paletteSize * 3);

      for (let i = 0; i < colorList.length; i++) {
        palette[i * 3] = (colorList[i] >> 16) & 0xff;
        palette[i * 3 + 1] = (colorList[i] >> 8) & 0xff;
        palette[i * 3 + 2] = colorList[i] & 0xff;
      }

      return { pixelIndices, palette, paletteSize };
    }

    encode() {
      if (this.frames.length === 0) return null;

      const firstFrame = this.frames[0];
      const { pixelIndices, palette, paletteSize } = this._quantize(firstFrame.imageData, 256);

      const lzw = new LZWEncoder();
      const lzwResult = lzw.encode(pixelIndices, this.width, this.height, paletteSize);

      const bytes = [];

      bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

      bytes.push(this.width & 0xff, (this.width >> 8) & 0xff);
      bytes.push(this.height & 0xff, (this.height >> 8) & 0xff);

      const gctFlag = 1;
      const colorResolution = 7;
      const sortFlag = 0;
      const gctSize = Math.log2(paletteSize) - 1;
      const packed = (gctFlag << 7) | (colorResolution << 4) | (sortFlag << 3) | gctSize;
      bytes.push(packed);

      bytes.push(0);
      bytes.push(0);

      for (let i = 0; i < paletteSize * 3; i++) {
        bytes.push(palette[i]);
      }

      bytes.push(0x21, 0xff, 0x0b);
      const netscape = 'NETSCAPE2.0';
      for (let i = 0; i < netscape.length; i++) {
        bytes.push(netscape.charCodeAt(i));
      }
      bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

      for (let f = 0; f < this.frames.length; f++) {
        const frame = this.frames[f];
        const frameQuant = this._quantize(frame.imageData, 256);

        const delayCs = Math.round(frame.delayMs / 10);

        bytes.push(0x21, 0xf9, 0x04);

        const disposalMethod = 2;
        const userInput = 0;
        const transparencyFlag = 0;
        const gcePacked = (disposalMethod << 2) | (userInput << 1) | transparencyFlag;
        bytes.push(gcePacked);

        bytes.push(delayCs & 0xff, (delayCs >> 8) & 0xff);

        bytes.push(0);
        bytes.push(0);

        bytes.push(0x2c);

        bytes.push(0, 0);
        bytes.push(0, 0);

        bytes.push(this.width & 0xff, (this.width >> 8) & 0xff);
        bytes.push(this.height & 0xff, (this.height >> 8) & 0xff);

        const lctFlag = 1;
        const interlace = 0;
        const sort = 0;
        const lctSize = Math.log2(frameQuant.paletteSize) - 1;
        const imgPacked = (lctFlag << 7) | (interlace << 6) | (sort << 5) | lctSize;
        bytes.push(imgPacked);

        for (let i = 0; i < frameQuant.paletteSize * 3; i++) {
          bytes.push(frameQuant.palette[i]);
        }

        bytes.push(lzwResult.minCodeSize);

        const frameLzw = lzw.encode(frameQuant.pixelIndices, this.width, this.height, frameQuant.paletteSize);
        for (let i = 0; i < frameLzw.data.length; i++) {
          bytes.push(frameLzw.data[i]);
        }
      }

      bytes.push(0x3b);

      return new Uint8Array(bytes);
    }
  }

  class ZIPWriter {
    constructor() {
      this.files = [];
    }

    addFile(name, data) {
      this.files.push({ name, data });
    }

    _crc32(data) {
      const table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
      }

      let crc = 0xffffffff;
      for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
      }
      return (crc ^ 0xffffffff) >>> 0;
    }

    _deflate(data) {
      return data;
    }

    generate() {
      const chunks = [];
      const centralDir = [];
      let offset = 0;

      for (const file of this.files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const fileData = file.data instanceof Uint8Array ? file.data : new TextEncoder().encode(file.data);
        const compressedData = this._deflate(fileData);
        const crc = this._crc32(fileData);

        const localHeader = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(localHeader.buffer);

        view.setUint32(0, 0x04034b50, true);
        view.setUint16(4, 20, true);
        view.setUint16(6, 0, true);
        view.setUint16(8, 0, true);
        view.setUint16(10, 0, true);
        view.setUint16(12, 0, true);
        view.setUint32(14, crc, true);
        view.setUint32(18, compressedData.length, true);
        view.setUint32(22, fileData.length, true);
        view.setUint16(26, nameBytes.length, true);
        view.setUint16(28, 0, true);

        localHeader.set(nameBytes, 30);

        chunks.push(localHeader);
        chunks.push(compressedData);

        const cdEntry = new Uint8Array(46 + nameBytes.length);
        const cdView = new DataView(cdEntry.buffer);

        cdView.setUint32(0, 0x02014b50, true);
        cdView.setUint16(4, 20, true);
        cdView.setUint16(6, 20, true);
        cdView.setUint16(8, 0, true);
        cdView.setUint16(10, 0, true);
        cdView.setUint16(12, 0, true);
        cdView.setUint32(14, crc, true);
        cdView.setUint32(18, compressedData.length, true);
        cdView.setUint32(22, fileData.length, true);
        cdView.setUint16(26, nameBytes.length, true);
        cdView.setUint16(28, 0, true);
        cdView.setUint16(30, 0, true);
        cdView.setUint16(32, 0, true);
        cdView.setUint16(34, 0, true);
        cdView.setUint32(36, 0, true);
        cdView.setUint32(40, offset, true);
        cdView.setUint32(44, 0, true);

        cdEntry.set(nameBytes, 46);

        centralDir.push(cdEntry);

        offset += localHeader.length + compressedData.length;
      }

      const cdLength = centralDir.reduce((sum, entry) => sum + entry.length, 0);
      const cdOffset = offset;

      const eocd = new Uint8Array(22);
      const eocdView = new DataView(eocd.buffer);

      eocdView.setUint32(0, 0x06054b50, true);
      eocdView.setUint16(4, 0, true);
      eocdView.setUint16(6, 0, true);
      eocdView.setUint16(8, this.files.length, true);
      eocdView.setUint16(10, this.files.length, true);
      eocdView.setUint32(12, cdLength, true);
      eocdView.setUint32(16, cdOffset, true);
      eocdView.setUint16(20, 0, true);

      chunks.push(...centralDir);
      chunks.push(eocd);

      let totalLength = 0;
      for (const chunk of chunks) totalLength += chunk.length;

      const result = new Uint8Array(totalLength);
      let pos = 0;
      for (const chunk of chunks) {
        result.set(chunk, pos);
        pos += chunk.length;
      }

      return result;
    }
  }

  AnimationController.prototype.getTotalFrames = function() {
    return this.totalFrames;
  };

  AnimationController.prototype.getCurrentTime = function() {
    return this.currentTime;
  };

  AnimationController.prototype.goToFrame = function(frame) {
    this.setCurrentFrame(frame);
  };

  AnimationController.prototype.setLoop = function(loop) {
    this.loop = loop;
  };

  AnimationController.prototype.setSpeed = function(speed) {
    this.speed = Math.max(0.1, Math.min(10, speed));
  };

  AnimationController.prototype.getKeyframeEasing = function(shapeId, propName, frame) {
    const anim = this.getShapeAnimation(shapeId, false);
    if (!anim) return null;
    const track = anim.getTrack(propName, false);
    if (!track) return null;
    const kf = track.getKeyframeAt(frame);
    return kf ? kf.easing : null;
  };

  AnimationController.prototype.setKeyframeEasing = function(shapeId, propName, frame, easing) {
    const anim = this.getShapeAnimation(shapeId, false);
    if (!anim) return false;
    const track = anim.getTrack(propName, false);
    if (!track) return false;
    const kf = track.getKeyframeAt(frame);
    if (kf) {
      kf.easing = easing || EASING_LINEAR;
      return true;
    }
    return false;
  };

  ShapeAnimation.prototype.getPropertyTrack = function(propName) {
    return this.getTrack(propName, false);
  };

  const _GIFEncoderStart = function() {
    this.frames = [];
    this._repeat = 0;
    this._delay = 100;
    this.out = { data: '', _dataArray: [], getData() { return this._dataArray.join(''); } };
    return this;
  };

  const _GIFEncoderSetRepeat = function(repeat) {
    this._repeat = repeat;
  };

  const _GIFEncoderSetDelay = function(delayMs) {
    this._delay = delayMs;
  };

  const _originalAddFrame = GIFEncoder.prototype.addFrame;

  const _GIFEncoderAddFrame = function(imageData) {
    _originalAddFrame.call(this, imageData, this._delay);
  };

  const _GIFEncoderFinish = function() {
    const result = this.encode();
    let str = '';
    for (let i = 0; i < result.length; i++) {
      str += String.fromCharCode(result[i]);
    }
    this.out._dataArray = [str];
  };

  GIFEncoder.prototype.start = _GIFEncoderStart;
  GIFEncoder.prototype.setRepeat = _GIFEncoderSetRepeat;
  GIFEncoder.prototype.setDelay = _GIFEncoderSetDelay;
  GIFEncoder.prototype.addFrame = _GIFEncoderAddFrame;
  GIFEncoder.prototype.finish = _GIFEncoderFinish;

  ZIPWriter.prototype.generateBase64 = function() {
    const uint8 = this.generate();
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  };

  global.AnimationController = AnimationController;
  global.ShapeAnimation = ShapeAnimation;
  global.PropertyTrack = PropertyTrack;
  global.Keyframe = Keyframe;
  global.GIFEncoder = GIFEncoder;
  global.LZWEncoder = LZWEncoder;
  global.ZIPWriter = ZIPWriter;

  global.AnimationSystem = {
    AnimationController,
    ShapeAnimation,
    PropertyTrack,
    Keyframe,
    GIFEncoder,
    LZWEncoder,
    ZIPWriter,
    EASING_LINEAR,
    EASING_EASE_IN_OUT,
    ANIMATABLE_PROPS,
    interpolateColor,
    interpolateNumber,
    hexToRgb,
    rgbToHex,
    rgbToHsl,
    hslToRgb,
    DEFAULT_FPS,
    DEFAULT_DURATION
  };

})(window);
