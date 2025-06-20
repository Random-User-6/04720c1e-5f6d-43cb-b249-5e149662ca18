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
