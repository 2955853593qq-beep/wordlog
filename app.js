(async () => {
const { openDatabase, readWords, saveSense, normalizeWord, forgetSense, undoForget, editSense } = window.WordlogDB;
const $ = id => document.getElementById(id);
let words = [];


let ready = false;
let saving = false;
const drafts = new Map();
const pendingSenses = new Set();
const cooldowns = new Map();
const undoEntries = new Map();
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function existingWord() { return words.find(word => word.normalized === normalizeWord($('word').value)); }
function showExisting() {
  const word = existingWord();
  const panel = $('existing'); panel.replaceChildren(); panel.hidden = !word;
  if (word) {
    panel.append(node('h3', `${word.spelling} 已在词书中`));
    for (const sense of word.senses) panel.append(node('p', `${sense.pos ? sense.pos + ' ' : ''}${sense.definition}`));
    panel.append(node('p', '可以在下方补充义项，保存后归入同一个单词。', 'help'));
  }
  if (!saving && ready) $('save').textContent = word ? '保存到已有单词' : '保存单词';
}
function renderBook() {
  const expanded = new Set([...$('word-list').querySelectorAll('details[open]')].map(card => card.dataset.wordId));
  const query = normalizeWord($('search').value);


  const filtered = words.filter(word => word.normalized.includes(query)).sort((a,b) => a.normalized.localeCompare(b.normalized, "en", {sensitivity:"base"}));
  $('book-summary').textContent = `共 ${words.length} 个单词 · ${words.reduce((sum,word) => sum + word.senses.length,0)} 个义项`;
  const list = $('word-list'); list.replaceChildren();
  if (!filtered.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h2', query ? '没有找到这个单词' : '词书从第一个词开始'), node('p', query ? '换一个拼写或缩短搜索内容试试。' : '遇到陌生单词或义项时，随手记录。'));
    if (!query) { const link = node('a', '去添加第一个单词'); link.href = '#add'; empty.append(link); }
    list.append(empty); return;
  }
  const index = node('nav', undefined, 'alphabet-index');
  index.setAttribute('aria-label', '字母索引');
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const target = filtered.find(word => word.normalized.startsWith(letter.toLowerCase()));
    const button = action(letter, '', () => document.getElementById('word-' + target.id)?.scrollIntoView({block:'start',behavior:'smooth'}));
    button.disabled = !target; index.append(button);
  }
  list.append(index);
  function wordCard(word) {
    const card = node('details'); const summary = node('summary', word.spelling);
    card.dataset.wordId = word.id; card.id = 'word-' + word.id;
    card.open = Boolean(query) || expanded.has(word.id);
    card.classList.toggle('search-match', Boolean(query && word.normalized.includes(query)));
    summary.append(node('small', `${word.senses.length} 个义项`)); card.append(summary);
    card.append(node('p', `首次添加：${new Date(word.createdAt).toLocaleDateString('zh-CN')}`, 'date'));
    for (const sense of word.senses) {
      card.append(senseRow(sense));
    }
    if (!word.senses.length) {
      card.append(node('p', '还没有词义，可以补充一个。', 'help'));
    }
    const addSenseButton = action('＋ 新增义项', 'add-sense-button', () => {
      location.hash = '#add'; route(); $('word').value = word.spelling; showExisting(); $('definition').focus();
    });
    const senseControls = node('div', undefined, 'sense-actions'); senseControls.append(addSenseButton); card.append(senseControls);
    return card;
  }
  for (const word of filtered) list.append(wordCard(word));
}
function bookFeedback(message, error = false) {
  $('book-feedback').textContent = message;
  $('book-feedback').classList.toggle('error', error);
}
function replaceSense(sense) {
  const word = words.find(word => word.id === sense.wordId);
  if (word) word.senses = word.senses.map(item => item.id === sense.id ? sense : item);
  showExisting();
  const oldRow = [...$('word-list').querySelectorAll('.sense')].find(row => row.dataset.senseId === sense.id);
  if (oldRow) oldRow.replaceWith(senseRow(sense));

  renderForgotten();
}
function openWord(id) {
  $('search').value = ''; location.hash = '#book'; route(); renderBook();
  const card = [...$('word-list').querySelectorAll('details')].find(card => card.dataset.wordId === id);
  if (card) {
    let parent = card; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement?.closest('details'); }
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}
function renderForgotten() {
  const list = $('forgotten-list'); list.replaceChildren();
  const senses = words.flatMap(word => word.senses.map(sense => ({ word, sense })))
    .filter(({sense}) => (sense.forgetRecords || []).length > 0)
    .sort((a,b) => b.sense.forgetRecords.length - a.sense.forgetRecords.length || a.word.normalized.localeCompare(b.word.normalized, "en", {sensitivity:"base"}));
  if (!senses.length) list.append(node('p', '还没有忘记记录。在词书中对具体义项点击“忘记了”，会显示在这里。', 'empty'));
  for (const {word, sense} of senses) {
    const card = node('div', undefined, 'card compact-card forgotten-card'); card.dataset.senseId = sense.id;
    const link = action(word.spelling, 'word-link', () => openWord(word.id));
    card.append(link, node('p', `${sense.pos ? sense.pos + ' ' : ''}${sense.definition}`, 'note-text'), node('p', `再次忘记 ${sense.forgetRecords.length} 次 · ${sense.forgetRecords.length >= 3 ? '经常忘记' : '薄弱义项'}`));
    list.append(card);
  }
}
function action(text, className, handler) {
  const button = node('button', text, className);
  button.type = 'button'; button.addEventListener('click', handler);
  return button;
}
function senseRow(sense) {
  const row = node('div', undefined, 'sense'); row.dataset.senseId = sense.id;
  row.append(node('p', `${sense.pos ? sense.pos + ' ' : ''}${sense.definition}`));
  const actions = node('div', undefined, 'sense-actions');
  const forget = action(`忘记了 ×${(sense.forgetRecords || []).length}`, 'forget-button', async () => {
    if (window.WordlogBackup.restoring || pendingSenses.has(sense.id) || (cooldowns.get(sense.id) || 0) > Date.now()) return;
    pendingSenses.add(sense.id); forget.disabled = true;
    try {
      const result = await forgetSense(sense.id);
      cooldowns.set(sense.id, Date.now() + 800);
      const entry = { recordId: result.record.id, expiresAt: Date.now() + 8000 };
      undoEntries.set(sense.id, entry);
      bookFeedback('已记录这次忘记，8 秒内可以撤销。');
      pendingSenses.delete(sense.id); replaceSense(result.sense);
      setTimeout(() => {
        const current = words.flatMap(word => word.senses).find(item => item.id === sense.id);
        const currentRow = [...$('word-list').querySelectorAll('.sense')].find(item => item.dataset.senseId === sense.id);
        if (currentRow && !pendingSenses.has(sense.id)) currentRow.querySelector('.forget-button').disabled = false;
        if (!current) return;
      }, 850);
      setTimeout(() => {
        if (undoEntries.get(sense.id) === entry) {
          undoEntries.delete(sense.id);
          const currentRow = [...$('word-list').querySelectorAll('.sense')].find(item => item.dataset.senseId === sense.id);
          currentRow?.querySelector('.undo-button')?.remove();
        }
      }, 8100);
    } catch (error) { bookFeedback(error.message, true); }
    finally { pendingSenses.delete(sense.id); if (forget.isConnected) forget.disabled = false; }
  });
  forget.disabled = pendingSenses.has(sense.id) || (cooldowns.get(sense.id) || 0) > Date.now();
  const edit = action('编辑', 'edit-button', () => {
    if (window.WordlogBackup.restoring) return;
    drafts.set(sense.id, { pos: sense.pos, definition: sense.definition });
    replaceSense(sense);
    const input = document.getElementById(`edit-pos-${sense.id}`);
    input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  edit.disabled = pendingSenses.has(sense.id) || drafts.has(sense.id);
  actions.append(forget, edit);
  const entry = undoEntries.get(sense.id);
  if (entry && entry.expiresAt > Date.now()) {
    const undo = action('撤销', 'undo-button', async () => {
      if (window.WordlogBackup.restoring || pendingSenses.has(sense.id)) return;
      pendingSenses.add(sense.id); undo.disabled = true;
      try {
        const updated = await undoForget(sense.id, entry.recordId);
        if (undoEntries.get(sense.id) === entry) undoEntries.delete(sense.id);
        cooldowns.delete(sense.id); pendingSenses.delete(sense.id);
        replaceSense(updated); bookFeedback('已撤销对应的忘记记录。');
      } catch (error) { bookFeedback(error.message, true); }
      finally { pendingSenses.delete(sense.id); if (undo.isConnected) undo.disabled = false; }
    });
    undo.disabled = pendingSenses.has(sense.id); actions.append(undo);
  }
  row.append(actions);
  if (drafts.has(sense.id)) row.append(editForm(sense));
  return row;
}
function editForm(sense) {
  const draft = drafts.get(sense.id);
  const form = node('form', undefined, 'edit-sense');
  const pos = node('input'); pos.id = `edit-pos-${sense.id}`; pos.value = draft.pos; pos.maxLength = 200;
  const posLabel = node('label', '词性（选填）'); posLabel.htmlFor = pos.id;
  const definition = node('textarea'); definition.id = `edit-definition-${sense.id}`;
  definition.value = draft.definition; definition.required = true; definition.maxLength = 5000; definition.rows = 3;
  const definitionLabel = node('label', '中文释义'); definitionLabel.htmlFor = definition.id;
  pos.addEventListener('input', () => { draft.pos = pos.value; });
  definition.addEventListener('input', () => { draft.definition = definition.value; });
  form.append(posLabel, pos, definitionLabel, definition);
  window.WordlogPosInput.attach(pos);
  const controls = node('div', undefined, 'sense-actions');
  const save = node('button', '保存修改', 'save-edit'); save.type = 'submit';
  const cancel = action('取消', 'cancel-edit', () => { drafts.delete(sense.id); replaceSense(sense); });
  controls.append(save, cancel);
  const status = node('p', '', 'feedback'); status.setAttribute('role', 'status');
  form.append(controls, status);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (window.WordlogBackup.restoring || pendingSenses.has(sense.id)) return;
    pendingSenses.add(sense.id); save.disabled = true; cancel.disabled = true;
    try {
      const updated = await editSense(sense.id, pos.value, definition.value);
      drafts.delete(sense.id); pendingSenses.delete(sense.id); replaceSense(updated);
      bookFeedback('义项已修改，忘记记录已保留。');
    } catch (error) { status.textContent = error.message; status.classList.add('error'); }
    finally { pendingSenses.delete(sense.id); save.disabled = false; cancel.disabled = false; }
  });
  return form;
}
async function refresh() {
  words = await readWords();
  $('word-count').textContent = words.length;
  $('sense-count').textContent = words.reduce((sum,word) => sum + word.senses.length,0);
 showExisting(); renderBook(); renderForgotten();
}
function route() {
  const pages = ['add', 'book', 'forgotten'];
  const current = location.hash === '#confusion' ? 'book' : pages.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'add';
  for (const page of pages) {
    $(`${page}-page`).hidden = page !== current;
    $(`${page}-tab`).removeAttribute('aria-current');
  }
  $(`${current}-tab`).setAttribute('aria-current', 'page');
  $('backup-panel').hidden = current !== 'book';
}
function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').classList.toggle('error',error); }
$('word').addEventListener('input', showExisting);
$('word').addEventListener('blur', () => { $('word').value = $('word').value.trim(); showExisting(); });
$('search').addEventListener('input', renderBook);
window.addEventListener('hashchange', route);
window.addEventListener('focus', () => { if (ready && !saving && !drafts.size && !pendingSenses.size && !window.WordlogBackup.restoring) refresh().catch(() => bookFeedback('无法刷新词书，请刷新页面重试。',true)); });
$('add-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!ready || saving || window.WordlogBackup.restoring) return;
  if (!normalizeWord($('word').value) || !$('definition').value.trim()) { feedback('请填写单词和中文释义，不能只输入空格。',true); return; }
  saving = true; $('save').disabled = true; $('save').textContent = '正在保存…';
  try {
    const result = await saveSense($('word').value, $('pos').value, $('definition').value);
    $('add-form').reset();

    feedback(result.existing ? `已为 ${result.spelling} 添加义项。` : `已保存 ${result.spelling}。`);
    await refresh(); $('word').focus();
  } catch (error) { feedback(error.message || '保存失败，输入内容已保留，请重试。',true); }
  finally { saving = false; $('save').disabled = false; showExisting(); }
});
route();
try {

  await openDatabase(); await refresh(); ready = true; clearTimeout(window.wordlogStartupTimer); $('save').disabled = false; showExisting();
  window.WordlogBackup.init({
    isBusy: () => saving || pendingSenses.size > 0 || drafts.size > 0,
    onRestored: async () => {
      drafts.clear(); undoEntries.clear(); cooldowns.clear();

      $('search').value = ''; await refresh(); location.hash = '#book';
    }
  });
}
catch (error) { feedback(`本地存储不可用：${error.message} 请使用普通浏览模式，并允许浏览器保存网站数据。`,true); $('save').textContent = '本地存储不可用'; }

})();



