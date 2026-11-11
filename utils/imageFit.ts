/**
 * Composer images are scaled down before upload, like Claude Code and omp do with a pasted
 * image: a retina screenshot or photo can be 10+ MB, which the server refuses (413) and the
 * model API would refuse after it (5 MB per image, base64). The limits match what the harnesses
 * resize to themselves.
 */
export const IMAGE_MAX_EDGE = 2000;
/** 3.75 MB raw = 5 MB base64, the per-image limit of the Anthropic API */
export const IMAGE_MAX_BYTES = 3_750_000;

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function canvasOf(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: Canvas, type: string, quality?: number): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  // the project's TS lib predates Promise.withResolvers
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function draw(bitmap: ImageBitmap, width: number, height: number, opaque: boolean): Canvas {
  const canvas = canvasOf(width, height);
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('no 2d context');
  // JPEG has no alpha: transparent pixels would turn black
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/**
 * `file` within `maxEdge` px on its longest side and `maxBytes`; unchanged when it already fits
 * or the browser cannot decode it (the server then decides). PNG and WebP keep their format while
 * they fit, everything else, and anything still too large, becomes JPEG.
 */
export async function fitImage(
  file: Blob,
  { maxEdge = IMAGE_MAX_EDGE, maxBytes = IMAGE_MAX_BYTES } = {}
): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    let scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= maxBytes) return file;
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (file.type === 'image/png' || file.type === 'image/webp') {
        const same = await encode(draw(bitmap, width, height, false), file.type);
        if (same && same.size <= maxBytes) return same;
      }
      const canvas = draw(bitmap, width, height, true);
      for (const quality of [0.9, 0.8, 0.7]) {
        const jpeg = await encode(canvas, 'image/jpeg', quality);
        if (jpeg && jpeg.size <= maxBytes) return jpeg;
      }
    }
    return file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}
