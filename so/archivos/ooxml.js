// SO · Documentos Office editables generados en el navegador: DOCX (WordprocessingML) y PPTX (PresentationML),
// con identidad SO (tipografía, acento, jerarquía) y contenido estructurado: títulos, párrafos, métricas y tablas.
// Contenido de entrada (DocSpec): { titulo, subtitulo?, autor?, secciones: [{ titulo, parrafos?: string[],
//   metricas?: [{ label, valor, delta? }], tabla?: { columnas: [{ label, type }], filas: any[][] } }] }
import { zip } from './zip.js';

const X = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const ACENTO = '2A78D6', TINTA = '1B1B1B', SUAVE = '52514E', LINEA = 'D9D8D3', FONDO = 'F1F0EC';
const fmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const celda = (v) => (typeof v === 'number' ? fmt.format(v) : String(v ?? ''));
const deltaTxt = (d) => (d == null ? '' : `${d >= 0 ? '▲' : '▼'} ${fmt.format(Math.abs(d * 100))}%`);
const ahora = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const core = (titulo, autor) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(titulo)}</dc:title><dc:creator>${X(autor || 'SO · Francisco')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${ahora()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${ahora()}</dcterms:modified></cp:coreProperties>`;

// ===================================================================== DOCX
function wP(texto, { estilo = null, negrita = false, color = null, tam = null, alinear = null } = {}) {
  const ppr = estilo || alinear ? `<w:pPr>${estilo ? `<w:pStyle w:val="${estilo}"/>` : ''}${alinear ? `<w:jc w:val="${alinear}"/>` : ''}</w:pPr>` : '';
  const rpr = negrita || color || tam ? `<w:rPr>${negrita ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${tam ? `<w:sz w:val="${tam}"/>` : ''}</w:rPr>` : '';
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${X(texto)}</w:t></w:r></w:p>`;
}

function wTabla(cols, filas) {
  const ancho = Math.floor(9000 / Math.max(1, cols.length));
  const tc = (txt, { cab = false, num = false } = {}) => `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${cab ? `<w:shd w:val="clear" w:color="auto" w:fill="${FONDO}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${num ? '<w:jc w:val="right"/>' : ''}</w:pPr><w:r>${cab ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${X(txt)}</w:t></w:r></w:p></w:tc>`;
  const borde = `<w:top w:val="single" w:sz="4" w:color="${LINEA}"/><w:bottom w:val="single" w:sz="4" w:color="${LINEA}"/><w:insideH w:val="single" w:sz="4" w:color="${LINEA}"/>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>${borde}</w:tblBorders><w:tblLook w:val="04A0" w:firstRow="1"/></w:tblPr>
    <w:tblGrid>${cols.map(() => `<w:gridCol w:w="${ancho}"/>`).join('')}</w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map((c) => tc(c.label, { cab: true, num: c.type === 'number' })).join('')}</w:tr>
    ${filas.map((f) => `<w:tr>${cols.map((c, i) => tc(celda(f[i]), { num: c.type === 'number' })).join('')}</w:tr>`).join('')}</w:tbl>${wP('')}`;
}

export function docx(doc) {
  const cuerpo = [wP(doc.titulo, { estilo: 'Title' })];
  if (doc.subtitulo) cuerpo.push(wP(doc.subtitulo, { estilo: 'Subtitle' }));
  for (const s of doc.secciones || []) {
    if (s.titulo) cuerpo.push(wP(s.titulo, { estilo: 'Heading1' }));
    if (s.metricas?.length) for (const m of s.metricas) cuerpo.push(`<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:color w:val="${SUAVE}"/></w:rPr><w:t xml:space="preserve">${X(m.label)}: </w:t></w:r><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">${X(celda(m.valor))}</w:t></w:r>${m.delta != null ? `<w:r><w:rPr><w:color w:val="${m.delta >= 0 ? '1D7A46' : 'A3141F'}"/></w:rPr><w:t xml:space="preserve">  ${X(deltaTxt(m.delta))}</w:t></w:r>` : ''}</w:p>`);
    for (const p of s.parrafos || []) cuerpo.push(wP(p));
    if (s.tabla?.columnas?.length) cuerpo.push(wTabla(s.tabla.columnas, s.tabla.filas || []));
  }
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${cuerpo.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:color w:val="${TINTA}"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="${TINTA}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:color w:val="${SUAVE}"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="${ACENTO}"/></w:rPr></w:style>
</w:styles>`;
  return zip([
    { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { nombre: '_rels/.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { nombre: 'word/_rels/document.xml.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { nombre: 'word/document.xml', datos: documento },
    { nombre: 'word/styles.xml', datos: estilos },
    { nombre: 'docProps/core.xml', datos: core(doc.titulo, doc.autor) },
  ]);
}

// ===================================================================== PPTX
const EMU = 914400;   // EMU por pulgada; diapositiva 13.333 × 7.5 in (16:9)
const SW = 12192000, SH = 6858000;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function caja(id, nombre, x, y, w, h, parrafos, { anclaje = 't' } = {}) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${X(nombre)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anclaje}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${parrafos}</p:txBody></p:sp>`;
}
const aP = (t, { tam = 1800, negrita = false, color = TINTA, vineta = false, espacio = 600 } = {}) =>
  `<a:p><a:pPr${vineta ? ' marL="285750" indent="-285750"' : ''}><a:spcBef><a:spcPts val="${espacio}"/></a:spcBef>${vineta ? `<a:buClr><a:srgbClr val="${ACENTO}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>'}</a:pPr><a:r><a:rPr lang="es-AR" sz="${tam}" b="${negrita ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${X(t)}</a:t></a:r></a:p>`;
const barra = (id) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Acento"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${0.6 * EMU}" y="${0.55 * EMU}"/><a:ext cx="${0.6 * EMU}" cy="${0.06 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${ACENTO}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;

function tablaPptx(id, cols, filas, y0) {
  const w = SW - 1.2 * EMU, colW = Math.floor(w / cols.length), filaH = Math.round(0.36 * EMU);
  const tc = (t, { cab = false, num = false } = {}) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${num ? 'r' : 'l'}"/><a:r><a:rPr lang="es-AR" sz="1200" b="${cab ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${TINTA}"/></a:solidFill></a:rPr><a:t>${X(String(t).slice(0, 40))}</a:t></a:r></a:p></a:txBody>
<a:tcPr marL="72000" marR="72000" marT="36000" marB="36000"><a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="${LINEA}"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="${LINEA}"/></a:solidFill></a:lnB>${cab ? `<a:solidFill><a:srgbClr val="${FONDO}"/></a:solidFill>` : '<a:noFill/>'}</a:tcPr></a:tc>`;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Tabla"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${0.6 * EMU}" y="${y0}"/><a:ext cx="${colW * cols.length}" cy="${filaH * (filas.length + 1)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>
<a:tblGrid>${cols.map(() => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>
<a:tr h="${filaH}">${cols.map((c) => tc(c.label, { cab: true, num: c.type === 'number' })).join('')}</a:tr>
${filas.map((f) => `<a:tr h="${filaH}">${cols.map((c, i) => tc(celda(f[i]), { num: c.type === 'number' })).join('')}</a:tr>`).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

const slideXml = (formas) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${formas}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

/** Arma las diapositivas a partir del DocSpec: portada + una por sección (tablas largas se parten, sin desbordes). */
export function diapositivas(doc) {
  const out = [{ portada: true, titulo: doc.titulo, subtitulo: doc.subtitulo || '' }];
  for (const s of doc.secciones || []) {
    const lineas = [...(s.metricas || []).map((m) => `${m.label}: ${celda(m.valor)}${m.delta != null ? `  ${deltaTxt(m.delta)}` : ''}`), ...(s.parrafos || [])].map((t) => String(t).slice(0, 160));
    if (lineas.length || !s.tabla) for (let i = 0; i < Math.max(1, lineas.length); i += 6) out.push({ titulo: s.titulo + (i ? ' (cont.)' : ''), lineas: lineas.slice(i, i + 6) });
    if (s.tabla?.columnas?.length) {
      const cols = s.tabla.columnas.slice(0, 6), filas = (s.tabla.filas || []).map((f) => f.slice(0, 6));
      for (let i = 0; i < Math.max(1, filas.length) && i < 120; i += 10) out.push({ titulo: s.titulo + (i ? ' (cont.)' : ''), tabla: { columnas: cols, filas: filas.slice(i, i + 10) } });
    }
  }
  return out;
}

export function pptx(doc) {
  const ds = diapositivas(doc);
  const slides = ds.map((d, i) => {
    if (d.portada) return slideXml(barra(2) + caja(3, 'Título', 0.6 * EMU, 2.3 * EMU, SW - 1.2 * EMU, 1.4 * EMU, aP(d.titulo, { tam: 4000, negrita: true, espacio: 0 }), { anclaje: 'b' })
      + caja(4, 'Subtítulo', 0.6 * EMU, 3.9 * EMU, SW - 1.2 * EMU, 1.0 * EMU, aP(d.subtitulo, { tam: 2000, color: SUAVE, espacio: 0 })));
    const tit = caja(3, 'Título', 0.6 * EMU, 0.8 * EMU, SW - 1.2 * EMU, 0.8 * EMU, aP(d.titulo, { tam: 2800, negrita: true, espacio: 0 }), { anclaje: 'b' });
    const pie = caja(9, 'Pie', 0.6 * EMU, 6.9 * EMU, SW - 1.2 * EMU, 0.35 * EMU, aP(`${doc.titulo} · ${i + 1}`, { tam: 1000, color: SUAVE, espacio: 0 }));
    const cuerpo = d.tabla ? tablaPptx(5, d.tabla.columnas, d.tabla.filas, 1.9 * EMU)
      : caja(4, 'Contenido', 0.6 * EMU, 1.9 * EMU, SW - 1.2 * EMU, 4.7 * EMU, d.lineas.length ? d.lineas.map((l) => aP(l, { tam: 2000, vineta: true })).join('') : aP('—', { tam: 2000 }));
    return slideXml(barra(2) + tit + cuerpo + pie);
  });
  const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="En blanco"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const tema = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SO"><a:themeElements>
<a:clrScheme name="SO"><a:dk1><a:srgbClr val="${TINTA}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${SUAVE}"/></a:dk2><a:lt2><a:srgbClr val="${FONDO}"/></a:lt2>
<a:accent1><a:srgbClr val="${ACENTO}"/></a:accent1><a:accent2><a:srgbClr val="EB6834"/></a:accent2><a:accent3><a:srgbClr val="1BAF7A"/></a:accent3><a:accent4><a:srgbClr val="EDA100"/></a:accent4><a:accent5><a:srgbClr val="6250D6"/></a:accent5><a:accent6><a:srgbClr val="E34948"/></a:accent6>
<a:hlink><a:srgbClr val="${ACENTO}"/></a:hlink><a:folHlink><a:srgbClr val="6250D6"/></a:folHlink></a:clrScheme>
<a:fontScheme name="SO"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="SO"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const rels = (items) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, tipo, destino]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}"/>`).join('')}</Relationships>`;
  const entradas = [
    { nombre: '[Content_Types].xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { nombre: '_rels/.rels', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { nombre: 'ppt/presentation.xml', datos: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${SW}" cy="${SH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>` },
    { nombre: 'ppt/_rels/presentation.xml.rels', datos: rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${i + 3}`, 'slide', `slides/slide${i + 1}.xml`])]) },
    { nombre: 'ppt/slideMasters/slideMaster1.xml', datos: master },
    { nombre: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', datos: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
    { nombre: 'ppt/slideLayouts/slideLayout1.xml', datos: layout },
    { nombre: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', datos: rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
    { nombre: 'ppt/theme/theme1.xml', datos: tema },
    ...slides.flatMap((x, i) => [{ nombre: `ppt/slides/slide${i + 1}.xml`, datos: x }, { nombre: `ppt/slides/_rels/slide${i + 1}.xml.rels`, datos: rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]) }]),
    { nombre: 'docProps/core.xml', datos: core(doc.titulo, doc.autor) },
  ];
  return zip(entradas);
}
