#!/usr/bin/env python3
"""
Generate listening audio files using Microsoft Edge TTS (edge-tts).
- Female voice: en-US-JennyNeural (Receptionist, Agent, Waitress, Concierge, Guide)
- Male voice:   en-US-GuyNeural   (Guest, Customer, Caller, Interviewer)
Usage: python3 gen_audio_edge.py
"""

import asyncio
import os
import subprocess
import sys
import tempfile
import shutil

AUDIO_DIR = os.environ.get("AUDIO_DIR", "/opt/vietravel-exam/public/audio")
if not os.path.exists(AUDIO_DIR):
    AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "audio")

FEMALE = "en-US-JennyNeural"
MALE   = "en-US-GuyNeural"

# Each conversation: list of (voice, text) tuples
CONVERSATIONS = {
    "lm1": [
        (FEMALE, "Welcome to our Q3 performance review meeting, Alex. Let's start with the sales figures for our chartered flights to Japan and Europe. What's the latest update?"),
        (MALE,   "Sure, Sophia. In Q3, our total revenue reached twelve point five million dollars, which is a fourteen percent increase quarter-on-quarter. Our Tokyo charter route achieved an ninety-two percent occupancy rate, generating four.eight million dollars alone. However, the Paris route faced some headwinds. We only reached seventy-four percent occupancy due to the late slot allocation, resulting in a minor loss of one hundred and twenty thousand dollars."),
        (FEMALE, "I see. A seventy-four percent occupancy rate is indeed below our target of eighty-five percent. If we want to secure those slots for Q4, the airline requires an upfront deposit of three hundred thousand dollars, up from the usual two hundred thousand. How do we negotiate this?"),
        (MALE,   "Three hundred thousand is too high. I propose we offer a two hundred and fifty thousand dollar deposit, but guarantee at least twelve flights instead of ten. This reduces their risk on empty seats and gives us leverage to demand better slot times. We also need to negotiate a five percent volume discount if we exceed fifteen flights in Q4."),
        (FEMALE, "That's a logical proposal. A guarantee of twelve flights should give them enough confidence to accept the lower deposit of two hundred and fifty thousand. I will schedule a meeting with their procurement director tomorrow to finalize the agreement. Let's aim to sign by Friday."),
    ],
    "l1c": [
        (FEMALE, "Good afternoon and welcome to The Sunrise Resort. May I have your name please?"),
        (MALE,   "Yes, my name is Tanaka. I have a room booked for two nights."),
        (FEMALE, "Perfect, Mr. Tanaka. You are in room five hundred and seven. Breakfast is served from seven AM to ten AM at the Lotus restaurant on the second floor."),
        (MALE,   "Great, thank you. And what time is check-out?"),
        (FEMALE, "Check-out is at twelve noon. Is there anything else I can help you with?"),
        (MALE,   "No, that's all. Thank you very much."),
    ],
    "l2c": [
        (MALE,   "Good evening. Welcome to the Lotus Garden. Table for how many?"),
        (FEMALE, "For four, please. Do you have a table by the window?"),
        (MALE,   "Yes, right this way. Here's the menu. Our special today is grilled sea bass with lemongrass."),
        (FEMALE, "That sounds lovely. We'll have two of those, one pad thai, and one chicken curry."),
        (MALE,   "Excellent choices. And for drinks?"),
        (FEMALE, "Two glasses of white wine and two sparkling waters, please."),
        (MALE,   "Perfect. Your food will be ready in about twenty minutes."),
    ],
    "l3c": [
        (FEMALE, "Good morning, Vietravel. How can I help you today?"),
        (MALE,   "Hi, I'd like to book the Mekong Delta day tour for this Saturday."),
        (FEMALE, "Certainly. How many people will be joining?"),
        (MALE,   "Four adults and two children."),
        (FEMALE, "The tour departs at seven thirty AM from your hotel. It includes a boat ride, a coconut candy workshop visit, and lunch. The price is forty-five dollars per adult and twenty-five for children under twelve."),
        (MALE,   "That's fine. Can we pay by credit card?"),
        (FEMALE, "Yes, of course. I'll send you a confirmation email with all the details."),
    ],
    "l4c": [
        (MALE,   "Excuse me, I need to speak with the manager. I have a serious complaint."),
        (FEMALE, "I'm the duty manager. How can I help you, sir?"),
        (MALE,   "When I checked in this afternoon, my room hadn't been cleaned. There were dirty towels on the floor and the bed wasn't made."),
        (FEMALE, "I'm terribly sorry about that. That's completely unacceptable. Let me arrange a different room for you immediately."),
        (MALE,   "I've already waited thirty minutes. This is very disappointing for a four-star hotel."),
        (FEMALE, "You're absolutely right, and I sincerely apologize. As compensation, I'd like to offer you a complimentary dinner at our restaurant tonight and a room upgrade."),
        (MALE,   "Well, I appreciate that. Thank you for handling this quickly."),
    ],
    "l5": [
        (MALE, "Good morning, everyone. Thank you for joining us at the Annual Tourism Industry Conference."),
        (MALE, "Today I want to talk about the future of sustainable tourism in Southeast Asia. The market is projected to reach four hundred and twenty billion dollars by twenty twenty-eight."),
        (MALE, "Three key trends are shaping our industry. First, experiential travel is growing at fifteen percent annually. Travelers want authentic local experiences, not just sightseeing."),
        (MALE, "Second, digital transformation is essential. Companies that invest in technology see twenty-five percent higher customer satisfaction scores."),
        (MALE, "Third, sustainability is no longer optional. Seventy-three percent of travelers say they would choose an eco-friendly option even if it costs more."),
        (MALE, "The companies that embrace these trends will lead the industry in the next decade. Thank you."),
    ],
    "l6c": [
        (FEMALE, "Good evening, Riverside Restaurant. How may I help you?"),
        (MALE,   "Hello, I'd like to make a reservation for tomorrow evening, please."),
        (FEMALE, "Certainly. For how many guests?"),
        (MALE,   "Six people. We're celebrating a birthday."),
        (FEMALE, "Lovely! What time would you prefer? We have availability at six thirty or eight PM."),
        (MALE,   "Eight PM would be perfect. Could we have a private area?"),
        (FEMALE, "Yes, our garden terrace is available. Would you like us to prepare a birthday cake?"),
        (MALE,   "That would be wonderful. Chocolate, please. The name is Wilson."),
        (FEMALE, "Perfect, Mr. Wilson. Six guests, eight PM, garden terrace, chocolate cake. We look forward to seeing you tomorrow!"),
    ],
    "l7c": [
        (FEMALE, "Good morning, everyone! My name is Linh and I'll be your guide today for the Cu Chi Tunnels tour."),
        (FEMALE, "Before we start, a few important things. The tour takes about three hours. Please stay with the group at all times."),
        (FEMALE, "The tunnels are quite narrow and dark, so if you're claustrophobic, you can wait outside. There's no obligation to go inside."),
        (FEMALE, "Please wear comfortable shoes and bring water. It gets very hot underground."),
        (FEMALE, "We'll have a fifteen-minute break at the souvenir shop halfway through. The bus will depart for the return journey at exactly two PM."),
        (FEMALE, "Any questions before we begin? No? Great, let's go!"),
    ],
    "l8c": [
        (MALE,   "Excuse me, could you tell me how to get to the night market from here?"),
        (FEMALE, "Of course! It's about a ten-minute walk. Go out the main entrance and turn left."),
        (MALE,   "Left at the entrance, okay."),
        (FEMALE, "Walk straight for about two hundred meters until you reach the traffic light. Then turn right onto Nguyen Hue Street."),
        (MALE,   "Right at the traffic light."),
        (FEMALE, "Yes. Continue for another five minutes and you'll see the market on your left. You can't miss it — there are lots of lights and food stalls."),
        (MALE,   "Is it safe to walk there at night?"),
        (FEMALE, "Absolutely. It's a very popular tourist area. But do keep an eye on your belongings. Would you like me to write down the directions?"),
        (MALE,   "No, I think I've got it. Thank you so much!"),
    ],
    "l9c": [
        (FEMALE, "Welcome to the Lotus Spa. Do you have an appointment?"),
        (MALE,   "No, I was hoping to book something for this afternoon. What do you recommend?"),
        (FEMALE, "Our most popular treatment is the Vietnamese herbal massage. It's ninety minutes and costs eighty dollars."),
        (MALE,   "That sounds nice. Do you have anything shorter? I have dinner at seven."),
        (FEMALE, "We have a sixty-minute aromatherapy massage for fifty-five dollars. I can book you in at five PM."),
        (MALE,   "Perfect. Can my wife also book at the same time?"),
        (FEMALE, "Let me check. Yes, we have a couples room available at five PM. Shall I book both?"),
        (MALE,   "Yes, please. Room four twelve, the name is Henderson."),
        (FEMALE, "Wonderful. We'll see you and Mrs. Henderson at five PM. Enjoy your afternoon!"),
    ],
    "l10c": [
        (FEMALE, "Thank you for joining us today. Can you tell us about the biggest changes in Vietnam's tourism industry over the past decade?"),
        (MALE,   "Certainly. The most significant change has been the shift toward experiential tourism. Visitors no longer want to just see famous sites — they want to cook local food, learn traditional crafts, and interact with communities."),
        (FEMALE, "How has technology impacted the industry?"),
        (MALE,   "Enormously. Online booking now accounts for sixty-five percent of all reservations. Social media has become the primary marketing channel. And artificial intelligence is beginning to personalize travel recommendations at scale."),
        (FEMALE, "What challenges remain for the sector?"),
        (MALE,   "Infrastructure development hasn't kept pace with demand. We also need more trained professionals who can deliver international-standard service while maintaining authentic Vietnamese hospitality."),
        (FEMALE, "Thank you for those valuable insights."),
        (MALE,   "My pleasure. The future of Vietnam's tourism is very bright."),
    ],
}

SILENCE_MS = 700  # ms between speakers


async def synth_line(voice: str, text: str, out_file: str):
    """Synthesize one line of speech using edge-tts."""
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, rate="-5%", volume="+0%")
    await communicate.save(out_file)


async def build_conversation(name: str, lines: list, out_dir: str) -> str:
    """Build a single MP3 from a list of (voice, text) tuples."""
    tmp = tempfile.mkdtemp(prefix=f"edgetts_{name}_")
    parts = []

    # Generate short silence clip for between speakers
    silence_file = os.path.join(tmp, "silence.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         f"anullsrc=r=24000:cl=mono", "-t", f"{SILENCE_MS/1000:.2f}",
         "-q:a", "5", silence_file],
        check=True, capture_output=True
    )

    # Generate initial silence to prevent cutting off the first words
    initial_silence_file = os.path.join(tmp, "init_silence.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i",
         f"anullsrc=r=24000:cl=mono", "-t", "2.0",
         "-q:a", "5", initial_silence_file],
        check=True, capture_output=True
    )

    parts.append(initial_silence_file)

    for i, (voice, text) in enumerate(lines):
        part_file = os.path.join(tmp, f"part_{i:02d}.mp3")
        print(f"    [{name}] line {i+1}/{len(lines)}: {text[:55]}...")
        await synth_line(voice, text, part_file)
        parts.append(part_file)
        if i < len(lines) - 1:
            parts.append(silence_file)

    # Concat with ffmpeg
    list_file = os.path.join(tmp, "list.txt")
    with open(list_file, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")

    out_mp3 = os.path.join(out_dir, f"{name}.mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
         "-i", list_file, "-acodec", "libmp3lame", "-q:a", "2", out_mp3],
        check=True, capture_output=True
    )

    shutil.rmtree(tmp, ignore_errors=True)
    size_kb = os.path.getsize(out_mp3) / 1024
    print(f"  ✅  {name}.mp3  ({size_kb:.0f} KB)")
    return out_mp3


async def main():
    # Check / install edge-tts
    try:
        import edge_tts  # noqa
    except ImportError:
        print("Installing edge-tts...")
        subprocess.run([sys.executable, "-m", "pip", "install", "edge-tts", "-q"], check=True)
        import edge_tts  # noqa

    os.makedirs(AUDIO_DIR, exist_ok=True)
    print(f"\n🎙  Generating {len(CONVERSATIONS)} audio files → {AUDIO_DIR}\n")

    for name, lines in CONVERSATIONS.items():
        await build_conversation(name, lines, AUDIO_DIR)

    print("\n✅  All audio files generated successfully!")
    # List results
    subprocess.run(["ls", "-lh", AUDIO_DIR])


if __name__ == "__main__":
    asyncio.run(main())
