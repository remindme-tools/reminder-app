import sharp from "sharp";
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#0f172a"/>
<g transform="translate(256 256) scale(${pad}) translate(-256 -256)">
<path d="M256 96c-62 0-104 46-104 108v62l-34 52v14h276v-14l-34-52v-62c0-62-42-108-104-108z" fill="#38bdf8"/>
<circle cx="256" cy="396" r="30" fill="#38bdf8"/>
<circle cx="340" cy="150" r="46" fill="#f97316"/>
</g></svg>`;
const out = (name, size, pad) => sharp(Buffer.from(svg(pad))).resize(size, size).png().toFile(`public/${name}`);
await out("icon-512.png", 512, 1);
await out("icon-192.png", 192, 1);
await out("icon-512-maskable.png", 512, 0.72);
await out("apple-touch-icon.png", 180, 0.9);
console.log("icons done");
