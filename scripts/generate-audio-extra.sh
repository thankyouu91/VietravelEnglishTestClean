#!/bin/bash
cd /opt/vietravel-exam

# Generate 10 more audio files with different voices and scenarios
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-YOUR_AWS_ACCESS_KEY} \
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-YOUR_AWS_SECRET_KEY} \
AWS_REGION=ap-southeast-1 \
node -e "
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const fs = require('fs');
const path = require('path');

const AUDIO_DIR = '/opt/vietravel-exam/public/audio';
const polly = new PollyClient({
  region: 'ap-southeast-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const extraScripts = [
  { file: 'l11c', voice: 'Matthew', text: '<speak><prosody rate=\"95%\"><p>Agent: Thank you for calling Vietravel. My name is David. How may I assist you?</p><break time=\"400ms\"/><p>Customer: Hi David. I booked a tour to Phu Quoc last week but I need to change the dates.</p><break time=\"400ms\"/><p>Agent: Of course. Can I have your booking reference number?</p><break time=\"400ms\"/><p>Customer: It is VT dash 2026 dash 4521.</p><break time=\"400ms\"/><p>Agent: I found it. You are currently booked for March 15 to 18. What dates would you prefer?</p><break time=\"400ms\"/><p>Customer: Can we move it to March 22 to 25 instead?</p><break time=\"400ms\"/><p>Agent: Let me check availability. Yes, those dates are available. There is no additional charge for the change since it is more than 7 days before departure.</p><break time=\"400ms\"/><p>Customer: Wonderful. Please go ahead and make the change.</p></prosody></speak>' },
  { file: 'l12c', voice: 'Joanna', text: '<speak><prosody rate=\"95%\"><p>Welcome aboard Vietnam Airlines flight VN 302 to Da Nang. Our flight time today will be approximately one hour and 20 minutes.</p><break time=\"400ms\"/><p>Please ensure your seatbelt is fastened, your tray table is in the upright position, and all electronic devices are switched to airplane mode.</p><break time=\"400ms\"/><p>We will be serving a light snack and beverages during the flight. For passengers in business class, a full meal service is available.</p><break time=\"400ms\"/><p>The weather in Da Nang is currently sunny with a temperature of 28 degrees Celsius. We expect a smooth flight with no turbulence.</p><break time=\"400ms\"/><p>On behalf of Captain Nguyen and the entire crew, we wish you a pleasant journey.</p></prosody></speak>' },
  { file: 'l13c', voice: 'Matthew', text: '<speak><prosody rate=\"95%\"><p>Good morning everyone. Before we begin today s training session, let me introduce myself. I am Mark Thompson, the new Regional Sales Manager.</p><break time=\"400ms\"/><p>Today we will cover three main topics. First, our Q3 sales targets. Second, the new customer relationship management system. And third, the upcoming promotional campaign.</p><break time=\"400ms\"/><p>Our target for this quarter is to increase bookings by 15 percent compared to last year. The focus will be on corporate travel packages and group tours.</p><break time=\"400ms\"/><p>The new CRM system will be launched next Monday. All staff must complete the online training module by Friday. It should take about 2 hours.</p><break time=\"400ms\"/><p>Any questions so far? Good. Let us move on to the promotional campaign details.</p></prosody></speak>' },
  { file: 'l14c', voice: 'Joanna', text: '<speak><prosody rate=\"95%\"><p>Receptionist: Good morning, Oceanview Hotel. How can I help you?</p><break time=\"400ms\"/><p>Guest: Hello, I am calling about a problem with my bill. I checked out yesterday but I noticed an extra charge on my credit card.</p><break time=\"400ms\"/><p>Receptionist: I am sorry to hear that. Can you tell me your room number and check-out date?</p><break time=\"400ms\"/><p>Guest: Room 803, I checked out on March 10th. There is a charge of 45 dollars for minibar items, but I did not use the minibar at all.</p><break time=\"400ms\"/><p>Receptionist: Let me look into that for you. I can see the charge here. I will need to verify with housekeeping. Can I call you back within the hour?</p><break time=\"400ms\"/><p>Guest: Yes, my number is 0912 345 678.</p><break time=\"400ms\"/><p>Receptionist: Thank you. If the charge is incorrect, we will process a refund immediately to your card. It should appear within 3 to 5 business days.</p></prosody></speak>' },
  { file: 'l15c', voice: 'Matthew', text: '<speak><prosody rate=\"90%\"><p>Ladies and gentlemen, welcome to the Vietravel Annual Awards Ceremony.</p><break time=\"500ms\"/><p>This year has been exceptional for our company. We served over 2 million customers, a 30 percent increase from last year. Our customer satisfaction score reached an all-time high of 4.8 out of 5.</p><break time=\"500ms\"/><p>I would like to recognize three outstanding achievements. First, our Da Nang branch won the Best Customer Service award for the third consecutive year.</p><break time=\"500ms\"/><p>Second, our digital marketing team increased online bookings by 45 percent through innovative social media campaigns.</p><break time=\"500ms\"/><p>And third, our sustainability initiative reduced carbon emissions by 20 percent while maintaining profitability.</p><break time=\"500ms\"/><p>Congratulations to all teams. Let us continue this momentum into next year.</p></prosody></speak>' },
  { file: 'l16c', voice: 'Joanna', text: '<speak><prosody rate=\"95%\"><p>Travel Agent: So you are looking for a honeymoon package?</p><break time=\"400ms\"/><p>Customer: Yes, we just got married last month. We are thinking somewhere tropical, maybe Bali or Maldives.</p><break time=\"400ms\"/><p>Agent: Both are excellent choices. For Bali, we have a 5-night package at a private villa resort for 2,800 dollars per couple. It includes airport transfers, daily breakfast, one spa treatment, and a sunset dinner cruise.</p><break time=\"400ms\"/><p>Customer: That sounds amazing. What about the Maldives?</p><break time=\"400ms\"/><p>Agent: The Maldives package is 4,200 dollars for 5 nights in an overwater bungalow. It includes all meals, snorkeling equipment, and a private beach dinner.</p><break time=\"400ms\"/><p>Customer: The Bali one fits our budget better. When is the best time to go?</p><break time=\"400ms\"/><p>Agent: April to October is the dry season. I would recommend May or June for the best weather and fewer crowds.</p></prosody></speak>' },
  { file: 'l17c', voice: 'Matthew', text: '<speak><prosody rate=\"95%\"><p>Good afternoon. This is your captain speaking. I have an important update regarding our flight.</p><break time=\"400ms\"/><p>Due to severe weather conditions at our destination, we will be diverting to Cam Ranh airport. This is a precautionary measure to ensure passenger safety.</p><break time=\"400ms\"/><p>We expect to land in approximately 25 minutes. Ground transportation will be arranged to take you to your original destination in Nha Trang, which is about 30 minutes by bus.</p><break time=\"400ms\"/><p>We apologize for any inconvenience. The airline will provide refreshments during the transfer. If you have connecting flights, please speak with our ground staff upon arrival.</p><break time=\"400ms\"/><p>Please remain seated with your seatbelt fastened. Cabin crew, please prepare for landing.</p></prosody></speak>' },
  { file: 'l18c', voice: 'Joanna', text: '<speak><prosody rate=\"95%\"><p>Guide: Welcome to the War Remnants Museum. Before we enter, let me give you some background information.</p><break time=\"400ms\"/><p>This museum was established in 1975 and contains over 20,000 documents and artifacts. It is one of the most visited museums in Vietnam, with over 1 million visitors per year.</p><break time=\"400ms\"/><p>The exhibition is spread across 3 floors. On the ground floor, you will find photographs and military equipment. The second floor focuses on the effects of Agent Orange. The third floor has international protest movements.</p><break time=\"400ms\"/><p>Please be aware that some images may be disturbing. Photography is allowed but please be respectful.</p><break time=\"400ms\"/><p>We will spend about 90 minutes here. Meet back at the entrance at 3:30 PM. The gift shop is on the left as you exit.</p></prosody></speak>' },
  { file: 'l19c', voice: 'Matthew', text: '<speak><prosody rate=\"95%\"><p>Instructor: Good morning class. Today we are going to practice handling difficult customer situations.</p><break time=\"400ms\"/><p>Scenario one. A customer calls to say their flight was cancelled and they are stranded at the airport. What do you do first?</p><break time=\"400ms\"/><p>Student: First, I would apologize and show empathy. Then I would check for alternative flights.</p><break time=\"400ms\"/><p>Instructor: Good. And if there are no flights available today?</p><break time=\"400ms\"/><p>Student: I would arrange hotel accommodation and meals, and rebook them on the earliest flight tomorrow.</p><break time=\"400ms\"/><p>Instructor: Excellent. Remember the three A s: Acknowledge the problem, Apologize sincerely, and Act quickly. Customer retention depends on how we handle these moments.</p></prosody></speak>' },
  { file: 'l20c', voice: 'Joanna', text: '<speak><prosody rate=\"90%\"><p>Thank you for attending this webinar on Digital Marketing Trends in Tourism for 2026.</p><break time=\"500ms\"/><p>The first trend I want to highlight is short-form video content. Platforms like TikTok and Instagram Reels now drive 40 percent of travel inspiration among millennials and Gen Z.</p><break time=\"500ms\"/><p>Second, AI-powered personalization. Hotels and airlines using AI recommendation engines see a 25 percent increase in upselling revenue.</p><break time=\"500ms\"/><p>Third, virtual reality previews. Properties offering VR tours of rooms and facilities report 35 percent higher conversion rates on their websites.</p><break time=\"500ms\"/><p>Finally, sustainability messaging. 68 percent of travelers say they actively seek out brands that demonstrate environmental responsibility.</p><break time=\"500ms\"/><p>The key takeaway: invest in video, personalization, and authentic sustainability stories. Questions?</p></prosody></speak>' },
];

async function synthesize(script) {
  const outputFile = path.join(AUDIO_DIR, script.file + '.mp3');
  try {
    const cmd = new SynthesizeSpeechCommand({
      Engine: 'neural', OutputFormat: 'mp3', Text: script.text,
      TextType: 'ssml', VoiceId: script.voice || 'Joanna', SampleRate: '24000',
    });
    const resp = await polly.send(cmd);
    const chunks = []; for await (const c of resp.AudioStream) chunks.push(c);
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(outputFile, buf);
    console.log('  ✅ ' + script.file + '.mp3 (' + (buf.length/1024).toFixed(1) + ' KB)');
  } catch(e) {
    // Fallback to standard
    try {
      const cmd = new SynthesizeSpeechCommand({
        Engine: 'standard', OutputFormat: 'mp3', Text: script.text,
        TextType: 'ssml', VoiceId: script.voice || 'Joanna', SampleRate: '22050',
      });
      const resp = await polly.send(cmd);
      const chunks = []; for await (const c of resp.AudioStream) chunks.push(c);
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(outputFile, buf);
      console.log('  ✅ ' + script.file + '.mp3 (standard, ' + (buf.length/1024).toFixed(1) + ' KB)');
    } catch(e2) { console.error('  ❌ ' + script.file + ': ' + e2.message); }
  }
}

(async () => {
  console.log('🎧 Generating 10 extra audio files...');
  for (const s of extraScripts) await synthesize(s);
  console.log('Done!');
})();
"
