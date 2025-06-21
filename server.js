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
  const format = req.body.format || 'svg';

  if (!req.files || !Array.isArray(req.files)) {
    return res.send("Error - No files uploaded or multer failed to parse 'ivrfiles'.");
  }

  for (const file of req.files) {
    try {
      console.log("Processing file:", file.originalname);
      const xml = fs.readFileSync(file.path, 'utf8');
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const extension = format === 'dot' ? 'dot' : 'svg';
      const outputFilename = `${file.originalname}_${timestamp}.${extension}`;
      const outputPath = `public/${outputFilename}`;
      await parseAndRenderXML(xml, outputPath, format);

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
      <title>Processed Files</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Processed Files</h1>
      $1</ul>
      <div>
        <button onclick="selectAll()">Select All</button>
        <button onclick="selectNone()">Select None</button>
      </div>
      <div>
        <button onclick="downloadSelected('svg')">Download Selected as SVG</button>
        <button onclick="downloadSelected('png')">Download Selected as PNG</button>
      </div>
      <form action="/" method="get">
        <button type="submit">Upload More</button>
      </form>
      <script>
        function downloadSelected(type) {
          const boxes = document.querySelectorAll('.dl-check:checked');
          if (boxes.length === 0) return alert('No files selected.');
          boxes.forEach(box => {
            const url = box.getAttribute('data-path');
            const filename = url.split('/').pop().replace(/\.svg$/, type === 'svg' ? '.svg' : '.png');
            fetch(url)
              .then(res => res.text())
              .then(data => {
                if (type === 'svg') {
                  const blob = new Blob([data], { type: 'image/svg+xml' });
                  const link = document.createElement('a');
                  link.href = URL.createObjectURL(blob);
                  link.download = filename;
                  link.click();
                } else if (type === 'png') {
                  const img = new Image();
                  const svgBlob = new Blob([data], { type: 'image/svg+xml' });
                  const urlObj = URL.createObjectURL(svgBlob);
                  img.onload = function () {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(urlObj);
                    canvas.toBlob(blob => {
                      const link = document.createElement('a');
                      link.href = URL.createObjectURL(blob);
                      link.download = filename;
                      link.click();
                    }, 'image/png');
                  };
                  img.src = urlObj;
                }
              });
          });
        }
              function selectAll() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = true);
        }

        function selectNone() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = false);
        }
      </script>
        function downloadAs(type) {
          const link = document.createElement('a');
          const svg = document.querySelector('object, embed, iframe, img[src$=".svg"], a[href$=".svg"]');
          if (!svg) return alert('No SVG found to convert.');
          fetch(svg.href || svg.src || svg.getAttribute('href'))
            .then(res => res.text())
            .then(data => {
              if (type === 'svg') {
                const blob = new Blob([data], { type: 'image/svg+xml' });
                link.href = URL.createObjectURL(blob);
                link.download = 'graph.svg';
                link.click();
              } else if (type === 'png') {
                const img = new Image();
                const svgBlob = new Blob([data], { type: 'image/svg+xml' });
                const url = URL.createObjectURL(svgBlob);
                img.onload = function() {
                  const canvas = document.createElement('canvas');
                  canvas.width = img.width;
                  canvas.height = img.height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                  URL.revokeObjectURL(url);
                  canvas.toBlob(blob => {
                    link.href = URL.createObjectURL(blob);
                    link.download = 'graph.png';
                    link.click();
                  }, 'image/png');
                };
                img.src = url;
              }
            });
        }
      </script>
    </body>
    </html>
    `;
  res.send(html);
});

async function parseAndRenderXML(xml, outputPath, format = 'svg') {
  try {
    const result = await parseStringPromise(xml);
    if (!result?.ivrScript?.modules?.[0]) {
      throw new Error("Invalid or unsupported IVR XML structure: 'ivrScript.modules[0]' missing");
    }
    const modules = result.ivrScript.modules[0];

    let dot = 'digraph G {\n  rankdir=LR;\n  node [shape=box, style=filled, fillcolor="#f9f9f9", fontname="Arial"];\n';
    const idToLabel = {};
    const edgeMap = new Map();

    const addEdge = (from, to, label = '', style = '') => {
      const key = `${from}->${to}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, new Set());
      }
      edgeMap.get(key).add(JSON.stringify({ label, style }));
    };

    for (const modType in modules) {
      for (const mod of modules[modType]) {
        const id = mod.moduleId?.[0];
        const name = mod.moduleName?.[0] || modType;
        if (!id) continue;

        const displayName = name.replace(/"/g, '');
        const tagLabel = modType;
        idToLabel[id] = `${tagLabel}\\n${displayName}`;

        (mod.ascendants || []).forEach(asc => {
          if (typeof asc === 'string') addEdge(asc, id);
        });

        if (mod.singleDescendant?.[0]) {
          addEdge(id, mod.singleDescendant[0]);
        }

        if (mod.exceptionalDescendant?.[0]) {
          addEdge(id, mod.exceptionalDescendant[0], 'Exception', 'color="red", fontcolor="red", style="dashed", penwidth=2');
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
      const safeLabel = label.replace(/"/g, '\\"');
      dot += `  "${id}" [label="${safeLabel}"];
`;
    }

    for (const [key, valueSet] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      let labels = [];
      let styles = new Set();

      for (const item of valueSet) {
        const { label, style } = JSON.parse(item);
        if (label) labels.push(label);
        if (style) styles.add(style);
      }

      const attrs = [];
      if (labels.length) attrs.push(`label="${labels.join(' / ')}"`);
      for (const style of styles) {
        attrs.push(style);
      }

      const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
      dot += `  "${from}" -> "${to}"${attrString};
`;
    }

    dot += '}';

    if (format === 'dot') {
      fs.writeFileSync(outputPath, dot, 'utf8');
    } else if (format === 'svg') {
      const viz = new Viz({ Module, render });
      const svg = await viz.renderString(dot);
      fs.writeFileSync(outputPath, svg, 'utf8');
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (err) {
    console.error("parseAndRenderXML failed:", err);
    throw err;
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
