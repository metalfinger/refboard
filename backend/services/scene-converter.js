const { v4: uuidv4 } = require('uuid');

/**
 * Convert Fabric.js v1 canvas JSON to v2 scene format.
 * Flattens groups, normalises property names, and extracts asset keys from image URLs.
 */
function convertFabricToV2(fabricJson) {
  const objects = [];
  let z = 0;

  for (const obj of (fabricJson.objects || [])) {
    const base = {
      id: obj.id || uuidv4(),
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      w: obj.width ?? 0,
      h: obj.height ?? 0,
      sx: obj.scaleX ?? 1,
      sy: obj.scaleY ?? 1,
      angle: obj.angle ?? 0,
      z: z++,
      opacity: obj.opacity ?? 1,
      locked: obj.selectable === false,
      name: obj.name || '',
      visible: obj.visible !== false,
    };

    if (obj.type === 'image') {
      // Extract asset key from src URL
      const src = obj.src || '';
      const match = src.match(/\/api\/images\/(boards\/[^/]+\/[^/]+)/);
      const asset = match ? match[1] : src;
      objects.push({
        ...base,
        type: 'image',
        asset,
        filters: (obj.filters || []).map(f => (f.type || '').toLowerCase()).filter(Boolean),
      });
    } else if (obj.type === 'i-text' || obj.type === 'text' || obj.type === 'textbox') {
      objects.push({
        ...base,
        type: 'text',
        text: obj.text || '',
        fontSize: obj.fontSize ?? 24,
        fill: obj.fill ?? '#ffffff',
        fontFamily: obj.fontFamily ?? 'sans-serif',
      });
    } else if (obj.type === 'group') {
      const childIds = [];
      for (const child of (obj.objects || [])) {
        const childId = child.id || uuidv4();
        childIds.push(childId);
        // Add flattened child with adjusted coordinates
        objects.push({
          id: childId,
          type: child.type === 'image' ? 'image' : 'text',
          x: (child.left ?? 0) + base.x,
          y: (child.top ?? 0) + base.y,
          w: child.width ?? 0,
          h: child.height ?? 0,
          sx: child.scaleX ?? 1,
          sy: child.scaleY ?? 1,
          angle: child.angle ?? 0,
          z: z++,
          opacity: child.opacity ?? 1,
          locked: false,
          name: child.name || '',
          visible: true,
          ...(child.type === 'image' ? { asset: child.src || '', filters: [] } : {}),
          ...(child.type === 'i-text' ? { text: child.text || '', fontSize: 24, fill: '#fff', fontFamily: 'sans-serif' } : {}),
        });
      }
      objects.push({ ...base, type: 'group', children: childIds });
    }
    // Skip paths (drawing tools deferred)
  }

  return {
    v: 2,
    bg: fabricJson.background || '#1e1e1e',
    objects,
  };
}

module.exports = { convertFabricToV2 };
