// ==================== مفكرتي - PWA ====================
const COLORS = [
  '#ffffff', '#f28b82', '#fbbc04', '#fff475',
  '#ccff90', '#a7ffeb', '#cbf0f8', '#aecbfa',
  '#d7aefb', '#fdcfe8', '#e6c9a8', '#e8eaed'
];

const DB_NAME = 'mofakrati_db';
const DB_VERSION = 1;
const STORE = 'notes';

let db = null;
let notes = [];
let currentNote = null;
let isChecklistMode = false;
let searchQuery = '';
let labels = []; // قائمة التصنيفات
let activeLabel = ''; // '' = الكل
const LABELS_KEY = 'mofakrati_labels';
const FONT_KEY = 'mofakrati_font_scale';
const FONT_STEPS = [0.9, 1, 1.15, 1.3, 1.5];
const FONT_NAMES = ['صغير', 'عادي', 'كبير', 'أكبر', 'ضخم'];
let fontScaleIdx = 1;

let draftImages = []; // base64 images while editing
let draftAudios = []; // {id, dataUrl, name} while editing
let mediaRecorder = null;
let recordChunks = [];


// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

function getAllNotes() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function saveNote(note) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.put(note);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function deleteNoteFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function clearAllNotes() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Helpers ----------
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function isLightColor(hex) {
  if (!hex || hex === '#ffffff') return true;
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function sortNotes(list) {
  return list.slice().sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

// ---------- Labels ----------

function applyFontScale() {
  const scale = FONT_STEPS[fontScaleIdx] || 1;
  document.documentElement.style.setProperty('--font-scale', scale);
  document.body.style.fontSize = (16 * scale) + 'px';
  const label = document.getElementById('font-size-label');
  if (label) label.textContent = FONT_NAMES[fontScaleIdx] || 'عادي';
  localStorage.setItem(FONT_KEY, String(fontScaleIdx));
}
function loadFontScale() {
  const v = parseInt(localStorage.getItem(FONT_KEY) || '1', 10);
  fontScaleIdx = isNaN(v) ? 1 : Math.min(FONT_STEPS.length - 1, Math.max(0, v));
  applyFontScale();
}
function incFont() {
  if (fontScaleIdx < FONT_STEPS.length - 1) { fontScaleIdx++; applyFontScale(); }
}
function decFont() {
  if (fontScaleIdx > 0) { fontScaleIdx--; applyFontScale(); }
}

function loadLabels() {
  try {
    const raw = localStorage.getItem(LABELS_KEY);
    labels = raw ? JSON.parse(raw) : ['تعلم', 'طبخ', 'مراجعة'];
  } catch {
    labels = ['تعلم', 'طبخ', 'مراجعة'];
  }
}

function saveLabels() {
  localStorage.setItem(LABELS_KEY, JSON.stringify(labels));
}

function renderLabelsBar() {
  const bar = document.getElementById('labels-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'label-chip' + (activeLabel === '' ? ' active' : '');
  allBtn.dataset.label = '';
  allBtn.textContent = 'الكل';
  allBtn.onclick = () => { activeLabel = ''; renderLabelsBar(); renderNotes(); };
  bar.appendChild(allBtn);

  labels.forEach(lab => {
    const btn = document.createElement('button');
    btn.className = 'label-chip' + (activeLabel === lab ? ' active' : '');
    btn.dataset.label = lab;
    btn.textContent = lab;
    btn.onclick = () => { activeLabel = lab; renderLabelsBar(); renderNotes(); };
    bar.appendChild(btn);
  });
}

function fillLabelSelect(selected) {
  const sel = document.getElementById('note-label');
  if (!sel) return;
  sel.innerHTML = '<option value="">بدون تصنيف</option>';
  labels.forEach(lab => {
    const opt = document.createElement('option');
    opt.value = lab;
    opt.textContent = lab;
    if (lab === selected) opt.selected = true;
    sel.appendChild(opt);
  });
}

function manageLabels() {
  closeMenu();
  const current = labels.join('، ');
  const result = prompt(
    'اكتب التصنيفات وافصل بينها بفاصلة أو نقطة أو سطر جديد\nمثال: تعلم، طبخ، مراجعة',
    current
  );
  if (result === null) return;
  // يقبل: سطر جديد، فاصلة عربية/إنجليزية، نقطة، شرطة
  const newLabels = result
    .split(/[\n,،.·\-|/]+/)
    .map(s => s.trim())
    .filter(Boolean);
  labels = [...new Set(newLabels)];
  saveLabels();
  if (activeLabel && !labels.includes(activeLabel)) activeLabel = '';
  renderLabelsBar();
  renderNotes();
  showToast('تم تحديث التصنيفات (' + labels.length + ')');
}

// ---------- Render ----------
function renderNotes() {
  const container = document.getElementById('notes-container');
  const empty = document.getElementById('empty-state');
  let filtered = notes;

  // فلترة بالتصنيف
  if (activeLabel) {
    filtered = filtered.filter(n => (n.label || '') === activeLabel);
  }

  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filtered = filtered.filter(n => {
      if ((n.title || '').toLowerCase().includes(q)) return true;
      if ((n.content || '').toLowerCase().includes(q)) return true;
      if (n.checklist && n.checklist.some(i => (i.text || '').toLowerCase().includes(q))) return true;
      if ((n.label || '').toLowerCase().includes(q)) return true;
      return false;
    });
  }

  filtered = sortNotes(filtered);
  container.innerHTML = '';

  if (filtered.length === 0) {
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = searchQuery ? 'لا توجد نتائج' : 'الملاحظات التي تضيفها تظهر هنا';
  } else {
    empty.classList.add('hidden');
  }

  filtered.forEach(note => {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.style.background = note.color || '#ffffff';
    const light = isLightColor(note.color || '#ffffff');
    card.style.color = light ? '#202124' : '#ffffff';

    let html = '';
    if (note.isPinned) html += '<div class="pin-icon">📌</div>';
    if (note.label) html += `<div class="note-label-tag">${escapeHtml(note.label)}</div>`;
    if (note.images && note.images.length) {
      html += '<div class="card-thumbs"><img src="' + note.images[0] + '" alt=""/></div>';
    }
    if (note.audios && note.audios.length) {
      html += '<div class="card-audio-badge">🎙️ ' + note.audios.length + ' تسجيل</div>';
    }
    if (note.title) html += `<div class="note-title">${escapeHtml(note.title)}</div>`;

    if (note.isChecklist && note.checklist && note.checklist.length) {
      html += '<div class="checklist-preview">';
      const items = note.checklist.slice(0, 6);
      items.forEach(item => {
        html += `<div class="checklist-item ${item.checked ? 'checked' : ''}">
          <span>${item.checked ? '☑️' : '⬜'}</span>
          <span>${escapeHtml(item.text || '')}</span>
        </div>`;
      });
      if (note.checklist.length > 6) {
        html += `<div class="more-items">+ ${note.checklist.length - 6} المزيد</div>`;
      }
      html += '</div>';
    } else if (note.content) {
      html += `<div class="note-body">${escapeHtml(note.content)}</div>`;
    }

    card.innerHTML = html;
    card.addEventListener('click', () => openEditor(note));
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ---------- Editor ----------

// ---------- Media (صور + صوت) ----------
function fileToCompressedDataUrl(file, maxW = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderEditorMedia() {
  const imgBox = document.getElementById('note-images');
  const audBox = document.getElementById('note-audios');
  if (!imgBox || !audBox) return;
  imgBox.innerHTML = '';
  audBox.innerHTML = '';
  draftImages.forEach((src, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'media-img-wrap';
    wrap.innerHTML = `<img src="${src}" alt=""/><button type="button" class="btn-rm-media" data-i="${idx}">✕</button>`;
    wrap.querySelector('.btn-rm-media').onclick = () => {
      draftImages.splice(idx, 1);
      renderEditorMedia();
    };
    imgBox.appendChild(wrap);
  });
  draftAudios.forEach((a, idx) => {
    const row = document.createElement('div');
    row.className = 'media-audio-row';
    row.innerHTML = `<audio controls src="${a.dataUrl}"></audio><button type="button" class="btn-rm-media" data-i="${idx}">✕</button>`;
    row.querySelector('.btn-rm-media').onclick = () => {
      draftAudios.splice(idx, 1);
      renderEditorMedia();
    };
    audBox.appendChild(row);
  });
}

async function onPickImages(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const dataUrl = await fileToCompressedDataUrl(f);
      draftImages.push(dataUrl);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل صورة');
    }
  }
  renderEditorMedia();
}

async function toggleAudioRecord() {
  const btn = document.getElementById('btn-add-audio');
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => { if (ev.data.size) recordChunks.push(ev.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      btn.classList.remove('recording');
      btn.textContent = '🎙️ صوت';
      const blob = new Blob(recordChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        draftAudios.push({ id: uid(), dataUrl: reader.result, name: 'تسجيل' });
        renderEditorMedia();
        showToast('تم حفظ التسجيل');
      };
      reader.readAsDataURL(blob);
      mediaRecorder = null;
    };
    mediaRecorder.start();
    btn.classList.add('recording');
    btn.textContent = '⏹️ إيقاف';
    showToast('جاري التسجيل...');
  } catch (err) {
    console.error(err);
    showToast('لازم تسمح بالميكروفون');
  }
}

function openEditor(note = null, asChecklist = false) {
  currentNote = note ? { ...note } : null;
  isChecklistMode = note ? !!note.isChecklist : asChecklist;
  draftImages = note && note.images ? [...note.images] : [];
  draftAudios = note && note.audios ? note.audios.map(a => ({...a})) : [];

  const editor = document.getElementById('editor');
  const titleInput = document.getElementById('note-title');
  const contentArea = document.getElementById('note-content-area');
  const checklistArea = document.getElementById('checklist-area');
  const contentInput = document.getElementById('note-content');
  const pinBtn = document.getElementById('btn-pin');

  titleInput.value = note ? (note.title || '') : '';
  contentInput.value = note ? (note.content || '') : '';
  fillLabelSelect(note ? (note.label || '') : (activeLabel || ''));
  renderEditorMedia();

  const bg = note ? (note.color || '#ffffff') : '#ffffff';
  editor.style.background = bg;
  const light = isLightColor(bg);
  editor.style.color = light ? '#202124' : '#ffffff';
  titleInput.style.color = light ? '#202124' : '#ffffff';
  contentInput.style.color = light ? '#202124' : '#ffffff';

  pinBtn.textContent = (note && note.isPinned) ? '📍' : '📌';

  if (isChecklistMode) {
    contentArea.classList.add('hidden');
    checklistArea.classList.remove('hidden');
    renderChecklistEditor(note ? (note.checklist || []) : [{ id: uid(), text: '', checked: false }]);
  } else {
    contentArea.classList.remove('hidden');
    checklistArea.classList.add('hidden');
  }

  document.getElementById('color-picker').classList.add('hidden');
  editor.classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');

  setTimeout(() => {
    if (!note || !note.title) titleInput.focus();
  }, 100);
}

function renderChecklistEditor(items) {
  const area = document.getElementById('checklist-area');
  area.innerHTML = '';

  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'checklist-row';
    row.innerHTML = `
      <input type="checkbox" ${item.checked ? 'checked' : ''} data-idx="${idx}" />
      <input type="text" value="${escapeHtml(item.text || '')}" placeholder="عنصر قائمة" data-idx="${idx}" class="${item.checked ? 'checked' : ''}" />
      <button class="btn-remove" data-idx="${idx}">✕</button>
    `;
    area.appendChild(row);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-add-item';
  addBtn.innerHTML = '＋ إضافة عنصر';
  addBtn.onclick = () => {
    const current = getChecklistFromUI();
    current.push({ id: uid(), text: '', checked: false });
    renderChecklistEditor(current);
    const inputs = area.querySelectorAll('input[type="text"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  };
  area.appendChild(addBtn);

  // Events
  area.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const idx = +e.target.dataset.idx;
      const textInput = area.querySelector(`input[type="text"][data-idx="${idx}"]`);
      if (e.target.checked) textInput.classList.add('checked');
      else textInput.classList.remove('checked');
    });
  });
  area.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = +e.target.dataset.idx;
      const current = getChecklistFromUI();
      current.splice(idx, 1);
      if (current.length === 0) current.push({ id: uid(), text: '', checked: false });
      renderChecklistEditor(current);
    });
  });
}

function getChecklistFromUI() {
  const area = document.getElementById('checklist-area');
  const rows = area.querySelectorAll('.checklist-row');
  const items = [];
  rows.forEach(row => {
    const cb = row.querySelector('input[type="checkbox"]');
    const text = row.querySelector('input[type="text"]');
    items.push({
      id: uid(),
      text: text.value,
      checked: cb.checked
    });
  });
  return items;
}

async function closeEditor(save = true) {
  if (save) {
    const title = document.getElementById('note-title').value.trim();
    let content = '';
    let checklist = [];

    if (isChecklistMode) {
      checklist = getChecklistFromUI().filter(i => i.text.trim());
    } else {
      content = document.getElementById('note-content').value.trim();
    }

    const isEmpty = !title && !content && checklist.length === 0 && draftImages.length === 0 && draftAudios.length === 0;

    if (isEmpty) {
      if (currentNote) {
        await deleteNoteFromDB(currentNote.id);
        notes = notes.filter(n => n.id !== currentNote.id);
      }
    } else {
      const now = Date.now();
      const labelSel = document.getElementById('note-label');
      const label = labelSel ? labelSel.value : '';
      const note = {
        id: currentNote ? currentNote.id : uid(),
        title,
        content,
        color: currentNote ? (currentNote.color || '#ffffff') : '#ffffff',
        isPinned: currentNote ? !!currentNote.isPinned : false,
        isChecklist: isChecklistMode,
        checklist: isChecklistMode ? checklist : [],
        label: label || '',
        images: [...draftImages],
        audios: draftAudios.map(a => ({...a})),
        createdAt: currentNote ? currentNote.createdAt : now,
        updatedAt: now
      };
      await saveNote(note);
      const idx = notes.findIndex(n => n.id === note.id);
      if (idx >= 0) notes[idx] = note;
      else notes.push(note);
    }
    renderNotes();
  }

  document.getElementById('editor').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  currentNote = null;
}

// ---------- Color Picker ----------
function setupColorPicker() {
  const row = document.getElementById('colors-row');
  row.innerHTML = '';
  COLORS.forEach(c => {
    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.background = c;
    if (c === '#ffffff') dot.style.border = '1px solid #ccc';
    dot.addEventListener('click', () => {
      if (!currentNote) currentNote = {};
      currentNote.color = c;
      const editor = document.getElementById('editor');
      editor.style.background = c;
      const light = isLightColor(c);
      editor.style.color = light ? '#202124' : '#ffffff';
      document.getElementById('note-title').style.color = light ? '#202124' : '#ffffff';
      document.getElementById('note-content').style.color = light ? '#202124' : '#ffffff';
      document.getElementById('color-picker').classList.add('hidden');
      row.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
    row.appendChild(dot);
  });
}

// ---------- Backup / Restore ----------
const BACKUP_FILENAME = 'mofakrati_backup.json';
const LAST_BACKUP_KEY = 'mofakrati_last_backup';

function doExportBackup(silent = false) {
  const data = {
    version: 2,
    exportedAt: new Date().toISOString(),
    notesCount: notes.length,
    labels: labels,
    notes: notes
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BACKUP_FILENAME; // ملف واحد ثابت (بيستبدل القديم)
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_BACKUP_KEY, Date.now().toString());
  if (!silent) {
    showToast('تم حفظ النسخة الاحتياطية ✅\n(ملف واحد: mofakrati_backup.json)');
    closeMenu();
  }
}

function exportBackup() {
  doExportBackup(false);
}

// نسخ احتياطي تلقائي كل 24 ساعة لما تفتح التطبيق
function checkAutoBackup() {
  if (notes.length === 0) return;
  const last = parseInt(localStorage.getItem(LAST_BACKUP_KEY) || '0', 10);
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (now - last > oneDay) {
    // نعمل البك أب بعد ثانيتين عشان التطبيق يخلص تحميل
    setTimeout(() => {
      doExportBackup(true);
      showToast('نسخة احتياطية يومية تلقائية ✅');
    }, 2000);
  }
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.notes || !Array.isArray(data.notes)) {
        showToast('ملف غير صالح');
        return;
      }
      if (!confirm('هل تريد استبدال كل الملاحظات الحالية بالنسخة الاحتياطية؟')) return;

      await clearAllNotes();
      for (const note of data.notes) {
        if (!note.id) note.id = uid();
        if (note.label === undefined) note.label = '';
        await saveNote(note);
      }
      if (Array.isArray(data.labels) && data.labels.length) {
        labels = data.labels;
        saveLabels();
      }
      notes = await getAllNotes();
      renderLabelsBar();
      renderNotes();
      showToast(`تم استرجاع ${data.notes.length} ملاحظة ✅`);
    } catch (err) {
      showToast('فشل الاسترجاع');
      console.error(err);
    }
    closeMenu();
  };
  input.click();
}

// ---------- Menu ----------
function openMenu() {
  document.getElementById('menu-sheet').classList.remove('hidden');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeMenu() {
  document.getElementById('menu-sheet').classList.add('hidden');
  document.getElementById('overlay').classList.add('hidden');
}

// ---------- Events ----------
function setupEvents() {
  document.getElementById('btn-add-note').onclick = () => openEditor(null, false);
  document.getElementById('btn-add-checklist').onclick = () => openEditor(null, true);
  const btnImg = document.getElementById('btn-add-image');
  const inputImg = document.getElementById('input-image');
  const btnAud = document.getElementById('btn-add-audio');
  if (btnImg && inputImg) {
    btnImg.onclick = () => inputImg.click();
    inputImg.onchange = onPickImages;
  }
  if (btnAud) btnAud.onclick = toggleAudioRecord;
  document.getElementById('btn-back').onclick = () => closeEditor(true);
  document.getElementById('btn-delete-note').onclick = async () => {
    if (currentNote && confirm('هل تريد حذف هذه الملاحظة؟')) {
      await deleteNoteFromDB(currentNote.id);
      notes = notes.filter(n => n.id !== currentNote.id);
      renderNotes();
      closeEditor(false);
      showToast('تم الحذف');
    }
  };
  document.getElementById('btn-pin').onclick = () => {
    if (!currentNote) currentNote = { isPinned: false };
    currentNote.isPinned = !currentNote.isPinned;
    document.getElementById('btn-pin').textContent = currentNote.isPinned ? '📍' : '📌';
  };
  document.getElementById('btn-color').onclick = () => {
    document.getElementById('color-picker').classList.toggle('hidden');
  };

  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  searchInput.oninput = (e) => {
    searchQuery = e.target.value;
    if (clearBtn) clearBtn.classList.toggle('hidden', !searchQuery);
    renderNotes();
  };
  if (clearBtn) {
    clearBtn.onclick = () => {
      searchInput.value = '';
      searchQuery = '';
      clearBtn.classList.add('hidden');
      renderNotes();
    };
  }

  document.getElementById('btn-menu').onclick = openMenu;
  document.getElementById('overlay').onclick = closeMenu;
  document.getElementById('btn-export').onclick = exportBackup;
  document.getElementById('btn-import').onclick = importBackup;
  const btnLabels = document.getElementById('btn-manage-labels');
  if (btnLabels) btnLabels.onclick = manageLabels;
  const fi = document.getElementById('btn-font-inc');
  const fd = document.getElementById('btn-font-dec');
  if (fi) fi.onclick = incFont;
  if (fd) fd.onclick = decFont;

  window.addEventListener('popstate', () => {
    if (!document.getElementById('editor').classList.contains('hidden')) {
      closeEditor(true);
    }
  });
}

// ---------- Service Worker & Install ----------
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }
}

// ---------- Init ----------
async function init() {
  try {
    await openDB();
    notes = await getAllNotes();
    loadLabels();
    loadFontScale();
    setupColorPicker();
    setupEvents();
    renderLabelsBar();
    renderNotes();
    registerSW();

    // Hide loader
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // نسخ احتياطي تلقائي كل يوم
    checkAutoBackup();
  } catch (err) {
    console.error(err);
    document.getElementById('loader').innerHTML = '<p style="color:red;padding:20px;text-align:center">حدث خطأ في التحميل</p>';
  }
}

init();
