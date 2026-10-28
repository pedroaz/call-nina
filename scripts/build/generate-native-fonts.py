"""Generate native weight-specific faces from the shared variable fonts.

Requires fonttools. Run explicitly when updating the bundled font sources;
ordinary builds consume the committed TTF assets and require no Python tools.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

fonts = Path(__file__).resolve().parents[2] / "packages/design-system/assets/fonts"
for family in ("SourceSans3", "SourceSerif4"):
    for weight in (400, 600, 700):
        font = TTFont(fonts / f"{family}-variable.ttf")
        axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
        axes["wght"] = weight
        static = instantiateVariableFont(font, axes, inplace=False)
        static.save(fonts / f"{family}-{weight}.ttf")
