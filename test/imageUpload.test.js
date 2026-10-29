import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { imageExt, saveAgentImage, MAX_IMAGE_BYTES } from '../server/services/imageUpload.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);

describe('imageUpload - validation', () => {
  it('detects the type from the magic bytes', () => {
    expect(imageExt(PNG)).toBe('png');
    expect(imageExt(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]))).toBe(
      'jpg'
    );
    expect(imageExt(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]))).toBe('gif');
    expect(imageExt(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
  });

  it('rejects non-images, SVG and tiny buffers', () => {
    expect(imageExt(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(imageExt(Buffer.from('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(imageExt(PNG.subarray(0, 8))).toBeNull();
    expect(imageExt('not a buffer')).toBeNull();
  });
});

describe('imageUpload - saveAgentImage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-images-'));

  it('stores the image under a server-chosen name', async () => {
    const file = await saveAgentImage(PNG, dir);
    expect(path.dirname(file)).toBe(dir);
    expect(path.basename(file)).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(fs.readFileSync(file).equals(PNG)).toBe(true);
  });

  it('refuses unsupported and oversized files with an HTTP status', async () => {
    await expect(saveAgentImage(Buffer.from('hello world, no image'), dir)).rejects.toMatchObject({
      status: 415,
    });
    const big = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    await expect(saveAgentImage(big, dir)).rejects.toMatchObject({ status: 413 });
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});
