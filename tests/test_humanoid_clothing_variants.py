"""Regression checks for Humanoid Lite clothing slots and texture assets."""
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1] / "characters" / "humanoid"
CATALOG = json.loads((ROOT / "source" / "clothing.json").read_text())
VARIANTS = json.loads((ROOT / "source" / "clothing-variants.json").read_text())
ITEMS = {item["id"]: item for item in CATALOG["items"]}


class TestClothingVariants(unittest.TestCase):
    def test_hoodie_is_exclusive_outerwear(self):
        self.assertEqual(ITEMS["hoodie"]["slot"], "outerwear")
        self.assertEqual(ITEMS["hoodie"]["occupies"], ["outerwear"])
        for item_id in ("jacket", "trenchcoat"):
            self.assertEqual(ITEMS[item_id]["slot"], "outerwear")
        self.assertEqual(ITEMS["shirt"]["slot"], "top")
        self.assertEqual(ITEMS["tshirt"]["slot"], "top")

    def test_variant_catalog_and_png_files(self):
        variant_count = 0
        for item_id, choices in VARIANTS["items"].items():
            with self.subTest(item=item_id):
                self.assertIn(item_id, ITEMS)
                self.assertTrue(choices)
                self.assertEqual(choices[0]["id"], "default")
                self.assertTrue(choices[0].get("original"))
                names = [choice["id"] for choice in choices]
                self.assertEqual(len(names), len(set(names)))
                for choice in choices[1:]:
                    variant_count += 1
                    self.assertTrue(choice.get("label"))
                    self.assertTrue(choice.get("color", "").startswith("#"))
                    filename = ROOT / "textures" / "clothing" / item_id / (choice["id"] + ".png")
                    with self.subTest(png=str(filename.relative_to(ROOT))):
                        self.assertTrue(filename.is_file())
                        data = filename.read_bytes()
                        self.assertEqual(data[:8], bytes.fromhex('89504e470d0a1a0a'))
                        self.assertEqual(data[12:16], b"IHDR")
                        w, h = struct.unpack(">II", data[16:24])
                        self.assertEqual((w, h), (512, 512))
        self.assertEqual(variant_count, 49)


if __name__ == "__main__":
    unittest.main()
