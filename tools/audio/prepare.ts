// Builds art/audio (SFX and instrument note samples) from CC0 / public-domain sources.
//
// Every shipped file is declared once in SOURCES below, which drives the download, the
// processing and art/audio/CREDITS.json, so the credits cannot drift from what is on disk.
// Raw downloads stay outside the repo in the cache directory (first argument, default
// $TMPDIR/corsair-audio). Non-WAV sources (OGG/MP3/FLAC) are decoded with macOS's built-in
// `afconvert`; zip archives are unpacked with `unzip`. Everything else is plain Node.
//
// Run from the repo root: node tools/audio/prepare.ts [cacheDir]
//         check only:    node tools/audio/prepare.ts --check
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative } from 'node:path';
import { detectPitch, firstAbove, hzToMidi, peak, readWav, resample, writeWav16 } from './wav.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'art', 'audio');
const BUDGET_BYTES = 7 * 1024 * 1024;

const SFX_RATE = 22050;
const NOTE_RATE = 32000;

const CC0 = { licence: 'CC0 1.0', licence_url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const VSCO = {
  ...CC0,
  author: 'Versilian Studios LLC (VSCO 2 Community Edition, Sam Gossner)',
  licence_url: 'https://github.com/sgossner/VSCO-2-CE/blob/master/LICENSE',
};
const VSCO_RAW = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
const OGA = 'https://opengameart.org/sites/default/files/';
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/';

type Source = {
  out: string; // path under art/audio
  title: string;
  author: string;
  source_url: string; // the item's own page, where the licence is stated
  licence: string;
  licence_url: string;
  notes?: string;
  download: string; // file or archive URL
  member?: string; // file inside the archive
  start?: number; // seconds into the (decoded) source
  maxLen: number; // seconds, after leading-silence trim
  fadeIn?: number;
  fadeOut?: number;
  rate: number;
  silenceDb?: number; // leading-silence threshold relative to peak; omit to keep the start as is
};

type Note = { id: string; name: string; dir: string; label: string; file: string; midi: number; notes: string };

// Instrument note samples. `midi` is the sounding root, confirmed against detectPitch (see
// the check below): VSCO violin and harp names use scientific pitch (C4 = 60); the flute
// and contrabass names are one octave below sounding pitch, so their roots are name + 12.
function vsco(n: Note, maxLen: number, page: string): Source {
  return {
    out: `instruments/${n.id}/${n.file}`,
    title: `${n.name} ${n.label} (${basename(n.dir)})`,
    ...VSCO,
    source_url: `https://github.com/sgossner/VSCO-2-CE/tree/master/${page}`,
    notes: `${n.notes} Trimmed to ${maxLen}s with a fade; mono ${NOTE_RATE} Hz.`,
    download: VSCO_RAW + `${n.dir}/${n.label}`.split('/').map(encodeURIComponent).join('/'),
    maxLen,
    fadeOut: 0.12,
    rate: NOTE_RATE,
    silenceDb: -40,
  };
}

const INSTRUMENTS: Record<string, { name: string; notes: string; maxLen: number; dir: string; files: [string, number][] }> = {
  fiddle: {
    name: 'Solo violin (arco, vibrato, forte)',
    notes: 'Sustained bowed notes; the steady part starts ~0.3s in, so long notes can loop from there. VSCO names are scientific pitch. The E5 (76) sample is ~19 cents sharp.',
    maxLen: 2.0,
    dir: 'Strings/Solo Violin/Arco Vib',
    files: [['LLVln_ArcoVib_G3_f.wav', 55], ['LLVln_ArcoVib_C4_f.wav', 60], ['LLVln_ArcoVib_E4_f.wav', 64], ['LLVln_ArcoVib_A4_f.wav', 69], ['LLVln_ArcoVib_C5_f.wav', 72], ['LLVln_ArcoVib_E5_f.wav', 76], ['LLVln_ArcoVib_A5_f.wav', 81]],
  },
  flute: {
    name: 'Flute (sustained, no vibrato) - tin-whistle stand-in',
    notes: 'Upper flute register chosen for a whistle-like melody voice. VSCO flute names are an octave below sounding pitch (file "C4" sounds C5 = 72).',
    maxLen: 2.0,
    dir: 'Woodwinds/Flute/susNV',
    files: [['LDFlute_susNV_A3_v3_1.wav', 69], ['LDFlute_susNV_C4_v3_1.wav', 72], ['LDFlute_susNV_E4_v3_1.wav', 76], ['LDFlute_susNV_A4_v3_1.wav', 81], ['LDFlute_susNV_C5_v2_1.wav', 84], ['LDFlute_susNV_E5_v2_1.wav', 88]],
  },
  bass: {
    name: 'Solo double bass (pizzicato)',
    notes: 'Plucked bass line. VSCO contrabass names are an octave below sounding pitch (file "C1" sounds C2 = 36).',
    maxLen: 1.6,
    dir: 'Strings/Solo Contrabass/Pizz',
    files: [['BKCtbss_Pizz_C1_v1_rr1.wav', 36], ['BKCtbss_Pizz_E1_v3_rr1.wav', 40], ['BKCtbss_Pizz_G#1_v1_rr1.wav', 44], ['BKCtbss_Pizz_C#2_v1_rr1.wav', 49], ['BKCtbss_Pizz_E2_v1_rr1.wav', 52], ['BKCtbss_Pizz_G#2_v1_rr1.wav', 56]],
  },
  harp: {
    name: 'Concert harp (mf) - plucked lute/guitar stand-in',
    notes: 'Plucked strings; no CC0 guitar or lute note set was found. Samples sit ~10 cents flat of A440.',
    maxLen: 1.8,
    dir: 'Strings/Harp',
    files: [['KSHarp_G3_mf.wav', 55], ['KSHarp_B3_mf.wav', 59], ['KSHarp_D4_mf.wav', 62], ['KSHarp_F4_mf.wav', 65], ['KSHarp_A4_mf.wav', 69], ['KSHarp_C5_mf.wav', 72], ['KSHarp_E5_mf.wav', 76]],
  },
};

// Unpitched one-shots: `midi` 60 means "play at the recorded speed".
const DRUMS: Record<string, { name: string; notes: string; maxLen: number; files: [string, string][] }> = {
  frame_drum: {
    name: 'Large hand drum (frame-drum / bodhran stand-in)',
    notes: 'Hand hits on a large ethnic drum, forte and mezzo-piano. Unpitched; root 60 = recorded speed.',
    maxLen: 0.7,
    files: [['VSCO 1 Percussion/drums/other/ethnic/giant/hand', 'EthnicLargeHand_hit_f_1.wav'], ['VSCO 1 Percussion/drums/other/ethnic/giant/hand', 'EthnicLargeHand_hit_mp_1.wav']],
  },
  bass_drum: {
    name: 'Concert bass drum',
    notes: 'Single hit with the tail cut to 1s. Unpitched; root 60 = recorded speed.',
    maxLen: 1.0,
    files: [['Percussion', 'BDrumNewhit_v4_rr1_Sum.wav']],
  },
  tambourine: {
    name: 'Tambourine',
    notes: 'Down-stroke, up-stroke and a hit. Unpitched; root 60 = recorded speed.',
    maxLen: 0.5,
    files: [['VSCO 1 Percussion/varWood', 'tambourine_Down.wav'], ['VSCO 1 Percussion/varWood', 'tambourine_up_2.wav'], ['Percussion', 'Tamb1-Hit_v2_rr1_Sum.wav']],
  },
};

const NOTE_SOURCES: Source[] = [];
const instrumentsJson: Record<string, unknown> = {};
for (const [id, inst] of Object.entries(INSTRUMENTS)) {
  const samples = inst.files.map(([label, midi]) => {
    const file = `${id}_${midi}.wav`;
    NOTE_SOURCES.push(vsco({ id, name: inst.name, dir: inst.dir, label, file, midi, notes: `Root MIDI ${midi}.` }, inst.maxLen, inst.dir));
    return { file: `art/audio/instruments/${id}/${file}`, midi };
  });
  const roots = samples.map((s) => s.midi);
  // Range reaches 2.5 semitones past the outer samples, the same limit as between samples.
  const range = [Math.ceil(Math.min(...roots) - 2.5), Math.floor(Math.max(...roots) + 2.5)];
  instrumentsJson[id] = { name: inst.name, samples, range, notes: inst.notes };
}
for (const [id, d] of Object.entries(DRUMS)) {
  const samples = d.files.map(([dir, label], i) => {
    const file = `${id}_${i + 1}.wav`;
    const n: Note = { id, name: d.name, dir, label, file, midi: 60, notes: 'Unpitched one-shot.' };
    NOTE_SOURCES.push(vsco(n, d.maxLen, dir));
    return { file: `art/audio/instruments/${id}/${file}`, midi: 60 };
  });
  instrumentsJson[id] = { name: d.name, samples, range: [60, 60], notes: d.notes };
}

const PDSOUNDS_NOTE = 'Commons licence template {{PD-author}} (released into the public domain by the author, worldwide) via PDSounds.org.';
const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;
const PD_COMMONS = { licence: 'Public domain', licence_url: 'https://commons.wikimedia.org/wiki/Template:PD-author' };
const NOAA_PD = { licence: 'Public domain (US federal government work)', licence_url: 'https://www.fisheries.noaa.gov/national/about-us/website-policies-and-disclaimers' };
const NOAA_PAGE = 'https://www.fisheries.noaa.gov/national/science-data/sounds-ocean-mammals';
const NOAA_AUTHOR = 'NOAA Northeast Fisheries Science Center, Passive Acoustics Branch';
const NOAA_NOTE = 'Hydrophone (underwater) recording by NOAA\'s own passive-acoustics group. NOAA Fisheries copyright policy: "Information created by the U.S. government and presented on U.S. government websites is not subject to copyright in the United States"; credit requested as "Courtesy: National Oceanic and Atmospheric Administration".';
const NPS_PD = { licence: 'Public domain (US federal government work)', licence_url: 'https://www.nps.gov/subjects/sound/gallery.htm' };

const SFX_SOURCES: (Source & { id: string })[] = [
  // Gulls
  ...[2, 4, 6].map((n, i) => ({
    id: 'gull', out: `sfx/gull_${i + 1}.wav`, title: `Seagull Ambient ${n}`, author: 'Rango Mango',
    source_url: 'https://opengameart.org/content/solo-seagull-sound-effects', ...CC0,
    download: OGA + encodeURIComponent(`Seagull Ambient ${n}.wav`), maxLen: 4, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.03,
  })),
  {
    id: 'gull', out: 'sfx/gull_4.wav', title: 'Western Gull (Golden Gate National Recreation Area)', author: 'U.S. National Park Service, Natural Sounds and Night Skies Division',
    source_url: 'https://www.nps.gov/subjects/sound/sounds-western-gull.htm', ...NPS_PD,
    notes: 'A flock calling; first 4s of the 4.7s MP3, decoded to WAV. NPS gallery: "The files are in the public domain and may be downloaded."',
    download: 'https://www.nps.gov/nps-audiovideo/audiovideo/588a7add-3839-4eb9-86f1-66cfd867224a.mp3', maxLen: 4, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.3,
  },
  // Hull creaks
  {
    id: 'creak', out: 'sfx/creak_1.wav', title: 'Tree Creaking', author: 'Department64',
    source_url: 'https://opengameart.org/content/tree-creaking', ...CC0,
    notes: 'Two long wooden groans (hull-groan stand-in); first 3.7s of the FLAC.',
    download: OGA + 'tree_creak.flac', maxLen: 3.7, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.3,
  },
  {
    id: 'creak', out: 'sfx/creak_2.wav', title: 'Creaky Wooden Swivel Chair', author: 'chocoholic',
    source_url: commons('Creaky_wooden_swivel_chair.ogg'), ...PD_COMMONS,
    notes: `Old oak chair creaks, 0.7-4.7s of the source. ${PDSOUNDS_NOTE}`,
    download: COMMONS + '4/4d/Creaky_wooden_swivel_chair.ogg', start: 0.7, maxLen: 4, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.3,
  },
  {
    id: 'creak', out: 'sfx/creak_3.wav', title: 'Creaky Wooden Casket', author: 'stephan',
    source_url: commons('Creaky_wooden_casket.ogg'), ...PD_COMMONS,
    notes: `Short wooden creak. ${PDSOUNDS_NOTE}`,
    download: COMMONS + 'e/ec/Creaky_wooden_casket.ogg', maxLen: 4, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.05,
  },
  // Sail canvas
  ...[1, 2, 6].map((n, i) => ({
    id: 'canvas', out: `sfx/canvas_${i + 1}.wav`, title: `Cloth_0${n}`, author: 'OwlishMedia',
    source_url: 'https://opengameart.org/content/202-more-sound-effects', ...CC0,
    notes: 'Cloth snap/rustle from the "202 More Sound Effects" pack, standing in for sail canvas.',
    download: OGA + 'MoreSounds.zip', member: `Cloth/Cloth_0${n}.wav`, maxLen: 2, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.05,
  })),
  // Rope / block
  {
    id: 'rope', out: 'sfx/rope_1.wav', title: 'creak2', author: 'Kenney (www.kenney.nl)',
    source_url: 'https://opengameart.org/content/50-rpg-sound-effects', ...CC0,
    notes: 'Wooden creak from the Kenney RPG pack, standing in for a rope/block creak; no CC0 rope-under-load recording was found.',
    download: OGA + 'RPGsounds_Kenney.zip', member: 'OGG/creak2.ogg', maxLen: 2, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.03,
  },
  {
    id: 'rope', out: 'sfx/rope_2.wav', title: 'wood_squeak_01', author: 'rubberduck',
    source_url: 'https://opengameart.org/content/100-cc0-metal-and-wood-sfx', ...CC0,
    notes: 'Short wood squeak, standing in for a block/sheave creak.',
    download: OGA + '100-CC0-wood-metal-SFX.zip', member: 'wood_squeak_01.ogg', maxLen: 2, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.03,
  },
  // Harbour
  {
    id: 'harbour_bell', out: 'sfx/harbour_bell_1.wav', title: 'Church bells and bird song', author: 'lezer',
    source_url: commons('Sound_of_church_bells_and_birds.oga'), ...PD_COMMONS,
    notes: `Distant church bell tolling heard from a window, with birdsong; 8s from 12s in, faded at both ends. ${PDSOUNDS_NOTE}`,
    download: COMMONS + '3/37/Sound_of_church_bells_and_birds.oga', start: 12, maxLen: 8, fadeIn: 0.4, fadeOut: 0.8, rate: SFX_RATE,
  },
  {
    id: 'harbour_crowd', out: 'sfx/harbour_crowd_1.wav', title: 'Boat by a wharf - 3', author: 'ezwa',
    source_url: commons('Boat_by_a_wharf_3.ogg'), ...PD_COMMONS,
    notes: `Outdoor wharf: boat noises, water and people talking; 8s from 2.5s in, faded at both ends. ${PDSOUNDS_NOTE}`,
    download: COMMONS + '7/74/Boat_by_a_wharf_3.ogg', start: 2.5, maxLen: 8, fadeIn: 0.5, fadeOut: 0.8, rate: SFX_RATE,
  },
  // Thunder
  {
    id: 'thunder', out: 'sfx/thunder_1.wav', title: 'sfx100v2_thunder_01', author: 'rubberduck',
    source_url: 'https://opengameart.org/content/100-cc0-sfx-2', ...CC0,
    notes: 'Whole 5.3s thunder clap, decoded from OGG.',
    download: OGA + 'sfx_100_v2.zip', member: 'sfx100v2_thunder_01.ogg', maxLen: 8, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.3,
  },
  {
    id: 'thunder', out: 'sfx/thunder_2.wav', title: 'Thunder', author: 'U.S. National Park Service, Natural Sounds and Night Skies Division',
    source_url: 'https://www.nps.gov/subjects/sound/sounds-thunder.htm', ...NPS_PD,
    notes: 'Rolling thunder (with rain), 8s from 2.5s into the 46s MP3, faded out. NPS gallery: "The files are in the public domain and may be downloaded."',
    download: 'https://www.nps.gov/nps-audiovideo/legacy/mp3/nri/avElement/nri-Thunder.mp3', start: 2.5, maxLen: 8, fadeIn: 0.2, fadeOut: 1.5, rate: SFX_RATE,
  },
  // Splashes
  ...[3, 12, 14].map((n, i) => ({
    id: 'splash_small', out: `sfx/splash_small_${i + 1}.wav`, title: `splash_${n}`, author: 'rubberduck',
    source_url: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx', ...CC0,
    notes: 'Short splash/plop from the "40 CC0 water / splash / slime SFX" pack.',
    download: OGA + 'water-splash-slime-sfx.zip', member: `splash_${String(n).padStart(2, '0')}.ogg`, maxLen: 1.5, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.05,
  })),
  ...[7, 11].map((n, i) => ({
    id: 'splash_big', out: `sfx/splash_big_${i + 1}.wav`, title: `splash_${n}`, author: 'rubberduck',
    source_url: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx', ...CC0,
    notes: 'The two longest, most sustained splashes from the "40 CC0 water / splash / slime SFX" pack.',
    download: OGA + 'water-splash-slime-sfx.zip', member: `splash_${String(n).padStart(2, '0')}.ogg`, maxLen: 2.5, rate: SFX_RATE, silenceDb: -40, fadeOut: 0.1,
  })),
  // Dolphins: whistle-dense windows picked by a spectral tonality scan (not by ear).
  ...([
    ['Stfr_Multisound_NOAA_PAGroup_01 (Atlantic spotted dolphin)', 'Stfr-Multisound-NOAA-PAGroup-01-atlantic-spotted-dolphin-clip.mp3', 0.15, 2.85],
    ['Stfr_Multisound_NOAA_PAGroup_01 (Atlantic spotted dolphin)', 'Stfr-Multisound-NOAA-PAGroup-01-atlantic-spotted-dolphin-clip.mp3', 3.1, 1.7],
    ['Dede_whistles_NOAA_PAGroup_01 (short-beaked common dolphin)', 'Dede-whistles-NOAA-PAGroup-01-short-beaked-common-dolphin-clip.mp3', 3.9, 3.0],
  ] as const).map(([title, file, start, maxLen], i) => ({
    id: 'dolphin', out: `sfx/dolphin_${i + 1}.wav`, title, author: NOAA_AUTHOR, source_url: NOAA_PAGE, ...NOAA_PD,
    notes: `Whistles, ${start}-${(start + maxLen).toFixed(2)}s of the clip. At 22.05 kHz only whistle energy below ~11 kHz survives. ${NOAA_NOTE}`,
    download: 'https://www.fisheries.noaa.gov/s3/2023-04/' + file, start, maxLen, fadeIn: 0.05, fadeOut: 0.2, rate: SFX_RATE,
  })),
  // Humpback song: each window holds whole song units with quiet either side (from an energy scan).
  ...([[6.0, 9.6], [43.6, 6.8]] as const).map(([start, maxLen], i) => ({
    id: 'whale_song', out: `sfx/whale_song_${i + 1}.wav`, title: 'Meno_song_NOAA_PAGroup_13 (humpback whale)', author: NOAA_AUTHOR, source_url: NOAA_PAGE, ...NOAA_PD,
    notes: `Humpback song, ${start}-${(start + maxLen).toFixed(1)}s of the 55s clip (8 kHz source, so nothing above 4 kHz), faded at both ends. ${NOAA_NOTE}`,
    download: 'https://www.fisheries.noaa.gov/s3/2023-04/Meno-song-NOAA-PAGroup-13-humpback-clip.mp3', start, maxLen, fadeIn: 0.4, fadeOut: 0.8, rate: SFX_RATE,
  })),
  // Whale blow: NPS says the blows are heard "twice near the end"; this is the louder, later event.
  {
    id: 'whale_blow', out: 'sfx/whale_blow_1.wav', title: 'Humpback whale wheezeblow (Glacier Bay)', author: 'U.S. National Park Service, Glacier Bay National Park and Preserve',
    source_url: commons('Humpback_whale_wheezeblow.ogg'), licence: 'Public domain (US federal government work)', licence_url: 'https://commons.wikimedia.org/wiki/Template:PD-USGov-NPS',
    notes: 'Wheeze blow, 56.9-59.9s of the 61s hydrophone recording (the strongest event near the end, where NPS says two blows are audible); identified by energy scan, not by ear, and heard through a hydrophone rather than in air. Commons template {{PD-USGov-NPS}}.',
    download: COMMONS + 'd/d4/Humpback_whale_wheezeblow.ogg', start: 56.9, maxLen: 3, fadeIn: 0.1, fadeOut: 0.5, rate: SFX_RATE,
  },
];

const SFX_NOTES: Record<string, string> = {
  gull: 'Single gulls (OpenGameArt) and one NPS western-gull flock clip.',
  creak: 'Wooden groans/creaks for the hull; play slowed (playbackRate 0.6-0.9) for a heavier ship.',
  canvas: 'Cloth snaps/rustles for setting or furling sail.',
  rope: 'Short wooden creaks standing in for rope through a block.',
  harbour_bell: 'Distant church bell tolling (with birdsong); loopable bed with faded ends.',
  harbour_crowd: 'Outdoor wharf with voices, faded ends; play low and low-passed for distance. (An indoor restaurant bed was dropped: it may carry background music the recordist could not license.)',
  thunder: 'One sharp clap and one long rolling peal.',
  dolphin: 'Dolphin whistle chatter recorded underwater (with hydrophone hiss); low-pass for an above-water feel.',
  whale_song: 'Distant humpback song for calm nights; hydrophone recordings, faded ends.',
  whale_blow: 'A humpback exhaling (wheeze blow), heard through a hydrophone; low-pass and add air noise for a spout at the surface.',
  splash_small: 'Small splashes / plops (fish, thrown object); about 0.5-0.8s.',
  splash_big: 'Bigger splashes (~1.1-1.3s) for a dolphin re-entering or a diving bird; pitch down (playbackRate 0.7-0.85) for more weight.',
};

// ---------------------------------------------------------------------------------------

async function fetchTo(url: string, path: string): Promise<void> {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'corsair-audio-prep/1.0' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

// Returns a local PCM WAV for the source, downloading, unzipping and decoding as needed.
async function localWav(src: Source, cache: string): Promise<string> {
  const name = decodeURIComponent(new URL(src.download).pathname).split('/').filter(Boolean).join('_');
  let file = join(cache, 'raw', name);
  await fetchTo(src.download, file);
  if (src.member) {
    const dir = join(cache, 'unzip', name);
    const member = join(dir, src.member);
    if (!existsSync(member)) {
      mkdirSync(dir, { recursive: true });
      execFileSync('unzip', ['-oq', file, src.member, '-d', dir]);
    }
    file = member;
  }
  if (extname(file).toLowerCase() === '.wav') return file;
  const wav = join(cache, 'decoded', basename(file) + '.wav');
  if (!existsSync(wav)) {
    mkdirSync(dirname(wav), { recursive: true });
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', file, wav]);
  }
  return wav;
}

function render(src: Source, wavPath: string): number {
  const m = resample(readWav(wavPath), src.rate);
  let s = Math.floor((src.start ?? 0) * m.rate);
  if (src.silenceDb !== undefined) {
    // A 5 ms pre-roll keeps the attack transient intact.
    s += Math.max(0, firstAbove(m.data.subarray(s), src.silenceDb) - Math.floor(0.005 * m.rate));
  }
  const data = m.data.slice(s, Math.min(m.data.length, s + Math.floor(src.maxLen * m.rate)));
  const fi = Math.floor((src.fadeIn ?? 0) * m.rate);
  const fo = Math.min(data.length, Math.floor((src.fadeOut ?? 0) * m.rate));
  for (let i = 0; i < fi; i++) data[i]! *= i / fi;
  for (let i = 0; i < fo; i++) data[data.length - 1 - i]! *= i / fo;
  const gain = 10 ** (-1 / 20) / (peak(data) || 1); // peak-normalise to -1 dBFS
  for (let i = 0; i < data.length; i++) data[i]! *= gain;
  writeWav16(join(OUT, src.out), { rate: m.rate, data });
  return data.length / m.rate;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)],
  );
}

// Every file in art/audio must be credited (or be one of the JSON manifests), every credited
// file must exist, every WAV must parse, and instrument roots must match their detected pitch.
function check(): void {
  const credits = JSON.parse(readFileSync(join(OUT, 'CREDITS.json'), 'utf8')) as { file: string; licence: string }[];
  const credited = new Set(credits.map((c) => c.file));
  const manifests = new Set(['CREDITS.json', 'sfx/sfx.json', 'instruments/instruments.json'].map((f) => `art/audio/${f}`));
  const problems: string[] = [];
  let total = 0;
  for (const c of credits) {
    if (!/^(CC0|Public domain)/.test(c.licence)) problems.push(`${c.file}: licence ${c.licence}`);
    if (!existsSync(join(ROOT, c.file))) problems.push(`${c.file}: credited but missing`);
  }
  for (const abs of listFiles(OUT)) {
    const rel = relative(ROOT, abs).split('\\').join('/');
    total += statSync(abs).size;
    if (!credited.has(rel) && !manifests.has(rel)) problems.push(`${rel}: not in CREDITS.json`);
    if (abs.endsWith('.wav')) {
      try {
        const m = readWav(abs);
        if (m.data.length === 0) problems.push(`${rel}: empty`);
      } catch (e) {
        problems.push(`${rel}: ${(e as Error).message}`);
      }
    }
  }
  const insts = JSON.parse(readFileSync(join(OUT, 'instruments', 'instruments.json'), 'utf8')) as Record<string, { samples: { file: string; midi: number }[] }>;
  for (const [id, inst] of Object.entries(insts)) {
    if (!(id in INSTRUMENTS)) continue;
    for (const s of inst.samples) {
      const m = readWav(join(ROOT, s.file));
      // Several windows, because autocorrelation octave-errors on single windows; a root passes
      // if any confident window agrees. Plucked notes are measured nearer the attack.
      const low = resample(m, 22050); // 11025 Hz is too coarse for notes above ~600 Hz
      const windows = id === 'fiddle' || id === 'flute' ? [0.3, 0.5, 0.7] : [0.1, 0.25, 0.4];
      const hits = windows.map((w) => detectPitch(low, w, 0.4)).map((p) => ({ d: hzToMidi(p.hz), clarity: p.clarity }));
      const ok = hits.some((h) => Math.abs(h.d - s.midi) < 0.5 && h.clarity > 0.8);
      const confident = hits.some((h) => h.clarity > 0.85);
      const seen = hits.map((h) => `${h.d.toFixed(2)}/${h.clarity.toFixed(2)}`).join(' ');
      console.log(`  ${ok ? 'ok ' : '?? '} ${s.file}  root ${s.midi}  detected ${seen}`);
      if (!ok && confident) problems.push(`${s.file}: root ${s.midi} but detected ${seen}`);
    }
  }
  console.log(`art/audio: ${(total / 1024 / 1024).toFixed(2)} MB (${total} bytes), budget 7 MB`);
  if (total > BUDGET_BYTES) problems.push('over the 7 MB budget');
  if (problems.length) {
    console.error('CHECK FAILED\n  ' + problems.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('check passed');
  }
}

async function build(cache: string): Promise<void> {
  const all = [...SFX_SOURCES, ...NOTE_SOURCES];
  const credits = [];
  for (const src of all) {
    mkdirSync(dirname(join(OUT, src.out)), { recursive: true });
    const secs = render(src, await localWav(src, cache));
    console.log(`  ${src.out}  ${secs.toFixed(2)}s`);
    const { title, author, source_url, licence, licence_url, notes } = src;
    credits.push({ file: `art/audio/${src.out}`, title, author, source_url, licence, licence_url, notes: notes ?? '' });
  }
  writeFileSync(join(OUT, 'CREDITS.json'), JSON.stringify(credits, null, 2) + '\n');
  const sfx: Record<string, { files: string[]; notes: string }> = {};
  for (const s of SFX_SOURCES) (sfx[s.id] ??= { files: [], notes: SFX_NOTES[s.id] ?? '' }).files.push(`art/audio/${s.out}`);
  writeFileSync(join(OUT, 'sfx', 'sfx.json'), JSON.stringify(sfx, null, 2) + '\n');
  writeFileSync(join(OUT, 'instruments', 'instruments.json'), JSON.stringify(instrumentsJson, null, 2) + '\n');
}

const arg = process.argv[2];
if (arg !== '--check') await build(arg ?? join(tmpdir(), 'corsair-audio'));
check();
