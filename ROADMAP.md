# ShadowChat Roadmap

Dokumen ini merangkum rencana pengembangan ShadowChat (bot anonymous chat + premium + moderasi).

Struktur:

- Fase 1 – Moderasi & Feedback
- Fase 2 – UX & Premium
- Fase 3 – Interest & Mode Chat
- Fase 4 – Admin Tools & Analitik

---

## Fase 1 – Moderasi & Feedback

**Tujuan:** lingkungan chat lebih aman dan terkendali, dengan feedback yang jelas setelah sesi.

### 1.1. Post-chat feedback (like / dislike / report)

**Trigger:** setiap kali sesi berakhir:

- User kirim `/stop`,
- User kirim `/next` (stop + cari baru),
- Partner disconnect/diban.

**Perubahan:**

1. Setelah sesi berakhir, bot kirim ke **kedua user**:

   - Teks:
     - ID: `Sesi chat selesai. Bagaimana pengalamanmu dengan partner ini?`
     - EN: `Chat session ended. How was your experience with your partner?`
   - Inline keyboard:
     - 👍 Suka → `fb:like:<partnerId>`
     - 👎 Tidak suka → `fb:dislike:<partnerId>`
     - 🚩 Report → `fb:report:<partnerId>`

2. Guard:
   - Satu feedback per sesi per user.
   - Tidak kirim feedback kalau user sedang dalam sesi pembayaran manual (payment_session aktif).

### 1.2. Tabel `chat_feedback`

Buat tabel baru:

```sql
create table if not exists chat_feedback (
  id          bigserial primary key,
  user_id     bigint not null,   -- pemberi feedback
  partner_id  bigint not null,   -- yang dinilai
  type        text not null,     -- 'like' | 'dislike' | 'report'
  reason      text,              -- untuk 'report' (abuse/spam/hate/nsfw/other)
  created_at  timestamptz default now()
);
```

### 1.3. Handler feedback

**Like (`fb:like:<partnerId>`)**

- Insert ke `chat_feedback` (`type = 'like'`).
- `adjustUserTrust(partnerId, +1)` (atau +2).
- Pesan: `Terima kasih atas feedbackmu.`

**Dislike (`fb:dislike:<partnerId>`)**

- Insert (`type = 'dislike'`).
- `adjustUserTrust(partnerId, -1)`.
- Pesan: `Feedback kamu sudah dicatat.`

### 1.4. Report dengan reason

**Step 1 – pilih report**

- Callback `fb:report:<partnerId>` kirim pesan:

  ```text
  Apa alasanmu melaporkan partner ini?
  ```

- Inline keyboard reason:

  - `Kasara / kata kasar` → `fb:report_reason:<partnerId>:abuse`
  - `Spam` → `...:spam`
  - `SARA / pelecehan` → `...:hate`
  - `Konten dewasa` → `...:nsfw`
  - `Lainnya` → `...:other`

**Step 2 – proses reason (`fb:report_reason:partnerId:reasonKey`)**

1. Insert ke `chat_feedback`:

   - `type = 'report'`
   - `reason = abuse/spam/hate/nsfw/other`

2. Integrasi dengan sistem report yang sudah ada:

   - Panggil `logReportedMessage` dengan jenis khusus, misalnya:

     - `message_type = 'post_chat'`
     - `text = null`
     - `ocr_text = reasonKey` (untuk catatan admin)

   - `logReportedMessage` akan:

     - Simpan ke `reported_messages`,
     - Kirim log ke grup admin (seperti report biasa, tapi di-tag “after chat”).

3. **Auto-ban:**

   - Tambahkan logika setelah insert report:

     - Hitung jumlah laporan berat terhadap `partnerId` dalam window waktu (misal 24 jam) dari:
       - `chat_feedback` (`type='report'` dan `reason in ('abuse','hate','nsfw')`),
       - dan/atau `reported_messages`.
     - Jika melebihi threshold:
       - `banUser(partnerId, 'auto-ban: too many reports after chat')`
       - `adjustUserTrust(partnerId, -10)`

4. Notifikasi admin:

   - Kirim ke grup admin:

     ```text
     Report after chat:
     • Reporter: <reporter_id>
     • Reported: <partner_id>
     • Reason: abuse/spam/hate/nsfw/other
     ```

   - Inline tombol:
     - `Ban user`,
     - `User status` (memicu `/user <id>`).

### 1.5. Rate limit & abuse protection

- Batasi feedback/report:
  - Maks 1 feedback per sesi per user.
  - Maks X feedback/report per hari (misal 10).
- Jika user sering report asal-asalan (feedback report tapi trust partner tinggi, tidak ada indikasi lain), bisa turunkan trust si pelapor sedikit sebagai balancing (opsional).

---

## Fase 2 – UX & Premium

**Tujuan:** pengalaman user lebih halus, terutama untuk premium & navigasi perintah.

### 2.1. Upgrade `/premium` dan `/stats`

**/premium**

- Tampilkan:

  - Status premium (aktif / tidak),
  - Expiry (tanggal & jam),
  - Kode unik aktif (jika masih ada pending),
  - Info diskon aktif (jika ada).

- Penanganan kode:

  - `getPendingPaymentCode` → jika ada, jelaskan bahwa user **harus memakai kode itu** sampai transaksi selesai.
  - Hanya generate kode baru jika:
    - Tidak ada kode pending,
    - Atau admin reset / expired.

**/stats**

- Tambah level/badge berdasarkan `total_chats` dan `user_trust`:

  - Contoh:
    - Level 1–3: “Newbie”, “Chatter”, “Social”.
    - Badge tambahan: “Premium”, “Trusted”, dll.

### 2.2. Reply keyboard sederhana

- Saat user **tidak** dalam chat:

  - Keyboard:

    - `/search`
    - `/premium`
    - `/stats`

- Saat user **dalam** chat:

  - Keyboard:

    - `/next`
    - `/stop`
    - `/report`
    - `/showid`

Implementasi:

- Gunakan `reply_markup: { keyboard: ... , resize_keyboard: true }` pada pesan kunci (misalnya di `/start`, `/search`, `/stop`).

### 2.3. Perapihan tampilan pembayaran

- `/payhistory`:

  - Format 1 baris per transaksi:

    - `2025-12-18 10:00  | trakteer | Rp 10.000 | 10 hari | approved`

- Log admin:

  - Ringkas, fokus pada:
    - User ID,
    - Nominal + method,
    - Kode,
    - Hari premium.

---

## Fase 3 – Interest & Mode Chat

**Tujuan:** matching lebih relevan dengan minat user.

### 3.1. Interest / minat

- Command `/setinterest`:

  - User bisa pilih beberapa interest dari list:
    - `game`, `anime`, `musik`, `curhat`, `serius`, dll.
  - Disimpan di tabel baru atau di `user_profile`:

    ```sql
    create table if not exists user_interests (
      user_id  bigint not null,
      interest text not null,
      primary key (user_id, interest)
    );
    ```

- Matching:

  - Saat cari partner, jika ada beberapa calon di queue:
    - Pilih yang punya **overlap interest** paling banyak.
  - Tidak wajib filter (biar queue tidak macet), hanya prioritas.

### 3.2. Mode chat

- Mode yang bisa dipilih user:

  - `random` (default),
  - `curhat`,
  - `serius`.

- Premium bisa set target mode partner (opsional).
- Matching mencoba:
  - Untuk premium: cari partner dengan mode yang sama dulu.
  - Kalau tidak ada, fallback ke random.

---

## Fase 4 – Admin Tools & Analitik

**Tujuan:** memudahkan pengelolaan tanpa harus masuk dashboard Supabase.

### 4.1. Adminpanel via bot

- `/adminpanel` → kirim inline keyboard:

  - `Stats` → jalankan `/adminstats`.
  - `Payments` → list 10 transaksi terakhir.
  - `Reports` → list 10 report terakhir.

### 4.2. Payment analytics

- `/paystats`:

  - Ringkasan:
    - Total nominal manual,
    - Total nominal Trakteer,
    - Jumlah user premium,
    - Periode (today/7d/30d).

### 4.3. Export sederhana

- Command untuk kirim CSV `payments` ke admin (opsional, jika dibutuhkan).

---

## Prioritas Implementasi

Urutan pengerjaan yang disarankan:

1. **Fase 1 – Moderasi & Feedback**
   - Tabel `chat_feedback`.
   - Inline feedback (👍/👎/🚩) setelah sesi.
   - Integrasi `report` + auto-ban + log admin.
   - Rate limit feedback/report.

2. **Fase 2 – UX & Premium**
   - Upgrade `/premium` & `/stats`.
   - Reply keyboard.

3. **Fase 3 – Interest & Mode Chat**
   - `user_interests` + `/setinterest`.
   - Matching prioritas interest & mode.

4. **Fase 4 – Admin Tools & Analitik**
   - `/adminpanel`, `/paystats`, export.

Dokumen ini jadi panduan supaya setiap perubahan di kode bisa mengacu pada fase yang jelas dan bisa dilacak progresnya.