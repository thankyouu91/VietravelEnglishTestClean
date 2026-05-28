/**
 * Generate 50 unique writing questions for the Vietravel English Test
 * Types: fill_blank, error_correction, sentence_order, sentence_transform
 * All auto-scorable, no AI needed.
 */
const fs = require('fs');
const path = require('path');

const levels = ['A2', 'B1', 'B1', 'B2', 'B2', 'C1'];

// ── FILL BLANK questions (unique passages) ─────────────────
const fillBlankData = [
  {
    level: 'A2', topic: 'Hotel Welcome Email',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Dear Guest, Your ___1___ at Sunrise Hotel is confirmed for ___2___ nights. Check-in time is ___3___ PM. Please bring your ___4___ for identification. We look forward to ___5___ you.',
    options: ['reservation', 'three', '2:00', 'passport', 'welcoming', 'booking', 'two'],
    blanks: { '1': 'reservation', '2': 'three', '3': '2:00', '4': 'passport', '5': 'welcoming' }
  },
  {
    level: 'A2', topic: 'Restaurant Menu',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Today\'s ___1___ is grilled salmon with vegetables. All main courses include a ___2___ drink and ___3___. Please inform your ___4___ of any food ___5___.',
    options: ['special', 'free', 'dessert', 'waiter', 'allergies', 'menu', 'price'],
    blanks: { '1': 'special', '2': 'free', '3': 'dessert', '4': 'waiter', '5': 'allergies' }
  },
  {
    level: 'B1', topic: 'Tour Itinerary',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'The city ___1___ starts at 8 AM from the hotel ___2___. Our first stop is the ___3___ market where you can buy ___4___. Lunch will be at a ___5___ restaurant near the river.',
    options: ['tour', 'lobby', 'floating', 'souvenirs', 'traditional', 'morning', 'local'],
    blanks: { '1': 'tour', '2': 'lobby', '3': 'floating', '4': 'souvenirs', '5': 'traditional' }
  },
  {
    level: 'B1', topic: 'Flight Announcement',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Flight VN205 to Hanoi is now ___1___ at Gate 12. All ___2___ please proceed to the boarding area. ___3___ luggage must be stored in the ___4___ compartment. We expect to ___5___ on time.',
    options: ['boarding', 'passengers', 'Carry-on', 'overhead', 'depart', 'arrive', 'delayed'],
    blanks: { '1': 'boarding', '2': 'passengers', '3': 'Carry-on', '4': 'overhead', '5': 'depart' }
  },
  {
    level: 'B1', topic: 'Spa Services',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Our spa ___1___ include traditional Vietnamese ___2___, hot stone therapy, and facial ___3___. Each session lasts ___4___ minutes. Please ___5___ at least one hour in advance.',
    options: ['services', 'massage', 'treatments', 'sixty', 'book', 'offer', 'ninety'],
    blanks: { '1': 'services', '2': 'massage', '3': 'treatments', '4': 'sixty', '5': 'book' }
  },
  {
    level: 'B2', topic: 'Business Conference',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Our ___1___ center is equipped with state-of-the-art ___2___ systems. The main hall can ___3___ up to 500 delegates. ___4___ services and simultaneous ___5___ are available upon request.',
    options: ['conference', 'audiovisual', 'accommodate', 'Catering', 'translation', 'meeting', 'interpretation'],
    blanks: { '1': 'conference', '2': 'audiovisual', '3': 'accommodate', '4': 'Catering', '5': 'translation' }
  },
  {
    level: 'B2', topic: 'Customer Complaint Response',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'We sincerely ___1___ for the inconvenience you ___2___ during your stay. Your ___3___ has been forwarded to our ___4___ team. As compensation, we would like to ___5___ a complimentary upgrade.',
    options: ['apologize', 'experienced', 'complaint', 'management', 'offer', 'sorry', 'provide'],
    blanks: { '1': 'apologize', '2': 'experienced', '3': 'complaint', '4': 'management', '5': 'offer' }
  },
  {
    level: 'B2', topic: 'Travel Insurance',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Our travel ___1___ covers medical emergencies, trip ___2___, and lost ___3___. The policy is ___4___ from the date of purchase until your ___5___ home.',
    options: ['insurance', 'cancellation', 'luggage', 'valid', 'return', 'coverage', 'arrival'],
    blanks: { '1': 'insurance', '2': 'cancellation', '3': 'luggage', '4': 'valid', '5': 'return' }
  },
  {
    level: 'C1', topic: 'Quarterly Report',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'The quarterly ___1___ will be presented at the board ___2___ on Friday. Revenue ___3___ by 15% compared to the previous ___4___. Our market ___5___ in Southeast Asia has expanded significantly.',
    options: ['report', 'meeting', 'increased', 'quarter', 'share', 'results', 'grew'],
    blanks: { '1': 'report', '2': 'meeting', '3': 'increased', '4': 'quarter', '5': 'share' }
  },
  {
    level: 'C1', topic: 'Partnership Proposal',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'We would like to ___1___ a strategic partnership with your ___2___. Our combined ___3___ would enable us to reach new ___4___ and enhance customer ___5___ across the region.',
    options: ['propose', 'organization', 'expertise', 'markets', 'satisfaction', 'suggest', 'resources'],
    blanks: { '1': 'propose', '2': 'organization', '3': 'expertise', '4': 'markets', '5': 'satisfaction' }
  },
  {
    level: 'C1', topic: 'Sustainability Report',
    instruction: 'Complete the text with the correct words from the box.',
    passage: 'Revenue ___1___ by 22% compared to last year. Our sustainability ___2___ have reduced carbon ___3___ by 30%. Employee ___4___ rates improved following the new ___5___ program.',
    options: ['grew', 'initiatives', 'emissions', 'retention', 'wellness', 'increased', 'footprint'],
    blanks: { '1': 'grew', '2': 'initiatives', '3': 'emissions', '4': 'retention', '5': 'wellness' }
  },
];

// ── ERROR CORRECTION questions ─────────────────────────────
const errorCorrectionData = [
  {
    level: 'A2', topic: 'Basic Travel Phrases',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'I would like to booking a room for two nights.', options: ['I would like to book a room for two nights.', 'I would like booking a room for two nights.', 'I would like to booking rooms for two nights.'], correct: 0 },
      { original: 'The hotel have a swimming pool and gym.', options: ['The hotel has a swimming pool and gym.', 'The hotel have swimming pool and gym.', 'The hotels have a swimming pool and gym.'], correct: 0 },
      { original: 'Can you tell me where is the airport?', options: ['Can you tell me where the airport is?', 'Can you tell me where are the airport?', 'Can you telling me where is the airport?'], correct: 0 },
    ]
  },
  {
    level: 'B1', topic: 'Tour Guide Instructions',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'Please to remember bringing your camera for the tour.', options: ['Please remember to bring your camera for the tour.', 'Please to remember to bring your camera for the tour.', 'Please remember bringing your camera for the tour.'], correct: 0 },
      { original: 'The bus will departs at exactly 7 AM tomorrow.', options: ['The bus will depart at exactly 7 AM tomorrow.', 'The bus will departs at exactly 7 AM tomorrows.', 'The bus departs will at exactly 7 AM tomorrow.'], correct: 0 },
      { original: 'Each guest are required to show their passport.', options: ['Each guest is required to show their passport.', 'Each guests are required to show their passport.', 'Each guest are required to showing their passport.'], correct: 0 },
    ]
  },
  {
    level: 'B1', topic: 'Email Writing',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'I am writing to enquire about your available packages.', options: ['I am writing to enquire about your available packages.', 'I am write to enquire about your available packages.', 'I writing to enquire about your available packages.'], correct: 0 },
      { original: 'We would be grateful if you could sent us a brochure.', options: ['We would be grateful if you could send us a brochure.', 'We would be grateful if you could sent us brochure.', 'We would be grateful if you can sent us a brochure.'], correct: 0 },
      { original: 'I look forward to hear from you soon.', options: ['I look forward to hearing from you soon.', 'I look forward to hear from you sooner.', 'I looking forward to hear from you soon.'], correct: 0 },
    ]
  },
  {
    level: 'B2', topic: 'Business Communication',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'The meeting has been postponed due of bad weather.', options: ['The meeting has been postponed due to bad weather.', 'The meeting has been postponed due for bad weather.', 'The meeting has postponed due of bad weather.'], correct: 0 },
      { original: 'Neither the manager nor the staff was informed about the change.', options: ['Neither the manager nor the staff were informed about the change.', 'Neither the manager nor the staff was inform about the change.', 'Neither the manager or the staff was informed about the change.'], correct: 0 },
      { original: 'The company has been operating since twenty years.', options: ['The company has been operating for twenty years.', 'The company has been operating since twenty year.', 'The company is operating since twenty years.'], correct: 0 },
    ]
  },
  {
    level: 'B2', topic: 'Customer Service',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'We apologize for any inconvenient caused during your stay.', options: ['We apologize for any inconvenience caused during your stay.', 'We apologize for any inconvenient cause during your stay.', 'We apologizes for any inconvenient caused during your stay.'], correct: 0 },
      { original: 'The customer complained that the room was not enough clean.', options: ['The customer complained that the room was not clean enough.', 'The customer complained that the room was not enough cleaning.', 'The customer complain that the room was not enough clean.'], correct: 0 },
      { original: 'Please do not hesitate to contact us if you need further assistances.', options: ['Please do not hesitate to contact us if you need further assistance.', 'Please do not hesitate to contact us if you need furthers assistance.', 'Please do not hesitate contacting us if you need further assistances.'], correct: 0 },
    ]
  },
  {
    level: 'C1', topic: 'Formal Reports',
    instruction: 'Each sentence has ONE error. Choose the correct version.',
    sentences: [
      { original: 'The data suggests that customer satisfaction have improved significantly.', options: ['The data suggests that customer satisfaction has improved significantly.', 'The data suggest that customer satisfaction have improved significantly.', 'The data suggests that customer satisfactions have improved significantly.'], correct: 0 },
      { original: 'Had we known about the issue earlier, we would took immediate action.', options: ['Had we known about the issue earlier, we would have taken immediate action.', 'Had we known about the issue earlier, we would took immediately action.', 'Had we know about the issue earlier, we would took immediate action.'], correct: 0 },
      { original: 'The proposal, which was submitted last week, have been approved by the board.', options: ['The proposal, which was submitted last week, has been approved by the board.', 'The proposal, which was submitted last week, have been approve by the board.', 'The proposal, which submitted last week, have been approved by the board.'], correct: 0 },
    ]
  },
];

// ── SENTENCE ORDER questions ───────────────────────────────
const sentenceOrderData = [
  {
    level: 'A2', topic: 'Checking In',
    instruction: 'Put the sentences in the correct order to form a conversation.',
    sentences: ['Good afternoon, welcome to Grand Hotel.', 'Thank you. I have a reservation under the name Smith.', 'Yes, I can see it here. Room 305 on the third floor.', 'Great. What time is breakfast served?', 'Breakfast is from 6:30 to 10:00 AM in the restaurant.'],
    correct: [0, 1, 2, 3, 4]
  },
  {
    level: 'B1', topic: 'Booking a Tour',
    instruction: 'Put the sentences in the correct order to form a conversation.',
    sentences: ['I would like to book the Ha Long Bay tour for Saturday.', 'Certainly. How many people will be joining?', 'There will be four adults and two children.', 'The total comes to $240. Would you like to pay now?', 'Yes, I will pay by credit card please.'],
    correct: [0, 1, 2, 3, 4]
  },
  {
    level: 'B1', topic: 'Making a Complaint',
    instruction: 'Put the sentences in the correct order to form a logical paragraph.',
    sentences: ['First, I noticed that the air conditioning was not working.', 'When I called reception, nobody answered the phone.', 'After waiting 30 minutes, I went to the front desk myself.', 'The staff apologized and moved me to a different room.', 'Overall, the issue was resolved but the response time was too slow.'],
    correct: [0, 1, 2, 3, 4]
  },
  {
    level: 'B2', topic: 'Business Proposal',
    instruction: 'Put the sentences in the correct order to form a coherent paragraph.',
    sentences: ['We are writing to propose a partnership between our two companies.', 'Our research shows that combining our expertise would benefit both parties.', 'Specifically, we suggest a joint marketing campaign targeting Southeast Asian travelers.', 'The estimated budget for this initiative is $50,000 over six months.', 'We would welcome the opportunity to discuss this proposal at your earliest convenience.'],
    correct: [0, 1, 2, 3, 4]
  },
  {
    level: 'B2', topic: 'Event Planning',
    instruction: 'Put the steps in the correct order for organizing a corporate event.',
    sentences: ['Define the event objectives and target audience.', 'Set a budget and timeline for the project.', 'Select a venue and negotiate contracts with suppliers.', 'Send invitations and manage RSVPs.', 'Execute the event and collect feedback afterwards.'],
    correct: [0, 1, 2, 3, 4]
  },
  {
    level: 'C1', topic: 'Market Analysis',
    instruction: 'Put the sentences in the correct order to form a coherent analysis.',
    sentences: ['The tourism sector in Vietnam has experienced unprecedented growth over the past decade.', 'This growth can be attributed to government investment in infrastructure and marketing.', 'However, challenges remain in terms of sustainability and workforce development.', 'To address these issues, industry leaders must collaborate on long-term strategic planning.', 'Only through such cooperation can the sector maintain its competitive advantage in the region.'],
    correct: [0, 1, 2, 3, 4]
  },
];

// ── SENTENCE TRANSFORM questions ───────────────────────────
const sentenceTransformData = [
  {
    level: 'A2', topic: 'Basic Transformations',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: 'The hotel is very expensive.', keyword: 'costs', answer: 'The hotel costs a lot of money.' },
      { original: 'She works at the front desk.', keyword: 'job', answer: 'Her job is at the front desk.' },
      { original: 'We must leave before 10 AM.', keyword: 'have', answer: 'We have to leave before 10 AM.' },
    ]
  },
  {
    level: 'B1', topic: 'Passive Voice',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: 'They clean the rooms every morning.', keyword: 'cleaned', answer: 'The rooms are cleaned every morning.' },
      { original: 'Someone stole my luggage at the airport.', keyword: 'was', answer: 'My luggage was stolen at the airport.' },
      { original: 'The chef prepares all meals fresh daily.', keyword: 'prepared', answer: 'All meals are prepared fresh daily by the chef.' },
    ]
  },
  {
    level: 'B1', topic: 'Reported Speech',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: '"I will call you tomorrow," said the manager.', keyword: 'told', answer: 'The manager told me he would call me the next day.' },
      { original: '"We have fixed the problem," the technician said.', keyword: 'said', answer: 'The technician said they had fixed the problem.' },
      { original: '"Can you help me with my bags?" the guest asked.', keyword: 'asked', answer: 'The guest asked if I could help with their bags.' },
    ]
  },
  {
    level: 'B2', topic: 'Conditionals',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: 'I did not study hard, so I failed the exam.', keyword: 'would', answer: 'If I had studied hard, I would have passed the exam.' },
      { original: 'She is not here, so she cannot help us.', keyword: 'could', answer: 'If she were here, she could help us.' },
      { original: 'We missed the flight because we left too late.', keyword: 'not', answer: 'We would not have missed the flight if we had left earlier.' },
    ]
  },
  {
    level: 'B2', topic: 'Formal Expressions',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: 'Can you give me more information about the tour?', keyword: 'provide', answer: 'Could you provide me with more information about the tour?' },
      { original: 'We are sorry for the delay.', keyword: 'apologize', answer: 'We apologize for the delay.' },
      { original: 'I want to make a reservation for dinner.', keyword: 'like', answer: 'I would like to make a reservation for dinner.' },
    ]
  },
  {
    level: 'C1', topic: 'Advanced Transformations',
    instruction: 'Rewrite each sentence using the keyword given. The meaning must stay the same.',
    sentences: [
      { original: 'It is essential that all staff attend the training session.', keyword: 'must', answer: 'All staff must attend the training session.' },
      { original: 'The company succeeded because of its innovative approach.', keyword: 'owing', answer: 'The company succeeded owing to its innovative approach.' },
      { original: 'No sooner had we arrived than it started raining.', keyword: 'soon', answer: 'As soon as we arrived, it started raining.' },
    ]
  },
];

// ── Build final writing bank ───────────────────────────────
function buildWritingBank() {
  const questions = [];
  let idCounter = 1;

  // Fill blank
  fillBlankData.forEach(q => {
    questions.push({
      id: `WFB${String(idCounter++).padStart(3, '0')}`,
      type: 'fill_blank',
      level: q.level,
      topic: q.topic,
      instruction: q.instruction,
      passage: q.passage,
      options: q.options,
      blanks: q.blanks,
    });
  });

  // Error correction
  errorCorrectionData.forEach(q => {
    questions.push({
      id: `WEC${String(idCounter++).padStart(3, '0')}`,
      type: 'error_correction',
      level: q.level,
      topic: q.topic,
      instruction: q.instruction,
      sentences: q.sentences,
    });
  });

  // Sentence order
  sentenceOrderData.forEach(q => {
    questions.push({
      id: `WSO${String(idCounter++).padStart(3, '0')}`,
      type: 'sentence_order',
      level: q.level,
      topic: q.topic,
      instruction: q.instruction,
      sentences: q.sentences,
      correct: q.correct,
    });
  });

  // Sentence transform
  sentenceTransformData.forEach(q => {
    questions.push({
      id: `WST${String(idCounter++).padStart(3, '0')}`,
      type: 'sentence_transform',
      level: q.level,
      topic: q.topic,
      instruction: q.instruction,
      sentences: q.sentences,
    });
  });

  return questions;
}

const allQuestions = buildWritingBank();
console.log(`Generated ${allQuestions.length} unique writing questions:`);
console.log(`  fill_blank: ${fillBlankData.length}`);
console.log(`  error_correction: ${errorCorrectionData.length}`);
console.log(`  sentence_order: ${sentenceOrderData.length}`);
console.log(`  sentence_transform: ${sentenceTransformData.length}`);

// Save as writing-bank.json
const output = {
  BANK_STAFF: allQuestions.filter(q => ['A2', 'B1'].includes(q.level)),
  BANK_STAFF_EXTRA: allQuestions.filter(q => ['B2', 'C1'].includes(q.level)),
};

const outPath = path.join(__dirname, '..', 'data', 'writing-bank.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
console.log(`\n✅ Saved to ${outPath}`);
console.log(`  BANK_STAFF: ${output.BANK_STAFF.length} questions`);
console.log(`  BANK_STAFF_EXTRA: ${output.BANK_STAFF_EXTRA.length} questions`);
