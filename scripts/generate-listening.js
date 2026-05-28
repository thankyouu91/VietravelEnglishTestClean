const fs = require('fs');
const path = require('path');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { Readable } = require('stream');

const polly = new PollyClient({ region: 'ap-southeast-1' });

const audioDir = path.join(__dirname, '..', 'public', 'audio');
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

const dataFile = path.join(__dirname, '..', 'data', 'banks.json');
const seedFile = path.join(__dirname, '..', 'seed', 'banks.json');

const items = [
  {
    id: 'L001',
    level: 'A2',
    topic: 'Tour Guide Welcome',
    audioFile: 'l1c',
    audioDescription: 'Tour guide welcoming guests and explaining schedule',
    transcript: "Welcome everyone to Sunny Beach Resort. My name is Sarah and I will be your guide today. We will start our tour at 9 AM from the main lobby. Please don't forget to bring your sunglasses and sunscreen, as it will be very hot today.",
    questions: [
      {
        question: "What time does the tour start?",
        options: ["8:00 AM", "8:30 AM", "9:00 AM", "10:00 AM"],
        correct: 2
      },
      {
        question: "What should the guests bring?",
        options: ["An umbrella and a map", "Sunglasses and sunscreen", "A swimsuit and a towel", "A camera and extra batteries"],
        correct: 1
      }
    ]
  },
  {
    id: 'L002',
    level: 'B1',
    topic: 'Flight Announcement',
    audioFile: 'l2c',
    audioDescription: 'Airport gate announcement for a delayed flight',
    transcript: "Attention passengers on flight VN123 to Tokyo. This flight is now ready for boarding at Gate 15. All passengers with priority boarding, please proceed to the gate immediately. Please have your boarding pass and passport ready.",
    questions: [
      {
        question: "What is the destination of the flight?",
        options: ["Seoul", "Beijing", "Tokyo", "Osaka"],
        correct: 2
      },
      {
        question: "Which gate is the flight boarding at?",
        options: ["Gate 5", "Gate 10", "Gate 15", "Gate 50"],
        correct: 2
      }
    ]
  },
  {
    id: 'L003',
    level: 'A1',
    topic: 'Hotel Check-in',
    audioFile: 'l3c',
    audioDescription: 'Receptionist giving check-in details to a guest',
    transcript: "Good evening, sir. Welcome to the Grand Plaza Hotel. I see you have a reservation for a double room for three nights. Breakfast is served from 6:30 to 10:00 AM in the restaurant on the ground floor. Here is your room key.",
    questions: [
      {
        question: "How many nights is the guest staying?",
        options: ["One night", "Two nights", "Three nights", "Four nights"],
        correct: 2
      },
      {
        question: "Where is the breakfast served?",
        options: ["On the top floor", "In the room", "On the ground floor", "Next to the pool"],
        correct: 2
      }
    ]
  },
  {
    id: 'L004',
    level: 'B1',
    topic: 'Weather Forecast',
    audioFile: 'l4c',
    audioDescription: 'Weather forecast for tourists in Da Nang',
    transcript: "Good morning travelers. Today's weather in Da Nang will be mostly sunny with a high of 32 degrees Celsius. However, there might be some light rain in the late afternoon around 4 PM, so it's a good idea to carry an umbrella if you are going out.",
    questions: [
      {
        question: "What will the maximum temperature be today?",
        options: ["28 degrees Celsius", "30 degrees Celsius", "32 degrees Celsius", "34 degrees Celsius"],
        correct: 2
      },
      {
        question: "When is the rain expected?",
        options: ["Early morning", "At noon", "Late afternoon", "At night"],
        correct: 2
      }
    ]
  },
  {
    id: 'L005',
    level: 'A2',
    topic: 'Lost and Found',
    audioFile: 'l5',
    audioDescription: 'Announcement about a lost item in a shopping mall',
    transcript: "Attention shoppers. A small brown leather wallet has been found near the food court on the second floor. If you have lost a wallet, please come to the customer service desk on the first floor to claim it.",
    questions: [
      {
        question: "Where was the wallet found?",
        options: ["Near the main entrance", "Near the food court", "In the restroom", "In a clothing store"],
        correct: 1
      },
      {
        question: "Where should the owner go to claim it?",
        options: ["Customer service desk", "Security office", "Information counter", "The manager's office"],
        correct: 0
      }
    ]
  },
  {
    id: 'L006',
    level: 'B2',
    topic: 'Museum Guide',
    audioFile: 'l6c',
    audioDescription: 'Audio guide instructions in a museum',
    transcript: "Welcome to the National History Museum. In this room, you will see artifacts from the 18th century, including traditional clothing and pottery. Please note that photography is strictly prohibited in this section to preserve the delicate colors of the fabrics.",
    questions: [
      {
        question: "What century are the artifacts from?",
        options: ["16th century", "17th century", "18th century", "19th century"],
        correct: 2
      },
      {
        question: "Why is photography prohibited?",
        options: ["To prevent crowds", "To preserve fabric colors", "To respect privacy", "To sell more postcards"],
        correct: 1
      }
    ]
  },
  {
    id: 'L007',
    level: 'B1',
    topic: 'Train Station',
    audioFile: 'l7c',
    audioDescription: 'Announcement regarding a delayed train',
    transcript: "May I have your attention please? The express train to Sapa, originally scheduled to depart at 20:30, has been delayed by 45 minutes due to heavy rain. We apologize for the inconvenience. Please wait in the main lounge.",
    questions: [
      {
        question: "Why is the train delayed?",
        options: ["Engine failure", "Track maintenance", "Heavy rain", "Staff shortage"],
        correct: 2
      },
      {
        question: "How long is the delay?",
        options: ["15 minutes", "30 minutes", "45 minutes", "60 minutes"],
        correct: 2
      }
    ]
  },
  {
    id: 'L008',
    level: 'A2',
    topic: 'Restaurant Booking',
    audioFile: 'l8c',
    audioDescription: 'Staff confirming a table reservation',
    transcript: "Hello, this is the Seafood Palace Restaurant. We are calling to confirm your table reservation for 4 people tonight at 7:30 PM. We have prepared a table by the window as you requested. We look forward to seeing you soon.",
    questions: [
      {
        question: "What time is the reservation for?",
        options: ["6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM"],
        correct: 2
      },
      {
        question: "Where is the table located?",
        options: ["Near the kitchen", "By the window", "In the private room", "On the terrace"],
        correct: 1
      }
    ]
  },
  {
    id: 'L009',
    level: 'B1',
    topic: 'Bus Tour',
    audioFile: 'l9c',
    audioDescription: 'Guide giving instructions during a bus stop',
    transcript: "Hello everyone. Our bus will stop here for 30 minutes. You can use this time to take photos of the beautiful waterfall or buy some local snacks. Please make sure to return to the bus by 11:15 AM so we can continue our journey.",
    questions: [
      {
        question: "How long is the stop?",
        options: ["15 minutes", "20 minutes", "30 minutes", "45 minutes"],
        correct: 2
      },
      {
        question: "What time must the passengers return to the bus?",
        options: ["10:45 AM", "11:00 AM", "11:15 AM", "11:30 AM"],
        correct: 2
      }
    ]
  },
  {
    id: 'L010',
    level: 'B2',
    topic: 'Spa Promotion',
    audioFile: 'l10c',
    audioDescription: 'Resort spa promotional announcement',
    transcript: "Welcome to Lotus Spa. As a guest of our resort, you are entitled to a 20% discount on all massage therapies this week. We highly recommend our signature hot stone massage, which is perfect for relaxing after a long day of sightseeing.",
    questions: [
      {
        question: "How much is the discount for resort guests?",
        options: ["10%", "15%", "20%", "25%"],
        correct: 2
      },
      {
        question: "Which treatment is highly recommended?",
        options: ["Facial treatment", "Aromatherapy", "Hot stone massage", "Foot reflexology"],
        correct: 2
      }
    ]
  }
];

async function generateAudio(text, filename) {
  const params = {
    Text: text,
    OutputFormat: 'mp3',
    VoiceId: 'Joanna',
    Engine: 'neural'
  };
  
  try {
    const command = new SynthesizeSpeechCommand(params);
    const response = await polly.send(command);
    
    return new Promise((resolve, reject) => {
      const dest = fs.createWriteStream(path.join(audioDir, filename + '.mp3'));
      response.AudioStream.pipe(dest);
      dest.on('finish', resolve);
      dest.on('error', reject);
    });
  } catch (err) {
    console.error(`Error generating audio for ${filename}:`, err);
    throw err;
  }
}

async function run() {
  console.log('Starting generation of 10 audio files and 20 questions...');
  
  const newQuestions = [];
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    console.log(`Generating audio for ${item.audioFile}.mp3...`);
    await generateAudio(item.transcript, item.audioFile);
    
    // Create 2 separate question entries for the bank
    const q1 = {
      id: `${item.id}_1`,
      level: item.level,
      topic: item.topic,
      audioFile: item.audioFile,
      audio: item.audioDescription,
      question: item.questions[0].question,
      options: item.questions[0].options,
      correct: item.questions[0].correct,
      type: 'listening'
    };
    
    const q2 = {
      id: `${item.id}_2`,
      level: item.level,
      topic: item.topic,
      audioFile: item.audioFile,
      audio: item.audioDescription,
      question: item.questions[1].question,
      options: item.questions[1].options,
      correct: item.questions[1].correct,
      type: 'listening'
    };
    
    newQuestions.push(q1, q2);
    console.log(`- Added ${q1.id} and ${q2.id}`);
  }
  
  // Save to banks
  [dataFile, seedFile].forEach(file => {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data.BANK_STAFF) data.BANK_STAFF = { listening: [], reading: [], writing: [] };
      if (!data.BANK_STAFF.listening) data.BANK_STAFF.listening = [];
      
      // Append new questions
      data.BANK_STAFF.listening.push(...newQuestions);
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(`Updated bank file: ${path.basename(file)} with ${newQuestions.length} new questions.`);
    }
  });
  
  console.log('All done!');
}

run().catch(console.error);
