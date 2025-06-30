// public/download.js

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
