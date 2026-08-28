/*
 * Lay App Store captions over captured gameplay frames.
 *
 *   node tools/caption-shots.js            # write to work/shots/out
 *   node tools/caption-shots.js --install  # write into assets/store
 *
 * WHY
 *   The three screenshots on the live listing are raw gameplay with no text, and
 *   all three are the same world — so at the size a search result actually shows
 *   them, they read as one purple smear and a person scrolling never learns what
 *   the game is. A caption is the only thing on that page that can say it.
 *
 * WHAT IT WILL NOT DO
 *   Every caption is the game's own mode description, trimmed. Nothing here
 *   promises a feature the build does not have — that is a rejection reason, and
 *   it is also lying to someone about to spend their time.
 *
 * INPUT   work/shots/s*.png  1290x2796  (iPhone 6.9")
 *         work/shots/p*.png  2048x2732  (iPad 13")
 *   from the capture harness: LUMEN.game.resize(forceW, forceH) pinned to the
 *   store size, attract mode driven frame by frame, one render, toDataURL into
 *   tools/shotsink.js. No cheats — a cheated run stamps "DEV RUN — NOT COUNTED"
 *   across the bottom of the frame.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'work', 'shots');
const INSTALL = process.argv.includes('--install');
const OUT = INSTALL ? path.join(ROOT, 'assets', 'store') : path.join(IN, 'out');

// kicker (small, letter-spaced), headline. Order matters: the first three are
// what a search result shows without anyone swiping.
const CAPTIONS = [
  ['ONE THUMB. ONE RULE.', 'Chain gates and the world\nslips into slow motion'],
  ['VORTEX', 'The world leans and turns.\nYour hands are fine —\nyour eyes are the problem.'],
  ['SPRINT', 'No gentle opening.\nFull speed from the first frame.'],
  ['BLACKOUT', 'The light comes in pulses.\nBetween them you fly on memory.'],
  ['MIRROR', 'Everything runs the other way.'],
  ['PRECISION', 'The gaps are barely\nwider than you are.'],
  ['ABANDON HOPE', 'You only see a gate\na heartbeat before it arrives.'],
  ['ZEN', 'Nothing can kill you.\nJust fly.'],
];

const SETS = [
  { prefix: 's', out: 'apple-67', srcs: ['s1-flow', 's5-vortex', 's2-sprint', 's3-blackout', 's4-mirror', 's6-precision', 's7-dread', 's8-zen'] },
  { prefix: 'p', out: 'apple-ipad13', srcs: ['p1-flow', 'p2-vortex', 'p3-sprint', 'p4-blackout', 'p5-mirror', 'p6-precision', 'p7-dread', 'p8-zen'] },
  // Google Play. Same eight scenes, Play's sizes. Capture them into work/play
  // with the harness (resize widths below x dpr 1.25 give these exactly):
  //   phone 1080x1920 -> resize(864, 1536)
  //   tab7  1200x1920 -> resize(960, 1536)
  //   tab10 1600x2560 -> resize(1280, 2048)
  { prefix: 'g', out: 'play-phone', srcs: ['g1-flow', 'g2-vortex', 'g3-sprint', 'g4-blackout', 'g5-mirror', 'g6-precision', 'g7-dread', 'g8-zen'] },
  { prefix: 't7', out: 'play-tab7', srcs: ['t71-flow', 't72-vortex', 't73-sprint', 't74-blackout', 't75-mirror', 't76-precision', 't77-dread', 't78-zen'] },
  { prefix: 't10', out: 'play-tab10', srcs: ['t101-flow', 't102-vortex', 't103-sprint', 't104-blackout', 't105-mirror', 't106-precision', 't107-dread', 't108-zen'] },
];

fs.mkdirSync(OUT, { recursive: true });

const py = `
import sys, json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

IN, OUT, jobs = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])

# Bahnschrift is the closest system face to the game's Rajdhani/Orbitron pairing:
# condensed, geometric, and it survives being shrunk to a store thumbnail.
FONT = r'C:\\Windows\\Fonts\\bahnschrift.ttf'
if not os.path.exists(FONT):
    FONT = r'C:\\Windows\\Fonts\\segoeuib.ttf'

def scrim(img, W, H, top, bottom, blur):
    """A feathered dark band so white text survives a bright world."""
    band = Image.new('L', (W, H), 0)
    ImageDraw.Draw(band).rectangle([0, top, W, bottom], fill=205)
    band = band.filter(ImageFilter.GaussianBlur(blur))
    return Image.composite(Image.new('RGB', (W, H), (4, 4, 10)), img,
                           band.point(lambda v: int(v * 0.86)))

report = []
for src, dst, kicker, head in jobs:
    im = Image.open(src if os.path.isabs(src) else os.path.join(IN, src)).convert('RGB')
    W, H = im.size
    # Type scales off WIDTH, placement off HEIGHT. Scaling everything by height
    # is what made the iPad set look under-set: that canvas is 59% wider than the
    # phone but barely taller, so height-scaled type shrank against it.
    kw = W / 1290.0
    kh = H / 2796.0
    kick_y   = int(300 * kh)            # below the score HUD, above the first gate
    head_max = int(92 * kw)
    kick_px  = int(46 * kw)
    margin   = int(90 * kw)

    lines = head.split('\\n')
    probe = ImageDraw.Draw(im)
    max_w = W - 2 * margin

    # Shrink until the widest line fits. Eyeballing this is how "Between them you
    # fly on memory." came out with both ends sliced off — it looked fine in a
    # contact sheet and was 60px over at full size.
    size = head_max
    while size > int(40 * kw):
        f = ImageFont.truetype(FONT, size)
        widest = max(probe.textlength(l, font=f) for l in lines)
        if widest <= max_w:
            break
        size -= 2
    head_font = ImageFont.truetype(FONT, size)
    kick_font = ImageFont.truetype(FONT, kick_px)

    line_h = int(size * 1.24)
    top = kick_y - int(90 * kh)
    bottom = kick_y + int(70 * kh) + len(lines) * line_h + int(40 * kh)
    im = scrim(im, W, H, top, bottom, int(90 * kw))

    d = ImageDraw.Draw(im)
    x = W // 2
    if kicker:
        spaced = ' '.join(kicker)      # PIL has no letter tracking
        d.text((x - d.textlength(spaced, font=kick_font) / 2, kick_y - int(10 * kh)),
               spaced, font=kick_font, fill=(120, 230, 255))
    y = kick_y + int(66 * kh)
    off = max(2, int(3 * kw))
    for ln in lines:
        lw = d.textlength(ln, font=head_font)
        d.text((x - lw / 2 + off, y + off), ln, font=head_font, fill=(0, 0, 0))
        d.text((x - lw / 2, y), ln, font=head_font, fill=(255, 255, 255))
        y += line_h

    im.save(os.path.join(OUT, dst))
    report.append({'file': dst, 'size': [W, H], 'pt': size, 'widest': int(widest), 'max': max_w})

print(json.dumps(report))
`;

const jobs = [];
const skipped = [];
for (const set of SETS) {
  set.srcs.forEach((src, i) => {
    const [kicker, head] = CAPTIONS[i];
    // Look in work/shots first, then work/play — the Play frames land there.
    const cand = [path.join(IN, src + '.png'), path.join(ROOT, 'work', 'play', src + '.png')];
    const found = cand.find((c) => fs.existsSync(c));
    if (!found) { skipped.push(set.out + '-' + (i + 1)); return; }
    jobs.push([found, `${set.out}-${i + 1}.png`, kicker, head]);
  });
}
if (skipped.length) {
  console.log(`${skipped.length} not captured yet, skipping: ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? ' …' : ''}
`);
}
if (!jobs.length) { console.error('nothing to caption'); process.exit(1); }

const report = JSON.parse(
  execFileSync('python', ['-c', py, IN, OUT, JSON.stringify(jobs)], { encoding: 'utf8' })
);

let over = 0;
for (const r of report) {
  if (r.widest > r.max) over++;
  console.log(
    `${r.file.padEnd(22)} ${r.size[0]}x${r.size[1]}  ${String(r.pt).padStart(3)}pt  ` +
      `${r.widest}/${r.max}${r.widest > r.max ? '  OVERFLOW' : ''}`
  );
}
console.log(`\n${report.length} captioned into ${path.relative(ROOT, OUT)}`);
if (over) {
  console.error(`${over} caption(s) overflow the margin.`);
  process.exit(1);
}
