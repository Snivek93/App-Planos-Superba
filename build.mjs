/* Compilación con esbuild.
     npm run build   → dist/ optimizado (minificado, con hash en los nombres y service worker)
     npm run dev     → servidor local con recarga al guardar (sin service worker)        */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEV = process.argv.includes('--dev');
const OUT = 'dist';
const PORT = +(process.env.PORT || 5173);

const PDF_WORKER = 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs';

function copyDir(from, to) {
  fs.mkdirSync(to, {recursive:true});
  for (const e of fs.readdirSync(from, {withFileTypes:true})) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}
function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p).split(path.sep).join('/')];
  });
}

/* Después de cada compilación: index.html con los nombres finales, archivos públicos,
   el worker de pdf.js y el service worker con la lista de archivos para uso sin conexión. */
function finish(result) {
  const outs = Object.entries(result.metafile.outputs);
  const entry = outs.find(([, o]) => o.entryPoint === 'src/main.js');
  if (!entry) throw new Error('No se encontró la salida de src/main.js');
  const rel = f => path.relative(OUT, f).split(path.sep).join('/');
  const js = rel(entry[0]), css = entry[1].cssBundle ? rel(entry[1].cssBundle) : null;
  let html = fs.readFileSync('index.html', 'utf8').replace('%APP_JS%', js);
  html = css ? html.replace('%APP_CSS%', css) : html.replace(/^.*%APP_CSS%.*\n/m, '');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  copyDir('public', OUT);
  fs.mkdirSync(path.join(OUT, 'vendor'), {recursive:true});
  fs.copyFileSync(PDF_WORKER, path.join(OUT, 'vendor/pdf.worker.min.mjs'));
  if (DEV) return;
  const files = listFiles(OUT).filter(f => f !== 'sw.js' && !f.endsWith('.map')).sort();
  const hash = crypto.createHash('sha256');
  for (const f of files) hash.update(f).update(fs.readFileSync(path.join(OUT, f)));
  const version = hash.digest('hex').slice(0, 12);
  const sw = fs.readFileSync('src/sw.js', 'utf8')
    .replace("'__VERSION__'", JSON.stringify(version))
    .replace('__PRECACHE__;', JSON.stringify(['./', ...files], null, 0) + ';');
  fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
  const kb = files.reduce((a, f) => a + fs.statSync(path.join(OUT, f)).size, 0) / 1024;
  console.log(`✓ dist/ listo · versión ${version} · ${files.length} archivos · ${(kb / 1024).toFixed(1)} MB para uso sin conexión`);
}

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  splitting: true,              // pdf.js y pdf-lib quedan en archivos aparte y se cargan solo cuando hacen falta
  format: 'esm',
  outdir: `${OUT}/assets`,
  entryNames: DEV ? '[name]' : '[name]-[hash]',
  chunkNames: DEV ? 'chunks/[name]' : 'chunks/[name]-[hash]',
  assetNames: DEV ? '[name]' : '[name]-[hash]',
  minify: !DEV,
  sourcemap: DEV ? 'inline' : 'linked',
  target: ['es2020', 'chrome95', 'safari15', 'firefox95', 'edge95'],
  define: { __DEV__: JSON.stringify(DEV), __DEBUG__: JSON.stringify(DEV || !!process.env.DEBUG_HOOK) },
  legalComments: 'linked',
  metafile: true,
  logLevel: 'info',
};

fs.rmSync(OUT, {recursive:true, force:true});
if (DEV) {
  const ctx = await esbuild.context({...options, plugins:[{name:'finish', setup(b) { b.onEnd(r => { if (!r.errors.length) finish(r); }); }}]});
  await ctx.watch();
  const {port} = await ctx.serve({servedir: OUT, port: PORT});
  console.log(`\n  App en desarrollo: http://localhost:${port}/\n`);
} else {
  finish(await esbuild.build(options));
}
