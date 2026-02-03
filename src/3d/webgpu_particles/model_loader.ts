import { WebIO } from '@gltf-transform/core';

export interface GpuModel {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
  indexFormat: GPUIndexFormat;
  boundsMinY: number;
  textureView: GPUTextureView;
  sampler: GPUSampler;
  meshData: {
    positions: Float32Array;
    indices: Uint16Array | Uint32Array;
  };
}

async function loadImageBitmapFromBytes(
  data: Uint8Array,
  mimeType: string
): Promise<ImageBitmap> {
  const blob = new Blob([data as any], { type: mimeType || 'image/png' });
  return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

async function loadImageBitmapFromUri(uri: string): Promise<ImageBitmap> {
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`Failed to load image: ${uri}`);
  }
  const blob = await res.blob();
  return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
}

export async function loadGltfModel(
  device: GPUDevice,
  url: string
): Promise<GpuModel> {
  const io = new WebIO();
  const document = await io.read(url);
  const baseUrl = new URL(url, window.location.href);
  const root = document.getRoot();
  const mesh = root.listMeshes()[0];
  if (!mesh) {
    throw new Error('GLTF has no meshes');
  }
  const primitive = mesh.listPrimitives()[0];
  if (!primitive) {
    throw new Error('GLTF has no mesh primitives');
  }

  const positionAccessor = primitive.getAttribute('POSITION');
  const normalAccessor = primitive.getAttribute('NORMAL');
  const uvAccessor = primitive.getAttribute('TEXCOORD_0');
  const indicesAccessor = primitive.getIndices();

  if (!positionAccessor || !normalAccessor || !uvAccessor || !indicesAccessor) {
    throw new Error('GLTF primitive missing POSITION/NORMAL/TEXCOORD_0/indices');
  }

  const positions = positionAccessor.getArray() as Float32Array | null;
  const normals = normalAccessor.getArray() as Float32Array | null;
  const uvs = uvAccessor.getArray() as Float32Array | null;
  const indicesData = indicesAccessor.getArray();

  if (!positions || !normals || !uvs || !indicesData) {
    throw new Error('GLTF primitive buffers are not loaded');
  }

  const vertexCount = positions.length / 3;
  const interleaved = new Float32Array(vertexCount * 8);
  let minY = Number.POSITIVE_INFINITY;
  for (let i = 0; i < vertexCount; i++) {
    const p = i * 3;
    const n = i * 3;
    const t = i * 2;
    const o = i * 8;
    interleaved[o + 0] = positions[p + 0];
    interleaved[o + 1] = positions[p + 1];
    interleaved[o + 2] = positions[p + 2];
    if (positions[p + 1] < minY) {
      minY = positions[p + 1];
    }
    interleaved[o + 3] = normals[n + 0];
    interleaved[o + 4] = normals[n + 1];
    interleaved[o + 5] = normals[n + 2];
    interleaved[o + 6] = uvs[t + 0];
    interleaved[o + 7] = uvs[t + 1];
  }

  const vertexBuffer = device.createBuffer({
    size: interleaved.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, interleaved);

  const indexBuffer = device.createBuffer({
    size: indicesData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });

  let indexFormat: GPUIndexFormat = 'uint16';
  if (indicesData instanceof Uint16Array) {
    device.queue.writeBuffer(indexBuffer, 0, indicesData);
    indexFormat = 'uint16';
  } else if (indicesData instanceof Uint32Array) {
    device.queue.writeBuffer(indexBuffer, 0, indicesData);
    indexFormat = 'uint32';
  } else {
    throw new Error('Unsupported index buffer type');
  }

  const material = primitive.getMaterial();
  const texture = material?.getBaseColorTexture() ?? null;
  if (!texture) {
    throw new Error('GLTF material missing base color texture');
  }

  const imageData = texture.getImage();
  const mimeType = texture.getMimeType() || 'image/png';
  const uri = texture.getURI();

  const bitmap = imageData
    ? await loadImageBitmapFromBytes(imageData, mimeType)
    : uri
      ? await loadImageBitmapFromUri(new URL(uri, baseUrl).toString())
      : null;

  if (!bitmap) {
    throw new Error('GLTF texture image data missing');
  }

  const textureGpu = device.createTexture({
    size: { width: bitmap.width, height: bitmap.height },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture: textureGpu },
    { width: bitmap.width, height: bitmap.height }
  );

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  return {
    vertexBuffer,
    indexBuffer,
    indexCount: indicesData.length,
    indexFormat,
    boundsMinY: minY,
    textureView: textureGpu.createView(),
    sampler,
    meshData: {
      positions: positions,
      indices: indicesData,
    },
  };
}
