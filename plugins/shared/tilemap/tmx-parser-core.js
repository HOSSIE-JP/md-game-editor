(function installTmxParser(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MdGameEditorTmxParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTmxParser() {
  'use strict';

  function clampInt(value, min, max, fallback) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }
  function unescapeXml(value) {
    return String(value ?? '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }
  function parseAttrs(text) {
    const attrs = {};
    const re = /([:\w-]+)\s*=\s*(["'])(.*?)\2/g;
    let match;
    while ((match = re.exec(String(text || '')))) attrs[match[1]] = unescapeXml(match[3]);
    return attrs;
  }
  function matchTag(text, tagName) {
    const match = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(String(text || ''));
    return match ? { attrs: match[1], body: match[2] } : null;
  }
  function matchTilesetTags(text) {
    const result = [];
    const re = /<tileset\b([^>]*?)(?:\/>|>([\s\S]*?)<\/tileset>)/gi;
    let match;
    while ((match = re.exec(String(text || '')))) result.push({ attrs: match[1], body: match[2] || '' });
    return result;
  }
  function parseCsvLayer(text) { return String(text || '').split(/[\s,]+/).filter(Boolean).map((value) => clampInt(value, 0, 0xffffffff, 0)); }
  function normalizeLayerData(data, width, height) {
    const count = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
    return Array.from({ length: count }, (_, index) => clampInt(data?.[index], 0, 0xffffffff, 0));
  }
  function isCollisionLayerName(value) { return /^collision(?::|$)/i.test(String(value || '').trim()); }
  function sourceBaseName(source) { return String(source || '').split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'tileset001'; }

  function parseTsx(text) {
    const rootTag = matchTag(text, 'tileset');
    if (!rootTag) throw new Error('TSX tileset element not found');
    const attrs = parseAttrs(rootTag.attrs);
    const imageMatch = /<image\b([^>]*?)(?:\/>|>)/i.exec(rootTag.body);
    const image = imageMatch ? parseAttrs(imageMatch[1]) : {};
    if (!image.source) throw new Error('TSX image source not found');
    return {
      name: attrs.name || sourceBaseName(image.source),
      tileWidth: clampInt(attrs.tilewidth, 1, 1024, 8),
      tileHeight: clampInt(attrs.tileheight, 1, 1024, 8),
      tileCount: clampInt(attrs.tilecount, 0, 65535, 0),
      columns: clampInt(attrs.columns, 0, 65535, 0),
      imageSource: image.source,
      imageWidth: clampInt(image.width, 0, 65535, 0),
      imageHeight: clampInt(image.height, 0, 65535, 0),
    };
  }

  function parseTmx(text) {
    const warnings = [];
    const rootTag = matchTag(text, 'map');
    if (!rootTag) throw new Error('TMX map element not found');
    const attrs = parseAttrs(rootTag.attrs);
    if (attrs.orientation && attrs.orientation !== 'orthogonal') warnings.push(`未対応 orientation: ${attrs.orientation}`);
    if (attrs.infinite === '1') warnings.push('infinite map は保存対象外です');
    if (/<chunk\b/i.test(rootTag.body)) warnings.push('chunked layer data は保存対象外です');
    if (/<objectgroup\b/i.test(rootTag.body)) warnings.push('object layerは読み込み時に保持しません');
    if (/<imagelayer\b/i.test(rootTag.body) || /<group\b/i.test(rootTag.body)) warnings.push('image/group layerは保存対象外です');
    const tilesets = matchTilesetTags(rootTag.body).map((tag) => {
      const value = parseAttrs(tag.attrs);
      return { firstgid: clampInt(value.firstgid, 1, 65535, 1), source: value.source || '', name: sourceBaseName(value.source || 'tileset001') };
    });
    const firstTileset = tilesets[0] || { firstgid: 1, source: '', name: 'tileset001' };
    const width = clampInt(attrs.width, 1, 4096, 40);
    const height = clampInt(attrs.height, 1, 4096, 28);
    const layers = [];
    const layerRe = /<layer\b([^>]*)>([\s\S]*?)<\/layer>/gi;
    let layerMatch;
    while ((layerMatch = layerRe.exec(rootTag.body))) {
      const layerAttrs = parseAttrs(layerMatch[1]);
      const dataTag = matchTag(layerMatch[2], 'data');
      if (!dataTag) { warnings.push(`layer '${layerAttrs.name || ''}' に data がありません`); continue; }
      const dataAttrs = parseAttrs(dataTag.attrs);
      if (String(dataAttrs.encoding || '').toLowerCase() !== 'csv') { warnings.push(`layer '${layerAttrs.name || ''}' は CSV encoding ではありません`); continue; }
      if (dataAttrs.compression) { warnings.push(`layer '${layerAttrs.name || ''}' は compressed data です`); continue; }
      layers.push({
        name: layerAttrs.name || `Layer ${layers.length + 1}`,
        visible: layerAttrs.visible !== '0' || isCollisionLayerName(layerAttrs.name || ''),
        opacity: Number(layerAttrs.opacity || 1), priority: /\s(priority|prio)$/i.test(layerAttrs.name || ''),
        collision: isCollisionLayerName(layerAttrs.name || ''), data: normalizeLayerData(parseCsvLayer(dataTag.body), width, height),
      });
    }
    if (!layers.length) layers.push({ name: 'Ground', visible: true, opacity: 1, priority: false, collision: false, data: new Array(width * height).fill(0) });
    return { name: 'map001', width, height, tileWidth: clampInt(attrs.tilewidth, 1, 1024, 8), tileHeight: clampInt(attrs.tileheight, 1, 1024, 8), tilesetSource: firstTileset.source, tilesetName: firstTileset.name, tilesets, layers, warnings };
  }

  function findLayer(map, name) {
    const requested = String(name || '').trim();
    return (map?.layers || []).find((layer) => layer.name === requested || layer.name === `Collision:${requested}` || (!requested && layer.collision)) || null;
  }
  function encodeRle(data) {
    const output = [];
    const values = Array.isArray(data) ? data : [];
    for (let index = 0; index < values.length;) {
      const value = clampInt(values[index], 0, 255, 0);
      let run = 1;
      while (index + run < values.length && run < 255 && clampInt(values[index + run], 0, 255, 0) === value) run += 1;
      output.push(run, value); index += run;
    }
    return output;
  }
  function decodeRle(data, expectedLength = 0) {
    const output = [];
    for (let index = 0; index + 1 < (data || []).length; index += 2) for (let run = 0; run < Number(data[index] || 0); run += 1) output.push(Number(data[index + 1]) || 0);
    if (expectedLength && output.length !== expectedLength) throw new Error(`collision RLE length ${output.length} != ${expectedLength}`);
    return output;
  }
  function collisionCatalog(text, layerName, materialMap = { 0: 0, 1: 1, 2: 2, 4: 2 }) {
    const map = parseTmx(text);
    const layer = findLayer(map, layerName);
    if (!layer) throw new Error(`collision layerがありません: ${layerName}`);
    const values = layer.data.map((value) => materialMap[value] == null ? value : materialMap[value]);
    return { width: map.width, height: map.height, tileWidth: map.tileWidth, tileHeight: map.tileHeight, layerName: layer.name, values, rle: encodeRle(values), warnings: map.warnings };
  }

  return { collisionCatalog, decodeRle, encodeRle, findLayer, isCollisionLayerName, normalizeLayerData, parseCsvLayer, parseTmx, parseTsx };
});
