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

const vizInstance = new Viz({ Module, render });

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
      const xml = fs.readFileSync(file.path, 'utf8');
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const baseName = `${file.originalname}_${timestamp}`;
      const formats = ['svg', 'mermaid', 'uml'];

      for (const fmt of formats) {
        const ext = fmt === 'mermaid' ? 'mmd' : fmt === 'uml' ? 'puml' : fmt;
        const outPath = `public/${baseName}.${ext}`;
        await parseAndRenderXML(xml, outPath, fmt);
      }

      results.push({
        name: file.originalname,
        base: baseName,
        svgPath: `/${baseName}.svg`
      });

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
      <style>
        .file-list { list-style-type: none; padding-left: 0; }
        .file-list li { margin: 5px 0; }
      </style>
    </head>
    <body>
      <h1>Processed Files</h1>
      <link rel="stylesheet" href="/styles.css">
      <div>
        <button onclick="selectAll()">Select All</button>
        <button onclick="selectNone()">Select None</button>
      </div>
      <div>
        <button onclick="downloadSelected('svg')">Download Selected as SVG</button>
        <button onclick="downloadSelected('png')">Download Selected as PNG</button>
        <button onclick="downloadSelected('mermaid')">Download Selected as Mermaid</button>
        <button onclick="downloadSelected('uml')">Download Selected as UML</button>
      </div>
      <ul class="file-list">
        ${results.map(result => {
          if (result.error) {
            return `<li>${result.name}: Error - ${result.error}</li>`;
          }
          return `
            <li>
              <input type="checkbox" class="dl-check" data-base="${result.base}" />
              <a href="${result.svgPath}" target="_blank">${result.name}</a>
            </li>
          `;
        }).join('')}
      </ul>
      <form action="/" method="get">
        <button type="submit">Upload More</button>
      </form>

      <div id="progress-container" style="display: none; max-width: 500px; margin-top: 20px;">
        <label for="progress-bar">Download Progress</label>
        <progress id="progress-bar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
        <div id="progress-text">0%</div>
      </div>

      <script>
        function selectAll() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = true);
        }
        function selectNone() {
          document.querySelectorAll('.dl-check').forEach(box => box.checked = false);
        }

        async function downloadSelected(type) {
          const boxes = Array.from(document.querySelectorAll('.dl-check:checked'));
          if (boxes.length === 0) return alert('No files selected.');

          const progressContainer = document.getElementById('progress-container');
          const progressBar = document.getElementById('progress-bar');
          const progressText = document.getElementById('progress-text');

          progressContainer.style.display = 'block';
          progressBar.value = 0;
          progressBar.max = boxes.length;
          progressText.textContent = '0%';

          const mimeTypes = {
            svg: 'image/svg+xml',
            png: 'image/png',
            mermaid: 'text/plain',
            uml: 'text/plain'
          };

          let completed = 0;

          for (const box of boxes) {
            const baseName = box.getAttribute('data-base');
            const ext = { svg: 'svg', png: 'svg', mermaid: 'mmd', uml: 'puml' }[type] || 'txt';
            var filePath = '/' + baseName + '.' + ext;
            const filename = baseName + '.' + (type === 'png' ? 'png' : ext);

            try {
              const res = await fetch(filePath);
              const data = await res.text();

              if (type === 'png') {
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
              } else {
                const blob = new Blob([data], { type: mimeTypes[type] });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }

            } catch (err) {
              console.error('Download failed:', err);
            }

            completed++;
            progressBar.value = completed;
            progressText.textContent = Math.round((completed / boxes.length) * 100) + "%";
          }

          setTimeout(() => {
            progressContainer.style.display = 'none';
          }, 1500);
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

async function parseAndRenderXML(xml, outputPath, format = 'svg') {
  const result = await parseStringPromise(xml);
  if (!result?.ivrScript?.modules?.[0]) {
    throw new Error("Invalid or unsupported IVR XML structure: 'ivrScript.modules[0]' missing");
  }
  const modules = result.ivrScript.modules[0];
  const idToLabel = {};
  const edgeMap = new Map();

  const addEdge = (from, to, label = '', style = '') => {
    const key = `${from}->${to}`;
    if (!edgeMap.has(key)) edgeMap.set(key, new Set());
    edgeMap.get(key).add(JSON.stringify({ label, style }));
  };

  for (const modType in modules) {
    for (const mod of modules[modType]) {
      const id = mod.moduleId?.[0];
      const name = mod.moduleName?.[0] || modType;
      if (!id) continue;
      const displayName = name.replace(/"/g, '');
      idToLabel[id] = `${modType}\\n${displayName}`;

      (mod.ascendants || []).forEach(asc => {
        if (typeof asc === 'string') addEdge(asc, id);
      });

      if (mod.singleDescendant?.[0]) addEdge(id, mod.singleDescendant[0]);
      if (mod.exceptionalDescendant?.[0]) {
        addEdge(id, mod.exceptionalDescendant[0], 'Exception', 'color="red", fontcolor="red", style="dashed", penwidth=1');
      }

      if (modType === 'ifElse' || modType === 'answerMachine') {
        const entries = mod.data?.[0]?.branches?.[0]?.entry || [];
        for (const entry of entries) {
          const key = entry.key?.[0];
          const desc = entry.value?.[0]?.desc?.[0];
          if (key && desc) addEdge(id, desc, key);
        }
      }

      if (modType === 'case' || modType === 'menu') {
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

  if (format === 'svg' || format === 'dot') {
    let dot = 'digraph G {\n  node [shape=box, style=filled, fillcolor="#f9f9f9", fontname="Arial"];\n';
    for (const [id, label] of Object.entries(idToLabel)) {
      dot += `  "${id}" [label="${label.replace(/"/g, '\\"')}"];\n`;
    }
    for (const [key, valueSet] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      const labels = [];
      const styles = new Set();
      for (const item of valueSet) {
        const { label, style } = JSON.parse(item);
        if (label) labels.push(label);
        if (style) styles.add(style);
      }
      const attrString = [
        labels.length ? `label="${labels.join(' / ')}"` : '',
        ...styles
      ].filter(Boolean).join(', ');
      dot += `  "${from}" -> "${to}"${attrString ? ` [${attrString}]` : ''};\n`;
    }
    dot += '}';
    if (format === 'dot') fs.writeFileSync(outputPath, dot, 'utf8');
    else fs.writeFileSync(outputPath, await vizInstance.renderString(dot), 'utf8');
  } else if (format === 'mermaid') {
    let mermaid = 'graph TD\n';
    for (const [id, label] of Object.entries(idToLabel)) {
      mermaid += `  ${id}["${label.replace(/\\n/g, '<br>').replace(/"/g, '')}"]\n`;
    }
    for (const [key, valueSet] of edgeMap.entries()) {
      const [from, to] = key.split('->');
      const labels = [];
      for (const item of valueSet) {
        const { label } = JSON.parse(item);
        if (label) labels.push(label);
      }
      if (labels.length) {
        const escapedLabel = labels
          .join(' / ')
          .replace(/\|/g, '∣')
          .replace(/`/g, '\'');
        mermaid += `  ${from} -->|${escapedLabel}| ${to}\n`;
      } else {
        mermaid += `  ${from} --> ${to}\n`;
      }
    }
    fs.writeFileSync(outputPath, mermaid, 'utf8');
  } else if (format === 'uml') {
    let uml = '@startuml\n';
    uml += 'hide empty description\n';
    uml += 'scale 0.85\n';
      // Build map of original GUID -> safe label ID
    const idToSafeId = {};
    for (const [id, label] of Object.entries(idToLabel)) {
      // Extract last line of label for ID (usually has unique readable info)
      const displayName = label.split('\\n').pop();
      // Replace unsafe characters with underscores
      let safeId = displayName.replace(/[^\w\d]/g, '_');
  
      // Ensure uniqueness (fallback to ID if needed)
      if (idToSafeId[safeId]) {
        safeId = safeId + '_' + id.slice(0, 4); // Append part of GUID to disambiguate
      }
  
      idToSafeId[id] = safeId;
  
      uml += `state "${label.replace(/"/g, '')}" as ${safeId}\n`;
    }
  
    for (const [key, valueSet] of edgeMap.entries()) {
      const [fromId, toId] = key.split('->');
      const from = idToSafeId[fromId] || fromId.replace(/[^\w\d]/g, '_');
      const to = idToSafeId[toId] || toId.replace(/[^\w\d]/g, '_');
  
      const labels = [];
      for (const item of valueSet) {
        const { label } = JSON.parse(item);
        if (label) labels.push(label);
      }
  
      uml += `${from} --> ${to}${labels.length ? ` : ${labels.join(' / ')}` : ''}\n`;
    }
  
    uml += '@enduml';
  
    // Strip BOM and write the clean file
    const cleanUml = uml.replace(/^\uFEFF/, '').trimStart();
    fs.writeFileSync(outputPath, cleanUml, 'utf8');
  } else {
    throw new Error('Unsupported format: ' + format);
  }
}

// Remove BOM and leading whitespace from PlantUML string
function sanitizePlantUML(input) {
  return input.replace(/^\uFEFF/, '').trimStart();
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
