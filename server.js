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
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IVR Flowchart Generator</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 0;
      padding: 0;
      background: #f4f4f4;
      color: #333;
    }
    .container {
      max-width: 900px;
      margin: auto;
      padding: 2rem;
      background: white;
      margin-top: 3rem;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    h1 {
      text-align: center;
    }
    form {
      text-align: center;
      margin-top: 2rem;
    }
    input[type="file"] {
      display: block;
      margin: 1rem auto;
    }
    button {
      background-color: #007bff;
      color: white;
      padding: 0.5rem 1.5rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background-color: #0056b3;
    }
    ul {
      list-style-type: none;
      padding: 0;
    }
    li {
      padding: 0.5rem;
    }
    a {
      color: #007bff;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>IVR Flowchart Generator</h1>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="ivrfiles" multiple required>
      <button type="submit">Upload and Generate</button>
    </form>
  </div>
</body>
</html>
`);
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

  let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Upload Results</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f9f9f9; }
    h1 { text-align: center; }
    .container { max-width: 800px; margin: auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    ul { list-style-type: none; padding: 0; }
    li { padding: 0.5rem 0; }
    a { color: #007bff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .back-link { display: block; margin-top: 2rem; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Processed Files</h1>
    <ul>
`;
  for (const result of results) {
    if (result.error) {
      html += `<li>${result.name}: Error - ${result.error}</li>`;
    } else {
      html += `<li><a href="${result.svgPath}" target="_blank">${result.name}</a></li>`;
    }
  }
  html += `
    </ul>
    <div class="back-link">
      <a href="/">Upload More</a>
    </div>
  </div>
</body>
</html>
`;

  res.send(html);
});

// === PATCH NODE LABEL HANDLING ===

async function parseAndRenderXML(xml, outputPath) {
  const result = await parseStringPromise(xml);
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
      const name = mod.moduleName?.[0] || modType;
      if (!id) continue;

      const displayName = name.replace(/"/g, '');
      const tagLabel = modType;

      idToLabel[id] = `
        <
        <TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0">
          <TR><TD ALIGN="LEFT"><FONT POINT-SIZE="10" FACE="sans-serif">&lt;${tagLabel}&gt;</FONT></TD></TR>
          <TR><TD ALIGN="LEFT"><FONT FACE="sans-serif">${displayName}</FONT></TD></TR>
        </TABLE>
        >`;

      (mod.ascendants || []).forEach(asc => addEdge(asc, id));
      if (mod.singleDescendant?.[0]) addEdge(id, mod.singleDescendant[0]);

      if (modType === 'ifElse') {
        const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
        for (const entry of entries) {
          const key = entry.key?.[0];
          const desc = entry.value?.[0]?.desc?.[0];
          if (key && desc) addEdge(id, desc, key.toUpperCase());
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
            if (label && desc) addEdge(id, desc, label);
          }
        }
      }
    }
  }

  for (const [id, label] of Object.entries(idToLabel)) {
    dot += `  "${id}" [label=${label}];\n`;
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
}
