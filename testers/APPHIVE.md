# LUMEN — AppHive kapalı test paketi

Bu klasördeki her şey tek bir iş için: **12 testçi × 14 gün** kuralını geçip
Google Play production erişimini almak.

---

## 1. Kopyala-yapıştır bilgiler

| Alan | Değer |
|---|---|
| Uygulama adı | `LUMEN` |
| **Package ID** | `com.rldgames.lumen` |
| Opt-in linki (web) | `https://play.google.com/apps/testing/com.rldgames.lumen` |
| Play mağaza linki | `https://play.google.com/store/apps/details?id=com.rldgames.lumen` |
| Test kanalı | Closed testing – Alpha |
| Sürüm | 69 (1.0.0) |
| Ülke | 177 ülke / bölge (tümü + rest of world) |
| Google Grubu | `apphive-testers@googlegroups.com` |
| Geri bildirim adresi | `rld.ranger07@gmail.com` |

AppHive senden pratikte **sadece Package ID** istiyor. Gerisi (ikon, ekran
görüntüleri, açıklama) Play'den otomatik çekiliyor — ayrıca yüklemene gerek yok.

## 2. Bu klasördeki dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `lumen-tester-card.png` | Paylaşılabilir davet kartı — logo + QR + link. Discord/Reddit/WhatsApp'a atılacak tek görsel |
| `qr-lumen-optin.png` | Sade QR: doğrudan LUMEN opt-in sayfası |
| `qr-apphive.png` | Sade QR: AppHive uygulamasının Play sayfası |
| `qr-group.png` | Sade QR: apphive-testers Google Grubu |

Dördünün de gerçekten okunduğu `cv2.QRCodeDetector` ile doğrulandı — göz kararı
değil.

## 3. Sıra

1. **Google Grubuna katıl** — https://groups.google.com/g/apphive-testers
   Katıldığın hesap, telefonundaki **Play Store hesabıyla aynı** olmalı. Farklı
   olursa hiçbir uygulamayı indiremezsin, AppHive'ın en sık şikâyeti bu.
2. **AppHive uygulamasını kur** — `com.codignia.apphive`, Play'den.
   Gerçek cihaz şart: emülatörde kurulumu bilerek engelliyorlar, denemek kalıcı
   cihaz banı demek. Android 8.0+, Play Services yüklü olmalı.
3. **Kaydol** — ücretsiz. Açılışta 500 UP (Hive'a girmeye yeter) ve 10 RP verilir.
4. **Hive'a katıl**, Package ID olarak `com.rldgames.lumen` gir.
5. **17 uygulama dolunca** Hive aktifleşir ve **14 günlük sayaç o an başlar.**
   Yayına girmesiyle değil — Hive dolmasıyla.

## 4. Günlük yükümlülük — hafife alınacak kısım değil

Sayaç işlerken **her gün diğer 16 uygulamayı açıp ekran görüntüsü almalısın.**
Gün UTC 00:00'da sıfırlanıyor.

| Ceza | Sebep |
|---|---|
| −2 IP | Bir uygulamayı o gün açmamak |
| −1 IP | Sana gelen test raporunu incelememek |
| −1 IP | Önceki günden yarım kalan kurulum |

**5 IP → 1 RP kaybı. 10 IP → Hive'dan otomatik ban + 3 RP kaybı.** Yani 14 gün
boyunca günde ~15-20 dakikalık bir iş; bir gün tamamen atlarsan telafisi var,
üst üste atlarsan sayaç sıfırlanır ve baştan başlarsın.

Bu yüzden Hive'a **başlayabileceğin gün** gir. Yoğun bir haftanın ortasında
başlamak, iki hafta sonra sıfırdan başlamak demek.

## 5. Ücretli alternatif

AppHive'ın "Premium Direct Track" seçeneği **$24.99** karşılığında 12+ testçiyi
doğrudan veriyor; karşılıklı test yükümlülüğü yok. Günde 20 dakika × 14 gün
senin için 25 dolardan pahalıysa mantıklı. Karar senin — ücretsiz yol da
tamamen çalışıyor, sadece emek istiyor.

## 6. Bizim taraf — durum

AppHive'ın "uygulaman indirilemiyorsa şunları kontrol et" listesi ve bizdeki hâli:

- [x] `apphive-testers@googlegroups.com` kapalı test kanalına **Google Grubu**
      olarak eklendi (yeniden yükleyip kalıcı olduğu doğrulandı)
- [x] Tüm ülkeler seçili — 177 ülke/bölge + rest of world
- [x] Package ID doğru — `com.rldgames.lumen`
- [ ] **Değişiklikler incelemeden geçip yayınlanmış olmalı** ← tek eksik.
      19 Ağustos 2026'da 16 değişiklik incelemeye gönderildi, quick check'ler
      geçti, şu an "Changes in review".

**Onay gelmeden opt-in linkini kimseye verme.** Şu an linke giren "item not
found" görür. Onay çıkar çıkmaz link kendiliğinden çalışmaya başlar; kartı da
QR'ı da yeniden üretmeye gerek yok, adres değişmiyor.

---

## 7. Açıklama metinleri (kopyala-yapıştır)

AppHive'ın alanı ne kadar kısaysa ona göre seç. Hepsi İngilizce — hive
uluslararası.

**Tek satır (79 karakter — Play'de yayınlanan kısa açıklamanın aynısı)**

    One thumb, one rule: flip gravity and thread every gap. No ad interrupts a run.

**Kısa (≈220 karakter)**

    LUMEN is a neon arcade game about one decision made over and over, faster and
    faster: fall up, or fall down. Chain gates without touching one and the world
    slips into slow motion. 10 modes, 11 worlds, a daily challenge. Plays offline.

**Testçiye yönelik not** — "testers should focus on" gibi bir alan varsa:

    Please open the app once a day and play a run or two. Worth a look: the
    tutorial on first launch, the shop tabs, and the daily challenge. It plays
    offline and needs no account. Feedback: rld.ranger07@gmail.com

Türkçe/İspanyolca/Çince sürümleri ve 4000 karakterlik tam mağaza metni
`docs/STORE_LISTING.md` içinde.
