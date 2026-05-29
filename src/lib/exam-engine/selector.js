function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function fingerprint(q) {
  const content = q.passage || q.prompt || q.question || (q.sentences ? JSON.stringify(q.sentences) : '') || q.id;
  return (q.instruction || '') + '|' + content.slice(0, 60) + '|' + (q.type || '');
}

function selectListening(bankItems, bpSkill, position) {
  const activeItems = bankItems.filter(q => !q.status || q.status === 'active');
  const targetLevels = bpSkill.targetLevelsByPosition[position] || [];
  
  // Group by audioFile
  const groupMap = {};
  for (const q of activeItems) {
    const key = (q.audioFile || 'unknown').toLowerCase();
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(q);
  }
  
  // Sort groups by how many items match target levels
  const groups = Object.values(groupMap);
  groups.sort((a, b) => {
    const aTarget = a.filter(q => targetLevels.includes(q.level)).length;
    const bTarget = b.filter(q => targetLevels.includes(q.level)).length;
    return bTarget - aTarget || Math.random() - 0.5; // fallback to random
  });

  const selectedGroups = [];
  const selectedItems = [];
  const selectedGroupIds = [];
  
  let groupCount = bpSkill.audioGroups || 2;
  
  for (const group of groups) {
    if (selectedGroups.length >= groupCount) break;
    selectedGroups.push(group);
    selectedGroupIds.push(group[0].audioFile);
    selectedItems.push(...shuffle(group));
  }
  
  let finalItems = selectedItems;
  if (finalItems.length > bpSkill.maxQuestions) {
    finalItems = finalItems.slice(0, bpSkill.maxQuestions);
  }
  
  return {
    items: finalItems,
    selectedGroups: selectedGroupIds
  };
}

function selectReading(bankItems, bpSkill, position) {
  const activeItems = bankItems.filter(q => !q.status || q.status === 'active');
  const targetLevels = bpSkill.targetLevelsByPosition[position] || [];
  
  // Group by passageId or id
  const groupMap = {};
  for (const q of activeItems) {
    const key = (q.passageId || q.id).toLowerCase();
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(q);
  }
  
  const groups = Object.values(groupMap);
  groups.sort((a, b) => {
    const aTarget = a.filter(q => targetLevels.includes(q.level)).length;
    const bTarget = b.filter(q => targetLevels.includes(q.level)).length;
    return bTarget - aTarget || Math.random() - 0.5;
  });

  const selectedGroups = [];
  const selectedItems = [];
  const selectedGroupIds = [];
  
  let groupCount = bpSkill.passageGroups || 1;
  
  for (const group of groups) {
    if (selectedGroups.length >= groupCount) break;
    selectedGroups.push(group);
    selectedGroupIds.push(group[0].passageId || group[0].id);
    selectedItems.push(...group); // Usually reading questions have a strict order
  }
  
  let finalItems = selectedItems;
  if (finalItems.length > bpSkill.maxQuestions) {
    finalItems = finalItems.slice(0, bpSkill.maxQuestions);
  }
  
  return {
    items: finalItems,
    selectedGroups: selectedGroupIds
  };
}

function selectWriting(bankItems, bpSkill, position) {
  const activeItems = bankItems.filter(q => !q.status || q.status === 'active');
  const targetLevels = bpSkill.targetLevelsByPosition[position] || [];
  
  const typeTargets = { ...bpSkill.typeTargets };
  
  // Check if we have enough controlled_response. If not, use fallback.
  const hasControlled = activeItems.some(q => q.type === 'controlled_response');
  const targets = (typeTargets.controlled_response && !hasControlled)
    ? bpSkill.fallbackTypeTargets || typeTargets
    : typeTargets;

  const selectedItems = [];
  const seen = new Set();
  
  const itemsByType = {};
  for (const q of activeItems) {
    // Exclude short_answer from v2
    if (q.type === 'short_answer') continue;
    
    if (!itemsByType[q.type]) itemsByType[q.type] = [];
    itemsByType[q.type].push(q);
  }
  
  for (const [type, count] of Object.entries(targets)) {
    let needed = count;
    const available = shuffle(itemsByType[type] || []);
    
    // Prioritize target levels
    available.sort((a, b) => {
      const aMatch = targetLevels.includes(a.level) ? 1 : 0;
      const bMatch = targetLevels.includes(b.level) ? 1 : 0;
      return bMatch - aMatch;
    });
    
    for (const q of available) {
      if (needed <= 0) break;
      const fp = fingerprint(q);
      if (seen.has(fp)) continue;
      
      seen.add(fp);
      selectedItems.push(q);
      needed--;
    }
  }
  
  return { items: shuffle(selectedItems) };
}

module.exports = {
  selectListening,
  selectReading,
  selectWriting
};
