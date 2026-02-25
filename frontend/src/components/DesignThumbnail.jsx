import React from 'react';

const PAGE_W = 794;
const PAGE_H = 1123;
const THUMB_W = 100;
const THUMB_H = 140;

/**
 * Miniature preview of a template design – box layout only (no content), like Adobe PDF sidebar.
 * design: { design: { pages: [{ boxes }] }, settings?: { pageSize, orientation } }
 */
function DesignThumbnail({ design, className = '' }) {
  const boxes = design?.design?.pages?.[0]?.boxes ?? [];
  const pageSize = design?.settings?.pageSize || 'A4';
  const orientation = design?.settings?.orientation || 'portrait';

  const dims = pageSize === 'A3' ? { portrait: [1123, 1587], landscape: [1587, 1123] }
    : pageSize === 'A5' ? { portrait: [559, 794], landscape: [794, 559] }
    : { portrait: [PAGE_W, PAGE_H], landscape: [PAGE_H, PAGE_W] };
  const [pw, ph] = orientation === 'landscape' ? dims.landscape : dims.portrait;

  const scale = Math.min(THUMB_W / pw, THUMB_H / ph, 1);
  const offsetX = (THUMB_W - pw * scale) / 2;
  const offsetY = (THUMB_H - ph * scale) / 2;

  return (
    <div className={`design-thumbnail ${className}`} title={design?.name || 'Design'}>
      <div
        className="design-thumbnail-page"
        style={{
          width: THUMB_W,
          height: THUMB_H,
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderRadius: 4,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {boxes.map((box, i) => {
          const x = (box.position?.x ?? 0) * scale + offsetX;
          const y = (box.position?.y ?? 0) * scale + offsetY;
          const w = Math.max(2, (box.size?.width ?? 60) * scale);
          const h = Math.max(2, (box.size?.height ?? 20) * scale);
          return (
            <div
              key={box.id || i}
              className="design-thumbnail-box"
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: w,
                height: h,
                border: '1px solid #64748b',
                borderRadius: 1,
                background: 'rgba(59, 130, 246, 0.12)',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
      </div>
      {design?.name && (
        <div className="design-thumbnail-name" style={{ fontSize: 11, marginTop: 4, color: 'var(--color-text-muted, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {design.name}
        </div>
      )}
    </div>
  );
}

export default DesignThumbnail;
