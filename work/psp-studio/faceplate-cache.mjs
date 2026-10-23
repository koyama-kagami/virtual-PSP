import { build } from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const CACHE_VERSION = 1;
const digest = value => createHash('sha256').update(value).digest('hex');

// Follow imports rather than a handwritten dependency list: adding a shape
// helper must invalidate baked geometry just as editing the main source does.
export async function geometryFingerprint({ root, entries = ['faceplate-source.js', 'psp-shapes.js'] }) {
  const graph = await build({
    absWorkingDir: root,
    entryPoints: entries,
    outdir: path.join(root, '.cache', 'dependency-graph'),
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    packages: 'external',
    logLevel: 'silent',
  });
  const hash = createHash('sha256');
  hash.update(`faceplates-v${CACHE_VERSION};node-${process.versions.node.split('.')[0]};`);
  const inputs = [...new Set([...Object.keys(graph.metafile.inputs), 'package-lock.json'])].sort();
  for (const input of inputs) {
    hash.update(input.replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(path.resolve(root, input)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function validData(data) {
  if (!data || ![16, 32].includes(data.indexBits)) return false;
  const lengths = ['positions', 'normals', 'indices'].map(key => {
    const value = data[key];
    if (typeof value !== 'string' || !value.length || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return -1;
    return Buffer.byteLength(value, 'base64');
  });
  const [positions, normals, indices] = lengths;
  return positions > 0 && positions % 12 === 0 && positions === normals && indices > 0 && indices % (3 * data.indexBits / 8) === 0;
}

export async function cachedFaceplate({ modelId, directory, fingerprint, bake, force = false }) {
  if (!/^[a-z0-9-]+$/.test(modelId)) throw new Error('Invalid faceplate model id');
  const file = path.join(directory, `faceplate-${modelId}.json`);
  if (!force) {
    try {
      const record = JSON.parse(await readFile(file, 'utf8'));
      if (record.version === CACHE_VERSION && record.fingerprint === fingerprint &&
          validData(record.data) && record.checksum === digest(JSON.stringify(record.data))) {
        return { data: record.data, hit: true, file };
      }
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') console.warn(`Faceplate cache read skipped: ${error.message}`);
    }
  }

  const data = await bake();
  if (!validData(data)) throw new Error(`Invalid baked faceplate data for PSP-${modelId}`);
  const record = { version: CACHE_VERSION, fingerprint, checksum: digest(JSON.stringify(data)), data };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, JSON.stringify(record));
    await rename(temporary, file);
  } catch (error) {
    // A read-only cache must not prevent a legitimate standalone build.
    console.warn(`Faceplate cache write skipped: ${error.message}`);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return { data, hit: false, file };
}
