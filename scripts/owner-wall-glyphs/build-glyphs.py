"""Build the normalized wall glyph outlines from Open Sans Bold and Liberation Serif Bold."""
import base64
import json
import math
import sys
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont


class OutlinePen(BasePen):
    def __init__(self, glyphs, units_per_em):
        super().__init__(glyphs)
        self.scale = 1000 / units_per_em
        self.contours = []
        self.points = []

    def add(self, point):
        x, y = point
        coordinate = (round(x * self.scale), round(-y * self.scale))
        if not self.points or coordinate != self.points[-1]:
            self.points.append(coordinate)

    def _moveTo(self, point):
        self.points = []
        self.add(point)

    def _lineTo(self, point):
        self.add(point)

    def curve(self, *points):
        length = sum(math.dist(a, b) for a, b in zip(points, points[1:]))
        steps = max(2, math.ceil(length * self.scale / 24))
        for step in range(1, steps + 1):
            position = step / steps
            intermediate = points
            while len(intermediate) > 1:
                intermediate = [
                    tuple(a + (b - a) * position for a, b in zip(start, end))
                    for start, end in zip(intermediate, intermediate[1:])
                ]
            self.add(intermediate[0])

    def _qCurveToOne(self, control, end):
        self.curve(self._getCurrentPoint(), control, end)

    def _curveToOne(self, first, second, end):
        self.curve(self._getCurrentPoint(), first, second, end)

    def _closePath(self):
        if len(self.points) > 2:
            if self.points[0] == self.points[-1]:
                self.points.pop()
            self.contours.append([coordinate for point in self.points for coordinate in point])

    _endPath = _closePath


def atlas(path):
    font = TTFont(path)
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    units_per_em = font["head"].unitsPerEm
    characters = list(range(32, 127)) + list(range(160, 256))
    characters += [0x152, 0x153, 0x178, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC, 0x20B1, 0x2212]
    result = {}
    for code in characters:
        name = cmap.get(code)
        if not name:
            continue
        pen = OutlinePen(glyphs, units_per_em)
        glyphs[name].draw(pen)
        result[chr(code)] = [round(glyphs[name].width * pen.scale), pen.contours]
    return result


def encode(glyphs):
    data = bytearray()

    def write(number):
        while number >= 128:
            data.append((number & 127) | 128)
            number >>= 7
        data.append(number)

    for letter, (advance, contours) in glyphs.items():
        write(ord(letter))
        write(advance)
        write(len(contours))
        for contour in contours:
            write(len(contour))
            previous = [0, 0]
            for i, coordinate in enumerate(contour):
                axis = i % 2
                delta = coordinate - previous[axis]
                previous[axis] = coordinate
                write(delta * 2 if delta >= 0 else -delta * 2 - 1)
    return base64.b64encode(data).decode()


out = Path(sys.argv[3])
data = {"sans": encode(atlas(sys.argv[1])), "serif": encode(atlas(sys.argv[2]))}
out.write_text("// Generated glyph outlines. See build-glyphs.py and font-licenses.txt.\nexport default "
               + json.dumps(data, separators=(",", ":")) + ";\n")
