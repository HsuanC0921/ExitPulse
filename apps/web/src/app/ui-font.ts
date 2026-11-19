const FAMILY = '"Noto Sans TC Variable"';
const SAMPLE = '站圖'; // Both glyphs are in the preloaded Traditional Chinese subset.

/** Some WebKit builds load the face but render every weight identically. */
export async function checkUiFontWeights() {
  const weights = [400, 900];
  const faces = await Promise.allSettled(weights.map(weight => document.fonts.load(`${weight} 24px ${FAMILY}`, SAMPLE)));
  if (!faces.every(face => face.status === 'fulfilled' && face.value.length)) return;

  const canvas = document.createElement('canvas');
  canvas.width = 52;
  canvas.height = 32;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;

  const coverage = (weight: number) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `${weight} 24px ${FAMILY}`;
    context.fillText(SAMPLE, 1, 25);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let alpha = 0;
    for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
    return alpha;
  };

  const regular = coverage(400);
  const bold = coverage(900);
  if (regular > 0 && regular === bold) document.documentElement.setAttribute('data-ui-font', 'system');
}
