'use strict';

(function () {
  const token = location.pathname.split('/').filter(Boolean).pop();
  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const dropLabel = document.getElementById('drop-label');
  const description = document.getElementById('description');
  const context = document.getElementById('context');
  const limitLabel = document.getElementById('limit');
  const sizeLabel = document.getElementById('size');
  const message = document.getElementById('message');
  const errorBox = document.getElementById('error');
  const submit = document.getElementById('submit');
  const back = document.getElementById('back');

  let selected = null;
  let maxBytes = 50 * 1024 * 1024;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fail(text) {
    errorBox.textContent = text;
    errorBox.hidden = false;
    form.hidden = true;
    context.textContent = 'This ticket cannot be used.';
  }

  function setFile(file) {
    if (!file) return;
    if (file.size > maxBytes) {
      message.textContent = `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`;
      submit.disabled = true;
      return;
    }
    selected = file;
    dropZone.classList.add('has-file');
    dropLabel.textContent = file.name;
    sizeLabel.textContent = formatBytes(file.size);
    message.textContent = '';
    submit.disabled = false;
  }

  fileInput.addEventListener('change', () => setFile(fileInput.files && fileInput.files[0]));

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });
  dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) setFile(file);
  });

  fetch(`/api/upload-info/${token}`)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'This upload link is invalid or expired.');
      return data;
    })
    .then((info) => {
      maxBytes = info.maxBytes || maxBytes;
      context.textContent = `Ticket for ${info.handle} · area: ${info.area}`;
      limitLabel.textContent = `Limit ${formatBytes(maxBytes)}`;
      if (info.bbsUrl) back.href = info.bbsUrl;
      form.hidden = false;
      submit.disabled = true;
    })
    .catch((err) => fail(err.message));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = selected || (fileInput.files && fileInput.files[0]);
    if (!file) {
      message.textContent = 'Choose a file first.';
      return;
    }
    if (file.size > maxBytes) {
      message.textContent = 'That file is larger than the ticket allows.';
      return;
    }
    submit.disabled = true;
    message.textContent = 'Uploading…';
    const query = new URLSearchParams({
      name: file.name,
      desc: description.value.slice(0, 200),
    });
    try {
      const response = await fetch(`/api/upload/${token}?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The upload failed.');
      message.textContent = `Uploaded ${data.filename} (${formatBytes(data.size)}). You can return to the board.`;
      dropZone.classList.remove('has-file');
      dropLabel.textContent = 'Upload another file';
      description.value = '';
      selected = null;
      fileInput.value = '';
      sizeLabel.textContent = '';
      submit.disabled = true;
    } catch (err) {
      message.textContent = '';
      errorBox.textContent = err.message;
      errorBox.hidden = false;
      submit.disabled = false;
    }
  });
})();
