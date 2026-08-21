import { writeFileSync } from "node:fs";
import sharp from "sharp";

const CARD_WIDTH = 400;
const CARD_HEIGHT = 520;

const svg = `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff"/>
<rect x="6" y="6" width="${CARD_WIDTH - 12}" height="${CARD_HEIGHT - 12}" rx="4" fill="#ffffff" stroke="#000000" stroke-width="3"/>
<rect x="6" y="6" width="${CARD_WIDTH - 12}" height="58" fill="#000000"/>
<text x="${CARD_WIDTH / 2}" y="45" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="24" fill="#ffffff" letter-spacing="1">MISSING RECEIPT</text>
<text x="${CARD_WIDTH / 2}" y="300" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="54" fill="none" stroke="#000000" stroke-width="3" letter-spacing="4" transform="rotate(-14 ${CARD_WIDTH / 2} 300)">MISSING</text>
<line x1="30" y1="370" x2="${CARD_WIDTH - 30}" y2="370" stroke="#000000" stroke-width="1" stroke-dasharray="6,6"/>
<text x="${CARD_WIDTH / 2}" y="405" text-anchor="middle" font-family="monospace" font-size="17" fill="#444444">No receipt on file.</text>
<text x="${CARD_WIDTH / 2}" y="428" text-anchor="middle" font-family="monospace" font-size="17" fill="#444444">See expense notes below.</text>
<polyline points="30,480 60,496 90,480 120,496 150,480 180,496 210,480 240,496 270,480 300,496 330,480 ${CARD_WIDTH - 30},480" fill="none" stroke="#000000" stroke-width="1"/>
</svg>`;

sharp(Buffer.from(svg))
  .png()
  .toBuffer()
  .then((buf) => {
    writeFileSync("public/expense-report/missing-receipt.png", buf);
    console.log("wrote", buf.byteLength, "bytes");
  });
