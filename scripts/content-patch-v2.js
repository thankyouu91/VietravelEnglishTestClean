#!/usr/bin/env node
/**
 * Content patch v2 — applied once to data/banks.json:
 *   1. Bring BANK_OFFICE_MGR up to ≥10 items per track (was 5L / 6R / 5W) so
 *      management exams can actually sample 10 per track without crashing.
 *   2. Dedupe BANK_STAFF.reading — replace 18 templated clones (8 cancellation
 *      duplicates, 5 service-escalation duplicates, 6 customer-testimonial
 *      duplicates) with 18 diverse hospitality scenarios that cover topics
 *      previously absent from the bank (lost luggage, dietary restrictions,
 *      currency exchange, accessibility, weddings, group dynamics, etc.).
 *
 * Run:  node scripts/content-patch-v2.js data/banks.json
 *
 * Idempotent on re-run: items whose `id` already exists are skipped; the
 * duplicate-removal step is a no-op if the ids are already gone.
 */

const fs = require('fs');
const path = require('path');

// ── 1. BANK_OFFICE_MGR additions ─────────────────────────────────────────────
const MGR_LISTENING_ADDS = [
  {
    id: 'OM_L6', audioFile: 'OM_L6', audioPending: true, level: 'B2',
    topic: 'Office: Vendor Renegotiation',
    audio: 'Procurement manager and a transport-services vendor discussing a contract renewal with revised SLAs.',
    transcript: 'Manager: Thank you for joining. We need to revisit the on-time pickup commitment in your current contract. Vendor: Of course. Our latest data shows 91% on-time, below the 95% target. Manager: Right. We are proposing a 12-month renewal at a 3% rate increase, but with a 95% on-time SLA and a 0.5% rebate per percentage point shortfall. Vendor: We can commit to 94%; 95% is tight without an additional vehicle. Manager: Then let us agree on 94% for the first six months, escalating to 95%. Vendor: Agreed in principle. I will return revised pricing by Friday.',
    question: 'What concession does the vendor secure in exchange for the higher SLA target?',
    options: [
      'A 5% rate increase instead of 3%',
      'A six-month grace period at 94% before 95% applies',
      'Removal of the rebate clause entirely',
      'A guaranteed minimum number of bookings per month',
    ],
    correct: 1,
  },
  {
    id: 'OM_L7', audioFile: 'OM_L7', audioPending: true, level: 'B2',
    topic: 'Office: Operations Standup',
    audio: 'Operations standup covering three open incidents at the start of a Monday shift.',
    transcript: 'Lead: Three things this morning. First, the booking-engine timeout — engineering rolled back the deploy at 02:00; impact was about 40 lost bookings. Second, the Hue tour bus broke down yesterday; guests were relocated and compensation processed. Third, audit asked for the new vendor file by Wednesday. Action items: Mai to write a customer apology by 10 AM, Phong to confirm replacement coach for next Tuesday, and I will handle the audit file. Any blockers? None. Standup closes at five past.',
    question: 'Which action has the earliest deadline?',
    options: [
      'Confirming a replacement coach for next Tuesday',
      'Sending the customer apology by 10 AM',
      'Submitting the audit vendor file by Wednesday',
      'Engineering rolling back the booking deploy',
    ],
    correct: 1,
  },
  {
    id: 'OM_L8', audioFile: 'OM_L8', audioPending: true, level: 'C1',
    topic: 'Office: Quarterly Investor Update',
    audio: 'CFO presenting quarterly numbers to investors and explaining a key variance.',
    transcript: 'CFO: Q3 revenue came in at 412 billion VND, up 8% year on year. EBITDA margin contracted 140 basis points to 18.2%, driven primarily by elevated fuel and short-term staffing costs in our outbound segment. We expect roughly half of this pressure to unwind in Q4 as a renegotiated fuel-hedging programme takes effect. Booking momentum into Q4 is strong; forward bookings are 14% above the same window last year. Guidance for full-year EBITDA margin is unchanged at 19 to 20%.',
    question: 'According to the CFO, what is the primary driver of the Q3 margin contraction?',
    options: [
      'Lower revenue than expected',
      'A new fuel-hedging programme',
      'Higher fuel and short-term staffing costs in outbound',
      'Weak forward bookings into Q4',
    ],
    correct: 2,
  },
  {
    id: 'OM_L9', audioFile: 'OM_L9', audioPending: true, level: 'C1',
    topic: 'Office: Crisis Communications Briefing',
    audio: 'Head of communications briefing the leadership team about a potential PR incident.',
    transcript: 'Head of Comms: A travel blogger has posted a 7-minute video alleging unsafe practices on our Sapa trekking tour. The video has 60,000 views in 12 hours. We have verified that two of the four claims are factually incorrect, one is partially correct, and one is correct — guide certifications were out of date for two staff. My recommendation is a written statement within four hours: acknowledge the one valid finding, present the renewal action already taken, and rebut the other claims with evidence. We do not respond on the video platform itself. Legal has cleared this approach.',
    question: 'Why does the head of communications recommend NOT responding on the video platform?',
    options: [
      'Legal has not yet cleared a video response',
      'The recommended approach is a written statement, not a platform response',
      'The video already has too many views to influence',
      'The blogger has blocked the company account',
    ],
    correct: 1,
  },
  {
    id: 'OM_L10', audioFile: 'OM_L10', audioPending: true, level: 'B2',
    topic: 'Office: Training Programme Review',
    audio: 'L&D lead reporting on a completed customer-service training cohort.',
    transcript: 'L&D Lead: We just closed the second cohort of the customer-service certificate. 28 of 30 staff completed it, two dropped out due to schedule conflicts. Pre-training mystery-shopper scores averaged 71%; post-training averaged 84%. Where we saw the biggest lift was complaint handling, up from 62 to 86%. The area that did not move was upselling at check-in — that stayed flat at about 65%. For cohort three I am proposing a shorter upselling module focused on practical scripts rather than theory.',
    question: 'Which area did NOT improve in the training cohort?',
    options: [
      'Complaint handling',
      'Overall mystery-shopper scores',
      'Upselling at check-in',
      'Completion rate',
    ],
    correct: 2,
  },
];

const MGR_READING_ADDS = [
  {
    id: 'OM_R7', level: 'B2', topic: 'Office: Procurement Policy Update',
    passage: '<p><strong>Procurement Policy v3.1 — effective 1 March</strong></p><p>All purchase requests above 50M VND now require three competing quotations and approval from both the department head and the CFO. Requests between 10M and 50M VND need two quotations and department-head approval only. Requests below 10M can proceed with a single quotation. Existing master-service agreements remain valid until their renewal date and are exempt from the new quotation requirement.</p>',
    question: 'A 25M VND purchase request from a department that does NOT fall under an existing master-service agreement requires:',
    options: [
      'One quotation and department-head approval',
      'Two quotations and department-head approval',
      'Two quotations plus CFO approval',
      'Three quotations and approval from both the department head and the CFO',
    ],
    correct: 1,
  },
  {
    id: 'OM_R8', level: 'C1', topic: 'Office: Risk Register Excerpt',
    passage: '<p><strong>Risk Register — Q4 Update (Top 3)</strong></p><p><em>R-014 Supplier concentration:</em> 68% of inbound bookings flow through three OTAs. Mitigation: direct-booking incentive programme launched; targeted to bring concentration below 55% by Q2 next year.</p><p><em>R-022 Currency exposure:</em> 40% of revenue is USD-denominated, while 78% of costs are VND. Mitigation: 50% forward hedge in place for the next 12 months.</p><p><em>R-031 Data-protection compliance:</em> Internal review identified gaps in consent capture for newsletter sign-ups. Mitigation: re-consent campaign and updated opt-in flow rolling out in 30 days.</p>',
    question: 'Which of the three risks has its mitigation tied to the most concrete numerical target?',
    options: [
      'Supplier concentration (R-014)',
      'Currency exposure (R-022)',
      'Data-protection compliance (R-031)',
      'All three have equally specific targets',
    ],
    correct: 0,
  },
  {
    id: 'OM_R9', level: 'B2', topic: 'Office: Performance Review Calibration',
    passage: '<p><strong>Calibration guidance — Q3 cycle</strong></p><p>Managers should ensure that, across the function as a whole, the distribution of ratings approximately follows: 10–15% "Exceeds", 65–75% "Meets", 10–20% "Partially Meets", and up to 5% "Below". Individual teams may deviate where justified by documented evidence; however, any team with more than 30% "Exceeds" or zero "Partially Meets" will trigger a calibration review. The aim is not a quota but a check against drift.</p>',
    question: 'A 12-person team has 5 "Exceeds" ratings and no "Partially Meets". This team will:',
    options: [
      'Be allowed to proceed because individual deviations are permitted',
      'Trigger a calibration review on both counts',
      'Be required to change one "Exceeds" to "Meets"',
      'Have only its "Exceeds" count flagged, not the absence of "Partially Meets"',
    ],
    correct: 1,
  },
  {
    id: 'OM_R10', level: 'C1', topic: 'Office: Board Strategy Memo',
    passage: '<p><strong>Memo to the Board — Domestic vs International Mix</strong></p><p>The strategy committee recommends rebalancing our portfolio toward domestic travel over the next 18 months, moving from the current 35% domestic / 65% outbound split to 50/50. The case rests on three observations: (i) domestic margins are now 4 points higher than outbound after fuel re-pricing, (ii) domestic demand has lower correlation with FX shocks, and (iii) brand permission is strongest in the domestic segment per our latest tracking study. Outbound remains strategic — the proposal is rebalancing, not divestment.</p>',
    question: 'Which statement best captures the proposal?',
    options: [
      'Exit the outbound segment in favour of domestic travel',
      'Reduce outbound exposure in absolute terms while expanding domestic',
      'Hold outbound investment flat while growing domestic faster',
      'Hold domestic flat while reducing outbound investment',
    ],
    correct: 2,
  },
];

const MGR_WRITING_ADDS = [
  {
    id: 'OM_W6', level: 'B2', topic: 'Office: Vendor Performance Letter', type: 'short_answer',
    prompt: 'Write a short formal letter to a coach-rental vendor whose on-time performance has fallen from 94% to 88% over the last quarter. State the breach of the 95% SLA, request a written improvement plan within 14 days covering the specific causes and corrective actions, and remind them that continued underperformance will trigger the contractual rebate clause.',
    minWords: 70, maxWords: 130,
  },
  {
    id: 'OM_W7', level: 'B2', topic: 'Office: Project Status Update', type: 'short_answer',
    prompt: 'Write a short project status update for the steering committee on the booking-engine migration. Cover three things: (1) Phase 2 is complete and on schedule, (2) Phase 3 has been delayed by two weeks due to a third-party integration issue, and (3) the proposed mitigation is to begin Phase 4 work in parallel so the overall go-live date stays unchanged.',
    minWords: 70, maxWords: 130,
  },
  {
    id: 'OM_W8', level: 'C1', topic: 'Office: Talent-Retention Proposal', type: 'short_answer',
    prompt: 'Write a short proposal to the executive committee on a talent-retention initiative for high-performing front-line staff. Explain the problem (regrettable attrition in the top performance quintile is running at 22% annually), the proposed intervention (a 12-month rotation programme combining cross-functional exposure and a defined development budget per participant), and the expected outcome with rough cost framing.',
    minWords: 100, maxWords: 160,
  },
  {
    id: 'OM_W9', level: 'C1', topic: 'Office: Incident Post-mortem Summary', type: 'short_answer',
    prompt: 'Write a short post-mortem summary for an incident in which the customer-facing payment page was unavailable for 47 minutes during a peak booking window. Include: a one-sentence incident description, the root cause (an expired TLS certificate on the third-party gateway), customer impact (estimated 320 abandoned bookings, ~580M VND in deferred revenue), and three concrete preventive actions with owners and deadlines.',
    minWords: 100, maxWords: 160,
  },
  {
    id: 'OM_W10', level: 'C2', topic: 'Office: Strategic Position Paper', type: 'short_answer',
    prompt: 'Write a short position paper for the CEO arguing for or against accepting a strategic-investment offer from a regional hotel group that would take a 25% minority stake in the company. Address: the strategic rationale, the principal risks (governance dilution, brand alignment, channel cannibalisation), the two or three deal terms that would have to be present for the offer to be acceptable, and your overall recommendation with the conditions under which you would revise it.',
    minWords: 120, maxWords: 180,
  },
];

// ── 2. BANK_STAFF.reading dedupe — IDs to remove ─────────────────────────────
// Keep R202 (cancellation), R302 (escalation), R300 (testimonial) as the
// canonical version of each templated cluster. Remove the redundant siblings.
const STAFF_READING_REMOVE_IDS = new Set([
  // 7 cancellation clones (keep R202)
  'R205', 'R208', 'R211', 'R214', 'R217', 'R220', 'R223',
  // 5 escalation clones (keep R302)
  'R305', 'R308', 'R311', 'R314', 'R317',
  // 6 testimonial clones (keep R300)
  'R303', 'R306', 'R309', 'R312', 'R315', 'R318',
]);

// ── 3. BANK_STAFF.reading replacements — 18 new diverse items ────────────────
// Covers topics previously absent from the bank: lost luggage, dietary
// restrictions, accessibility, weddings & events, currency exchange,
// transport disruption, loyalty programme, group dynamics, sustainability ops.
const STAFF_READING_ADDS = [
  {
    id: 'R500', level: 'B1', topic: 'Lost Luggage',
    passage: '<p>If your checked luggage does not arrive on the same flight, please report it at our Lost Luggage desk in the arrivals hall before leaving the airport. You will receive a tracking reference and an interim allowance of $50 per day for essentials. Most delayed bags are reunited with their owners within 48 hours and delivered to your hotel at no extra charge.</p>',
    question: 'How long does it typically take for a delayed bag to be reunited with its owner?',
    options: ['Within 24 hours', 'Within 48 hours', 'Within 72 hours', 'Within one week'],
    correct: 1,
  },
  {
    id: 'R501', level: 'B1', topic: 'Dietary Restrictions',
    passage: '<p>Please inform our restaurant team of any dietary restrictions or allergies at least 24 hours before your meal. Our chef can prepare vegetarian, vegan, gluten-free, halal, and most allergy-safe options. For severe allergies, we recommend speaking directly with the chef on arrival so we can confirm preparation methods and avoid cross-contamination.</p>',
    question: 'What should guests with severe allergies do in addition to giving advance notice?',
    options: [
      'Bring their own food',
      'Eat only pre-packaged items',
      'Speak with the chef directly on arrival',
      'Order at least 48 hours ahead',
    ],
    correct: 2,
  },
  {
    id: 'R502', level: 'B1', topic: 'Accessibility',
    passage: '<p>The hotel has six rooms designed for wheelchair access on the ground floor, with roll-in showers, lowered counters, and emergency call buttons. Service animals are welcome in all areas. Sign-language interpretation can be arranged at no extra charge with 72 hours\' notice. The pool has a hoist available on request between 7 AM and 9 PM.</p>',
    question: 'Which service requires advance booking?',
    options: [
      'Use of the pool hoist',
      'Sign-language interpretation',
      'Bringing a service animal',
      'A ground-floor accessible room',
    ],
    correct: 1,
  },
  {
    id: 'R503', level: 'A2', topic: 'Currency Exchange',
    passage: '<p>The front desk can exchange US dollars, euros, and Japanese yen for Vietnamese dong, 24 hours a day. Today\'s rate is shown on the lobby screen. There is no commission for guests staying at the hotel. The maximum amount per day is $500 or its equivalent.</p>',
    question: 'How much can a hotel guest exchange per day?',
    options: ['$200', '$300', '$500', '$1000'],
    correct: 2,
  },
  {
    id: 'R504', level: 'B2', topic: 'Wedding Coordination',
    passage: '<p>Our wedding planning service includes a dedicated coordinator, a tasting menu for up to six guests, and a one-night complimentary stay for the couple. Bookings made more than nine months in advance receive a 10% reduction on venue hire. A non-refundable deposit of 30% is required at booking; the balance is due 30 days before the event. Any change to guest numbers within seven days of the event will be charged at the contracted per-person rate.</p>',
    question: 'A couple changes their guest count from 80 to 70 four days before the wedding. They will be charged for:',
    options: [
      '70 guests, because the reduction was made before the event',
      '80 guests, because the change is within seven days',
      '75 guests, as an average is applied',
      'A flat administrative fee only',
    ],
    correct: 1,
  },
  {
    id: 'R505', level: 'B1', topic: 'Transport Disruption',
    passage: '<p>In the event of a road closure or weather disruption that affects your tour, our team will offer one of three options: (1) re-routing to an alternative destination of equivalent value, (2) rescheduling at no charge to another available date within 12 months, or (3) a full refund of the affected portion. Choose your preferred option within 48 hours of being notified.</p>',
    question: 'How long does a guest have to choose between the three options?',
    options: ['24 hours', '48 hours', '7 days', '12 months'],
    correct: 1,
  },
  {
    id: 'R506', level: 'B1', topic: 'Loyalty Programme',
    passage: '<p>Vietravel Rewards members earn one point per dollar spent on tours and hotel stays. 1,000 points can be redeemed for a free domestic-tour night; 2,500 points for a free international-tour night. Points expire 24 months after the date they are earned. Status tiers (Silver, Gold, Platinum) are reviewed every January based on points earned in the previous calendar year.</p>',
    question: 'A member earns 600 points in March 2026. When do these points expire?',
    options: ['March 2027', 'March 2028', 'January 2027', 'They do not expire'],
    correct: 1,
  },
  {
    id: 'R507', level: 'B2', topic: 'Group Tour Dynamics',
    passage: '<p>When travelling in a group, please respect the agreed meeting times. A delay by one guest of more than 10 minutes can shift the entire day\'s schedule, particularly when access to attractions is time-slotted. If you are running late, please call the guide directly rather than walking back to the meeting point. Repeated unexplained delays may require the group to depart without the missing member, who would then make their own way to the next location.</p>',
    question: 'What does the passage advise a delayed guest to do?',
    options: [
      'Walk quickly back to the meeting point',
      'Call the guide directly',
      'Wait for the group to come back',
      'Take a taxi to the previous stop',
    ],
    correct: 1,
  },
  {
    id: 'R508', level: 'A2', topic: 'Tipping Etiquette',
    passage: '<p>Tipping is not required in Vietnam, but it is appreciated for good service. A common range is 10 to 50 thousand dong per service. For multi-day tours, many guests give the guide and driver a tip together on the last day. Hotel bills already include service charge, so an extra tip is optional.</p>',
    question: 'On a multi-day tour, when is it common to tip the guide and driver?',
    options: ['Every morning', 'After every meal', 'On the last day', 'It is not common to tip them'],
    correct: 2,
  },
  {
    id: 'R509', level: 'B2', topic: 'Sustainability Operations',
    passage: '<p>Our resort runs on 60% solar power during daylight hours and uses harvested rainwater for landscaping and laundry. Single-use plastics are replaced by glass bottles and bamboo amenities. Guests choosing to reuse towels for two or more nights generate a 50,000 VND donation per stay to a local mangrove-restoration project. Last year, this programme funded the planting of 14,000 trees.</p>',
    question: 'According to the passage, how is the towel-reuse choice connected to the mangrove project?',
    options: [
      'Reused towels are recycled into seedling pots',
      'A donation is generated for the project per qualifying stay',
      'Guests receive mangrove seedlings to plant',
      'The laundry water is used to irrigate the mangroves',
    ],
    correct: 1,
  },
  {
    id: 'R510', level: 'B1', topic: 'Travel Insurance',
    passage: '<p>Travel insurance is strongly recommended for all our international tours. Our partner policy covers medical expenses up to $100,000, trip cancellation for documented reasons, and lost personal items up to $1,500 per traveller. Pre-existing medical conditions must be declared at the time of purchase. The policy must be bought before the tour\'s departure date — it cannot be added retroactively.</p>',
    question: 'When can travel insurance be purchased?',
    options: [
      'At any time, including after the tour starts',
      'Only before the tour\'s departure date',
      'Only when booking the tour itself',
      'Within 7 days of completing the tour',
    ],
    correct: 1,
  },
  {
    id: 'R511', level: 'C1', topic: 'Industry Analysis',
    passage: '<p>Southeast Asia\'s outbound travel market has rebounded strongly in 2025, with regional volumes now 12% above the 2019 baseline. Vietnam, however, lags this rebound — outbound is 6% above 2019, while inbound has recovered to only 87% of pre-pandemic levels. The gap is attributable largely to slower long-haul flight capacity restoration and visa-policy frictions, both of which the industry expects to ease through 2026.</p>',
    question: 'According to the passage, what is the principal reason Vietnam lags the regional rebound?',
    options: [
      'Higher tour prices than regional peers',
      'Weaker domestic demand',
      'Slower flight-capacity recovery and visa-policy frictions',
      'Reduced government tourism funding',
    ],
    correct: 2,
  },
  {
    id: 'R512', level: 'B1', topic: 'Spa Booking',
    passage: '<p>Spa appointments can be booked through your room phone or at the spa reception. We require 4 hours\' notice for cancellation; later cancellations are charged 50% of the treatment price. Couples treatments must be booked at least 24 hours in advance. The spa is open daily from 10 AM to 9 PM; the last appointment of the day begins at 7:30 PM.</p>',
    question: 'A guest cancels a single massage 2 hours before the appointment. They will be charged:',
    options: ['Nothing', '50% of the treatment price', 'The full treatment price', 'A flat administrative fee'],
    correct: 1,
  },
  {
    id: 'R513', level: 'B2', topic: 'Restaurant Review',
    passage: '<p><em>The Anchor, Da Nang.</em> A confident new addition to the harbour-side dining scene. The grilled red snapper was beautifully timed, with charred-citrus pickles offsetting the richness of the fish; the vegetarian banh xeo, served on a black-rice pancake, deserves to be a signature. Service was warm and well-paced. The wine list leans heavily Australian and could use a wider European presence. Reservations are advisable for Friday and Saturday evenings.</p>',
    question: 'Which aspect of the restaurant does the reviewer suggest could be improved?',
    options: [
      'The pacing of the service',
      'The breadth of the wine list',
      'The grilled red snapper',
      'The reservation system',
    ],
    correct: 1,
  },
  {
    id: 'R514', level: 'A2', topic: 'Hotel Amenities',
    passage: '<p>The hotel has a swimming pool open from 6 AM to 10 PM, a gym open 24 hours a day, and a sauna in the spa area open from 10 AM to 8 PM. Room service is available 24 hours. The business centre is on the second floor and is free for hotel guests.</p>',
    question: 'Which facility is open 24 hours a day?',
    options: ['The swimming pool', 'The gym', 'The sauna', 'The business centre'],
    correct: 1,
  },
  {
    id: 'R515', level: 'B1', topic: 'Customer Testimonial',
    passage: '<p>I just got back from the 4-day Mekong Delta trip with Vietravel and I would book it again tomorrow. Our guide Linh was endlessly patient and knew every village we stopped in. The homestay on night two was the highlight — sleeping under mosquito nets and learning to cook with the family was special. The only thing I would change is the very early start on day three (4:30 AM is brutal!), but I understand why we had to leave then. Highly recommended.</p>',
    question: 'According to the reviewer, what was the only thing they would change about the trip?',
    options: [
      'The choice of homestay',
      'The very early start on day three',
      'The guide\'s knowledge of local villages',
      'The cooking activity with the host family',
    ],
    correct: 1,
  },
  {
    id: 'R516', level: 'B1', topic: 'Cancellation Policy',
    passage: '<p>For day tours, free cancellation is available up to 24 hours before departure. Cancellations within 24 hours forfeit 100% of the tour price. For multi-day tours, the schedule is: 30+ days before departure — full refund; 15 to 29 days — 50% refund; 7 to 14 days — 25% refund; less than 7 days — no refund. Postponement is always available subject to availability at no charge.</p>',
    question: 'A guest cancels a 5-day tour 10 days before departure. They will receive:',
    options: ['A full refund', 'A 50% refund', 'A 25% refund', 'No refund'],
    correct: 2,
  },
  {
    id: 'R517', level: 'B2', topic: 'Service Escalation Policy',
    passage: '<p>Front-line staff resolve straightforward complaints at the first point of contact. Issues that involve a refund above 1,000,000 VND, a safety concern, or a written complaint are escalated to the duty manager within one hour. If a guest threatens legal action or contacts a media outlet, the matter goes directly to the head of Guest Experience, who consults Legal and Communications before responding. All escalations are logged within 24 hours, including those resolved at the first contact.</p>',
    question: 'A guest demands a 1,500,000 VND refund without mentioning legal action. The appropriate handler is:',
    options: [
      'Front-line staff at first contact',
      'The duty manager within one hour',
      'The head of Guest Experience',
      'The legal and communications team directly',
    ],
    correct: 1,
  },
];

// ── Apply ────────────────────────────────────────────────────────────────────
function apply(bank) {
  bank.BANK_OFFICE_MGR.listening = mergeById(bank.BANK_OFFICE_MGR.listening, MGR_LISTENING_ADDS);
  bank.BANK_OFFICE_MGR.reading   = mergeById(bank.BANK_OFFICE_MGR.reading,   MGR_READING_ADDS);
  bank.BANK_OFFICE_MGR.writing   = mergeById(bank.BANK_OFFICE_MGR.writing,   MGR_WRITING_ADDS.map(attachWritingRubric));

  bank.BANK_STAFF.reading = bank.BANK_STAFF.reading.filter(
    (item) => !STAFF_READING_REMOVE_IDS.has(item.id)
  );
  bank.BANK_STAFF.reading = mergeById(bank.BANK_STAFF.reading, STAFF_READING_ADDS);

  return bank;
}

function mergeById(existing, additions) {
  const seen = new Set(existing.map((x) => x.id));
  return existing.concat(additions.filter((x) => !seen.has(x.id)));
}

// Writing items added here use the same per-CEFR rubric template as the
// migration script — keep it in sync if the rubric ever changes.
const RUBRIC_BY_LEVEL = {
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

function attachWritingRubric(item) {
  const criteria = RUBRIC_BY_LEVEL[item.level];
  if (!criteria) throw new Error(`No rubric for level ${item.level} on ${item.id}`);
  return { ...item, rubric: { criteria } };
}

function assertCounts(bank) {
  const required = (track, n, name) => {
    const have = bank[name][track].length;
    if (have < n) throw new Error(`${name}.${track} has ${have} items, need at least ${n}`);
  };
  for (const track of ['listening', 'reading', 'writing']) {
    required(track, 10, 'BANK_OFFICE_MGR');
    required(track, 10, 'BANK_STAFF');
  }
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/content-patch-v2.js <bank.json>');
    process.exit(2);
  }
  const abs = path.resolve(target);
  const bank = JSON.parse(fs.readFileSync(abs, 'utf8'));
  apply(bank);
  assertCounts(bank);
  fs.writeFileSync(abs, JSON.stringify(bank, null, 2) + '\n');

  const counts = (name) => ({
    L: bank[name].listening.length,
    R: bank[name].reading.length,
    W: bank[name].writing.length,
  });
  console.log(`✓ patched ${target}`);
  console.log('  BANK_STAFF:      ', counts('BANK_STAFF'));
  console.log('  BANK_OFFICE_MGR: ', counts('BANK_OFFICE_MGR'));
}

if (require.main === module) main();
