import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTypedArray } from './faceplate-codec.js';

test('geometry binary decoding preserves every bit for each supported attribute type', () => {
  for (const original of [
    new Float32Array([0, -0, .25, -.0000001, Math.PI, 100000]),
    new Uint16Array([0, 1, 65535]),
    new Uint32Array([0, 1, 65536, 4294967295]),
  ]) {
    const bytes = Buffer.from(original.buffer);
    const decoded = decodeTypedArray(bytes.toString('base64'), original.constructor);
    assert.deepEqual(Buffer.from(decoded.buffer), bytes);
  }
});

test('legacy browser fallback decodes without a per-byte iterator', () => {
  const original = Uint8Array.fromBase64;
  try {
    Uint8Array.fromBase64 = undefined;
    assert.deepEqual(Array.from(decodeTypedArray('AAABAP//', Uint16Array)), [0, 1, 65535]);
    assert.throws(() => decodeTypedArray('AA==', Float32Array), /aligned/);
  } finally {
    Uint8Array.fromBase64 = original;
  }
});

test('uses native base64 decoding when the browser supports it', () => {
  const original = Uint8Array.fromBase64;
  let calls = 0;
  try {
    Uint8Array.fromBase64 = encoded => {
      calls++;
      return new Uint8Array(Buffer.from(encoded, 'base64'));
    };
    assert.deepEqual(Array.from(decodeTypedArray('AAABAP//', Uint16Array)), [0, 1, 65535]);
    assert.equal(calls, 1);
  } finally {
    Uint8Array.fromBase64 = original;
  }
});
