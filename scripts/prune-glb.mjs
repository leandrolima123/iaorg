// Remove dados não usados de modelos .glb (accessors e bufferViews que nenhuma malha, pele, animação
// ou imagem referencia). Os esqueletos do KayKit vinham com ~11 mil accessors órfãos: 3,2 MB → ~0,4 MB.
// Uso: node scripts/prune-glb.mjs arquivo.glb [...]   (reescreve no lugar e mostra o antes/depois)
import fs from 'node:fs';

function prune(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: não é GLB`);
  const jsonLen = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = b.slice(binStart, binStart + b.readUInt32LE(20 + jsonLen));
  if ((j.accessors || []).some((a) => a.sparse)) throw new Error(`${file}: accessors esparsos não suportados`);

  // accessors referenciados
  const usedAcc = new Set();
  for (const m of j.meshes || []) for (const p of m.primitives) {
    Object.values(p.attributes).forEach((i) => usedAcc.add(i));
    if (p.indices != null) usedAcc.add(p.indices);
    (p.targets || []).forEach((t) => Object.values(t).forEach((i) => usedAcc.add(i)));
  }
  for (const s of j.skins || []) if (s.inverseBindMatrices != null) usedAcc.add(s.inverseBindMatrices);
  for (const a of j.animations || []) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output); }
  const accOld = [...usedAcc].sort((x, y) => x - y);
  const accMap = new Map(accOld.map((o, n) => [o, n]));

  // bufferViews referenciados (por accessors e imagens)
  const usedBv = new Set(accOld.map((i) => j.accessors[i].bufferView).filter((v) => v != null));
  for (const im of j.images || []) if (im.bufferView != null) usedBv.add(im.bufferView);
  const bvOld = [...usedBv].sort((x, y) => x - y);
  const bvMap = new Map(bvOld.map((o, n) => [o, n]));

  // novo binário, com cada bufferView alinhado em 4 bytes
  const parts = []; let off = 0;
  const bufferViews = bvOld.map((o) => {
    const v = j.bufferViews[o];
    const pad = (4 - (off % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); off += pad; }
    parts.push(bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength));
    const nv = { ...v, buffer: 0, byteOffset: off };
    off += v.byteLength;
    return nv;
  });
  const newBin = Buffer.concat(parts);

  j.accessors = accOld.map((o) => ({ ...j.accessors[o], ...(j.accessors[o].bufferView != null ? { bufferView: bvMap.get(j.accessors[o].bufferView) } : {}) }));
  j.bufferViews = bufferViews;
  for (const im of j.images || []) if (im.bufferView != null) im.bufferView = bvMap.get(im.bufferView);
  const re = (i) => accMap.get(i);
  for (const m of j.meshes || []) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) p.attributes[k] = re(p.attributes[k]);
    if (p.indices != null) p.indices = re(p.indices);
    (p.targets || []).forEach((t) => { for (const k of Object.keys(t)) t[k] = re(t[k]); });
  }
  for (const s of j.skins || []) if (s.inverseBindMatrices != null) s.inverseBindMatrices = re(s.inverseBindMatrices);
  for (const a of j.animations || []) for (const s of a.samplers) { s.input = re(s.input); s.output = re(s.output); }
  j.buffers = [{ byteLength: newBin.length }];

  // GLB: cabeçalho + JSON (alinhado com espaços) + BIN (alinhado com zeros)
  let jsonBuf = Buffer.from(JSON.stringify(j), 'utf8');
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  const binBuf = newBin.length % 4 ? Buffer.concat([newBin, Buffer.alloc(4 - (newBin.length % 4))]) : newBin;
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([head, jh, jsonBuf, bh, binBuf]);
  fs.writeFileSync(file, out);
  return { file, before: b.length, after: out.length, accessors: `${accOld.length}`, bufferViews: `${bvOld.length}` };
}

for (const f of process.argv.slice(2)) {
  const r = prune(f);
  console.log(`${r.file}: ${(r.before / 1024).toFixed(0)} KB → ${(r.after / 1024).toFixed(0)} KB (${r.accessors} accessors, ${r.bufferViews} bufferViews)`);
}
