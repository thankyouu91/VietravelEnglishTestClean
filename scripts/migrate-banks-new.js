const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const banksFile = path.join(dataDir, 'banks.json');
const writingBankFile = path.join(dataDir, 'writing-bank.json');

// 1. Read existing data
const banks = JSON.parse(fs.readFileSync(banksFile, 'utf8'));
const writing = JSON.parse(fs.readFileSync(writingBankFile, 'utf8'));

console.log('--- BEFORE MIGRATION ---');
console.log('BANK_STAFF listening:', banks.BANK_STAFF.listening.length);
console.log('BANK_STAFF reading:', banks.BANK_STAFF.reading.length);
console.log('BANK_OFFICE_MGR listening:', banks.BANK_OFFICE_MGR.listening.length);
console.log('BANK_OFFICE_MGR reading:', banks.BANK_OFFICE_MGR.reading.length);

// 2. Adjust BANK_STAFF (A1-B1 only)
// Keep only A2 and B1 listening questions (remove B2, C1)
banks.BANK_STAFF.listening = banks.BANK_STAFF.listening.filter(q => ['A1', 'A2', 'B1'].includes(q.level));

// Set level: B1 for all reading questions in BANK_STAFF
banks.BANK_STAFF.reading.forEach(q => {
  q.level = 'B1';
});

// 3. Adjust BANK_OFFICE_MGR (B1-C1)
// Replace reading questions with 2 new business/management passages (P3 and P4)
const p3Passage = "Vietravel Market Expansion Strategy 2026\n\nIn early 2026, Vietravel launched its strategic market expansion plan, prioritizing high-growth international B2B sectors. To optimize performance, corporate sales managers began delivering detailed monthly business performance reviews. A key operational metric revealed a 15% increase in corporate incentive group bookings. Additionally, the business development team actively negotiated with local destination management companies (DMCs) to secure exclusive tariffs and allotment guarantees. This expansion strategy focuses on experiential tour packages for corporate clients rather than competing solely on price.";

const p4Passage = "Hotel Allocation and Contract Negotiation\n\nProcurement directors at Vietravel frequently negotiate complex agreements with luxury resort chains to prepare for peak tourist seasons. These negotiations center around two primary structures: allotments with flexible release periods and commitment contracts (guaranteed buyouts). Commitment contracts offer the lowest room rates but carry higher financial risks because rooms must be paid for regardless of occupancy. On the other hand, allotments allow Vietravel to release unsold rooms back to the hotel 14 days before the arrival date without penalties. Yield management plays a key role in finding the optimal balance between these structures to maximize revenue and minimize risk.";

const managerReadingQuestions = [
  // Passage 3 (B2 Level)
  {
    id: "P3_1",
    passageId: "P3",
    topic: "Vietravel Market Expansion Strategy 2026",
    passage: p3Passage,
    question: "What is the primary focus of Vietravel's market expansion plan in 2026?",
    options: [
      "Low-cost consumer retail travel",
      "High-growth international B2B sectors",
      "Domestic budget hotel construction",
      "Aviation regulatory compliance"
    ],
    correct: 1,
    level: "B2"
  },
  {
    id: "P3_2",
    passageId: "P3",
    topic: "Vietravel Market Expansion Strategy 2026",
    passage: p3Passage,
    question: "Negotiating with local DMCs is part of the strategy to secure exclusive tariffs.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 0,
    level: "B2"
  },
  {
    id: "P3_3",
    passageId: "P3",
    topic: "Vietravel Market Expansion Strategy 2026",
    passage: p3Passage,
    question: "What specific growth metric was highlighted in the monthly business reviews?",
    options: [
      "A 15% increase in B2B corporate group bookings",
      "A 22% reduction in staff operating costs",
      "A 30% reduction in hotel room cancellations",
      "A 5% decline in international flight ticket prices"
    ],
    correct: 0,
    level: "B2"
  },
  {
    id: "P3_4",
    passageId: "P3",
    topic: "Vietravel Market Expansion Strategy 2026",
    passage: p3Passage,
    question: "Vietravel's strategy aims to win market share primarily by offering the lowest prices.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 1,
    level: "B2"
  },
  {
    id: "P3_5",
    passageId: "P3",
    topic: "Vietravel Market Expansion Strategy 2026",
    passage: p3Passage,
    question: "The expansion plan was designed by external international consultants.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 2,
    level: "B2"
  },
  // Passage 4 (C1 Level)
  {
    id: "P4_1",
    passageId: "P4",
    topic: "Hotel Allocation and Contract Negotiation",
    passage: p4Passage,
    question: "Which contract type carries the highest financial risk for the travel agency?",
    options: [
      "Allotment contracts",
      "Commitment contracts",
      "Standard retail booking",
      "Non-refundable group discounts"
    ],
    correct: 1,
    level: "C1"
  },
  {
    id: "P4_2",
    passageId: "P4",
    topic: "Hotel Allocation and Contract Negotiation",
    passage: p4Passage,
    question: "Commitment contracts offer higher room rates than allotment contracts.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 1,
    level: "C1"
  },
  {
    id: "P4_3",
    passageId: "P4",
    topic: "Hotel Allocation and Contract Negotiation",
    passage: p4Passage,
    question: "What is the release period for allotments mentioned in the passage?",
    options: [
      "7 days before arrival",
      "14 days before arrival",
      "30 days before arrival",
      "24 hours before arrival"
    ],
    correct: 1,
    level: "C1"
  },
  {
    id: "P4_4",
    passageId: "P4",
    topic: "Hotel Allocation and Contract Negotiation",
    passage: p4Passage,
    question: "Yield management is used to find the best balance between allotment and commitment contracts.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 0,
    level: "C1"
  },
  {
    id: "P4_5",
    passageId: "P4",
    topic: "Hotel Allocation and Contract Negotiation",
    passage: p4Passage,
    question: "Luxury resort chains prefer allotment contracts over commitment contracts.",
    options: [
      "TRUE",
      "FALSE",
      "NOT GIVEN"
    ],
    correct: 2,
    level: "C1"
  }
];

banks.BANK_OFFICE_MGR.reading = managerReadingQuestions;

// 4. Overwrite writing questions for Manager
writing.BANK_OFFICE_MGR = [
  {
    id: "WSA001",
    type: "short_answer",
    level: "B2",
    topic: "Corporate Proposal Email",
    instruction: "Write a professional email (100-150 words) to a prospective corporate client proposing a customized team-building tour package for their 200 staff members. Emphasize Vietravel's market reputation and volume-based discounts.",
    prompt: "Write a professional email (100-150 words) to a prospective corporate client proposing a customized team-building tour package for their 200 staff members. Emphasize Vietravel's market reputation and volume-based discounts."
  },
  {
    id: "WSA002",
    type: "short_answer",
    level: "C1",
    topic: "Contract Negotiation Memo",
    instruction: "Write a business memorandum (120-180 words) to the Board of Directors outlining the strategic advantages, financial risks, and mitigation strategies of signing a commitment contract with a new luxury resort chain.",
    prompt: "Write a business memorandum (120-180 words) to the Board of Directors outlining the strategic advantages, financial risks, and mitigation strategies of signing a commitment contract with a new luxury resort chain."
  },
  {
    id: "WSA003",
    type: "short_answer",
    level: "B2",
    topic: "Partner Quality Complaint",
    instruction: "Write a professional response (100-150 words) to a travel agency partner who complained about hotel allocation delays during a peak travel holiday, explaining the solution and compensation.",
    prompt: "Write a professional response (100-150 words) to a travel agency partner who complained about hotel allocation delays during a peak travel holiday, explaining the solution and compensation."
  }
];

// Write changes back to files
fs.writeFileSync(banksFile, JSON.stringify(banks, null, 2) + '\n', 'utf8');
fs.writeFileSync(writingBankFile, JSON.stringify(writing, null, 2) + '\n', 'utf8');

console.log('--- AFTER MIGRATION ---');
console.log('BANK_STAFF listening:', banks.BANK_STAFF.listening.length);
console.log('BANK_STAFF reading:', banks.BANK_STAFF.reading.length);
console.log('BANK_OFFICE_MGR listening:', banks.BANK_OFFICE_MGR.listening.length);
console.log('BANK_OFFICE_MGR reading:', banks.BANK_OFFICE_MGR.reading.length);
console.log('BANK_OFFICE_MGR writing:', writing.BANK_OFFICE_MGR.length);
console.log('Successfully completed question bank levels and manager topics migration!');
