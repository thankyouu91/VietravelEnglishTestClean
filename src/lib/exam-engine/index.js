const { getBlueprint } = require('./blueprint-loader');
const { selectListening, selectReading, selectWriting } = require('./selector');
const { shieldForClientV2 } = require('./shield');
const { restoreQuestionSet } = require('./restore');

function buildExam({ bank, position, positionInfo, config, blueprintVersion }) {
  const blueprint = getBlueprint(blueprintVersion);
  if (!blueprint) {
    throw new Error(`Blueprint ${blueprintVersion} not found`);
  }
  
  const bpSkills = blueprint.skills;
  const positionKey = positionInfo.management ? 'manager' : 'staff';
  
  // 1. Select items
  const listeningResult = selectListening(bank.listening, bpSkills.listening, positionKey);
  const readingResult = selectReading(bank.reading, bpSkills.reading, positionKey);
  const writingResult = selectWriting(bank.writing, bpSkills.writing, positionKey);
  
  const questionSet = {
    listening: listeningResult.items,
    reading: readingResult.items,
    writing: writingResult.items
  };
  
  const questionIds = {
    listening: questionSet.listening.map(q => q.id),
    reading: questionSet.reading.map(q => q.id),
    writing: questionSet.writing.map(q => q.id),
    _meta: {
      engineVersion: 'v2',
      blueprintVersion,
      examPlan: {
        engineVersion: 'v2',
        blueprintVersion,
        position: positionKey,
        generatedAt: Date.now(),
        skills: {
          listening: {
            scoreMax: bpSkills.listening.scoreMax,
            selectedGroups: listeningResult.selectedGroups,
            itemIds: questionSet.listening.map(q => q.id)
          },
          reading: {
            scoreMax: bpSkills.reading.scoreMax,
            selectedGroups: readingResult.selectedGroups,
            itemIds: questionSet.reading.map(q => q.id)
          },
          writing: {
            scoreMax: bpSkills.writing.scoreMax,
            itemIds: questionSet.writing.map(q => q.id)
          }
        }
      }
    }
  };
  
  return {
    questionSet,
    questionIds,
    examPlan: questionIds._meta.examPlan
  };
}

module.exports = {
  buildExam,
  shieldForClientV2,
  restoreQuestionSet
};
