#!/usr/bin/env node
/**
 * One-shot migration: convert legacy writing items (gap-fill template + gaps,
 * or essay keywords) into the new `short_answer` schema graded by the LLM
 * rubric grader (src/lib/llm-grader.js).
 *
 * Run once per bank file:
 *   node scripts/migrate-writing-to-short-answer.js data/banks.json
 *   node scripts/migrate-writing-to-short-answer.js data/sample-bank.json
 *
 * After migration the script asserts every writing item has `type: short_answer`
 * and exits non-zero if any item failed to convert.
 */

const fs = require('fs');
const path = require('path');

const LENGTH_BY_LEVEL = {
  A2: { minWords: 30, maxWords: 70 },
  B1: { minWords: 50, maxWords: 100 },
  B2: { minWords: 70, maxWords: 130 },
  C1: { minWords: 100, maxWords: 160 },
  C2: { minWords: 120, maxWords: 180 },
};

const RUBRIC_BY_LEVEL = {
  A2: [
    { name: 'Task completion', weight: 0.40, description: 'Includes all the requested information; addresses the prompt directly.' },
    { name: 'Grammar accuracy', weight: 0.30, description: 'Simple present/past tenses, articles, plurals, basic word order at A2 level.' },
    { name: 'Vocabulary range', weight: 0.20, description: 'Uses everyday hospitality vocabulary correctly; no L1 transfer errors that block meaning.' },
    { name: 'Tone & format',     weight: 0.10, description: 'Polite, customer-facing tone; greeting and closing appropriate for the channel.' },
  ],
  B1: [
    { name: 'Task completion', weight: 0.35, description: 'Covers every required point; details are relevant and concrete.' },
    { name: 'Grammar accuracy', weight: 0.30, description: 'Connectors, modals, prepositions, and tenses used correctly at B1 level.' },
    { name: 'Vocabulary range', weight: 0.20, description: 'Some range of hospitality / customer-service phrases; minor word-choice errors acceptable.' },
    { name: 'Tone & coherence', weight: 0.15, description: 'Logical paragraph flow; professional, hospitable register.' },
  ],
  B2: [
    { name: 'Task completion', weight: 0.30, description: 'Fully addresses the scenario including any nuance (apology, justification, next steps).' },
    { name: 'Grammar accuracy', weight: 0.30, description: 'Complex sentences, conditionals, passive voice used accurately at B2 level.' },
    { name: 'Vocabulary range', weight: 0.20, description: 'Precise hospitality and business vocabulary; appropriate collocations.' },
    { name: 'Tone & coherence', weight: 0.20, description: 'Diplomatic, professional tone; clear discourse organization with transitions.' },
  ],
  C1: [
    { name: 'Task completion', weight: 0.30, description: 'Comprehensive treatment of an analytical or persuasive task; supported reasoning.' },
    { name: 'Grammar & syntax', weight: 0.25, description: 'Wide range of structures handled accurately; few non-systematic errors.' },
    { name: 'Vocabulary precision', weight: 0.25, description: 'Precise business / management lexis; near-native collocation and register.' },
    { name: 'Argument & cohesion', weight: 0.20, description: 'Well-developed argument with cohesive devices, clear paragraphing, executive tone.' },
  ],
  C2: [
    { name: 'Task completion', weight: 0.25, description: 'Sophisticated executive-level communication with strategic framing and risk-aware reasoning.' },
    { name: 'Grammar & syntax', weight: 0.25, description: 'Mastery of complex syntax; essentially error-free.' },
    { name: 'Vocabulary precision', weight: 0.25, description: 'Idiomatic, domain-precise board-level vocabulary; nuanced register choices.' },
    { name: 'Argument & rhetoric', weight: 0.25, description: 'Sophisticated argument structure, balanced tone, persuasive without overstatement.' },
  ],
};

// Per-item prompt + topic. The id keys are the existing item ids; the value
// is the new candidate-facing task. Levels stay as set in the original bank.
const PROMPTS = {
  // ── BANK_STAFF A2 ──────────────────────────────────────────────────────
  W1:  { topic: 'Hotel Confirmation Email',
         prompt: 'Write a short reply to Mr. Nguyen confirming his hotel reservation for 3 nights from August 5 to August 8. Mention the room rate ($150/night including breakfast), the total cost, and that check-in is from 14:00. Use a polite, customer-facing tone.' },
  W6:  { topic: 'Welcome Message',
         prompt: 'Write a short welcome note for Ms. Chen on arrival at Pearl Bay Resort. Tell her the room number (412, fourth floor), the wifi name ("PearlGuest") and password ("welcome2026"), and breakfast hours (06:30–10:00). Keep it warm and brief.' },
  WA3: { topic: 'Tour Reminder',
         prompt: 'Write a short reminder message to Mr. Tanaka that his city tour starts tomorrow at 08:00. Tell him to meet the guide in the hotel lobby 15 minutes early and to bring water and a hat.' },
  WA4: { topic: 'Booking Information',
         prompt: 'Write a short note giving a newly arrived guest their key information: room 305, breakfast at the Garden Restaurant from 06:00 to 10:00, and the pool open until 22:00. Polite tone.' },
  WA5: { topic: 'Payment Confirmation',
         prompt: 'Write a short email thanking a guest for their payment of $480 for booking #VTV-2026-1107 and confirming that the booking is now fully paid. Mention that a receipt is attached.' },
  WA6: { topic: 'Check-in Instructions',
         prompt: 'Write a short set of instructions for a guest arriving today: show passport at the front desk, sign the registration card, and a porter will take their luggage to the room. Polite and clear.' },
  WA7: { topic: 'Restaurant Booking',
         prompt: 'Write a short reply confirming a dinner reservation for 4 guests at 19:30 tonight in the hotel restaurant. Mention that the table is by the window as requested and ask the guest to arrive on time.' },
  WA8: { topic: 'Tour Welcome',
         prompt: 'Write a short message to a tour guest arriving in Hanoi tomorrow. Introduce their tour guide David, say he will meet them at the hotel lobby at 08:00, and tell them what to bring (passport, comfortable shoes).' },

  // ── BANK_STAFF B1 ──────────────────────────────────────────────────────
  W2:  { topic: 'Tour Package Description',
         prompt: 'Write a short description of our 3-day Halong Bay cruise package for the website. Mention overnight accommodation on a luxury boat, all meals, a kayaking session on the morning of day 2, and price ($420 per person). Make it sound appealing.' },
  W7:  { topic: 'Itinerary Description',
         prompt: 'Write a short paragraph describing day 3 of a Vietnam tour: a Vietnamese cooking class where participants learn to prepare pho and spring rolls, followed by lunch with the class. Include start time (09:00) and what guests should bring.' },
  WB3: { topic: 'Booking Modification',
         prompt: 'Write a short email confirming that you have moved a guest\'s reservation from October 12–14 to October 15–17. Explain that an additional charge of $40/night applies because of the higher weekend rate, and ask the guest to confirm acceptance.' },
  WB4: { topic: 'Travel Inquiry Response',
         prompt: 'Write a short reply to a customer asking about the 5-day Halong Bay package. State that the total cost ($820 per person) includes return flights from Ho Chi Minh City, 4 nights\' hotel, all meals, and the tour activities. Offer to send a detailed itinerary.' },
  WB5: { topic: 'Guest Feedback Reply',
         prompt: 'Write a short reply to a guest who complained about slow check-in. Acknowledge the problem, apologize, explain that you have added two more reception staff during peak hours, and thank them for the feedback.' },
  WB6: { topic: 'Group Booking',
         prompt: 'Write a short email explaining your group booking policy to a corporate client. Groups of 10 or more guests get a 15% discount on room rates, but only when booking at least 14 days in advance. Mention how to confirm a group booking.' },
  WB7: { topic: 'Late Arrival Notice',
         prompt: 'Write a short reply to a guest who told you they will arrive late tonight. Confirm that you will hold their room until 23:00, explain that after that time you cannot guarantee the room, and ask them to call if they will be even later.' },
  WB8: { topic: 'Service Request',
         prompt: 'Write a short concierge message offering services during the guest\'s stay: 24-hour room service at extension 0, laundry collected before 09:00 returned same day, and a tour-booking desk in the lobby. Helpful, professional tone.' },

  // ── BANK_STAFF B2 ──────────────────────────────────────────────────────
  W3:  { topic: 'Customer Service Response',
         prompt: 'Write a short reply to a guest who complained that the air conditioning was broken for two nights during their recent stay. Apologize sincerely, explain what corrective action you have taken (replaced the unit, briefed engineering on faster response), and offer a 20% refund on those two nights. Diplomatic, professional tone.' },
  W4:  { topic: 'Hotel Marketing',
         prompt: 'Write a short marketing paragraph for the newly renovated rooms at our hotel. Highlight panoramic city views, state-of-the-art amenities (rainfall shower, smart TV, espresso machine), and the executive lounge access included with these rooms. Aim the text at business travellers.' },
  WB9: { topic: 'Complaint Handling',
         prompt: 'Write a short letter responding to a complaint about poor cleanliness in a guest\'s room. Acknowledge the issue, explain that the housekeeping team has been retrained and the supervisor briefed, offer a complimentary night on their next stay, and invite them to contact you directly if anything else arises.' },
  WB10:{ topic: 'Email Communication',
         prompt: 'Write a short professional email to a guest summarising three things: (1) their booking #VTV-2026-0847 has been confirmed, (2) a deposit of $200 is required by Friday to secure the room, and (3) free airport pick-up is available if they share their flight details. End with a polite closing.' },

  // ── BANK_OFFICE_MGR B2 / C1 / C2 ───────────────────────────────────────
  OM_W1: { topic: 'Internal Compliance Memo',
           prompt: 'Write a short internal memo announcing a new expense policy: from December 1, all expense submissions exceeding 5,000,000 VND must have pre-approval from the immediate supervisor before the expense is incurred. Reference the Q2 internal audit recommendation, explain why the change is needed, and tell staff where to find the new approval form.' },
  OM_W2: { topic: 'Complaint Resolution Letter — Back Office',
           prompt: 'Write a short letter from the Operations team to a tour partner who complained that two of our group bookings were cancelled with less than 48 hours\' notice last month. Acknowledge the impact, summarise the corrective actions you have implemented (new approval workflow, weekly capacity review), and propose a meeting to rebuild confidence.' },
  OM_W3: { topic: 'HR Briefing — Attrition',
           prompt: 'Write a short HR briefing for the executive team on Q3 attrition. Q3 exit-interview data shows attrition is primarily driven by compensation gaps (45% of departures cited pay), with manager quality (22%) and career path (18%) secondary. Recommend a market-rate review for the three most-affected roles and a 12-month manager-coaching programme, and quantify the expected reduction in attrition (from 32% to 24% by end-2027).' },
  OM_W4: { topic: 'Audit Response',
           prompt: 'Write a short formal response to the Compliance Committee\'s recent findings. Confirm that you have developed a remediation roadmap, that all high-risk items will be closed within 60 days (ahead of the regulatory 90-day deadline), and outline the governance: weekly status to the Committee chair and an independent verification by Internal Audit before sign-off.' },
  OM_W5: { topic: 'Board Recommendation',
           prompt: 'Write a short board paper recommending an increase in cyber-insurance coverage from 200 billion VND to 400 billion VND. Justify the increase using the asymmetric risk profile evident in recent peer-event payouts (cite the range — 280–520 billion), quantify the marginal premium (~1.8 billion VND/year), and argue why failure to act would expose the balance sheet to existential risk in a worst-case ransomware scenario. Persuasive, balanced executive tone.' },
};

function migrateItem(orig) {
  if (orig.type === 'short_answer') return orig; // idempotent
  const length = LENGTH_BY_LEVEL[orig.level];
  const rubric = RUBRIC_BY_LEVEL[orig.level];
  if (!length || !rubric) {
    throw new Error(`Unsupported level "${orig.level}" on item ${orig.id}.`);
  }

  // Two source shapes to cover:
  //   1. Gap-fill items (template + gaps) — no usable candidate prompt; use the
  //      hand-written prompt from PROMPTS below.
  //   2. Essay items (prompt + keywords + minWords) — already have a candidate
  //      prompt; keep it, drop the keyword-overlap scoring, attach the rubric.
  const meta = PROMPTS[orig.id];
  const hasOwnPrompt = typeof orig.prompt === 'string' && orig.prompt.trim().length > 0;

  let prompt, topic;
  if (meta) {
    prompt = meta.prompt;
    topic  = meta.topic;
  } else if (hasOwnPrompt) {
    prompt = orig.prompt;
    topic  = orig.topic;
  } else {
    throw new Error(`No short_answer prompt for writing id "${orig.id}". Add it to PROMPTS in scripts/migrate-writing-to-short-answer.js.`);
  }

  return {
    id: orig.id,
    level: orig.level,
    topic,
    type: 'short_answer',
    prompt,
    minWords: orig.minWords ?? length.minWords,
    maxWords: orig.maxWords ?? length.maxWords,
    rubric: { criteria: rubric },
  };
}

function migrateBank(bankObj) {
  for (const bankName of Object.keys(bankObj)) {
    const bank = bankObj[bankName];
    if (!bank.writing) continue;
    bank.writing = bank.writing.map(migrateItem);
  }
  return bankObj;
}

function assertAllShortAnswer(bankObj) {
  const offenders = [];
  for (const [bankName, bank] of Object.entries(bankObj)) {
    if (!bank.writing) continue;
    bank.writing.forEach((item, idx) => {
      if (item.type !== 'short_answer') {
        offenders.push(`${bankName}.writing[${idx}] id=${item.id}`);
      }
    });
  }
  if (offenders.length > 0) {
    throw new Error(`Items still missing short_answer type:\n  - ${offenders.join('\n  - ')}`);
  }
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error('Usage: node scripts/migrate-writing-to-short-answer.js <bank.json> [<bank.json> ...]');
    process.exit(2);
  }
  for (const target of targets) {
    const abs = path.resolve(target);
    const raw = fs.readFileSync(abs, 'utf8');
    const bank = JSON.parse(raw);
    const migrated = migrateBank(bank);
    assertAllShortAnswer(migrated);
    fs.writeFileSync(abs, JSON.stringify(migrated, null, 2) + '\n');
    console.log(`✓ migrated ${target}`);
  }
}

if (require.main === module) main();
