function shieldForClientV2(questionSet) {
  const stripListeningReading = (q) => ({
    id: q.id,
    type: q.type || 'mcq',
    passageId: q.passageId,
    audioFile: q.audioFile,
    level: q.level,
    topic: q.topic,
    audio: q.audio,
    question: q.question,
    options: q.options,
    passage: q.passage,
  });

  const stripWriting = (q) => {
    const base = {
      id: q.id,
      level: q.level,
      topic: q.topic,
      type: q.type,
      instruction: q.instruction
    };
    
    switch (q.type) {
      case 'fill_blank':
        return {
          ...base,
          passage: q.passage,
          options: q.options,
          blanks: Object.keys(q.blanks || {}).reduce((o, k) => { o[k] = ''; return o; }, {})
        };
      case 'error_correction':
        return {
          ...base,
          sentences: (q.sentences || []).map(s => ({ original: s.original, options: s.options }))
        };
      case 'sentence_order':
        return {
          ...base,
          sentences: q.sentences
        };
      case 'sentence_transform':
        return {
          ...base,
          sentences: (q.sentences || []).map(s => ({ original: s.original, keyword: s.keyword }))
        };
      case 'controlled_response':
        // Renders via default free-write since it has prompt/minWords/maxWords
        return {
          ...base,
          prompt: q.prompt,
          minWords: q.minWords,
          maxWords: q.maxWords
        };
      default:
        return { ...base, prompt: q.prompt, options: q.options };
    }
  };

  return {
    listening: (questionSet.listening || []).map(stripListeningReading),
    reading:   (questionSet.reading || []).map(stripListeningReading),
    writing:   (questionSet.writing || []).map(stripWriting),
  };
}

module.exports = {
  shieldForClientV2
};
