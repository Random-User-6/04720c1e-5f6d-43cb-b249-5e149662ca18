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

    // const addEdge = (from, to, label = '') => {
    //   const key = `${from}->${to}`;
    //   if (!edgeMap.has(key)) edgeMap.set(key, new Set());
    //   edgeMap.get(key).add(label || '');
    // };
    // const addEdge = (from, to, attrs = {}) => {
    //   const key = `${from}->${to}`;
    //   if (!edgeMap.has(key)) edgeMap.set(key, []);
    //   edgeMap.get(key).push(attrs);
    // };
    // const addEdge = (from, to, newAttrs = {}) => {
    //   const key = `${from}->${to}`;
    //   const existing = edgeMap.get(key);
    
    //   if (!existing) {
    //     edgeMap.set(key, { ...newAttrs });
    //   } else {
    //     // Merge: prefer label EXCEPTION, color red, style dashed
    //     const merged = {
    //       label: existing.label || newAttrs.label,
    //       color: existing.color || newAttrs.color,
    //       style: existing.style || newAttrs.style
    //     };
    //     edgeMap.set(key, merged);
    //   }
    // };
    const addEdge = (from, to, newAttrs = {}) => {
      const key = `${from}->${to}`;
      const existing = edgeMap.get(key);
    
      if (!existing) {
        edgeMap.set(key, { ...newAttrs });
      } else {
        const merged = {
          label: existing.label || newAttrs.label, // Preserve first non-empty label
          color: newAttrs.label === "EXCEPTION" ? newAttrs.color || existing.color : existing.color,
          style: newAttrs.label === "EXCEPTION" ? newAttrs.style || existing.style : existing.style
        };
        edgeMap.set(key, merged);
      }
    };



  
    for (const modType in modules) {
      for (const mod of modules[modType]) {
        const id = mod.moduleId?.[0];
        const name = mod.moduleName?.[0] || modType;idToLabel
        if (!id) continue;

        const displayName = name.replace(/"/g, '');
        const tagLabel = modType;
        idToLabel[id] = `${tagLabel}\\n${displayName}`;
        
        (mod.ascendants || []).forEach(asc => {
          addEdge(asc, id);
        });

        // if (mod.singleDescendant?.[0]) {
        //   addEdge(id, mod.singleDescendant[0]);
        // }

        // if (mod.exceptionalDescendant?.[0]) {
        //   addEdge(id, mod.exceptionalDescendant[0], { label: "EXCEPTION", color: "red", style: "dashed" });
        // }

        if (mod.singleDescendant?.[0]) {
          addEdge(id, mod.singleDescendant[0], { label: "", color: "black" });
        }
        
        if (mod.exceptionalDescendant?.[0]) {
          addEdge(id, mod.exceptionalDescendant[0], { label: "EXCEPTION", color: "red", style: "dashed" });
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
      dot += `  "${id}" [label="${safeLabel}"];\n`;
    }


    // for (const [key, labels] of edgeMap.entries()) {
    //   const [from, to] = key.split('->');
    //   const labelArr = Array.from(labels).filter(Boolean);
    //   const attrs = labelArr.length ? [`label=\"${labelArr.join(' / ')}\"`] : [];
    //   const attrString = attrs.length ? ` [${attrs.join(', ')}]` : '';
    //   dot += `  "${from}" -> "${to}"${attrString};\n`;
    // }
    // for (const [key, attrList] of edgeMap.entries()) {
    //   const [from, to] = key.split('->');
    //   for (const attrs of attrList) {
    //     const attrParts = [];
    //     if (attrs.label) attrParts.push(`label="${attrs.label}"`);
    //     if (attrs.color) attrParts.push(`color="${attrs.color}"`);
    //     if (attrs.style) attrParts.push(`style="${attrs.style}"`);
    //     const attrString = attrParts.length ? ` [${attrParts.join(', ')}]` : '';
    //     dot += `  "${from}" -> "${to}"${attrString};\n`;
    //   }
    // }
    for (const [key, attrs] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      const attrParts = [];
      if (attrs.label) attrParts.push(`label="${attrs.label}"`);
      if (attrs.color) attrParts.push(`color="${attrs.color}"`);
      if (attrs.style) attrParts.push(`style="${attrs.style}"`);
      const attrString = attrParts.length ? ` [${attrParts.join(', ')}]` : '';
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
