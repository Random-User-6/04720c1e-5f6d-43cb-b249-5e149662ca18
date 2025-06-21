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
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
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
      <title>Processed Files</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
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
        <form action="/" method="get">
          <button type="submit">Upload More</button>
        </form>
    </body>
    </html>
    `;
  res.send(html);
});

// async function parseAndRenderXML(xml, outputPath) {
//   try {
//     const result = await parseStringPromise(xml);
//     if (!result?.ivrScript?.modules?.[0]) {
//       throw new Error("Invalid or unsupported IVR XML structure: 'ivrScript.modules[0]' missing");
//     }
//     const modules = result.ivrScript.modules[0];

//     let dot = 'digraph G {\n  node [shape=box];\n';
//     const idToLabel = {};
//     const edgeMap = new Map();

// const addEdge = (from, to, label = '', style = '') => {
//   const key = `${from}->${to}`;
//   if (!edgeMap.has(key)) {
//     edgeMap.set(key, new Set());
//   }
//   edgeMap.get(key).add(JSON.stringify({ label, style }));
// };

  
//     for (const modType in modules) {
//       for (const mod of modules[modType]) {
//         const id = mod.moduleId?.[0];
//         const name = mod.moduleName?.[0] || modType;idToLabel
//         if (!id) continue;

//         const displayName = name.replace(/"/g, '');
//         const tagLabel = modType;
//         idToLabel[id] = `${tagLabel}\\n${displayName}`;
        
//         (mod.ascendants || []).forEach(asc => {
//           addEdge(asc, id);
//         });

//         if (mod.singleDescendant?.[0]) {
//           addEdge(id, mod.singleDescendant[0]);
//         }

//         // if (mod.exceptionalDescendant?.[0]) {
//         //   addEdge(id, mod.exceptionalDescendant[0], 'Exception');
//         // }
//         if (mod.exceptionalDescendant?.[0]) {
//   addEdge(id, mod.exceptionalDescendant[0], 'Exception', 'color="red"');
// }


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
        
//         if (modType === 'case') {
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
//   const [from, to] = key.split('->');
//   let labels = [];
//   let styles = new Set();

//   for (const item of valueSet) {
//     const { label, style } = JSON.parse(item);
//     if (label) labels.push(label);
//     if (style) styles.add(style);
//   }

//   const attrs = [];
//   if (labels.length) attrs.push(`label="${labels.join(' / ')}"`);
//   for (const style of styles) {
//     attrs.push(style);
//   }

//   const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
//   dot += `  "${from}" -> "${to}"${attrString};\n`;
// }

    
//     dot += '}';

//     const viz = new Viz({ Module, render });
//     const svg = await viz.renderString(dot);
//     fs.writeFileSync(outputPath, svg, 'utf8');
//   } catch (err) {
//     console.error("parseAndRenderXML failed:", err);
//     throw err;
//   }
// }
async function parseAndRenderXML(xml, outputPath) {
  const result = await parseStringPromise(xml);
  const modules = result.ivrScript.modules?.[0];
  if (!modules) throw new Error("No modules found.");

  let dot = `
digraph G {
  rankdir=LR;
  ranksep=0.75;
  nodesep=0.5;
  node [shape=box, style=filled, fillcolor="#f9f9f9", fontname="Arial"];
  edge [fontname="Arial"];
`;

  const idToLabel = {};
  const idToPosition = {};
  const edges = [];

  const addEdge = (from, to, label = '', style = '') => {
    edges.push({ from, to, label, style });
  };

  for (const modType in modules) {
    for (const mod of modules[modType]) {
      const id = mod.moduleId?.[0];
      const name = mod.moduleName?.[0] || modType;
      const x = mod.locationX?.[0];
      const y = mod.locationY?.[0];

      if (!id) continue;

      idToLabel[id] = `${modType}\\n${name}`;
      if (x && y) idToPosition[id] = `${x},${y}!`;

      if (mod.singleDescendant?.[0])
        addEdge(id, mod.singleDescendant[0]);

      if (mod.exceptionalDescendant?.[0])
        addEdge(id, mod.exceptionalDescendant[0], 'Exception', 'color="red", fontcolor="red", penwidth=2, style="dashed"');

      (mod.ascendants || []).forEach(asc => {
        if (typeof asc === 'string') addEdge(asc, id);
        else if (asc._) addEdge(asc._, id);
      });

      if (modType === 'ifElse' || modType === 'case') {
        const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
        for (const entry of entries) {
          const key = entry.key?.[0];
          const value = entry.value?.[0];
          if (!value) continue;

          if (modType === 'ifElse') {
            const desc = value.desc?.[0];
            if (desc) addEdge(id, desc, key?.toUpperCase());
          } else if (modType === 'case') {
            const names = value.name || [];
            const descs = value.desc || [];
            for (let i = 0; i < descs.length; i++) {
              const label = names[i] || names[0] || '';
              addEdge(id, descs[i], label);
            }
          }
        }
      }
    }
  }

  for (const id in idToLabel) {
    const label = idToLabel[id].replace(/"/g, '\\"');
    const pos = idToPosition[id] ? `, pos="${idToPosition[id]}"` : '';
    dot += `  "${id}" [label="${label}"${pos}];\n`;
  }

  for (const { from, to, label, style } of edges) {
    const parts = [];
    if (label) parts.push(`label="${label}"`);
    if (style) parts.push(style);
    const attrs = parts.length ? ` [${parts.join(', ')}]` : '';
    dot += `  "${from}" -> "${to}"${attrs};\n`;
  }

  dot += '}';

  const viz = new Viz({ Module, render });
  const svg = await viz.renderString(dot);
  fs.writeFileSync(outputPath, svg, 'utf8');
}


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
