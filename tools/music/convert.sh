#!/bin/sh
# Rebuilds the sea-song entries in packages/data/content/music.json from the ABC files in abc/.
# Each file is the transcription as downloaded, except where noted. Run from the repo root.
#   lilliburlero.abc   - the source writes strain A out twice and also ends it with :|; that :|
#                        is changed to |: so the tune plays AABB.
#   spanish_ladies.abc - only the Chappell voice of the VWML file, with L:1/4 added (the
#                        export omits it but the notes are plainly quarters) and $ breaks removed.
#   wellerman.abc      - written in 2/4 but barred in 4/4, so --meter 4/4.
#   college_hornpipe.abc - Mittell (1799) chosen over The Session's D-major setting for provenance.
set -e
T=tools/music/abc-to-tune.ts
J=packages/data/content/music.json
A=https://abcnotation.com/tunePage?a=
DT=sniff.numachi.com/~rickheit/dtrad/abc_dtrad.tar.gz/abc_dtrad
c() { node $T "$@" --append $J; }

c tools/music/abc/wellerman.abc --meter 4/4 --id wellerman --title "Soon May the Wellerman Come" --mood lively --bpm 104 \
  --source "Traditional New Zealand whaling song (c. 1860s), public domain; melody from The Session, https://thesession.org/tunes/20383 (setting 1, written in 2/4, barred here in 4/4); chords derived"
c tools/music/abc/spanish_ladies.abc --key Gm --id spanish_ladies --title "Spanish Ladies" --mood gentle --bpm 84 \
  --source "Traditional English sea song, public domain; Chappell's version as copied in the Sabine Baring-Gould manuscripts (VWML SBG/1/2/384), ${A}www.vwml.org/components/com_rbdmdtallis/media/abctranscriptions/abc/SBG-1-2-384-0/0000; chords derived"
c tools/music/abc/blow_the_man_down.abc --id blow_the_man_down --title "Blow the Man Down" --mood lively --bpm 192 \
  --source "Traditional halyard shanty, public domain; melody from the Digital Tradition (collection not stated), ${A}$DT/BLOWDOWN/0000; chords derived"
c tools/music/abc/college_hornpipe.abc --id college_hornpipe --title "The College Hornpipe (Sailor's Hornpipe)" --mood lively --bpm 100 \
  --source "Traditional hornpipe (18th century), public domain; melody from William Mittell's manuscript, New Romney, Kent, 1799 (Village Music Project), ${A}www.cpartington.plus.com/Links/Mittell/MITTELL.ABC/0011; chords derived"
c tools/music/abc/haul_away_joe.abc --id haul_away_joe --title "Haul Away Joe" --mood lively --bpm 96 \
  --source "Traditional short-drag shanty, public domain; melody from Henrik Norbeck's ABC song collection, ${A}www.norbeck.nu/abc/i/hnsong1/0102; chords derived"
c tools/music/abc/lilliburlero.abc --beat 3/8 --id lilliburlero --title "Lilliburlero" --mood lively --bpm 100 \
  --source "Traditional English tune (1680s; printed by Playford, set by Purcell), public domain; melody and chords from ${A}trillian.mit.edu/~jc/music/abc/mirror/mindspring.com/~dmilewski/ecdp/3lfpublic/0070"
c tools/music/abc/leave_her_johnny.abc --id leave_her_johnny --title "Leave Her, Johnny" --mood gentle --bpm 76 \
  --source "Traditional pumping shanty, public domain; melody from the Digital Tradition (collection not stated), ${A}$DT/LEAVEHER/0000; chords derived"
c tools/music/abc/admiral_benbow.abc --id admiral_benbow --title "Admiral Benbow" --mood night --bpm 72 \
  --source "Traditional English sea ballad (c. 1702), public domain; noted by Cecil Sharp from Sam Bennett, Ilmington, 1909 (VWML CJS2/10/2321), ${A}www.vwml.org/components/com_rbdmdtallis/media/abctranscriptions/abc/CJS2-10-2321-0/0000; chords derived"
