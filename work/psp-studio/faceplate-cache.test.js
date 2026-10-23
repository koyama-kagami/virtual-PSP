import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cachedFaceplate, geometryFingerprint } from './faceplate-cache.mjs';

const encode = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
const mesh = () => ({
  positions: encode(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
  normals: encode(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])),
  indices: encode(new Uint16Array([0, 1, 2])),
  indexBits: 16,
});

test('cache reuses exact geometry; source changes and forced bakes invalidate it', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psp-faceplates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { modelId: '1000', directory, fingerprint: 'source-a', bake: async () => { calls++; return mesh(); } };
  const cold = await cachedFaceplate(options);
  const warm = await cachedFaceplate(options);
  assert.equal(cold.hit, false);
  assert.equal(warm.hit, true);
  assert.deepEqual(warm.data, cold.data);
  assert.equal(calls, 1);
  assert.equal((await cachedFaceplate({ ...options, fingerprint: 'source-b' })).hit, false);
  assert.equal((await cachedFaceplate({ ...options, force: true })).hit, false);
  assert.equal(calls, 3);
});

test('damaged or structurally invalid cache files are rebuilt', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psp-faceplates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { modelId: '2000', directory, fingerprint: 'source', bake: mesh };
  const first = await cachedFaceplate(options);
  const record = JSON.parse(await readFile(first.file, 'utf8'));
  record.data.positions = record.data.positions.replace('A', 'B');
  await writeFile(first.file, JSON.stringify(record));
  assert.equal((await cachedFaceplate(options)).hit, false, 'detect binary changes even if JSON is valid');
  await writeFile(first.file, '{partial write');
  assert.equal((await cachedFaceplate(options)).hit, false);
  await assert.rejects(cachedFaceplate({ ...options, force: true, bake: () => ({ ...mesh(), indexBits: 8 }) }), /Invalid/);
});

test('fingerprint tracks transitive local imports and dependency versions', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'psp-geometry-source-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'entry.js'), "export { shape } from './shape.js';");
  await writeFile(path.join(directory, 'shape.js'), 'export const shape = 1;');
  await writeFile(path.join(directory, 'package-lock.json'), '{"version": 1}');
  const options = { root: directory, entries: ['entry.js'] };
  const first = await geometryFingerprint(options);
  assert.equal(await geometryFingerprint(options), first);
  await writeFile(path.join(directory, 'shape.js'), 'export const shape = 2;');
  const changedSource = await geometryFingerprint(options);
  assert.notEqual(changedSource, first);
  await writeFile(path.join(directory, 'package-lock.json'), '{"version": 2}');
  assert.notEqual(await geometryFingerprint(options), changedSource);
});
