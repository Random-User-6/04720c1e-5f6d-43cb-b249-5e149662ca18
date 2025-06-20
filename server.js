// Required packages:
// npm install express multer xml2js viz.js

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const Viz = require('viz.js');
const { Module, render } = require('viz.js/full.render.js');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.post('/upload', upload.array('ivrfiles'), async (req, res) => {
  const results = [];

  if (!req.files || !Array.isArray(req.files)) {
    return res.send("Error - No files uploaded or multer failed to parse 'ivrfiles'.");
  }

  for (const file of req.files) {
    try {
      console.log("Processing file:", file.originalname);
      const xml = fs.readFileSync(file.path, 'utf8');
      const timestamp = Date.now();
      const outputFilename = `${file.originalname}_${timestamp}.svg`;
      const outputPath = `public/${outputFilename}`;
      await parseAndRenderXML(xml, outputPath);
      results.push({ name: file.originalname, svgPath: `/${outputFilename}` });
    } catch (e) {
      console.error('Error in parseAndRenderXML:', e);
      results.push({ name: file.originalname || file.filename, error: e.message });
    } finally {
      fs.unlinkSync(file.path);
    }
  }

  let html = '<h1>Processed Files</h1><ul>';
  for (const result of results) {
    if (result.error) {
      html += `<li>${result.name}: Error - ${result.error}</li>`;
    } else {
      html += `<li><a href="${result.svgPath}" target="_blank">${result.name}</a></li>`;
    }
  }
  html += '</ul><a href="/">Upload More</a>';

  res.send(html);
});

async function parseAndRenderXML(xml, outputPath) {
  try {
    const result = await parseStringPromise(xml);
    if (!result?.ivrScript?.modules?.[0]) {
      throw new Error("Invalid or unsupported IVR XML structure: 'ivrScript.modules[0]' missing");
    }
    const modules = result.ivrScript.modules[0];

    let dot = 'digraph G {\n  node [shape=box];\n';
    const idToLabel = {};
    const edgeMap = new Map();

    const addEdge = (from, to, label = '') => {
      const key = `${from}->${to}`;
      if (!edgeMap.has(key)) edgeMap.set(key, new Set());
      edgeMap.get(key).add(label || '');
    };

    for (const modType in modules) {
      for (const mod of modules[modType]) {
        const id = mod.moduleId?.[0];
        const name = mod.moduleName?.[0] || modType;idToLabel
        if (!id) continue;

        const displayName = name.replace(/"/g, '');
        const tagLabel = modType;
        /* idToLabel[id] = `<<${tagLabel}>>\\n${displayName}`;*/
        // idToLabel[id] = `<
        //   <TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0">
        //     <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="10" FACE="sans-serif">&lt;${tagLabel}&gt;</FONT></TD></TR>
        //     <TR><TD ALIGN="LEFT"><FONT FACE="sans-serif">${displayName}</FONT></TD></TR>
        //   </TABLE>
        // >`;
        const safeDisplayName = displayName.replace(/[<>&"]/g, s => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[s]
));

const escapeHTML = str =>
  str.replace(/[<>&"]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[s]));

const safeName = escapeHTML(displayName);
const safeTag = escapeHTML(tagLabel);

idToLabel[id] = `<
  <TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="6">
    <TR><TD ALIGN="LEFT" PORT="tag" FIXEDSIZE="FALSE"><FONT POINT-SIZE="10" FACE="sans-serif">&lt;${safeTag}&gt;</FONT></TD></TR>
    <TR><TD ALIGN="LEFT" PORT="name" FIXEDSIZE="FALSE"><FONT FACE="sans-serif">${safeName}</FONT></TD></TR>
  </TABLE>
>`;



        (mod.ascendants || []).forEach(asc => {
          addEdge(asc, id);
        });

        if (mod.singleDescendant?.[0]) {
          addEdge(id, mod.singleDescendant[0]);
        }

        if (modType === 'ifElse') {
          const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
          for (const entry of entries) {
            const key = entry.key?.[0];
            const desc = entry.value?.[0]?.desc?.[0];
            if (key && desc) {
              addEdge(id, desc, key.toUpperCase());
            }
          }
        }

        if (modType === 'case') {
          const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
          for (const entry of entries) {
            const names = entry.value?.[0]?.name || [];
            const descs = entry.value?.[0]?.desc || [];
            for (let i = 0; i < descs.length; i++) {
              const label = names[i] || names[0] || '';
              const desc = descs[i];
              if (label && desc) {
                addEdge(id, desc, label);
              }
            }
          }
        }
      }
    }

    for (const [id, label] of Object.entries(idToLabel)) {
      if (label.trim().startsWith('<')) {
        // HTML-like label, no quotes
        dot += `  "${id}" [label=${label}];\n`;
      } else {
        // Plain text label, escape double quotes
        const safeLabel = label.replace(/"/g, '\\"');
        dot += `  "${id}" [label="${safeLabel}"];\n`;
      }
    }


    for (const [key, labels] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      const labelArr = Array.from(labels).filter(Boolean);
      const attrs = labelArr.length ? [`label=\"${labelArr.join(' / ')}\"`] : [];
      const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
      dot += `  "${from}" -> "${to}"${attrString};\n`;
    }

    dot += '}';

    const viz = new Viz({ Module, render });
    const svg = await viz.renderString(dot);
    fs.writeFileSync(outputPath, svg, 'utf8');
  } catch (err) {
    console.error("parseAndRenderXML failed:", err);
    throw err;
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
