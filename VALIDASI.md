# Validasi v3.0.0

Hasil pada 1 Oktober 2026:

- `npm test`: **23 pengujian lulus**. SQL supabase.sql benar-benar dijalankan pada PostgreSQL PGlite, bukan diganti dengan mock state. Alur A → B → C → A, kepemilikan tunggal, lease, pemulihan respons hilang, Stop, Start yang terlambat, pergantian pekerjaan lanjutan, interval 30 hari, izin database, pembatasan login, OAuth, CSRF, enkripsi, dan pemeliharaan metadata diperiksa.
- `npm run build`: **berhasil**, memakai Next.js 16.3.8, React 19.3.0, dan Workflow SDK 5.0.0. Manifest mengenali workflow dan route backend.
- `node tests/runtime.mjs`: **integrasi lulus** dengan server Next dari build produksi, Workflow SDK sesungguhnya pada backend Local World, endpoint REST HTTPS pengujian, dan PostgreSQL PGlite. Login/API/CSP, pendaftaran pekerjaan, event waktu tunggu yang tersimpan, dan Stop diperiksa. Tidak ada panggilan atau perubahan YouTube sungguhan.

Belum diuji pada deployment Vercel, database Supabase hosted, akun Google pengguna, siaran YouTube sungguhan, atau tampilan browser secara visual. Integrasi lokal memverifikasi mekanisme SDK; infrastruktur Vercel tetap perlu diverifikasi setelah deployment. Tampilan memiliki CSS responsif tetapi belum divalidasi lewat screenshot.

Tidak ada credential pengguna dalam paket. Sebelum digunakan pada live utama, sambungkan akun, pilih live uji, mulai rotasi minimal 10 menit, tutup tab CMS, pastikan dua judul berganti, lalu Stop dan pastikan tidak ada pergantian berikutnya. Uji ini memverifikasi OAuth, database, Workflow managed, dan API pada akun yang benar.

RDP hanya menjalankan encoder yang sudah digunakan. Tidak ada installer, service, pairing key, koneksi masuk ke RDP, atau agent v3. Paket ini mengontrol metadata satu live, bukan mematikan/menyalakan encoder.
