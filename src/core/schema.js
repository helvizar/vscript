// Defines the shape of an episode, the default vocal registers, the 5-act blueprint, and a sample episode.
// Pure data and factories only: no storage, no UI.

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const ZONES = { CORE: 'core', EXPANSION: 'expansion' };

export const TRAFFIC_SOURCES = ['Browse', 'Suggested', 'Search'];

export const DEFAULT_REGISTERS = [
  { id: 'bright', name: 'Bright / Cheerful', wpm: 135 },
  { id: 'deep', name: 'Deep / Intense', wpm: 100 },
  { id: 'calm', name: 'Calm / Storytelling', wpm: 105 },
];

export const ACTS = [
  { id: 'act1', title: 'Act 1: Cold Open / Open Loop', timeHint: '0:00–0:45', rehook: false },
  { id: 'act2', title: 'Act 2: Immersion & Setup', timeHint: '', rehook: false },
  { id: 'act3', title: 'Act 3: Re-Hook 1 (Conflict / Shift)', timeHint: '', rehook: true },
  { id: 'act4', title: 'Act 4: Re-Hook 2 (Climax & Resolution)', timeHint: '', rehook: true },
  { id: 'act5', title: 'Act 5: Outro / Next-Episode Bridge', timeHint: '', rehook: false },
];

// null = not entered yet (post-upload data); keeps "0" distinct from "unknown".
export const createAnalytics = () => ({
  discovery: { impressions: null, ctr: null, trafficSource: '' },
  retention: {
    retention30s: null,
    avdSeconds: null,
    avgPercentViewed: null,
    returningViewers: null,
    dipSpikeTimestamps: '',
  },
  audience: { likes: null, comments: null, topRequests: '', moodNotes: '', trendTags: [] },
});

export const createBlock = ({
  actId,
  registerId = 'calm',
  zone = ZONES.CORE,
  label = '',
  text = '',
} = {}) => ({ id: uid(), actId, registerId, zone, label, text });

// Blank episode: one empty core block per act. Registers are copied so they can be renamed per episode.
export const createEpisode = (overrides = {}) => {
  const now = Date.now();
  return {
    id: uid(),
    title: '[M4F] ',
    thumbnailText: '',
    description: '',
    tags: [],
    chapters: '',
    mood: '',
    hookStyle: '',
    registers: DEFAULT_REGISTERS.map((r) => ({ ...r })),
    blocks: ACTS.map((a) => createBlock({ actId: a.id })),
    analytics: createAnalytics(),
    uploaded: false,
    clips: [], // teleprompter "Good Take" timestamps: { id, seconds, note }
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
};

// Copy with new ids; analytics and clips reset because they belong to the original upload/session.
export const duplicateEpisode = (ep) => {
  const now = Date.now();
  return {
    ...structuredClone(ep),
    id: uid(),
    title: `${ep.title} (Copy)`,
    blocks: ep.blocks.map((b) => ({ ...b, id: uid() })),
    analytics: createAnalytics(),
    uploaded: false,
    clips: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const createSampleEpisode = () =>
  createEpisode({
    title: "[M4F] You Said You'd Be Home By Nine... (Yandere Girlfriend Waits Up For You) [ASMR Roleplay]",
    thumbnailText: "YOU'RE LATE.",
    description:
      "She waited up. Dinner's cold, the door is locked, and she has questions about where you've been.\n\nHeadphones on. Stay close.",
    tags: ['m4f', 'asmr roleplay', 'yandere girlfriend', 'girlfriend asmr', 'whisper', 'sleep'],
    chapters: '0:00 You\'re late\n1:10 Sit with me\n3:30 The phone call\n5:40 Closer\n7:30 Goodnight, for now',
    mood: 'Yandere',
    hookStyle: 'Accusation / open loop',
    registers: [
      ...DEFAULT_REGISTERS.map((r) => ({ ...r })),
      { id: 'yandere', name: 'Yandere (Soft Whisper)', wpm: 95 },
    ],
    blocks: [
      createBlock({
        actId: 'act1',
        registerId: 'yandere',
        label: 'Cold open',
        text:
          "[SFX: front door lock clicking] You're late. [PAUSE 2s] You said nine o'clock. It's almost eleven. [PAUSE 2s] And I'm not angry. Really. I kept your dinner warm anyway. [PAUSE 3s] Do you want to know why I'm not angry? [PAUSE 3s] Sit down. I'll tell you what I did while I waited.",
      }),
      createBlock({
        actId: 'act2',
        registerId: 'calm',
        label: 'Grounding',
        text:
          "[SFX: soft footsteps, wooden floor] Come on, shoes off. There. Isn't that better? [PAUSE 2s] The apartment is quiet tonight. Just the rain on the window. [SFX: rain] I lit the candle you like. I wanted everything perfect for when you got home. [PAUSE 3s] I counted the minutes, you know. Every single one.",
      }),
      createBlock({
        actId: 'act2',
        registerId: 'calm',
        zone: ZONES.EXPANSION,
        label: 'Inner monologue',
        text:
          "[PAUSE 2s] Maybe I'm being silly. People get stuck at work. Traffic happens. [PAUSE 2s] But your phone went straight to voicemail. Four times. [PAUSE 3s] I'm sure there's an explanation. [PAUSE 2s] There has to be.",
      }),
      createBlock({
        actId: 'act3',
        registerId: 'deep',
        label: 'Conflict shift',
        text:
          "[RE-HOOK] Who is Claire? [PAUSE 3s] Her name lit up your screen while you were in the shower last week. I didn't read the message. I only saw the name. [PAUSE 2s] So tell me. Slowly. I have all night. [PAUSE 4s] Look at me while you answer.",
      }),
      createBlock({
        actId: 'act3',
        registerId: 'yandere',
        zone: ZONES.EXPANSION,
        label: 'Proximity trigger',
        text:
          "[PROXIMITY] Shh. Closer. I want to hear you breathe. [SFX: fabric rustle] [PAUSE 3s] Your heartbeat is so loud. Is that guilt, or is that me? [PAUSE 3s] Don't move. Just let me listen.",
      }),
      createBlock({
        actId: 'act4',
        registerId: 'calm',
        label: 'Climax & resolution',
        text:
          "[RE-HOOK] Claire is your sister's coworker. Isn't she? [PAUSE 2s] I checked. Of course I checked. [PAUSE 3s] Oh. Oh, you were planning something. For me. [PAUSE 3s] I'm sorry. I got scared. When you're late, my head fills with the worst things. [PAUSE 3s] Say you forgive me. Please.",
      }),
      createBlock({
        actId: 'act5',
        registerId: 'bright',
        label: 'Next-episode bridge',
        text:
          "There. All better. [PAUSE 2s] Go to sleep now. I'll be right here. [SFX: blanket rustle] [PAUSE 3s] Tomorrow, you'll finally meet my mother. She has so many stories about me. Next episode, if you're brave enough. Goodnight, love.",
      }),
    ],
  });
