import base64
from io import BytesIO
from pathlib import Path
import struct
import tempfile
from types import SimpleNamespace

from django.core.files import File
from django.test import SimpleTestCase
from PIL import Image

from .services import OpenAIProvider


class VisionImageEncodingTests(SimpleTestCase):
    def encode(self, content):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "knee.png"
            path.write_bytes(content)
            with path.open("rb") as source:
                result = OpenAIProvider._image_content(SimpleNamespace(image=File(source, name=path.name)))
            self.assertEqual(path.read_bytes(), content, "The original radiograph must remain unchanged.")
        header, encoded = result["image_url"]["url"].split(",", 1)
        self.assertEqual(header, "data:image/png;base64")
        self.assertEqual(result["image_url"]["detail"], "high")
        return base64.b64decode(encoded)

    def test_16_bit_grayscale_scales_to_8_bit_without_clipping_or_reorientation(self):
        source = Image.frombytes("I;16", (4, 1), struct.pack("<4H", 0, 16384, 32768, 65535))
        buffer = BytesIO()
        source.save(buffer, format="PNG")
        encoded = self.encode(buffer.getvalue())
        self.assertEqual(encoded[24], 8)
        with Image.open(BytesIO(encoded)) as prepared:
            self.assertEqual(prepared.mode, "L")
            self.assertEqual(prepared.size, (4, 1))
            for actual, expected in zip(prepared.getdata(), (0, 64, 128, 255)):
                self.assertLessEqual(abs(actual - expected), 1)

    def test_8_bit_rgb_image_is_sent_byte_for_byte(self):
        buffer = BytesIO()
        Image.new("RGB", (3, 2), (25, 100, 200)).save(buffer, format="PNG")
        self.assertEqual(self.encode(buffer.getvalue()), buffer.getvalue())
