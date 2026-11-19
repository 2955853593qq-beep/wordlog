(() => {
const DB_NAME = 'wordlog';
const DB_VERSION = 2;
let database;
function normalizeWord(word) { return word.trim().toLowerCase(); }
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = request.result;
      if (event.oldVersion < 1) {
      const words = db.createObjectStore('words', { keyPath: 'id' });
      words.createIndex('normalized', 'normalized', { unique: true });
      const senses = db.createObjectStore('senses', { keyPath: 'id' });
      senses.createIndex('wordId', 'wordId');
      }
      // Additive migration only: existing words and senses are untouched.
      if (event.oldVersion < 2) db.createObjectStore('groups', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => { database.close(); location.reload(); };
      resolve();
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他 Wordlog 页面后刷新。'));
  });
}
function readWords() {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses'], 'readonly');
    const words = tx.objectStore('words').getAll();
    const senses = tx.objectStore('senses').getAll();
    tx.oncomplete = () => resolve(words.result.map(word => ({ ...word, senses: senses.result.filter(sense => sense.wordId === word.id) })).sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    tx.onabort = () => reject(tx.error);
  });
}
function saveSense(spelling, pos, definition, disambiguation = null) {
  const normalized = normalizeWord(spelling);
  pos = pos.trim(); definition = definition.trim();
  if (!normalized || !definition) return Promise.reject(new Error('请填写单词和中文释义。'));
  return new Promise((resolve, reject) => {
    // Read and write in one transaction: concurrent tabs cannot create duplicate words.
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite');
    const words = tx.objectStore('words');
    const senses = tx.objectStore('senses');
    let result;
    let failure;
    const lookup = words.index('normalized').get(normalized);
    lookup.onsuccess = () => {
      let word = lookup.result;
      const existing = Boolean(word);
      const now = new Date().toISOString();
      if (!word) {
        word = { id: crypto.randomUUID(), spelling: spelling.trim(), normalized, createdAt: now, needsDisambiguation: false, disambiguationNote: '' };
        words.add(word);
      }
      if (disambiguation) {
        word.needsDisambiguation = Boolean(disambiguation.marked);
        word.disambiguationNote = disambiguation.note;
        words.put(word);
      }
      const list = senses.index('wordId').getAll(word.id);
      list.onsuccess = () => {
        if (list.result.some(sense => sense.pos === pos && sense.definition === definition)) {
          failure = new Error('该词性和释义已经存在，请查看已有义项。');
          tx.abort(); return;
        }
        senses.add({ id: crypto.randomUUID(), wordId: word.id, pos, definition, createdAt: now, forgetRecords: [] });
        if (disambiguation?.marked) {
          writeSimilarGroup(tx, { anchorId: word.id, members: disambiguation.members || [], note: disambiguation.note });
        }
        result = { existing, spelling: word.spelling };
      };
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.wordlogFailure || tx.error || new Error('保存失败，请重试。'));
  });
}

// Always read the latest stored sense inside the write transaction.
// Updating only requested fields preserves IDs, timestamps and other records.
function updateSense(id, change) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('senses', 'readwrite');
    const store = tx.objectStore('senses');
    let result;
    let failure;
    store.get(id).onsuccess = event => {
      try {
        const sense = event.target.result;
        if (!sense) throw new Error('义项已不存在，请刷新词书。');
        result = change(sense);
        store.put(sense);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('保存失败，请重试。'));
  });
}
function forgetSense(id) {
  return updateSense(id, sense => {
    const record = { id: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    sense.forgetRecords = [...(sense.forgetRecords || []), record];
    return { sense, record };
  });
}
function undoForget(id, recordId) {
  return updateSense(id, sense => {
    sense.forgetRecords = (sense.forgetRecords || []).filter(record => record.id !== recordId);
    return sense;
  });
}
function editSense(id, pos, definition) {
  pos = pos.trim(); definition = definition.trim();
  if (!definition) return Promise.reject(new Error('请填写中文释义，不能只输入空格。'));
  return updateSense(id, sense => {
    sense.pos = pos;
    sense.definition = definition;
    return sense;
  });
}
function readBackupData() {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readonly');
    const words = tx.objectStore('words').getAll();
    const senses = tx.objectStore('senses').getAll();
    const groups = tx.objectStore('groups').getAll();
    tx.oncomplete = () => resolve({ words: words.result, senses: senses.result, groups: groups.result });
    tx.onabort = () => reject(tx.error || new Error('读取备份失败。'));
  });
}
function restoreBackup(backup) {
  // Validate again before opening a write transaction, even for direct callers.
  const checked = window.WordlogBackup.validate(backup);
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('恢复失败，原数据已保留。'));
    try {
      const words = tx.objectStore('words');
      const senses = tx.objectStore('senses');
      const groups = tx.objectStore('groups');
      words.clear(); senses.clear(); groups.clear();
      checked.data.words.forEach(word => words.add(word));
      checked.data.senses.forEach(sense => senses.add(sense));
      (checked.data.groups || []).forEach(group => groups.add(group));
    } catch (error) { tx.abort(); }
  });
}
function setDisambiguation(id, marked, note) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('words', 'readwrite');
    const store = tx.objectStore('words');
    let result; let failure;
    store.get(id).onsuccess = event => {
      const word = event.target.result;
      if (!word) { failure = new Error('单词不存在，请刷新页面。'); tx.abort(); return; }
      word.needsDisambiguation = Boolean(marked); word.disambiguationNote = note;
      store.put(word); result = word;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('保存备注失败。'));
  });
}
function readGroups() {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('groups', 'readonly');
    const request = tx.objectStore('groups').getAll();
    tx.oncomplete = () => resolve(request.result.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    tx.onabort = () => reject(tx.error);
  });
}
function cleanMembers(values) {
  const members = values.map(value => typeof value === 'string' ? { spelling: value } : { ...value })
    .map(value => ({ ...value, spelling: value.spelling.trim(), ...(value.pos !== undefined ? { pos: value.pos.trim() } : {}), ...(value.definition !== undefined ? { definition: value.definition.trim() } : {}) }));
  if (!members.length || members.some(member => !member.spelling)) throw new Error('请填写单词拼写，或移除空白单词。');
  if (new Set(members.map(member => normalizeWord(member.spelling))).size !== members.length) throw new Error('组内单词重复，请合并后保存。');
  return members;
}
// Reuse words and exact senses; all additions and links commit together.
function writeSimilarGroup(tx, { id = null, anchorId = null, members, note, legacy = false, replaceMembers = false }) {
  const wordStore = tx.objectStore('words'); const senseStore = tx.objectStore('senses'); const groupStore = tx.objectStore('groups');
  const wordRequest = wordStore.getAll(); const senseRequest = senseStore.getAll(); const groupRequest = groupStore.getAll();
  groupRequest.onsuccess = () => {
    try {
      const words = wordRequest.result; const senses = senseRequest.result;
      const anchor = words.find(word => word.id === anchorId);
      const orderedGroups = [...groupRequest.result].sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const previous = id ? orderedGroups.find(group => group.id === id) : anchor && (orderedGroups.find(group => (group.anchorId || group.members[0]?.wordId) === anchorId) || orderedGroups.find(group => group.members.some(member => member.wordId === anchorId || normalizeWord(member.spelling) === anchor.normalized)));
      if (id && !previous) throw new Error('词组不存在，请刷新页面。');
      let entries = members.length ? cleanMembers(members) : anchor ? [{ spelling: anchor.spelling }] : cleanMembers(members);
      if (anchor && !entries.some(member => normalizeWord(member.spelling) === anchor.normalized)) {
        entries.unshift(previous?.members.find(member => member.wordId === anchorId) || { spelling: anchor.spelling });
      }
      // Adding from a word must retain the other members of its existing group.
      if (anchor && previous && !replaceMembers) {
        for (const member of previous.members) if (!entries.some(entry => normalizeWord(entry.spelling) === normalizeWord(member.spelling))) entries.push(member);
      }
      const now = new Date().toISOString();
      const linked = entries.map(member => {
        const normalized = normalizeWord(member.spelling);
        let word = words.find(word => word.normalized === normalized);
        if (!word) {
          word = { id: crypto.randomUUID(), spelling: member.spelling, normalized, createdAt: now, needsDisambiguation: true, disambiguationNote: '' };
          wordStore.add(word); words.push(word);
        } else if (!legacy && !word.needsDisambiguation) { word.needsDisambiguation = true; wordStore.put(word); }
        const linkedMember = { ...member, wordId: word.id };
        if (member.definition?.trim()) {
          const pos = member.pos || '';
          let sense = senses.find(sense => sense.wordId === word.id && sense.pos === pos && sense.definition === member.definition);
          if (!sense) { sense = { id: crypto.randomUUID(), wordId: word.id, pos, definition: member.definition, createdAt: now, forgetRecords: [] }; senseStore.add(sense); senses.push(sense); }
          linkedMember.senseId = sense.id;
        } else delete linkedMember.senseId;
        return linkedMember;
      });
      const rootId = previous?.anchorId || previous?.members[0]?.wordId || anchorId || linked[0].wordId;
      if (previous && !linked.some(member => member.wordId === rootId)) {
        const root = words.find(word => word.id === rootId);
        if (root) linked.unshift({ ...(previous.members.find(member => member.wordId === rootId) || {}), spelling: root.spelling, wordId: root.id });
      }
      groupStore.put({ ...(previous || {}), ...(!legacy ? { anchorId: rootId } : {}), id: previous?.id || crypto.randomUUID(), createdAt: previous?.createdAt || now, updatedAt: legacy ? previous.updatedAt : now, note, members: linked });
    } catch (error) { tx.wordlogFailure = error; tx.abort(); }
  };
}
function saveGroup(id, members, note) {
  try { members = cleanMembers(members); } catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite');
    writeSimilarGroup(tx, { id, members, note });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.wordlogFailure || tx.error || new Error('保存词组失败。'));
  });
}
function saveSimilarWord(id, marked, note, members) {
  try { if (marked && members.length) members = cleanMembers(members); } catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite'); const store = tx.objectStore('words');
    store.get(id).onsuccess = event => {
      const word = event.target.result;
      if (!word) { tx.wordlogFailure = new Error('单词不存在，请刷新页面。'); tx.abort(); return; }
      word.needsDisambiguation = marked; word.disambiguationNote = note; store.put(word);
      if (marked) writeSimilarGroup(tx, { anchorId: id, members, note, replaceMembers: true });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.wordlogFailure || tx.error || new Error('保存相似单词失败。'));
  });
}
async function syncGroupWords() {
  const groups = await readGroups();
  // Separate transactions let later groups reuse words created for earlier ones.
  for (const group of groups) await new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite');
    writeSimilarGroup(tx, { id: group.id, members: group.members, note: group.note, legacy: true });
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.wordlogFailure || tx.error);
  });
}
function deleteGroup(id) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('groups', 'readwrite');
    tx.objectStore('groups').delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
function clearWordbook() {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(['words', 'senses', 'groups'], 'readwrite');
    for (const name of ['words', 'senses', 'groups']) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('清空失败，原数据已保留。'));
  });
}
window.WordlogDB = { openDatabase, readWords, saveSense, normalizeWord, forgetSense, undoForget, editSense, readBackupData, restoreBackup, clearWordbook, setDisambiguation, readGroups, saveGroup, deleteGroup, saveSimilarWord, syncGroupWords };
})();

