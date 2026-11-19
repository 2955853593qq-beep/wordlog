(() => {
  const FORMAT = 'WordlogBackup';
  const VERSION = 2;
  const READABLE_HEADER = 'Wordlog 完整备份（可读版 2）';
  const wordFields = [['单词', 'spelling'], ['单词编号', 'id'], ['规范拼写', 'normalized'], ['首次添加时间', 'createdAt'], ['待辨析', 'needsDisambiguation'], ['待辨析备注', 'disambiguationNote']];
  const senseFields = [['义项编号', 'id'], ['所属单词编号', 'wordId'], ['词性', 'pos'], ['释义', 'definition'], ['义项创建时间', 'createdAt']];
  const eventFields = [['记录编号', 'id'], ['忘记时间', 'occurredAt']];
  const groupFields = [['词组编号', 'id'], ['词组创建时间', 'createdAt'], ['词组修改时间', 'updatedAt'], ['辨析笔记', 'note']];
  const memberFields = [['成员单词', 'spelling'], ['关联单词编号', 'wordId'], ['词性', 'pos'], ['词义', 'definition']];
  // Escape line breaks without changing the original content on restoration.
  const escapeText = value => value.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  function unescapeText(value) {
    let result = '';
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== '\\') { result += value[i]; continue; }
      const character = value[++i];
      if (!['\\', 'r', 'n'].includes(character)) throw new Error('备份文本中的换行标记无效。');
      result += character === 'n' ? '\n' : character === 'r' ? '\r' : '\\';
    }
    return result;
  }
  function readableBackup(value) {
    const backup = validate(value);
    const hasGroups = backup.version === 2;
    const lines = [hasGroups ? READABLE_HEADER : 'Wordlog 完整备份（可读版 1）', `备份时间：${backup.exportedAt}`, `数据版本：${backup.databaseVersion}`, `单词总数：${backup.data.words.length}`, `义项总数：${backup.data.senses.length}`];
    if (hasGroups) lines.push(`易混词组总数：${backup.data.groups.length}`);
    function fields(record, specification, excluded = [], optional = []) {
      for (const [label, key] of specification) {
        if (optional.includes(key) && !Object.hasOwn(record, key)) continue;
        lines.push(`${label}：${typeof record[key] === 'boolean' ? (record[key] ? '是' : '否') : escapeText(record[key] ?? '')}`);
      }
      const known = new Set([...specification.map(([, key]) => key), ...excluded]);
      const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));
      lines.push(`附加字段：${Object.keys(extra).length ? JSON.stringify(extra) : '无'}`);
    }
    for (const word of backup.data.words) {
      lines.push('', '【单词】'); fields(word, wordFields); lines.push('【单词结束】');
    }
    const spellings = new Map(backup.data.words.map(word => [word.id, word.spelling]));
    for (const sense of backup.data.senses) {
      lines.push('', `【义项】`, `所属单词：${escapeText(spellings.get(sense.wordId))}`);
      fields(sense, senseFields, ['forgetRecords']);
      lines.push(`再次忘记次数：${sense.forgetRecords.length}`);
      for (const event of sense.forgetRecords) { lines.push('【忘记记录】'); fields(event, eventFields); lines.push('【忘记记录结束】'); }
      lines.push('【义项结束】');
    }
    for (const group of backup.data.groups || []) {
      lines.push('', '【易混词组】'); fields(group, groupFields, ['members']);
      lines.push(`成员数量：${group.members.length}`);
      for (const member of group.members) { lines.push('【词组成员】'); fields(member, memberFields, [], ['pos', 'definition']); lines.push('【词组成员结束】'); }
      lines.push('【易混词组结束】');
    }
    lines.push('', '【完整备份结束】');
    return lines.join('\n');
  }
  function parseReadable(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(line => line !== '');
    let position = 0;
    function take(label) {
      const line = lines[position++];
      if (!line?.startsWith(label + '：')) throw new Error(`备份不完整或格式有误：缺少“${label}”。`);
      return line.slice(label.length + 1);
    }
    function expect(marker) { if (lines[position++] !== marker) throw new Error(`备份不完整或格式有误：缺少“${marker}”。`); }
    function count(label) { const value = take(label); if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${label}无效。`); return Number(value); }
    function fields(specification, excluded = [], optional = []) {
      const record = {};
      for (const [label, key] of specification) {
        if (optional.includes(key) && !lines[position]?.startsWith(label + '：')) continue;
        const value = take(label);
        if (key === 'needsDisambiguation') {
          if (!['是', '否'].includes(value)) throw new Error('待辨析状态无效。');
          record[key] = value === '是';
        } else record[key] = key === 'wordId' && value === '' ? null : unescapeText(value);
      }
      const extraText = take('附加字段');
      if (extraText !== '无') {
        const extra = JSON.parse(extraText);
        if (!extra || typeof extra !== 'object' || Array.isArray(extra) || Object.keys(extra).some(key => Object.hasOwn(record, key) || excluded.includes(key))) throw new Error('附加字段无效。');
        for (const [key, value] of Object.entries(extra)) Object.defineProperty(record, key, { value, enumerable: true, writable: true, configurable: true });
      }
      return record;
    }
    const version = lines[0] === READABLE_HEADER ? 2 : 1;
    expect(version === 2 ? READABLE_HEADER : 'Wordlog 完整备份（可读版 1）');
    const exportedAt = take('备份时间'); const databaseVersion = count('数据版本');
    const wordCount = count('单词总数'); const senseCount = count('义项总数');
    const groupCount = version === 2 ? count('易混词组总数') : 0;
    const words = []; const senses = []; const groups = [];
    for (let i = 0; i < wordCount; i++) { expect('【单词】'); words.push(fields(wordFields)); expect('【单词结束】'); }
    const spellings = new Map(words.map(word => [word.id, word.spelling]));
    for (let i = 0; i < senseCount; i++) {
      expect('【义项】'); const spelling = unescapeText(take('所属单词')); const sense = fields(senseFields, ['forgetRecords']);
      if (spellings.get(sense.wordId) !== spelling) throw new Error('义项所属单词不一致。');
      const forgetCount = count('再次忘记次数'); sense.forgetRecords = [];
      for (let j = 0; j < forgetCount; j++) { expect('【忘记记录】'); sense.forgetRecords.push(fields(eventFields)); expect('【忘记记录结束】'); }
      expect('【义项结束】'); senses.push(sense);
    }
    for (let i = 0; i < groupCount; i++) {
      expect('【易混词组】'); const group = fields(groupFields, ['members']);
      const memberCount = count('成员数量'); group.members = [];
      for (let j = 0; j < memberCount; j++) { expect('【词组成员】'); group.members.push(fields(memberFields, [], ['pos', 'definition'])); expect('【词组成员结束】'); }
      expect('【易混词组结束】'); groups.push(group);
    }
    expect('【完整备份结束】');
    if (position !== lines.length) throw new Error('完整备份结束后有多余内容。');
    return { format: FORMAT, version, databaseVersion, exportedAt, data: { words, senses, ...(version === 2 ? { groups } : {}) } };
  }
  function validate(value) {
    let backup;
    try { backup = typeof value === 'string' ? (value.trim().startsWith('Wordlog') ? parseReadable(value.trim()) : JSON.parse(value)) : JSON.parse(JSON.stringify(value)); }
    catch (error) { throw new Error(`请粘贴未删改的完整备份文本。${error.message}`); }
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string';
    const id = value => text(value) && value.trim().length > 0;
    const date = value => text(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
    const require = (valid, message) => { if (!valid) throw new Error(message); };
    require(object(backup) && backup.format === FORMAT, '这不是 Wordlog 完整备份，可读词表不能用于恢复。');
    require((backup.version === 1 && backup.databaseVersion === 1) || (backup.version === 2 && backup.databaseVersion === 2), '备份版本不兼容，未修改现有数据。');
    require(date(backup.exportedAt), '备份导出时间缺失或无效。');
    require(object(backup.data) && Array.isArray(backup.data.words) && Array.isArray(backup.data.senses), '备份缺少完整的单词或义项列表。');
    require(Object.keys(backup.data).every(key => ['words', 'senses', ...(backup.version === 2 ? ['groups'] : [])].includes(key)), '备份包含不兼容的数据仓库。');
    require(backup.version !== 2 || Array.isArray(backup.data.groups), '备份缺少易混词组列表。');
    const wordIds = new Set(); const normalized = new Set(); const senseIds = new Set(); const eventIds = new Set();
    for (const word of backup.data.words) {
      require(object(word) && id(word.id) && text(word.spelling) && word.spelling.trim() && text(word.normalized), '单词记录缺少有效的 ID 或拼写。');
      require(word.normalized === word.spelling.trim().toLowerCase(), '单词规范化拼写不一致。');
      require(!wordIds.has(word.id) && !normalized.has(word.normalized), '备份包含重复单词 ID 或拼写。');
      require(date(word.createdAt) && typeof word.needsDisambiguation === 'boolean' && text(word.disambiguationNote), '单词的时间或待辨析字段不完整。');
      wordIds.add(word.id); normalized.add(word.normalized);
    }
    for (const sense of backup.data.senses) {
      require(object(sense) && id(sense.id) && !senseIds.has(sense.id), '备份包含无效或重复的义项 ID。');
      require(wordIds.has(sense.wordId), '义项关联的单词不存在。');
      require(text(sense.pos) && text(sense.definition) && sense.definition.trim() && date(sense.createdAt) && Array.isArray(sense.forgetRecords), '义项的词性、释义、时间或忘记记录不完整。');
      senseIds.add(sense.id);
      for (const event of sense.forgetRecords) {
        require(object(event) && id(event.id) && !eventIds.has(event.id) && date(event.occurredAt), '忘记事件的 ID 或时间无效，或事件重复。');
        eventIds.add(event.id);
      }
    }
    const groupIds = new Set();
    const wordMap = new Map(backup.data.words.map(word => [word.id, word]));
    const senseMap = new Map(backup.data.senses.map(sense => [sense.id, sense]));
    for (const group of backup.data.groups || []) {
      require(object(group) && id(group.id) && !groupIds.has(group.id) && date(group.createdAt) && date(group.updatedAt) && text(group.note) && Array.isArray(group.members) && group.members.length >= 1, '相似单词组的 ID、时间、备注或成员列表无效。');
      groupIds.add(group.id); const spellings = new Set();
      require(group.anchorId === undefined || group.members.some(member => member.wordId === group.anchorId && wordMap.has(group.anchorId)), '相似单词组的主词关联无效。');
      for (const member of group.members) {
        require(object(member) && text(member.spelling) && member.spelling.trim(), '易混词组成员拼写无效。');
        require((member.pos === undefined || text(member.pos)) && (member.definition === undefined || text(member.definition)), '相似单词的词性或词义无效。');
        const normalized = member.spelling.trim().toLowerCase();
        require(!spellings.has(normalized), '易混词组包含重复成员。'); spellings.add(normalized);
        require(member.wordId === null || (wordMap.has(member.wordId) && wordMap.get(member.wordId).normalized === normalized), '易混词组关联单词无效。');
        require(member.senseId === undefined || (senseMap.has(member.senseId) && senseMap.get(member.senseId).wordId === member.wordId), '相似单词关联义项无效。');
      }
    }
    return backup;
  }
  function readableWordlist(data) {
    const lines = ['Wordlog · 我的词书', ''];
    for (const word of data.words) {
      lines.push(word.spelling);
      for (const sense of data.senses.filter(sense => sense.wordId === word.id)) {
        const count = (sense.forgetRecords || []).length;
        lines.push(`${sense.pos ? sense.pos + ' ' : ''}${sense.definition}${count ? `（再次忘记 ${count} 次）` : ''}`);
      }
      lines.push('');
    }
    if (!data.words.length) lines.push('词书还是空的。');
    return lines.join('\n').trim();
  }
  function init({ isBusy, onRestored }) {
    const $ = id => document.getElementById(id);
    let checked = null; let copying = false;
    const status = (message, error = false) => {
      $('backup-status').textContent = message;
      $('backup-status').classList.toggle('error', error);
    };
    const invalidate = () => { checked = null; $('restore-backup').disabled = true; };
    $('copy-backup').disabled = false; $('check-backup').disabled = false;
    $('copy-wordlist').disabled = false;
    $('download-txt').addEventListener('click', async () => {
      try {
        const data = await window.WordlogDB.readBackupData();
        const url = URL.createObjectURL(new Blob(['\ufeff' + readableWordlist(data)], {type:'text/plain;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url; link.download = 'Wordlog.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) { status('导出失败：' + error.message, true); }
    });
    $('clear-wordbook').disabled = false;
    $('clear-wordbook').addEventListener('click', async () => {
      if (api.restoring || isBusy()) { status('请先完成当前编辑或保存。', true); return; }
      if (!confirm('确定清空当前浏览器中的全部单词、义项、忘记历史和旧词组吗？清空后只能使用之前的完整备份恢复。')) return;
      api.restoring = true; $('clear-wordbook').disabled = true;
      try { await window.WordlogDB.clearWordbook(); invalidate(); await onRestored(); status('词书已清空，可以重新开始添加。'); }
      catch (error) { status(error.message, true); }
      finally { api.restoring = false; $('clear-wordbook').disabled = false; }
    });
    $('select-wordlist').addEventListener('click', () => {
      $('wordlist-output').focus(); $('wordlist-output').select();
      $('wordlist-output').setSelectionRange(0, $('wordlist-output').value.length);
    });
    $('copy-wordlist').addEventListener('click', async () => {
      if (api.restoring) return;
      $('copy-wordlist').disabled = true;
      $('wordlist-fallback').hidden = true;
      try {
        const text = readableWordlist(await window.WordlogDB.readBackupData());
        try {
          await navigator.clipboard.writeText(text);
          $('wordlist-status').textContent = '可读词表已复制，可以粘贴到备忘录查看。';
        } catch {
          $('wordlist-output').value = text; $('wordlist-fallback').hidden = false;
          $('wordlist-output').focus(); $('wordlist-output').select();
          $('wordlist-status').textContent = '自动复制未成功，请全选下方词表后手动复制。';
        }
      } catch (error) { $('wordlist-status').textContent = `复制失败：${error.message}`; }
      finally { $('copy-wordlist').disabled = false; }
    });
    $('backup-input').addEventListener('input', () => { invalidate(); status('文本已修改，请重新检查备份。'); });
    $('select-backup').addEventListener('click', () => { $('backup-output').focus(); $('backup-output').select(); $('backup-output').setSelectionRange(0, $('backup-output').value.length); });
    $('copy-backup').addEventListener('click', async () => {
      if (copying || api.restoring) return;
      copying = true; $('copy-backup').disabled = true;
      $('backup-fallback').hidden = true; $('backup-output').value = '';
      try {
        const backup = { format: FORMAT, version: VERSION, databaseVersion: 2, exportedAt: new Date().toISOString(), data: await window.WordlogDB.readBackupData() };
        validate(backup);
        const text = readableBackup(backup);
        try {
          await navigator.clipboard.writeText(text);
          status(`完整备份已复制：${backup.data.words.length} 个单词、${backup.data.senses.length} 个义项、${backup.data.groups.length} 个易混词组。`);
        } catch {
          $('backup-output').value = text; $('backup-fallback').hidden = false;
          $('backup-output').focus(); $('backup-output').select();
          status('自动复制未成功。请点击“全选备份文本”，再手动复制。');
        }
      } catch (error) { status(`备份失败：${error.message}`, true); }
      finally { copying = false; $('copy-backup').disabled = false; }
    });
    $('check-backup').addEventListener('click', () => {
      invalidate();
      try {
        checked = validate($('backup-input').value);
        status(`检查通过：${checked.data.words.length} 个单词、${checked.data.senses.length} 个义项、${(checked.data.groups || []).length} 个易混词组。${checked.data.words.length ? '' : '这是一份空词书备份。'}`);
        $('restore-backup').disabled = false;
      } catch (error) { status(error.message, true); }
    });
    $('restore-backup').addEventListener('click', async () => {
      if (!checked || api.restoring) return;
      if (isBusy()) { status('请先完成当前的保存或义项编辑，再恢复词书。', true); return; }
      let backup;
      try { backup = validate($('backup-input').value); }
      catch (error) { invalidate(); status(error.message, true); return; }
      if (!window.confirm(`当前设备上的 Wordlog 数据将被完整替换为备份中的 ${backup.data.words.length} 个单词、${backup.data.senses.length} 个义项、${(backup.data.groups || []).length} 个易混词组。此操作不会合并数据。确定恢复词书吗？`)) return;
      api.restoring = true;
      ['restore-backup', 'copy-backup', 'check-backup', 'backup-input'].forEach(id => { $(id).disabled = true; });
      status('正在恢复词书…');
      try {
        await window.WordlogDB.restoreBackup(backup);
        await onRestored();
        status(`恢复完成：${backup.data.words.length} 个单词、${backup.data.senses.length} 个义项、${(backup.data.groups || []).length} 个易混词组。`);
      } catch (error) { status(`恢复未完成：${error.message}`, true); }
      finally {
        api.restoring = false; invalidate();
        ['copy-backup', 'check-backup', 'backup-input'].forEach(id => { $(id).disabled = false; });
      }
    });
  }
  const api = { validate, readableBackup, readableWordlist, init, restoring: false };
  window.WordlogBackup = api;
})();
