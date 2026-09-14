# LUMEN — paylaşım kartına günlük challenge bağlamı ekle

Bu, tek bir değişiklik paketidir. Amaç: LUMEN'i challenge oyunu olarak
yayılabilir hâle getirmek. Bugün yayılamıyor, çünkü paylaşım kartı **hangi
güne ait olduğunu, günün ne olduğunu ve oyuna nasıl gidileceğini söylemiyor.**

Repo: `D:\cowork\Lumen` (vanilla JS, bağımlılık yok, motor yok).

---

## Sorun

`js/input.js:71` `Share.render(game, data)` kartı çiziyor ve sadece şunları
basıyor: `LUMEN` başlığı, skor, `TOP COMBO ×N`, tagline, varsa `NEW BEST`.
`js/ui.js:2473` `share()` ise metni `T('shareText')` ile üretiyor —
`js/i18n.js:290`: *"I hit {s} in LUMEN ⚡ (top combo x{c}). … Can you beat it?"*

Yani kartı alan kişi:
- bunun **günlük challenge** olduğunu bilmiyor,
- **hangi güne** ait olduğunu bilmiyor (tohum tarihten geliyor, ertesi gün
  parkur başka),
- günün **bükümünü** (mod + mutator) bilmiyor,
- **serinin** kaç gün olduğunu görmüyor,
- ve **oyuna gidecek hiçbir bağlantı yok.**

"Can you beat it?" diyor ama karşıdakine yenecek bir şey vermiyor.

Oysa veri zaten hazır: `LUMEN.Missions.todayStr()`, `.twistName()`,
`.status().streak` ve `?mode=daily` derin bağlantısı (`js/main.js:17`) çalışıyor.

---

## Değişiklik 1 — UI, son koşunun günlük olduğunu unutuyor

`js/ui.js:2428-2430`, oyun sonu verisi saklanırken:

```js
this._lastScore  = data.score;
this._lastCombo  = data.combo;
this._lastIsBest = data.isBest;
this._lastDaily  = !!data.daily;   // YENİ
```

`data.daily` zaten mevcut — hemen altta `js/ui.js:2440` civarında
`Rating.consider()` için kullanılıyor. Sadece saklanmıyor.

---

## Değişiklik 2 — `share()` günlük bağlamını karta geçirsin

`js/ui.js:2473` `share()` içinde, `data` ve `text` kurulumu:

```js
const M     = LUMEN.Missions;
const daily = !!this._lastDaily;
const s     = this._lastScore || 0;
const c     = this._lastCombo || 0;

const data = {
  score: s, combo: c, isBest: !!this._lastIsBest,
  daily,
  dailyDate:   daily && M ? M.todayStr()            : '',
  dailyTwist:  daily && M ? M.twistName()           : '',
  dailyStreak: daily && M ? (M.status().streak || 0): 0,
};

const text = daily
  ? T('shareTextDaily', { s: s, c: c, d: data.dailyDate, u: LUMEN.Config.shareUrl })
  : T('shareText',      { s: s, c: c });
```

`twistName()` (`js/missions.js:52`) zaten yerelleştirilmiş bir dize döndürüyor
(`Modes.name()` + `mut_*` anahtarları) ve büküm yoksa boş dize dönüyor —
o durumda kartta o satırı hiç çizme.

---

## Değişiklik 3 — kartı çiz

`js/input.js` `Share.render()` içinde, `NEW BEST` bloğundan sonra:

- `data.daily` ise **sol üstte** bir şerit: `DAILY · <dailyDate>`
  (yani `DAILY · 2026-08-31`). Kart hâlâ ortalanmış çizim kullanıyor
  (`x.textAlign = 'center'`), bu şerit için `textAlign = 'left'` yapıp
  sonra geri al.
- Altına `data.dailyTwist` (boşsa çizme) — küçük punto, kısık renk.
- `data.dailyStreak > 0` ise **sağ üstte** `🔥 <n>`.
- **Her kartta** (günlük olsun olmasın) alt kenara bağlantı satırı:
  `LUMEN.Config.shareUrl`.

Kart 1200×630. Üstte `LUMEN` başlığı y=108'de, skor y=320'de — şerit için
y≈52 boş. Alt bağlantı satırı için y≈600 uygun; `NEW BEST` y=545'te olduğu
için çakışmıyor.

**Dikkat:** kart, canlı oyun tuvalinin üstüne çiziliyor
(`js/input.js:78-85`). Sol üst köşe bazı modlarda parlak olabiliyor —
şeridin arkasına yarı saydam koyu bir dikdörtgen koy, yoksa metin kayboluyor.

---

## Değişiklik 4 — bağlantı, ayarlanabilir olsun

`config.js` içine yeni alan:

```js
// Paylaşım kartındaki ve paylaşım metnindeki bağlantı.
shareUrl: 'https://apps.apple.com/us/app/lumen-flip-thread-flow/id6797276640',
```

**Burada bir karar var, kod yazmadan önce sorulmalı.** İki seçenek:

1. **App Store bağlantısı** (yukarıdaki varsayılan) — mağaza kurulumuna
   yönlendirir, bio'daki mevcut karara uyar.
2. **Web bağlantısı** `https://kaanipek.github.io/lumen/?mode=daily` — tıklayan
   kişi **o günün aynı koşusunu anında oynar**, kurulum yok. Challenge yayılımı
   için ölçülebilir biçimde daha güçlü olan bu, çünkü sürtünme sıfır.

Sahibi daha önce Instagram bio'su için "sadece mağaza linki, web sürümü yok"
demişti. Paylaşım kartı farklı bir bağlam (oradaki hedef *hemen oynatmak*),
ama bu yine de onun kararı — **varsayılanı 1 yap, 2'yi seçenek olarak sun.**

---

## Değişiklik 5 — i18n, dört dil

`js/i18n.js` içinde her dil bloğuna `shareText`'in yanına yeni anahtar:

- EN ≈ satır 290
- TR ≈ satır 919
- ES ≈ satır 1596
- ZH ≈ satır 2346

```
shareTextDaily:
  EN: "LUMEN daily, {d} — {s} points (top combo x{c}). Same run for everyone today. Beat me: {u}"
  TR: "LUMEN günlük, {d} — {s} puan (en iyi kombo x{c}). Bugün herkes aynı koşuyu oynuyor. Geç bakalım: {u}"
  ES: "Diario de LUMEN, {d} — {s} puntos (mejor combo x{c}). Hoy todos juegan la misma partida. Supérame: {u}"
  ZH: "LUMEN 每日挑战 {d} — {s} 分（最高连击 x{c}）。今天所有人跑的是同一条路线。来超过我：{u}"
```

Kartın üstündeki `DAILY` etiketi için **`dailyTitle` anahtarını KULLANMA** —
o, perk sistemindeki "DAILY REWARD" (`js/i18n.js:390`), başka bir özellik.
Gerekirse yeni `shareDailyTag` anahtarı aç.

---

## Değişiklik 6 — test

`tests/tests.js`:
- `Share.render()` günlük veriyle çağrıldığında patlamıyor ve
  `data.dailyTwist` boşken de doğru çiziliyor.
- `Missions.twistName()` bilinen bir tohum için beklenen dizeyi veriyor.
- **Mevcut günlük belirlenircilik testleri bozulmamalı** — `tests/tests.js:274`
  ("the planned course is identical across runs") ve `:1584-1590`
  (900×1600 ve 430×900'de aynı parkur). Bunlara dokunma.

---

## Kabul ölçütü

1. Günlük koşudan sonra paylaş → kartta **tarih, günün bükümü, seri ve
   bağlantı** var; metin `shareTextDaily`.
2. Normal koşudan sonra paylaş → kart eskisi gibi, **artı** bağlantı satırı.
3. Büküm `none` + mod `classic` olan bir günde büküm satırı hiç çizilmiyor
   (boş satır bırakmıyor).
4. Seri 0 iken 🔥 rozeti çizilmiyor.
5. Dört dilde de metin dönüyor, `{u}` yerine gerçek bağlantı geçiyor.
6. `?mode=daily` derin bağlantısı hâlâ çalışıyor (`js/main.js:17`).
7. Kart sol üst köşesi parlak bir modda (örn. BLACKOUT'un ışık darbesi,
   VORTEX) okunabiliyor.

---

## Kapsam dışı (yapma)

- Haftalık tablo, arkadaş tablosu, mod bazlı tablo — hiçbiri yok, eklemeye
  kalkma; bu paket sadece paylaşım kartı.
- Ghost / "Pacer" — `config.js:131-134`'te sadece bir anket seçeneği.
- Çok oyunculu — `config.js:93`'te bilerek kapsam dışı bırakılmış.
- Android: online tablolar Google girişi bağlı değilken zaten gizleniyor
  (`js/ui.js:1554-1559`). Paylaşım kartı bundan etkilenmemeli — kart
  çevrimdışı da çalışmalı.

---

## Sonrası

Bu değişiklik yeni bir App Store build'i gerektiriyor. Web sürümü
(`kaanipek.github.io/lumen`) push ile kendiliğinden yayına giriyor, o yüzden
önce web'de doğrulanabilir.
