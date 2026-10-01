# YouTube Master CMS v3.0.0

Satu aplikasi web: login YouTube, pilih satu live aktif, masukkan antrean judul, atur interval, dan Start/Stop Loop. Semua pergantian judul berjalan di cloud. Tidak ada agent atau aplikasi baru yang perlu dipasang di RDP.

RDP tetap menjalankan OBS/FFmpeg atau encoder yang sudah dipakai untuk mengirim video. Menutup CMS tidak menghentikan antrean. Stop Loop menghentikan pergantian judul; siaran YouTube tetap berjalan. Versi ini tidak mematikan lalu menyalakan encoder atau membuat siaran baru.

## Alur penggunaan

1. Buka CMS dan masukkan password.
2. Klik **Hubungkan YouTube**, pilih akun/channel, dan berikan izin.
3. Mulai siaran dari RDP seperti biasa, lalu klik **Refresh live** di CMS.
4. Pilih live, isi satu judul per baris, tentukan interval minimal 10 menit, lalu **Simpan antrean**.
5. Klik **Start Loop**. Judul A langsung dipasang, lalu B, C, A, dan seterusnya.
6. Klik **Stop Loop** untuk berhenti. Start berikutnya melanjutkan ke judul berikutnya. **Reset antrean** menghapus konfigurasi dan memulai posisi dari awal setelah disimpan lagi.

Jika Stop ditekan ketika permintaan penggantian judul sudah dikirim ke YouTube, permintaan tersebut bisa selesai. Mesin tidak menjadwalkan pergantian berikutnya. Jika koneksi terputus, target judul disimpan dan dipulihkan sebelum antrean dilanjutkan.

## Setup sekali di cloud

Paket ini adalah source project siap diimpor, belum dipasang ke akun Vercel atau disambungkan ke channel pengguna. Satu CMS menggunakan Vercel untuk web dan Workflow, serta Supabase untuk konfigurasi dan token terenkripsi. Supabase adalah database di belakang CMS; tidak ada aplikasi Supabase yang perlu diinstal di RDP.

### 1. Database Supabase

Buat project di [Supabase](https://supabase.com/dashboard). Buka SQL Editor dan jalankan **supabase.sql**. Salin Project URL dan secret key backend (`sb_secret_...`, atau legacy service_role). Jangan gunakan anon/publishable key. Tabel v3 terpisah dari tabel v2.

### 2. Google Cloud

Di [Google Cloud Console](https://console.cloud.google.com/):

1. Aktifkan **YouTube Data API v3**.
2. Atur Google Auth Platform / OAuth consent screen. Untuk uji pribadi, tambahkan akun sendiri sebagai test user.
3. Buat OAuth Client ID dengan jenis **Web application**.
4. Authorized redirect URI harus persis: `https://DOMAIN-CMS/api/youtube/callback`.
5. Salin Client ID dan Client Secret ke environment Vercel.

Client Desktop dari paket RDP sebelumnya tidak dipakai untuk versi ini. OAuth aplikasi External yang masih berstatus Testing umumnya memiliki refresh token 7 hari untuk scope YouTube; untuk operasi jangka panjang, selesaikan konfigurasi status Production dan persyaratan Google yang berlaku. Jika akses dicabut atau kedaluwarsa, CMS berhenti dan meminta login ulang.

### 3. Deploy Vercel

Upload isi folder ini ke repository GitHub milik sendiri dan import sebagai project di [Vercel](https://vercel.com/new). Root Directory adalah folder yang berisi package.json; framework Next.js; Node.js 22 atau lebih baru. Tidak perlu konfigurasi Cron Jobs.

Tambahkan 8 variabel berikut ke environment **Production**. Semua merupakan variabel backend; jangan diberi awalan `NEXT_PUBLIC_`.

| Variabel | Isi |
| --- | --- |
| CMS_PUBLIC_URL | Origin HTTPS CMS, misalnya `https://nama-project.vercel.app`, tanpa path |
| CMS_PASSWORD | Password CMS minimal 12 karakter |
| SESSION_SECRET | Secret acak minimal 32 karakter |
| TOKEN_ENCRYPTION_KEY | Kunci acak 64 karakter hexadecimal |
| SUPABASE_URL | Project URL Supabase |
| SUPABASE_SECRET_KEY | Secret key backend Supabase |
| GOOGLE_CLIENT_ID | OAuth client Web application |
| GOOGLE_CLIENT_SECRET | OAuth client secret |

Untuk membuat tiga nilai acak tanpa instalasi, buka **BUAT_SECRET.html** dari folder paket dan klik tombolnya. Alternatif untuk pengembang: `npm run keys`. Simpan kunci enkripsi dengan aman: menggantinya membuat token lama tidak dapat dibaca dan memerlukan penataan ulang koneksi. Credential tidak boleh dimasukkan ke source, commit, dashboard publik, atau percakapan.

Di Vercel **Settings → Environment Variables**, aktifkan **Enable access to System Environment Variables** agar Workflow mendapatkan `VERCEL_DEPLOYMENT_ID`. Aktifkan Fluid Compute. Deploy/redeploy setelah variabel dan redirect URI benar. Biarkan `WORKFLOW_TARGET_WORLD` tidak disetel di Vercel; SDK memilih backend Vercel otomatis.

Gunakan environment/database terpisah untuk Preview jika ingin menjalankan versi uji. Jangan menyambungkan Production dan Preview ke database/channel yang sama: keduanya bisa saling mengambil kepemilikan pekerjaan. Jangan menjalankan loop v2 dan v3 bersamaan untuk video yang sama; Stop dan tutup agent versi lama terlebih dahulu jika sudah pernah digunakan.

## Cara penjadwal bekerja

Vercel Workflow menjalankan satu langkah pergantian judul, menyimpan waktu tunggu, lalu melanjutkan ketika interval tercapai. Tidak ada timer di browser dan tidak ada proses Python di RDP. Run dipecah setelah 64 langkah menjadi pekerjaan lanjutan agar riwayat eksekusi tetap kecil; antrean dan posisi disimpan dalam database yang sama.

Database mengunci kepemilikan pekerjaan dan target judul sebelum melakukan update. Callback duplikat tidak mendapat kepemilikan kedua. Jika jawaban YouTube hilang, mesin mengecek judul yang sama sebelum melakukan update ulang dan sebelum menaikkan posisi. API YouTube tidak memberikan transaksi bersama database; fitur ini memulihkan target, bukan menjanjikan eksekusi tepat satu kali dalam semua kegagalan jaringan.

Penggantian memakai videos.update bagian snippet, dengan description, tags, categoryId, defaultLanguage, dan defaultAudioLanguage yang dapat ditulis dipertahankan. Judul maksimal 100 karakter. Siaran diperiksa aktif dan milik channel terhubung. Aplikasi ini ditujukan untuk satu pemilik CMS dan satu live dalam satu waktu.

Loop berlangsung sampai Stop, live selesai, atau ada kendala akses/kuota/layanan. Error sementara dicoba lagi setelah satu menit. Untuk akses/kuota yang ditolak, perbaiki kendala lalu Start. Jika pekerjaan Workflow gagal, tombol **Periksa / pulihkan loop** dapat melanjutkan antrean. Bila live sudah berakhir, Stop/Reset lalu pilih live aktif yang baru.

Workflow tersedia dengan kuota pada Hobby, namun pemakaian Workflows, Functions, Queues, Supabase, dan API tetap mengikuti batas serta biaya akun. Paket ini tidak menjanjikan gratis tanpa batas atau pergantian pada detik yang persis. Baca [pricing resmi](https://vercel.com/docs/workflows/pricing).

## Pengembangan dan verifikasi

```sh
npm ci
npm test
npm run build
```

Untuk menjalankan lokal dengan akun sendiri, salin `.env.example` ke `.env.local`, isi konfigurasi, gunakan `CMS_PUBLIC_URL=http://localhost:3000` dan redirect URI Google yang sama pada origin tersebut, lalu `npm run dev`. Mode lokal memakai penyimpanan Workflow lokal selama proses Next berjalan; untuk penjadwalan cloud gunakan deploy Vercel.

Pengujian integrasi setelah build: `node tests/runtime.mjs`. Memerlukan OpenSSL, membuat sertifikat pengujian localhost sementara, menjalankan Next + Workflow SDK + PostgreSQL PGlite, dan tidak memakai akun Google atau mengubah YouTube. Lihat VALIDASI.md untuk cakupan hasil.

## Referensi resmi

- [Vercel Workflows](https://vercel.com/docs/workflows)
- [Workflow SDK](https://workflow-sdk.dev/)
- [Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [YouTube videos.update](https://developers.google.com/youtube/v3/docs/videos/update)
- [YouTube liveBroadcasts.list](https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list)
