function restoreQuestionSet(bank, idsObj) {
  const restore = (track) => {
    if (!bank[track] || !idsObj[track]) return [];
    const byId = Object.fromEntries(bank[track].map(q => [q.id, q]));
    return idsObj[track].map(id => byId[id]).filter(Boolean);
  };
  
  return {
    listening: restore('listening'),
    reading:   restore('reading'),
    writing:   restore('writing')
  };
}

module.exports = {
  restoreQuestionSet
};
