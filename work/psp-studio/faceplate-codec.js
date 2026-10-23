// Native decoding avoids a callback and intermediate iterator per mesh byte.
// The loop preserves support for browsers without Uint8Array.fromBase64.
export function decodeTypedArray(encoded, Type) {
  let bytes;
  if (typeof Uint8Array.fromBase64 === 'function') {
    bytes = Uint8Array.fromBase64(encoded);
  } else {
    const binary = atob(encoded);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength % Type.BYTES_PER_ELEMENT) throw new Error('Geometry bytes are not aligned to their attribute type');
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}
