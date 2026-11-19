import atlas from './eden-wall-glyphs.js';

function decodeAtlas(encoded) {
  const bytes = atob(encoded);
  const glyphs = new Map();
  let index = 0;
  function read() {
    let value = 0, shift = 0, byte;
    do {
      byte = bytes.charCodeAt(index++);
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value;
  }
  while (index < bytes.length) {
    const letter = String.fromCodePoint(read());
    const advance = read();
    const contours = Array.from({length: read()}, () => {
      const position = [0, 0];
      return Array.from({length: read()}, (_, i) => {
        const delta = read();
        return position[i % 2] += delta % 2 ? -(delta + 1) / 2 : delta / 2;
      });
    });
    const area = contour => contour.reduce((sum, x, i) => {
      if (i % 2) return sum;
      const next = (i + 2) % contour.length;
      return sum + x * contour[next + 1] - contour[next] * contour[i + 1];
    }, 0);
    const winding = Math.sign(contours.map(area).reduce((largest, item) => Math.abs(item) > Math.abs(largest) ? item : largest, 0));
    glyphs.set(letter, {advance, contours, winding});
  }
  return glyphs;
}

const faces = {sans: decodeAtlas(atlas.sans), serif: decodeAtlas(atlas.serif)};
const surfaces = {
  pearl: {
    font: 'sans', caps: true, center: true, x: 55, y: 105, width: 480, size: 108,
    shear: .061, vanish: .00031, depth: 11, edgeX: -.64, edgeY: -.26,
    face: ['#355074','#203955','#192b49'], edges: ['#10192d','#182b46','#244067','#385573'],
    glint: '#7c98b2', shadow: '#382d24', shadowX: 6, shadowY: 9
  },
  lumi: {
    font: 'serif', x: 192, y: 18, width: 470, size: 74,
    shear: .008, vanish: .00003, depth: 9, edgeX: -.42, edgeY: -.36,
    face: ['#fbdd95','#c18c40','#edc878','#a46927'], edges: ['#563516','#795226','#ad7939','#efc46d'],
    glint: '#fff0b6', shadow: '#3c291a', shadowX: 5, shadowY: 8
  },
  siam: {
    font: 'serif', x: 71, y: 84, width: 525, size: 89,
    shear: -.015, vanish: -.00007, depth: 9, edgeX: .45, edgeY: -.33,
    face: ['#f5d389','#c29443','#e4b864','#a87b32'], edges: ['#3b2410','#62401a','#a47735','#ca9d50'],
    glint: '#ffe2a1', shadow: '#110904', shadowX: -4, shadowY: 7
  },
  pattaya: {
    font: 'sans', caps: true, center: true, x: 500, y: 57, width: 524, size: 87,
    shear: .005, vanish: .00004, depth: 8, edgeX: -.28, edgeY: -.43,
    face: ['#378f9a','#207785','#125d69'], edges: ['#163d46','#1a5360','#236f7b','#468d92'],
    glint: '#93c7ca', shadow: '#25464a', shadowX: 4, shadowY: 7
  },
  mabuhay: {
    font: 'sans', caps: true, center: true, x: 122, y: 38, width: 682, size: 81,
    shear: -.012, vanish: -.00006, depth: 9, edgeX: .35, edgeY: -.34,
    face: ['#4b6b83','#24465f','#173347'], edges: ['#102537','#17354e','#294a62','#49738a'],
    glint: '#93b5c5', shadow: '#3a3831', shadowX: -3, shadowY: 7
  }
};

const spacing = 24;
const pairs = new Map([['AV', -84], ['VA', -72], ['WA', -63], ['AT', -52], ['TA', -60], ['TO', -38], ['LT', -60], ['PA', -45], ['Yo', -70], ['To', -60]]);
const round = value => Math.round(value * 10) / 10;
const path = points => 'M' + points.map(([x, y]) => round(x) + ',' + round(y)).join('L') + 'Z';
const length = row => row.at(-1).x + row.at(-1).glyph.advance;

function layoutLine(text, glyphs) {
  let x = 0, previous = '';
  return Array.from(text, letter => {
    const glyph = glyphs.get(letter);
    x += pairs.get(previous + letter) || 0;
    const point = {glyph, x};
    x += glyph.advance + spacing;
    previous = letter;
    return point;
  });
}

function layoutText(text, glyphs, surface) {
  const lines = text.split('\n');
  if (lines.length === 1) {
    const words = text.split(' ');
    const width = line => length(layoutLine(line, glyphs));
    if (words.length > 1 && width(text) * surface.size / 1000 > surface.width * 1.07) {
      let best = Infinity;
      for (let index = 1; index < words.length; index++) {
        const left = words.slice(0,index).join(' '), right = words.slice(index).join(' ');
        const widest = Math.max(width(left),width(right));
        if (widest < best) {
          best = widest;
          lines.splice(0, lines.length, left, right);
        }
      }
    }
  }
  const rows = lines.map(line => layoutLine(line, glyphs));
  const scale = Math.min(surface.size / 1000, surface.width / Math.max(...rows.map(length)));
  return {rows, scale};
}

export function renderMountedWall(value, theme) {
  const surface = Object.hasOwn(surfaces, theme) ? surfaces[theme] : surfaces.pearl;
  const normalized = value.normalize('NFC').split('\n').map(line => line.trim().replace(/\s+/g,' ')).filter(Boolean).join('\n');
  const text = surface.caps ? normalized.toUpperCase() : normalized;
  const glyphs = faces[surface.font];
  if (!text || text.length > 140 || [...text].some(letter => letter !== '\n' && !glyphs.has(letter))) return '';
  const {rows, scale} = layoutText(text, glyphs, surface);
  const project = (x, y, z) => {
    const perspective = 1 + x * surface.vanish + y * .000035;
    return [surface.x + (x + z * surface.edgeX) / perspective,
      surface.y + (y + x * surface.shear + z * surface.edgeY) / perspective];
  };
  const shadow = [], fronts = [], highlights = [];
  const sides = surface.edges.map(() => []);
  rows.forEach((row, index) => {
    const rowX = surface.center ? (surface.width - length(row) * scale) / 2 : 0;
    const baseline = (790 + index * 1010) * scale;
    const depth = Math.min(surface.depth, scale * 147);
    const face = [];
    const back = [];
    for (const {glyph, x} of row) {
      for (const contour of glyph.contours) {
        const wall = [], front = [];
        for (let i = 0; i < contour.length; i += 2) {
          const px = rowX + (x + contour[i]) * scale, py = baseline + contour[i + 1] * scale;
          wall.push(project(px, py, 0));
          front.push(project(px, py, depth));
        }
        back.push(path(wall));
        face.push(path(front));
        for (let i = 0; i < front.length; i++) {
          const next = (i + 1) % front.length;
          const [ax, ay] = front[i], [bx, by] = front[next];
          const dx = bx - ax, dy = by - ay, distance = Math.hypot(dx, dy);
          if (distance < .05) continue;
          const nx = glyph.winding * dy / distance, ny = -glyph.winding * dx / distance;
          const lit = -.46 * nx - .89 * ny;
          if (nx * surface.edgeX + ny * surface.edgeY < -.035) {
            const shade = Math.max(0, Math.min(sides.length - 1, Math.round((lit + 1) * 1.5)));
            sides[shade].push(path([front[i],front[next],wall[next],wall[i]]));
          }
          if (lit > .47) highlights.push('M'+round(ax)+','+round(ay)+'L'+round(bx)+','+round(by));
        }
      }
    }
    shadow.push(...back);
    fronts.push('<path d="'+face.join('')+'" fill="url(#wall-face-'+index+')"/>');
  });

  const colors = surface.face.map((color, index, stops) =>
    '<stop offset="'+index / (stops.length - 1)+'" stop-color="'+color+'"/>').join('');
  const gradients = rows.map((_, index) =>
    '<linearGradient id="wall-face-'+index+'" x1="0%" y1="0%" x2="12%" y2="100%">'+colors+'</linearGradient>').join('');
  const cast = shadow.join('');
  const edges = sides.map((shade, index) => '<path fill="'+surface.edges[index]+'" d="'+shade.join('')+'"/>').join('');
  return '<svg class="mounted-wall" viewBox="0 0 1672 941" aria-hidden="true" focusable="false"><defs>'+gradients+
    '<filter id="wall-shadow" x="-20%" y="-35%" width="155%" height="180%"><feGaussianBlur stdDeviation="3.4"/></filter>'+
    '<filter id="wall-contact" x="-12%" y="-20%" width="130%" height="145%"><feGaussianBlur stdDeviation="1.05"/></filter>'+
    '</defs><path d="'+cast+'" fill="'+surface.shadow+'" opacity=".46" filter="url(#wall-shadow)" transform="translate('+surface.shadowX+' '+surface.shadowY+')"/>'+
    '<path d="'+cast+'" fill="'+surface.shadow+'" opacity=".55" filter="url(#wall-contact)" transform="translate('+surface.shadowX*.35+' '+surface.shadowY*.4+')"/>'+
    edges+'<g stroke="'+surface.edges[1]+'" stroke-width=".65" stroke-linejoin="round">'+fronts.join('')+'</g>'+
    '<path d="'+highlights.join('')+'" fill="none" stroke="'+surface.glint+'" stroke-opacity=".58" stroke-width=".8" stroke-linecap="round"/></svg>';
}
