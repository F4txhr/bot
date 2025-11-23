import argparse
import io
import re

from PIL import Image
import pytesseract


def detect_wallet(ocr_upper: str) -> str:
    """Mendeteksi e-wallet dari teks OCR."""
    if "DANA" in ocr_upper:
        return "DANA"
    if "GOPAY" in ocr_upper or "GO-PAY" in ocr_upper or "GOJEK" in ocr_upper:
        return "GOPAY"
    if "OVO" in ocr_upper:
        return "OVO"
    return "UNKNOWN"


def extract_amount_candidates(ocr_upper: str) -> list[int]:
    """Mengambil semua nominal yang diawali 'RP' dari teks OCR.

    Catatan: gunakan pola "RP\s*" (BUKAN "RP\\s*") supaya \s dikenali
    sebagai whitespace oleh regex, bukan karakter backslash + 's'.
    """
    candidates: set[int] = set()
    for match in re.findall(r"RP\s*([0-9][0-9\.\,]*)", ocr_upper):
        cleaned = re.sub(r"[^0-9]", "", match)
        if cleaned:
            try:
                candidates.add(int(cleaned))
            except ValueError:
                continue
    return sorted(candidates)


def find_payment_codes(ocr_upper: str) -> list[str]:
    """Mencari pola kode pembayaran seperti PAY-XXXX di teks OCR."""
    codes = set(re.findall(r"PAY-[A-Z0-9]{4,12}", ocr_upper))
    return sorted(codes)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Tes manual OCR pembayaran dengan pytesseract."
    )
    parser.add_argument(
        "image",
        help="Path ke file gambar (screenshot pembayaran).",
    )
    parser.add_argument(
        "--code",
        help="Kode pembayaran yang diharapkan (misalnya PAY-ABCD1234).",
    )
    parser.add_argument(
        "--amount",
        type=int,
        help="Nominal yang diharapkan dalam rupiah (misalnya 3000).",
    )
    parser.add_argument(
        "--lang",
        default="ind+eng",
        help='Bahasa OCR, default "ind+eng".',
    )

    args = parser.parse_args()

    # Baca gambar
    with open(args.image, "rb") as f:
        image_bytes = f.read()
    image = Image.open(io.BytesIO(image_bytes))

    # Jalankan OCR
    ocr_text = pytesseract.image_to_string(image, lang=args.lang)
    ocr_text_str = ocr_text if isinstance(ocr_text, str) else ""
    ocr_upper = ocr_text_str.upper()

    # Deteksi e-wallet
    wallet = detect_wallet(ocr_upper)

    # Ambil kandidat nominal
    amount_candidates = extract_amount_candidates(ocr_upper)

    # Cari kode pembayaran otomatis
    detected_codes = find_payment_codes(ocr_upper)

    # Cek kode dan nominal yang diharapkan (jika diberikan)
    code_found = None
    if args.code:
        code_found = args.code.upper() in ocr_upper

    amount_found = None
    if args.amount is not None:
        amount_found = args.amount in amount_candidates

    print("=== HASIL OCR MANUAL (tesseract.py) ===")
    print(f"Gambar           : {args.image}")
    print(f"E-wallet terdeteksi : {wallet}")
    print(f"Kode pembayaran terdeteksi (pola PAY-XXXX): {detected_codes or '-'}")
    print(f"Nominal terdeteksi (Rp ...): {amount_candidates or '-'}")

    if args.code:
        print(f"Kode yang diharapkan : {args.code} -> ditemukan: {code_found}")
    if args.amount is not None:
        print(f"Nominal yang diharapkan : Rp {args.amount:,} -> ditemukan: {amount_found}")

    print("\n--- Teks OCR lengkap ---\n")
    print(ocr_text_str)
    print("\n=== SELESAI ===")


if __name__ == "__main__":
    main()