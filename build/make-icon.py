"""Builds the EasyTuber icons from the logo.

    python build/make-icon.py

Reads build/logo-source.jpg (the full logo), crops the play-button mark on its left, and writes
  build/icon.png   256 px, the window / tray icon
  build/icon.ico   Windows (256, 64, 48, 32, 16)
  build/icon.icns  macOS (512, 256, 128)
  build/logo.jpg   the full logo at 900 px wide, for the top bar
Needs ffmpeg on PATH; no Python packages.
"""
import os
import struct
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "logo-source.jpg")
CROP = "crop=640:640:35:28"  # the mark, in the 2080x696 source


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        png = {}
        for s in (512, 256, 128, 64, 48, 32, 16):
            out = os.path.join(tmp, f"{s}.png")
            ffmpeg("-i", SRC, "-vf", f"{CROP},scale={s}:{s}:flags=lanczos", "-pix_fmt", "rgba", out)
            png[s] = open(out, "rb").read()

    open(os.path.join(HERE, "icon.png"), "wb").write(png[256])

    sizes = [256, 64, 48, 32, 16]
    entries, blobs, offset = b"", b"", 6 + 16 * len(sizes)
    for s in sizes:
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(png[s]), offset + len(blobs))
        blobs += png[s]
    open(os.path.join(HERE, "icon.ico"), "wb").write(struct.pack("<HHH", 0, 1, len(sizes)) + entries + blobs)

    body = b""
    for kind, s in ((b"ic07", 128), (b"ic08", 256), (b"ic09", 512)):
        body += kind + struct.pack(">I", 8 + len(png[s])) + png[s]
    open(os.path.join(HERE, "icon.icns"), "wb").write(b"icns" + struct.pack(">I", 8 + len(body)) + body)

    ffmpeg("-i", SRC, "-vf", "scale=900:-1:flags=lanczos", "-q:v", "3", os.path.join(HERE, "logo.jpg"))
    print("wrote icon.png, icon.ico, icon.icns and logo.jpg")


if __name__ == "__main__":
    main()
