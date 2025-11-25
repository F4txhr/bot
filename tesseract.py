import argparse
import io
import re
import time
from datetime import datetime

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


def extract_amount_candidates(ocr_text: str) -> list[int]:
    """Mengambil semua nominal yang diawali 'RP' dari teks OCR (per baris)."""
    candidates: set[int] = set()
    lines = ocr_text.splitlines()
    for line in lines:
        line_upper = line.upper()
        for match in re.findall(r"RP\s*([0-9][0-9\.\,]*)", line_upper):
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


def parse_transaction_datetime(ocr_upper: str) -> datetime | None:
    """Mencoba membaca tanggal & waktu transaksi dari teks OCR."""
    month_map = {
        "JAN": 1,
        "JANUARI": 1,
        "FEB": 2,
        "FEBRUARI": 2,
        "MAR": 3,
        "MARET": 3,
        "APR": 4,
        "APRIL": 4,
        "MEI": 5,
        "JUN": 6,
        "JUNI": 6,
        "JUL": 7,
        "JULI": 7,
        "AGU": 8,
        "AGUSTUS": 8,
        "SEP": 9,
        "SEPT": 9,
        "SEPTEMBER": 9,
        "OKT": 10,
        "OKTOBER": 10,
        "NOV": 11,
        "NOVEMBER": 11,
        "DES": 12,
        "DESEMBER": 12,
    }
    date_regex = (
        r"(\d{1,2})\s+("
        r"JAN|JANUARI|FEB|FEBRUARI|MAR|MARET|APR|APRIL|MEI|"
        r"JUN|JUNI|JUL|JULI|AGU|AGUSTUS|SEP|SEPT|SEPTEMBER|"
        r"OKT|OKTOBER|NOV|NOVEMBER|DES|DESEMBER"
        r")\s+(\d{4})"
    )
    date_match = re.search(date_regex, ocr_upper)
    time_match = re.search(r"(\d{1,2}):(\d{2})", ocr_upper)

    if not date_match:
        return None

    day_str, mon_str, year_str = date_match.groups()
    try:
        day = int(day_str)
        year = int(year_str)
        month = month_map.get(mon_str, None)
        if month is None:
            return None

        hour = 12
        minute = 0
        if time_match:
            hour = int(time_match.group(1))
            minute = int(time_match.group(2))

        return datetime(year, month, day, hour, minute)
    except Exception:
        return None


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
    amount_candidates = extract_amount_candidates(ocr_text_str)

    # Cari kode pembayaran otomatis
    detected_codes = find_payment_codes(ocr_upper)

    # Cek kode dan nominal yang diharapkan (jika diberikan)
    code_found = None
    if args.code:
        code_found = args.code.upper() in ocr_upper

    amount_found = None
    if args.amount is not None:
        amount_found = args.amount in amount_candidates

    # Coba baca tanggal & waktu transaksi
    tx_dt = parse_transaction_datetime(ocr_upper)
    tx_info = "-"
    time_diff_info = "-"
    if tx_dt is not None:
        tx_info = tx_dt.strftime("%Y-%m-%d %H:%M")
        diff_hours = abs(time.time() - tx_dt.timestamp()) / 3600.0
        time_diff_info = f"{diff_hours:.1f} jam dari sekarang"

    print("=== HASIL OCR MANUAL (tesseract.py) ===")
    print(f"Gambar               : {args.image}")
    print(f"E-wallet terdeteksi  : {wallet}")
    print(f"Tanggal/waktu terbaca: {tx_info} (selisih {time_diff_info})")
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