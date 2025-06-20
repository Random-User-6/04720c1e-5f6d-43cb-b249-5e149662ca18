// Required packages:
// npm install express multer xml2js viz.js fs

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parseStringPromise } = require('xml2js');
const { render } = require('viz.js/full.render.js');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 3000;

/**/
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
/**/
app.use(express.static('public'));

// Serve upload form
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Handle file uploads
app.post('/upload', upload.array('ivrfiles'), async (req, res) => {
  const results = [];

  if (!req.files || !Array.isArray(req.files)) {
    return res.send("No files uploaded or req.files is not an array.");
  }

  for (const file of req.files) {
    try {
      console.log("Processing file:", file.originalname);
      const xml = fs.readFileSync(file.path, 'utf8');
      const outputPath = `public/${file.originalname}.svg`;
      await parseAndRenderXML(xml, outputPath);
      results.push({ name: file.originalname, svgPath: `/${file.originalname}.svg` });
    } catch (e) {
      results.push({ name: file.originalname || file.filename, error: e.message });
    } finally {
      fs.unlinkSync(file.path); // Clean up temp file
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


// XML parsing and SVG rendering logic
async function parseAndRenderXML(xml, outputPath) {
  const result = await parseStringPromise(xml);
  const modules = result.ivrScript.modules?.[0] || {};

  let dot = 'digraph G {\n  node [shape=box];\n';
  const idToLabel = {};
  const edges = [];

  for (const modType in modules) {
    for (const mod of modules[modType]) {
      const id = mod.moduleId?.[0];
      const name = mod.moduleName?.[0] || modType;
      if (!id) continue;
      idToLabel[id] = name.replace(/"/g, '');

      (mod.ascendants || []).forEach(asc => {
        edges.push({ from: asc, to: id });
      });

      if (mod.singleDescendant?.[0]) {
        edges.push({ from: id, to: mod.singleDescendant[0] });
      }

      if (modType === 'ifElse') {
        const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
        for (const entry of entries) {
          const key = entry.key?.[0];
          const desc = entry.value?.[0]?.desc?.[0];
          if (key && desc) {
            edges.push({ from: id, to: desc, label: key.toUpperCase(), color: key.toUpperCase() === 'FALSE' ? 'red' : 'green' });
          }
        }
      }

      if (modType === 'case') {
        const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
        for (const entry of entries) {
          const name = entry.value?.[0]?.name?.[0];
          const desc = entry.value?.[0]?.desc?.[0];
          if (name && desc) {
            edges.push({ from: id, to: desc, label: name, color: name.toLowerCase() === 'no match' ? 'red' : 'green' });
          }
        }
      }
    }
  }

  for (const [id, label] of Object.entries(idToLabel)) {
    dot += `  "${id}" [label="${label}"];\n`;
  }

  for (const edge of edges) {
    const attrs = [];
    if (edge.label) attrs.push(`label=\"${edge.label}\"`);
    if (edge.color) attrs.push(`color=${edge.color}`);
    const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
    dot += `  "${edge.from}" -> "${edge.to}"${attrString};\n`;
  }

  dot += '}';
  const svg = await render(dot);
  fs.writeFileSync(outputPath, svg, 'utf8');
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
