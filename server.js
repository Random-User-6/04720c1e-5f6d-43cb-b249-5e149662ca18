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

const vizInstance = new Viz({ Module, render }); // Shared instance

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
      <style>
        .file-list { list-style-type: none; padding-left: 0; }
        .file-list li { margin: 5px 0; }
      </style>
    </head>
    <body>
      <h1>Processed Files</h1>

      <div>
        <button onclick="selectAll()">Select All</button>
        <button onclick="selectNone()">Select None</button>
      </div>
      <div>
        <button onclick="downloadSelected('svg')">Download Selected as SVG</button>
        <button onclick="downloadSelected('png')">Download Selected as PNG</button>
      </div>
      <ul class="file-list">
        ${results.map(result => {
          if (result.error) {
            return `<li>${result.name}: Error - ${result.error}</li>`;
          }
          return `
            <li>
              <input type="checkbox" class="dl-check" data-path="${result.svgPath}" />
              <a href="${result.svgPath}" target="_blank">${result.name}</a>
            </li>
          `;
        }).join('')}
      </ul>
      <form action="/" method="get">
        <button type="submit">Upload More</button>
      </form>
      <script>
        async function downloadSelected(type) {
          const boxes = Array.from(document.querySelectorAll('.dl-check:checked'));
          if (boxes.length === 0) return alert('No files selected.');

          for (const box of boxes) {
            const url = box.getAttribute('data-path');
            const filename = url.split('/').pop().replace(/\.svg$/, type === 'svg' ? '.svg' : '.png');
            try {
              const res = await fetch(url);
              const data = await res.text();

              if (type === 'svg') {
                const blob = new Blob([data], { type: 'image/svg+xml' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              } else if (type === 'png') {
                const img = new Image();
                const svgBlob = new Blob([data], { type: 'image/svg+xml' });
                const urlObj = URL.createObjectURL(svgBlob);

                await new Promise((resolve, reject) => {
                  img.onload = () => {
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
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      resolve();
                    }, 'image/png');
                  };
                  img.onerror = reject;
                  img.src = urlObj;
                });
              }
            } catch (err) {
              console.error('Download failed:', err);
            }
          }
        }

        function selectAll() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = true);
        }

        function selectNone() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = false);
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// async function parseAndRenderXML(xml, outputPath, format = 'svg') {
//   try {
//     const result = await parseStringPromise(xml);
//     if (!result?.ivrScript?.modules?.[0]) {
//       throw new Error("Invalid or unsupported IVR XML structure: 'ivrScript.modules[0]' missing");
//     }
//     const modules = result.ivrScript.modules[0];

//     let dot = 'digraph G {\n  node [shape=box, style=filled, fillcolor="#f9f9f9", fontname="Arial"];\n';
//     const idToLabel = {};
//     const edgeMap = new Map();

//     const addEdge = (from, to, label = '', style = '') => {
//       const key = `${from}->${to}`;
//       if (!edgeMap.has(key)) {
//         edgeMap.set(key, new Set());
//       }
//       edgeMap.get(key).add(JSON.stringify({ label, style }));
//     };

//     for (const modType in modules) {
//       for (const mod of modules[modType]) {
//         const id = mod.moduleId?.[0];
//         const name = mod.moduleName?.[0] || modType;
//         if (!id) continue;

//         const displayName = name.replace(/"/g, '');
//         const tagLabel = modType;
//         idToLabel[id] = `${tagLabel}\\n${displayName}`;

//         (mod.ascendants || []).forEach(asc => {
//           if (typeof asc === 'string') addEdge(asc, id);
//         });

//         if (mod.singleDescendant?.[0]) {
//           addEdge(id, mod.singleDescendant[0]);
//         }

//         if (mod.exceptionalDescendant?.[0]) {
//           addEdge(id, mod.exceptionalDescendant[0], 'EXCEPTION', 'color="red", fontcolor="red", style="dashed", penwidth=2');
//         }

//         if (modType === 'ifElse') {
//           const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
//           for (const entry of entries) {
//             const key = entry.key?.[0];
//             const desc = entry.value?.[0]?.desc?.[0];
//             if (key && desc) {
//               addEdge(id, desc, key.toUpperCase());
//             }
//           }
//         }

//         // if (modType === 'case') {
//         if (modType === 'case' || modType === 'menu') {
//           const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
//           for (const entry of entries) {
//             const names = entry.value?.[0]?.name || [];
//             const descs = entry.value?.[0]?.desc || [];
//             for (let i = 0; i < descs.length; i++) {
//               const label = names[i] || names[0] || '';
//               const desc = descs[i];
//               if (label && desc) {
//                 addEdge(id, desc, label);
//               }
//             }
//           }
//         }
//       }
//     }

//     for (const [id, label] of Object.entries(idToLabel)) {
//       const safeLabel = label.replace(/"/g, '\\"');
//       dot += `  "${id}" [label="${safeLabel}"];\n`;
//     }

//     for (const [key, valueSet] of edgeMap.entries()) {
//       const [from, to] = key.split('->');
//       let labels = [];
//       let styles = new Set();

//       for (const item of valueSet) {
//         const { label, style } = JSON.parse(item);
//         if (label) labels.push(label);
//         if (style) styles.add(style);
//       }

//       const attrs = [];
//       if (labels.length) attrs.push(`label="${labels.join(' / ')}"`);
//       for (const style of styles) {
//         attrs.push(style);
//       }

//       const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
//       dot += `  "${from}" -> "${to}"${attrString};\n`;
//     }

//     dot += '}';

//     if (format === 'dot') {
//       fs.writeFileSync(outputPath, dot, 'utf8');
//     } else if (format === 'svg') {
//       const svg = await vizInstance.renderString(dot);
//       fs.writeFileSync(outputPath, svg, 'utf8');
//     } else {
//       throw new Error(`Unsupported format: ${format}`);
//     }
//   } catch (err) {
//     console.error("parseAndRenderXML failed:", err);
//     throw err;
//   }
// }
async function parseAndRenderXML(xml, outputPath, format = 'svg') {
  try {
    const result = await parseStringPromise(xml);
    // const modules = result.ivrScript?.modules?.[0]?.module || [];
    const allModules = result.ivrScript.modules[0];
const modules = [];

for (const modType in allModules) {
  for (const mod of allModules[modType]) {
    mod.$ = {
      id: mod.moduleId?.[0],
      name: mod.moduleName?.[0],
      modType
    };
    modules.push(mod);
  }
}


    const edges = parseModules(modules);
    const idToLabel = {};
    const edgeMap = new Map();

    for (const mod of modules) {
      const id = mod.$?.id;
      const name = mod.$?.name || mod.$?.modType || 'Module';
      if (!id) continue;
      const label = `${mod.$?.modType}\\n${name}`.replace(/"/g, '');
      idToLabel[id] = label;
    }

    for (const edge of edges) {
      const key = `${edge.from}->${edge.to}`;
      if (!edgeMap.has(key)) edgeMap.set(key, new Set());
      edgeMap.get(key).add(JSON.stringify({ label: edge.label }));
    }

    let dot = 'digraph G {\n  node [shape=box, style=filled, fillcolor="#f9f9f9", fontname="Arial"];\n';

    for (const [id, label] of Object.entries(idToLabel)) {
      const safeLabel = label.replace(/"/g, '\\"');
      dot += `  "${id}" [label="${safeLabel}"];\n`;
    }

    for (const [key, valueSet] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      let labels = [];
      for (const item of valueSet) {
        const { label } = JSON.parse(item);
        if (label) labels.push(label);
      }

      const attrs = [];
      if (labels.length) attrs.push(`label="${labels.join(' / ')}"`);

      // If EXCEPTION label, use red style
      if (labels.includes('EXCEPTION')) {
        attrs.push('color="red"', 'fontcolor="red"', 'style="dashed"', 'penwidth=2');
      }

      const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
      dot += `  "${from}" -> "${to}"${attrString};\n`;
    }

    dot += '}';

    if (format === 'dot') {
      fs.writeFileSync(outputPath, dot, 'utf8');
    } else if (format === 'svg') {
      const svg = await vizInstance.renderString(dot);
      fs.writeFileSync(outputPath, svg, 'utf8');
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (err) {
    console.error("parseAndRenderXML failed:", err);
    throw err;
  }
}

// Full IVR Module Parser with Dynamic Connection Handling

function parseModules(modules) {
  const edges = [];

  for (const mod of modules) {
    const modType = mod.$?.modType;
    const modId = mod.$?.id;
    const data = mod.data;

    if (!modType || !modId) continue;

    switch (modType) {
      case 'menu':
      case 'case':
        extractBranches(modId, data, edges);
        break;

      case 'play':
      case 'getDigits':
      case 'recording':
      case 'language':
        extractSingle(modId, data, edges);
        break;

      case 'thirdPartyTransfer':
      case 'voiceMailTransfer':
      case 'agentTransfer':
      case 'skillTransfer':
      case 'conference':
        extractSingle(modId, data, edges);
        extractException(modId, data, edges);
        break;

      case 'hangup':
case 'incomingCall':
  extractSingle(modId, data, edges);
  extractException(modId, data, edges);
  extractBranches(modId, data, edges);
  break;


      default:
        // Unknown or unsupported module type
        break;
    }
  }

  return edges;
}

function extractBranches(id, data, edges) {
  const entries = data?.[0]?.branches?.[0]?.entry || [];
  for (const entry of entries) {
    const value = entry.value?.[0];
    const name = value?.name?.[0] || '';
    const desc = value?.desc?.[0];
    if (desc) {
      edges.push({ from: id, to: desc, label: name });
    }
  }
}

function extractSingle(id, data, edges) {
  const target = data?.[0]?.singleDescendant?.[0];
  if (target) {
    edges.push({ from: id, to: target, label: '' });
  }
}

function extractException(id, data, edges) {
  const target = data?.[0]?.exceptionalDescendant?.[0];
  if (target) {
    edges.push({ from: id, to: target, label: 'EXCEPTION' });
  }
}

module.exports = {
  parseModules
};


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
