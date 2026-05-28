#!/bin/bash
cd /opt/vietravel-exam

# Install ffmpeg for audio concatenation
sudo apt-get install -y ffmpeg > /dev/null 2>&1

AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-YOUR_AWS_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-YOUR_AWS_SECRET_KEY} \
AWS_REGION=ap-southeast-1 \
node -e "
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = '/opt/vietravel-exam/public/audio';
const TMP_DIR = '/tmp/polly-parts';
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const polly = new PollyClient({
  region: 'ap-southeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Conversations with 2 speakers (no labels in audio)
const conversations = [
  {
    file: 'l1c',
    lines: [
      { voice: 'Joanna', text: 'Good afternoon and welcome to The Sunrise Resort. May I have your name please?' },
      { voice: 'Matthew', text: 'Yes, my name is Tanaka. I have a room booked for two nights.' },
      { voice: 'Joanna', text: 'Perfect, Mr. Tanaka. You are in room 507. Breakfast is served from 7 AM to 10 AM at the Lotus restaurant on the second floor.' },
      { voice: 'Matthew', text: 'Great, thank you. And what time is check-out?' },
      { voice: 'Joanna', text: 'Check-out is at 12 noon. Is there anything else I can help you with?' },
      { voice: 'Matthew', text: 'No, that is all. Thank you very much.' },
    ]
  },
  {
    file: 'l2c',
    lines: [
      { voice: 'Matthew', text: 'Good evening. Welcome to the Lotus Garden. Table for how many?' },
      { voice: 'Joanna', text: 'For four, please. Do you have a table by the window?' },
      { voice: 'Matthew', text: 'Yes, right this way. Here is the menu. Our special today is grilled sea bass with lemongrass.' },
      { voice: 'Joanna', text: 'That sounds lovely. We will have two of those, one pad thai, and one chicken curry.' },
      { voice: 'Matthew', text: 'Excellent choices. And for drinks?' },
      { voice: 'Joanna', text: 'Two glasses of white wine and two sparkling waters, please.' },
      { voice: 'Matthew', text: 'Perfect. Your food will be ready in about 20 minutes.' },
    ]
  },
  {
    file: 'l3c',
    lines: [
      { voice: 'Joanna', text: 'Good morning, Vietravel. How can I help you today?' },
      { voice: 'Matthew', text: 'Hi, I would like to book the Mekong Delta day tour for this Saturday.' },
      { voice: 'Joanna', text: 'Certainly. How many people will be joining?' },
      { voice: 'Matthew', text: 'Four adults and two children.' },
      { voice: 'Joanna', text: 'The tour departs at 7:30 AM from your hotel. It includes a boat ride, coconut candy workshop visit, and lunch. The price is 45 dollars per adult and 25 for children under 12.' },
      { voice: 'Matthew', text: 'That is fine. Can we pay by credit card?' },
      { voice: 'Joanna', text: 'Yes, of course. I will send you a confirmation email with all the details.' },
    ]
  },
  {
    file: 'l4c',
    lines: [
      { voice: 'Matthew', text: 'Excuse me, I need to speak with the manager. I have a serious complaint.' },
      { voice: 'Joanna', text: 'I am the duty manager. How can I help you, sir?' },
      { voice: 'Matthew', text: 'When I checked in this afternoon, my room had not been cleaned. There were dirty towels on the floor and the bed was not made.' },
      { voice: 'Joanna', text: 'I am terribly sorry about that. That is completely unacceptable. Let me arrange a different room for you immediately.' },
      { voice: 'Matthew', text: 'I have already waited 30 minutes. This is very disappointing for a four-star hotel.' },
      { voice: 'Joanna', text: 'You are absolutely right, and I apologize. As compensation, I would like to offer you a complimentary dinner at our restaurant tonight and a room upgrade.' },
    ]
  },
  {
    file: 'l5',
    lines: [
      { voice: 'Matthew', text: 'Good morning, everyone. Thank you for joining us at the Annual Tourism Industry Conference.' },
      { voice: 'Matthew', text: 'Today I want to talk about the future of sustainable tourism in Southeast Asia. The market is projected to reach 420 billion dollars by 2028.' },
      { voice: 'Matthew', text: 'Three key trends are shaping our industry. First, experiential travel is growing at 15 percent annually. Travelers want authentic local experiences, not just sightseeing.' },
      { voice: 'Matthew', text: 'Second, digital transformation is essential. Companies that invest in technology see 25 percent higher customer satisfaction scores.' },
      { voice: 'Matthew', text: 'Third, sustainability is no longer optional. 73 percent of travelers say they would choose an eco-friendly option even if it costs more.' },
    ]
  },
  {
    file: 'l6c',
    lines: [
      { voice: 'Joanna', text: 'Good evening, Riverside Restaurant. How may I help you?' },
      { voice: 'Matthew', text: 'Hello, I would like to make a reservation for tomorrow evening, please.' },
      { voice: 'Joanna', text: 'Certainly. For how many guests?' },
      { voice: 'Matthew', text: 'Six people. We are celebrating a birthday.' },
      { voice: 'Joanna', text: 'Lovely! What time would you prefer? We have availability at 6:30 or 8 PM.' },
      { voice: 'Matthew', text: '8 PM would be perfect. Could we have a private area?' },
      { voice: 'Joanna', text: 'Yes, our garden terrace is available. Would you like us to prepare a birthday cake?' },
      { voice: 'Matthew', text: 'That would be wonderful. Chocolate, please. The name is Wilson.' },
    ]
  },
  {
    file: 'l7c',
    lines: [
      { voice: 'Joanna', text: 'Good morning, everyone! My name is Linh and I will be your guide today for the Cu Chi Tunnels tour.' },
      { voice: 'Joanna', text: 'Before we start, a few important things. The tour takes about 3 hours. Please stay with the group at all times.' },
      { voice: 'Joanna', text: 'The tunnels are quite narrow and dark, so if you are claustrophobic, you can wait outside.' },
      { voice: 'Joanna', text: 'Please wear comfortable shoes and bring water. It gets very hot underground.' },
      { voice: 'Joanna', text: 'We will have a 15-minute break at the souvenir shop halfway through. The bus will depart at exactly 2 PM.' },
    ]
  },
  {
    file: 'l8c',
    lines: [
      { voice: 'Matthew', text: 'Excuse me, could you tell me how to get to the night market from here?' },
      { voice: 'Joanna', text: 'Of course! It is about a 10-minute walk. Go out the main entrance and turn left.' },
      { voice: 'Matthew', text: 'Left at the entrance, okay.' },
      { voice: 'Joanna', text: 'Walk straight for about 200 meters until you reach the traffic light. Then turn right onto Nguyen Hue Street.' },
      { voice: 'Matthew', text: 'Right at the traffic light.' },
      { voice: 'Joanna', text: 'Yes. Continue for another 5 minutes and you will see the market on your left. You cannot miss it.' },
      { voice: 'Matthew', text: 'Is it safe to walk there at night?' },
      { voice: 'Joanna', text: 'Absolutely. It is a very popular tourist area. But do keep an eye on your belongings.' },
    ]
  },
  {
    file: 'l9c',
    lines: [
      { voice: 'Joanna', text: 'Welcome to the Lotus Spa. Do you have an appointment?' },
      { voice: 'Matthew', text: 'No, I was hoping to book something for this afternoon. What do you recommend?' },
      { voice: 'Joanna', text: 'Our most popular treatment is the Vietnamese herbal massage. It is 90 minutes and costs 80 dollars.' },
      { voice: 'Matthew', text: 'That sounds nice. Do you have anything shorter? I have dinner at 7.' },
      { voice: 'Joanna', text: 'We have a 60-minute aromatherapy massage for 55 dollars. I can book you in at 5 PM.' },
      { voice: 'Matthew', text: 'Perfect. Can my wife also book at the same time?' },
      { voice: 'Joanna', text: 'Let me check. Yes, we have a couples room available at 5 PM. Shall I book both?' },
    ]
  },
  {
    file: 'l10c',
    lines: [
      { voice: 'Joanna', text: 'Thank you for joining us today. Can you tell us about the biggest changes in Vietnam tourism industry?' },
      { voice: 'Matthew', text: 'Certainly. The most significant change has been the shift toward experiential tourism. Visitors no longer want to just see famous sites. They want to cook local food, learn traditional crafts, and interact with communities.' },
      { voice: 'Joanna', text: 'How has technology impacted the industry?' },
      { voice: 'Matthew', text: 'Enormously. Online booking now accounts for 65 percent of all reservations. Social media has become the primary marketing channel.' },
      { voice: 'Joanna', text: 'What challenges remain?' },
      { voice: 'Matthew', text: 'Infrastructure development has not kept pace with demand. We also need more trained professionals who can deliver international-standard service.' },
    ]
  },
];

async function synthesizeLine(text, voice, outputFile) {
  const ssml = '<speak><prosody rate=\"95%\">' + text + '</prosody></speak>';
  const cmd = new SynthesizeSpeechCommand({
    Engine: 'neural', OutputFormat: 'mp3', Text: ssml,
    TextType: 'ssml', VoiceId: voice, SampleRate: '24000',
  });
  const resp = await polly.send(cmd);
  const chunks = []; for await (const c of resp.AudioStream) chunks.push(c);
  fs.writeFileSync(outputFile, Buffer.concat(chunks));
}

// Generate 0.8s silence file
function genSilence() {
  const silenceFile = path.join(TMP_DIR, 'silence.mp3');
  if (!fs.existsSync(silenceFile)) {
    execSync('ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 0.8 -q:a 9 ' + silenceFile + ' 2>/dev/null');
  }
  return silenceFile;
}

async function generateConversation(conv) {
  const parts = [];
  const silenceFile = genSilence();

  for (let i = 0; i < conv.lines.length; i++) {
    const line = conv.lines[i];
    const partFile = path.join(TMP_DIR, conv.file + '_part' + i + '.mp3');
    await synthesizeLine(line.text, line.voice, partFile);
    parts.push(partFile);
    if (i < conv.lines.length - 1) parts.push(silenceFile); // pause between lines
  }

  // Concatenate with ffmpeg
  const listFile = path.join(TMP_DIR, conv.file + '_list.txt');
  fs.writeFileSync(listFile, parts.map(p => \"file '\" + p + \"'\").join('\n'));
  const outputFile = path.join(AUDIO_DIR, conv.file + '.mp3');
  execSync('ffmpeg -y -f concat -safe 0 -i ' + listFile + ' -acodec libmp3lame -q:a 2 ' + outputFile + ' 2>/dev/null');

  const size = fs.statSync(outputFile).size;
  console.log('  ✅ ' + conv.file + '.mp3 (' + (size/1024).toFixed(1) + ' KB) — ' + conv.lines.length + ' lines, 2 voices');
}

(async () => {
  console.log('🎧 Generating multi-voice audio (Joanna + Matthew)...');
  console.log('');
  for (const conv of conversations) {
    await generateConversation(conv);
  }
  // Cleanup
  execSync('rm -rf ' + TMP_DIR);
  console.log('');
  console.log('✅ All 10 audio files regenerated with 2 speakers!');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
"
