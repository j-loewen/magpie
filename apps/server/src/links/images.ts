import sharp from 'sharp';

// Decoding untrusted images: cap the pixel count so a tiny file cannot expand into gigabytes.
const LIMIT_INPUT_PIXELS = 40_000_000;

/** Preview image → WebP, at most 960×960. Re-encoding also strips anything but pixels. */
export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
    .rotate()
    .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

export interface Icon {
  data: Buffer;
  mime: string;
  ext: string;
}

const ICO_MAX_BYTES = 64 * 1024;
const isIco = (buf: Buffer) => buf.length > 4 && buf.readUInt32LE(0) === 0x00010000;

/**
 * Favicon → 64×64 PNG. SVG is rasterised, so no user-supplied SVG is ever served from this origin.
 * .ico (which sharp cannot read) is kept as-is if small; it cannot contain script.
 */
export async function makeIcon(input: Buffer, contentType: string): Promise<Icon | null> {
  if (isIco(input) || contentType.includes('icon')) {
    if (!isIco(input) || input.length > ICO_MAX_BYTES) return null;
    return { data: input, mime: 'image/x-icon', ext: 'ico' };
  }
  try {
    const data = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, animated: false })
      .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { data, mime: 'image/png', ext: 'png' };
  } catch {
    return null;
  }
}
