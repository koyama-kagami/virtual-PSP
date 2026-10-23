import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { cachedFaceplate, geometryFingerprint } from './faceplate-cache.mjs';
const root=import.meta.dirname;
const { values: options } = parseArgs({ options: {
  output: { type: 'string' },
  'rebuild-faceplates': { type: 'boolean', default: false },
} });
const buildStarted = performance.now();
const encode = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
const fingerprint = await geometryFingerprint({ root });
const faceplates = {};
for (const modelId of ['1000', '2000', '3000']) {
  const started = performance.now();
  const { data, hit } = await cachedFaceplate({
    modelId, fingerprint,
    directory: path.join(root, '.cache', 'faceplates'),
    force: options['rebuild-faceplates'],
    bake: async () => {
      const [{ faceplateGeometry }, { roundedShape, silhouette }] = await Promise.all([
        import('./faceplate-source.js'), import('./psp-shapes.js'),
      ]);
      const geometry = faceplateGeometry(silhouette(modelId), roundedShape, modelId);
      try {
        return {
          positions: encode(geometry.attributes.position.array),
          normals: encode(geometry.attributes.normal.array),
          indices: encode(geometry.index.array),
          indexBits: geometry.index.array.BYTES_PER_ELEMENT * 8,
        };
      } finally {
        geometry.dispose();
      }
    },
  });
  faceplates[modelId] = data;
  const vertices = Buffer.byteLength(data.positions, 'base64') / 12;
  const triangles = Buffer.byteLength(data.indices, 'base64') / (3 * data.indexBits / 8);
  console.log(`${hit ? 'Cached' : 'Baked'} PSP-${modelId} faceplate: ${vertices} vertices, ${triangles} triangles in ${((performance.now() - started) / 1000).toFixed(2)}s.`);
}
const result=await build({entryPoints:[path.join(root,'app.js')],bundle:true,write:false,minify:true,format:'iife',target:'es2020',legalComments:'inline',plugins:[{
  name:'baked-faceplate', setup(build) {
    build.onResolve({filter:/^psp:faceplate-data$/}, () => ({path:'faceplate-data',namespace:'baked'}));
    build.onLoad({filter:/.*/,namespace:'baked'}, () => ({contents:`export const faceplates=${JSON.stringify(faceplates)};`,loader:'js'}));
  },
}]});
const html=await readFile(path.join(root,'index.html'),'utf8');
const css=await readFile(path.join(root,'style.css'),'utf8');
const code=result.outputFiles[0].text.replaceAll('</script','<\\/script');
const runtimePackages = ['three'];
const licenses = await Promise.all(runtimePackages.map(async name => {
  const directory = path.join(root,'node_modules',name);
  const file = (await readdir(directory)).find(file => /^licen[sc]e/i.test(file));
  if (!file) throw new Error(`Missing bundled license for ${name}`);
  return `${name}\n${await readFile(path.join(directory,file),'utf8')}`;
}));
const output=options.output ? path.resolve(options.output) : path.resolve(root,'../../outputs/psp-3000.html');
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,html.replace('/*__STYLE__*/',()=>css).replace('/*__SCRIPT__*/',()=>code).replace('</html>',`<!-- Bundled runtime licenses:\n${licenses.join('\n\n')}\n-->\n</html>`));
console.log(`Built ${output} (${Math.round((await readFile(output)).length/1024)} KB) in ${((performance.now() - buildStarted) / 1000).toFixed(2)}s; bundled, no remote assets.`);
