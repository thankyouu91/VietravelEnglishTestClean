function calcBandV2(total, position, skillScores, flags) {
  let isReview = flags && flags.writing_pending_review;
  let hasLowSkill = skillScores && (
    skillScores.listening < 3 || 
    skillScores.reading < 3 || 
    (skillScores.writing !== null && skillScores.writing < 4)
  );

  let band = { level: 'A1', status: 'fail', label: 'Beginner - below requirement' };

  if (position === 'manager') {
    if (total >= 27) band = { level: 'C2', status: 'pass', label: 'Proficient - strong manager result' };
    else if (total >= 23) band = { level: 'C1', status: 'pass', label: 'Advanced - meets manager requirement' };
    else if (total >= 18) band = { level: 'B2', status: 'review', label: 'Upper-Intermediate - review recommended' };
    else if (total >= 13) band = { level: 'B1', status: 'review', label: 'Intermediate - below manager target' };
    else band = { level: 'A2', status: 'fail', label: 'Elementary - below requirement' };
  } else {
    if (total >= 27) band = { level: 'B2', status: 'pass', label: 'Upper-Intermediate - excellent staff result' };
    else if (total >= 20) band = { level: 'B1', status: 'pass', label: 'Intermediate - meets staff requirement' };
    else if (total >= 11) band = { level: 'A2', status: 'review', label: 'Elementary - review recommended' };
    else band = { level: 'A1', status: 'fail', label: 'Beginner - below requirement' };
  }

  if (isReview) {
    band.status = 'pending_review';
  } else if (hasLowSkill && band.status === 'pass') {
    band.status = 'review';
    band.label += ' (Flagged for unbalanced skills)';
  }

  return band;
}

module.exports = {
  calcBandV2
};
