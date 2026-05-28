/**
 * Generate listening audio files using Amazon Polly
 * Usage: AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx node scripts/generate-audio.js
 */
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '..', 'public', 'audio');
const REGION = process.env.AWS_REGION || 'ap-southeast-1';

const polly = new PollyClient({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ── Conversation scripts for each audio file ───────────────
const scripts = [
  {
    file: 'l1c',
    voice: 'Joanna', // Female US
    voice2: 'Matthew', // Male US
    text: `<speak>
<prosody rate="95%">
<p><amazon:domain name="conversational">
Receptionist: Good afternoon and welcome to The Sunrise Resort. May I have your name please?
</amazon:domain></p>
<break time="500ms"/>
<p><amazon:domain name="conversational">
Guest: Yes, my name is Tanaka. I have a room booked for two nights.
</amazon:domain></p>
<break time="500ms"/>
<p><amazon:domain name="conversational">
Receptionist: Perfect, Mr. Tanaka. You are in room 507. Breakfast is served from 7 AM to 10 AM at the Lotus restaurant on the second floor.
</amazon:domain></p>
<break time="500ms"/>
<p><amazon:domain name="conversational">
Guest: Great, thank you. And what time is check-out?
</amazon:domain></p>
<break time="500ms"/>
<p><amazon:domain name="conversational">
Receptionist: Check-out is at 12 noon. Is there anything else I can help you with?
</amazon:domain></p>
<break time="500ms"/>
<p><amazon:domain name="conversational">
Guest: No, that's all. Thank you very much.
</amazon:domain></p>
</prosody>
</speak>`,
  },
  {
    file: 'l2c',
    text: `<speak>
<prosody rate="95%">
<p>Waiter: Good evening. Welcome to the Lotus Garden. Table for how many?</p>
<break time="400ms"/>
<p>Customer: For four, please. Do you have a table by the window?</p>
<break time="400ms"/>
<p>Waiter: Yes, right this way. Here's the menu. Our special today is grilled sea bass with lemongrass.</p>
<break time="400ms"/>
<p>Customer: That sounds lovely. We'll have two of those, one pad thai, and one chicken curry.</p>
<break time="400ms"/>
<p>Waiter: Excellent choices. And for drinks?</p>
<break time="400ms"/>
<p>Customer: Two glasses of white wine and two sparkling waters, please.</p>
<break time="400ms"/>
<p>Waiter: Perfect. Your food will be ready in about 20 minutes.</p>
</prosody>
</speak>`,
  },
  {
    file: 'l3c',
    text: `<speak>
<prosody rate="95%">
<p>Agent: Good morning, Vietravel. How can I help you today?</p>
<break time="400ms"/>
<p>Customer: Hi, I'd like to book the Mekong Delta day tour for this Saturday.</p>
<break time="400ms"/>
<p>Agent: Certainly. How many people will be joining?</p>
<break time="400ms"/>
<p>Customer: Four adults and two children.</p>
<break time="400ms"/>
<p>Agent: The tour departs at 7:30 AM from your hotel. It includes a boat ride, coconut candy workshop visit, and lunch. The price is 45 dollars per adult and 25 for children under 12.</p>
<break time="400ms"/>
<p>Customer: That's fine. Can we pay by credit card?</p>
<break time="400ms"/>
<p>Agent: Yes, of course. I'll send you a confirmation email with all the details.</p>
</prosody>
</speak>`,
  },
  {
    file: 'l4c',
    text: `<speak>
<prosody rate="95%">
<p>Guest: Excuse me, I need to speak with the manager. I have a serious complaint.</p>
<break time="400ms"/>
<p>Manager: I'm the duty manager. How can I help you, sir?</p>
<break time="400ms"/>
<p>Guest: When I checked in this afternoon, my room hadn't been cleaned. There were dirty towels on the floor and the bed wasn't made.</p>
<break time="400ms"/>
<p>Manager: I'm terribly sorry about that. That's completely unacceptable. Let me arrange a different room for you immediately.</p>
<break time="400ms"/>
<p>Guest: I've already waited 30 minutes. This is very disappointing for a four-star hotel.</p>
<break time="400ms"/>
<p>Manager: You're absolutely right, and I apologize. As compensation, I'd like to offer you a complimentary dinner at our restaurant tonight and a room upgrade.</p>
<break time="400ms"/>
<p>Guest: Well, I appreciate that. Thank you for handling this quickly.</p>
</prosody>
</speak>`,
  },
  {
    file: 'l5',
    text: `<speak>
<prosody rate="90%">
<p>Good morning, everyone. Thank you for joining us at the Annual Tourism Industry Conference.</p>
<break time="500ms"/>
<p>Today I want to talk about the future of sustainable tourism in Southeast Asia. The market is projected to reach 420 billion dollars by 2028.</p>
<break time="500ms"/>
<p>Three key trends are shaping our industry. First, experiential travel is growing at 15% annually. Travelers want authentic local experiences, not just sightseeing.</p>
<break time="500ms"/>
<p>Second, digital transformation is essential. Companies that invest in technology see 25% higher customer satisfaction scores.</p>
<break time="500ms"/>
<p>Third, sustainability is no longer optional. 73% of travelers say they would choose an eco-friendly option even if it costs more.</p>
<break time="500ms"/>
<p>The companies that embrace these trends will lead the industry in the next decade. Thank you.</p>
</prosody>
</speak>`,
  },
  {
    file: 'l6c',
    text: `<speak>
<prosody rate="95%">
<p>Restaurant: Good evening, Riverside Restaurant. How may I help you?</p>
<break time="400ms"/>
<p>Caller: Hello, I'd like to make a reservation for tomorrow evening, please.</p>
<break time="400ms"/>
<p>Restaurant: Certainly. For how many guests?</p>
<break time="400ms"/>
<p>Caller: Six people. We're celebrating a birthday.</p>
<break time="400ms"/>
<p>Restaurant: Lovely! What time would you prefer? We have availability at 6:30 or 8 PM.</p>
<break time="400ms"/>
<p>Caller: 8 PM would be perfect. Could we have a private area?</p>
<break time="400ms"/>
<p>Restaurant: Yes, our garden terrace is available. Would you like us to prepare a birthday cake?</p>
<break time="400ms"/>
<p>Caller: That would be wonderful. Chocolate, please. The name is Wilson.</p>
<break time="400ms"/>
<p>Restaurant: Perfect, Mr. Wilson. Six guests, 8 PM, garden terrace, chocolate cake. See you tomorrow!</p>
</prosody>
</speak>`,
  },
  {
    file: 'l7c',
    text: `<speak>
<prosody rate="95%">
<p>Good morning, everyone! My name is Linh and I'll be your guide today for the Cu Chi Tunnels tour.</p>
<break time="400ms"/>
<p>Before we start, a few important things. The tour takes about 3 hours. Please stay with the group at all times.</p>
<break time="400ms"/>
<p>The tunnels are quite narrow and dark, so if you're claustrophobic, you can wait outside. There's no obligation to go inside.</p>
<break time="400ms"/>
<p>Please wear comfortable shoes and bring water. It gets very hot underground.</p>
<break time="400ms"/>
<p>We'll have a 15-minute break at the souvenir shop halfway through. The bus will depart for the return journey at exactly 2 PM.</p>
<break time="400ms"/>
<p>Any questions before we begin? No? Great, let's go!</p>
</prosody>
</speak>`,
  },
  {
    file: 'l8c',
    text: `<speak>
<prosody rate="95%">
<p>Guest: Excuse me, could you tell me how to get to the night market from here?</p>
<break time="400ms"/>
<p>Concierge: Of course! It's about a 10-minute walk. Go out the main entrance and turn left.</p>
<break time="400ms"/>
<p>Guest: Left at the entrance, okay.</p>
<break time="400ms"/>
<p>Concierge: Walk straight for about 200 meters until you reach the traffic light. Then turn right onto Nguyen Hue Street.</p>
<break time="400ms"/>
<p>Guest: Right at the traffic light.</p>
<break time="400ms"/>
<p>Concierge: Yes. Continue for another 5 minutes and you'll see the market on your left. You can't miss it — there are lots of lights and food stalls.</p>
<break time="400ms"/>
<p>Guest: Is it safe to walk there at night?</p>
<break time="400ms"/>
<p>Concierge: Absolutely. It's a very popular tourist area. But do keep an eye on your belongings. Would you like me to write down the directions?</p>
</prosody>
</speak>`,
  },
  {
    file: 'l9c',
    text: `<speak>
<prosody rate="95%">
<p>Receptionist: Welcome to the Lotus Spa. Do you have an appointment?</p>
<break time="400ms"/>
<p>Guest: No, I was hoping to book something for this afternoon. What do you recommend?</p>
<break time="400ms"/>
<p>Receptionist: Our most popular treatment is the Vietnamese herbal massage. It's 90 minutes and costs 80 dollars.</p>
<break time="400ms"/>
<p>Guest: That sounds nice. Do you have anything shorter? I have dinner at 7.</p>
<break time="400ms"/>
<p>Receptionist: We have a 60-minute aromatherapy massage for 55 dollars. I can book you in at 5 PM.</p>
<break time="400ms"/>
<p>Guest: Perfect. Can my wife also book at the same time?</p>
<break time="400ms"/>
<p>Receptionist: Let me check. Yes, we have a couples room available at 5 PM. Shall I book both?</p>
<break time="400ms"/>
<p>Guest: Yes, please. Room 412, the name is Henderson.</p>
</prosody>
</speak>`,
  },
  {
    file: 'l10c',
    text: `<speak>
<prosody rate="90%">
<p>Interviewer: Thank you for joining us today. Can you tell us about the biggest changes in Vietnam's tourism industry?</p>
<break time="500ms"/>
<p>Expert: Certainly. The most significant change has been the shift toward experiential tourism. Visitors no longer want to just see famous sites — they want to cook local food, learn traditional crafts, and interact with communities.</p>
<break time="500ms"/>
<p>Interviewer: How has technology impacted the industry?</p>
<break time="500ms"/>
<p>Expert: Enormously. Online booking now accounts for 65% of all reservations. Social media has become the primary marketing channel. And AI is beginning to personalize travel recommendations.</p>
<break time="500ms"/>
<p>Interviewer: What challenges remain?</p>
<break time="500ms"/>
<p>Expert: Infrastructure development hasn't kept pace with demand. We also need more trained professionals who can deliver international-standard service while maintaining authentic Vietnamese hospitality.</p>
</prosody>
</speak>`,
  },
];

async function synthesize(script) {
  const outputFile = path.join(AUDIO_DIR, `${script.file}.mp3`);

  // Use neural voice for better quality
  const params = {
    Engine: 'neural',
    OutputFormat: 'mp3',
    Text: script.text,
    TextType: 'ssml',
    VoiceId: script.voice || 'Joanna',
    SampleRate: '24000',
  };

  try {
    const command = new SynthesizeSpeechCommand(params);
    const response = await polly.send(command);

    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.AudioStream) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(outputFile, buffer);
    console.log(`  ✅ ${script.file}.mp3 (${(buffer.length / 1024).toFixed(1)} KB)`);
    return true;
  } catch (err) {
    // Fallback to standard engine if neural not available
    if (err.name === 'InvalidParameterValueException' || err.message?.includes('neural')) {
      try {
        params.Engine = 'standard';
        const command = new SynthesizeSpeechCommand(params);
        const response = await polly.send(command);
        const chunks = [];
        for await (const chunk of response.AudioStream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(outputFile, buffer);
        console.log(`  ✅ ${script.file}.mp3 (standard, ${(buffer.length / 1024).toFixed(1)} KB)`);
        return true;
      } catch (e2) {
        console.error(`  ❌ ${script.file}: ${e2.message}`);
        return false;
      }
    }
    console.error(`  ❌ ${script.file}: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables');
    console.error('   Create IAM user with AmazonPollyFullAccess policy');
    process.exit(1);
  }

  console.log('🎧 Generating audio files with Amazon Polly...');
  console.log(`   Region: ${REGION}`);
  console.log(`   Output: ${AUDIO_DIR}`);
  console.log('');

  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

  let success = 0, failed = 0;
  for (const script of scripts) {
    const ok = await synthesize(script);
    if (ok) success++; else failed++;
  }

  console.log('');
  console.log(`Done! ${success} generated, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
