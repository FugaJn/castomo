/* Shared reference data: regions, prefectures, built-in fishing spots, fish and styles.
   Loaded by the browser (window.CAST) and by the server (require). Tide values are SAMPLE numbers only. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CAST = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  var REGIONS = [
    { id: 'hokkaido', en: 'Hokkaido', ja: '北海道' },
    { id: 'tohoku', en: 'Tohoku', ja: '東北' },
    { id: 'kanto', en: 'Kanto', ja: '関東' },
    { id: 'chubu', en: 'Chubu', ja: '中部' },
    { id: 'kansai', en: 'Kansai', ja: '近畿' },
    { id: 'chugoku', en: 'Chugoku', ja: '中国' },
    { id: 'shikoku', en: 'Shikoku', ja: '四国' },
    { id: 'kyushu', en: 'Kyushu & Okinawa', ja: '九州・沖縄' }
  ];
  /* [prefecture id, en, ja, region, sample mean tide cm, sample amplitude cm, spots]
     spot = id|en|ja|type  (s saltwater, b brackish, f freshwater) */
  var PREF_ROWS = [
    ['hokkaido', 'Hokkaido', '北海道', 'hokkaido', 55, 28, 'otaru|Otaru Port|小樽港|s;ishikari|Ishikari Bay New Port|石狩湾新港|s;muroran|Muroran Port|室蘭港|s;hakodate|Hakodate Port|函館港|s;abashiri|Abashiri Port|網走港|s;toya|Lake Toya|洞爺湖|f;shikotsu|Lake Shikotsu|支笏湖|f;kushiro|Kushiro River|釧路川|f;tokachi|Tokachi River|十勝川|f'],
    ['aomori', 'Aomori', '青森県', 'tohoku', 70, 30, 'hachinohe|Hachinohe Port|八戸港|s;tappi|Tappi Cape|竜飛崎|s;mutsu|Mutsu Bay|陸奥湾|s;towada|Lake Towada|十和田湖|f'],
    ['iwate', 'Iwate', '岩手県', 'tohoku', 85, 40, 'miyako|Miyako Bay|宮古湾|s;kamaishi|Kamaishi Port|釜石港|s;ofunato|Ofunato Bay|大船渡湾|s'],
    ['miyagi', 'Miyagi', '宮城県', 'tohoku', 85, 40, 'shiogama|Shiogama Port|塩釜港|s;matsushima|Matsushima Bay|松島湾|s;ishinomaki|Ishinomaki Port|石巻港|s;kesennuma|Kesennuma Bay|気仙沼湾|s'],
    ['akita', 'Akita', '秋田県', 'tohoku', 35, 12, 'oga|Oga Peninsula|男鹿半島|s;noshiro|Noshiro Port|能代港|s;akita-port|Akita Port|秋田港|s'],
    ['yamagata', 'Yamagata', '山形県', 'tohoku', 35, 12, 'sakata|Sakata Port|酒田港|s;yura|Yura Coast|由良海岸|s;mogami|Mogami River|最上川|f'],
    ['fukushima', 'Fukushima', '福島県', 'tohoku', 90, 42, 'onahama|Onahama Port|小名浜港|s;soma|Soma Port|相馬港|s;inawashiro|Lake Inawashiro|猪苗代湖|f;hibara|Lake Hibara|桧原湖|f'],
    ['ibaraki', 'Ibaraki', '茨城県', 'kanto', 90, 42, 'oarai|Oarai|大洗|s;kashima|Kashima Port|鹿島港|s;hasaki|Hasaki|波崎|s;kasumigaura|Lake Kasumigaura|霞ヶ浦|f;tone|Tone River|利根川|f'],
    ['tochigi', 'Tochigi', '栃木県', 'kanto', 100, 45, 'chuzenji|Lake Chuzenji|中禅寺湖|f;kinu|Kinu River|鬼怒川|f'],
    ['gunma', 'Gunma', '群馬県', 'kanto', 100, 45, 'haruna|Lake Haruna|榛名湖|f;akagi|Lake Onuma (Akagi)|赤城大沼|f'],
    ['saitama', 'Saitama', '埼玉県', 'kanto', 100, 45, 'arakawa|Arakawa (Saitama)|荒川(埼玉)|f;chichibu|Lake Chichibu|秩父湖|f'],
    ['chiba', 'Chiba', '千葉県', 'kanto', 90, 42, 'choshi|Choshi|銚子|s;katsuura|Katsuura|勝浦|s;futtsu|Futtsu Cape|富津岬|s;kisarazu|Kisarazu|木更津|s;tateyama|Tateyama|館山|s;kujukuri|Kujukuri Beach|九十九里浜|s'],
    ['tokyo', 'Tokyo', '東京都', 'kanto', 100, 50, 'wakasu|Wakasu Seaside Park|若洲海浜公園|s;kasai|Kasai Seaside Park|葛西臨海公園|s;tama|Tama River mouth|多摩川河口|b;hachijo|Hachijojima|八丈島|s'],
    ['kanagawa', 'Kanagawa', '神奈川県', 'kanto', 95, 45, 'honmoku|Honmoku Fishing Pier|本牧海づり施設|s;daikoku|Daikoku Fishing Pier|大黒海づり施設|s;enoshima|Enoshima|江の島|s;manazuru|Manazuru|真鶴|s;miura|Miura Peninsula|三浦半島|s;sagami|Lake Sagami|相模湖|f'],
    ['niigata', 'Niigata', '新潟県', 'chubu', 35, 12, 'sado|Sado Island|佐渡島|s;naoetsu|Naoetsu Port|直江津港|s;niigata-port|Niigata Port|新潟港|s;shinano|Shinano River|信濃川|f;uono|Uono River|魚野川|f'],
    ['toyama', 'Toyama', '富山県', 'chubu', 35, 12, 'himi|Himi|氷見|s;toyama-bay|Toyama Bay|富山湾|s;namerikawa|Namerikawa|滑川|s'],
    ['ishikawa', 'Ishikawa', '石川県', 'chubu', 35, 12, 'noto|Noto Peninsula|能登半島|s;kanazawa|Kanazawa Port|金沢港|s;nanao|Nanao Bay|七尾湾|s'],
    ['fukui', 'Fukui', '福井県', 'chubu', 35, 12, 'tsuruga|Tsuruga Bay|敦賀湾|s;wakasa|Wakasa Bay|若狭湾|s;echizen|Echizen Coast|越前海岸|s;kuzuryu|Kuzuryu River|九頭竜川|f'],
    ['yamanashi', 'Yamanashi', '山梨県', 'chubu', 100, 45, 'kawaguchi|Lake Kawaguchi|河口湖|f;yamanaka|Lake Yamanaka|山中湖|f;motosu|Lake Motosu|本栖湖|f'],
    ['nagano', 'Nagano', '長野県', 'chubu', 100, 45, 'suwa|Lake Suwa|諏訪湖|f;kizaki|Lake Kizaki|木崎湖|f;chikuma|Chikuma River|千曲川|f'],
    ['gifu', 'Gifu', '岐阜県', 'chubu', 100, 45, 'nagara|Nagara River|長良川|f;ibi|Ibi River|揖斐川|f;hida|Hida River|飛騨川|f'],
    ['shizuoka', 'Shizuoka', '静岡県', 'chubu', 95, 45, 'hamana|Lake Hamana|浜名湖|b;shimizu|Shimizu Port|清水港|s;suruga|Suruga Bay|駿河湾|s;izu|Izu Peninsula|伊豆半島|s;omaezaki|Omaezaki|御前崎|s;ooi|Oi River|大井川|f'],
    ['aichi', 'Aichi', '愛知県', 'chubu', 99, 46, 'nagoya|Nagoya Port|名古屋港|s;kiso|Kiso River mouth (Yatomi)|木曽川河口(弥富)|b;kinuura|Kinuura Port (Hekinan)|衣浦港(碧南)|s;morozaki|Morozaki (Chita)|師崎(知多)|s;tokoname|Tokoname / Centrair|常滑・セントレア周辺|s;handa|Handa / Taketoyo|半田・武豊|s;noma|Noma (Mihama)|野間(美浜)|s;utsumi|Utsumi (Minamichita)|内海(南知多)|s;toyohama|Toyohama (Minamichita)|豊浜(南知多)|s;shinojima|Shinojima|篠島|s;himaka|Himakajima|日間賀島|s;isshiki|Isshiki (Nishio)|一色(西尾)|s;yahagi|Yahagi River mouth|矢作川河口|b;gamagori|Gamagori|蒲郡|s;toyohashi|Toyohashi Port|豊橋港|s;irago|Irago (Tahara)|伊良湖(田原)|s;akabane|Akabane (Tahara)|赤羽根(田原)|s'],
    ['mie', 'Mie', '三重県', 'kansai', 100, 50, 'yokkaichi|Yokkaichi Port|四日市港|s;toba|Toba|鳥羽|s;ago|Ago Bay|英虞湾|s;owase|Owase|尾鷲|s;kumano|Kumano|熊野|s'],
    ['shiga', 'Shiga', '滋賀県', 'kansai', 100, 45, 'biwa-north|Lake Biwa (North)|琵琶湖 北湖|f;biwa-south|Lake Biwa (South)|琵琶湖 南湖|f;yogo|Lake Yogo|余呉湖|f'],
    ['kyoto', 'Kyoto', '京都府', 'kansai', 35, 12, 'maizuru|Maizuru Bay|舞鶴湾|s;miyazu|Miyazu Bay|宮津湾|s;kyotango|Kyotango Coast|京丹後海岸|s;uji|Uji River|宇治川|f'],
    ['osaka', 'Osaka', '大阪府', 'kansai', 100, 45, 'nankou|Nankou (Osaka Port)|南港(大阪港)|s;sakai|Sakai Port|堺港|s;kishiwada|Kishiwada|岸和田|s;yodo|Yodo River|淀川|f'],
    ['hyogo', 'Hyogo', '兵庫県', 'kansai', 100, 50, 'kobe|Kobe Port|神戸港|s;akashi|Akashi|明石|s;awaji|Awaji Island|淡路島|s;ako|Ako|赤穂|s;muko|Muko River|武庫川|f'],
    ['nara', 'Nara', '奈良県', 'kansai', 100, 45, 'totsukawa|Totsukawa River|十津川|f;yoshino-nara|Yoshino River (Nara)|吉野川(奈良)|f'],
    ['wakayama', 'Wakayama', '和歌山県', 'kansai', 90, 45, 'kushimoto|Kushimoto|串本|s;shirahama|Shirahama|白浜|s;tanabe|Tanabe|田辺|s;kainan|Kainan|海南|s;arida|Arida River|有田川|f'],
    ['tottori', 'Tottori', '鳥取県', 'chugoku', 30, 10, 'sakaiminato|Sakaiminato|境港|s;tottori-coast|Tottori Coast|鳥取海岸|s;togo|Lake Togo|東郷湖|b'],
    ['shimane', 'Shimane', '島根県', 'chugoku', 30, 10, 'shinji|Lake Shinji|宍道湖|b;nakaumi|Lake Nakaumi|中海|b;oki|Oki Islands|隠岐諸島|s;hamada|Hamada Port|浜田港|s;go|Go River|江の川|f'],
    ['okayama', 'Okayama', '岡山県', 'chugoku', 150, 60, 'kojima|Kojima Bay|児島湾|s;ushimado|Ushimado|牛窓|s;tamano|Tamano|玉野|s;asahi|Asahi River|旭川|f'],
    ['hiroshima', 'Hiroshima', '広島県', 'chugoku', 160, 70, 'hiroshima-bay|Hiroshima Bay|広島湾|s;onomichi|Onomichi|尾道|s;kure|Kure|呉|s;ota|Ota River|太田川|f'],
    ['yamaguchi', 'Yamaguchi', '山口県', 'chugoku', 120, 50, 'shimonoseki|Shimonoseki|下関|s;hagi|Hagi|萩|s;ube|Ube|宇部|s;nishiki|Nishiki River|錦川|f'],
    ['tokushima', 'Tokushima', '徳島県', 'shikoku', 130, 60, 'naruto|Naruto Strait|鳴門海峡|s;mugi|Mugi|牟岐|s;yoshino|Yoshino River|吉野川|f'],
    ['kagawa', 'Kagawa', '香川県', 'shikoku', 140, 55, 'takamatsu|Takamatsu Port|高松港|s;shodoshima|Shodoshima|小豆島|s;marugame|Marugame|丸亀|s'],
    ['ehime', 'Ehime', '愛媛県', 'shikoku', 150, 60, 'uwajima|Uwajima|宇和島|s;imabari|Imabari|今治|s;matsuyama|Matsuyama Port|松山港|s;shigenobu|Shigenobu River|重信川|f'],
    ['kochi', 'Kochi', '高知県', 'shikoku', 100, 48, 'shimanto|Shimanto River|四万十川|f;muroto|Muroto|室戸|s;tosa-bay|Tosa Bay|土佐湾|s;ashizuri|Cape Ashizuri|足摺岬|s;niyodo|Niyodo River|仁淀川|f'],
    ['fukuoka', 'Fukuoka', '福岡県', 'kyushu', 110, 55, 'hakata|Hakata Bay|博多湾|s;genkai|Genkai Sea Coast|玄界灘沿岸|s;kitakyushu|Kitakyushu|北九州|s;chikugo|Chikugo River|筑後川|f'],
    ['saga', 'Saga', '佐賀県', 'kyushu', 110, 60, 'karatsu|Karatsu|唐津|s;yobuko|Yobuko|呼子|s;ariake-saga|Ariake Sea (Saga)|有明海(佐賀)|s;kase|Kase River|嘉瀬川|f'],
    ['nagasaki', 'Nagasaki', '長崎県', 'kyushu', 120, 60, 'tsushima|Tsushima|対馬|s;goto|Goto Islands|五島列島|s;omura|Omura Bay|大村湾|s;iki|Iki Island|壱岐|s;sasebo|Sasebo|佐世保|s'],
    ['kumamoto', 'Kumamoto', '熊本県', 'kyushu', 200, 90, 'amakusa|Amakusa|天草|s;misumi|Misumi|三角|s;kuma|Kuma River|球磨川|f;kikuchi|Kikuchi River|菊池川|f'],
    ['oita', 'Oita', '大分県', 'kyushu', 130, 55, 'saganoseki|Saganoseki|佐賀関|s;beppu|Beppu Bay|別府湾|s;saiki|Saiki|佐伯|s;oita-river|Oita River|大分川|f'],
    ['miyazaki', 'Miyazaki', '宮崎県', 'kyushu', 85, 40, 'nichinan|Nichinan|日南|s;hyuga|Hyuga|日向|s;nobeoka|Nobeoka|延岡|s;oyodo|Oyodo River|大淀川|f'],
    ['kagoshima', 'Kagoshima', '鹿児島県', 'kyushu', 140, 60, 'kagoshima-bay|Kagoshima Bay|鹿児島湾|s;yakushima|Yakushima|屋久島|s;amami|Amami Oshima|奄美大島|s;makurazaki|Makurazaki|枕崎|s;sendai-river|Sendai River|川内川|f'],
    ['okinawa', 'Okinawa', '沖縄県', 'kyushu', 120, 55, 'naha|Naha|那覇|s;ishigaki|Ishigaki Island|石垣島|s;miyakojima|Miyakojima|宮古島|s;kerama|Kerama Islands|慶良間諸島|s']
  ];
  var PREFS = [], SPOTS = [];
  PREF_ROWS.forEach(function (r) {
    PREFS.push({ id: r[0], en: r[1], ja: r[2], region: r[3], mean: r[4], a: r[5] });
    var pr = rng(hash(r[0])), bp = pr() * 6.28, bp2 = pr() * 6.28, bp3 = pr() * 6.28;
    r[6].split(';').forEach(function (s) {
      var x = s.split('|'), o = (hash(x[0]) % 100) / 250;
      SPOTS.push({ id: x[0], en: x[1], ja: x[2], type: x[3], pref: r[0], region: r[3], mean: r[4], a: r[5], p: bp + o, p2: bp2 + o, p3: bp3 + o });
    });
  });
  var FISH = {
    any: { en: 'Anything', ja: 'なんでも' }, seabass: { en: 'Seabass', ja: 'シーバス' }, aji: { en: 'Horse mackerel', ja: 'アジ' },
    chinu: { en: 'Black sea bream', ja: 'チヌ' }, aori: { en: 'Squid (aori-ika)', ja: 'アオリイカ' }, haze: { en: 'Goby', ja: 'ハゼ' },
    tachi: { en: 'Hairtail', ja: 'タチウオ' }, kisu: { en: 'Sillago (kisu)', ja: 'シロギス' }, mebaru: { en: 'Rockfish (mebaru)', ja: 'メバル' },
    hirame: { en: 'Flounder', ja: 'ヒラメ' }, blackbass: { en: 'Black bass', ja: 'ブラックバス' }, trout: { en: 'Trout', ja: 'トラウト' },
    wakasagi: { en: 'Pond smelt (wakasagi)', ja: 'ワカサギ' }, ayu: { en: 'Sweetfish (ayu)', ja: 'アユ' }, madai: { en: 'Red sea bream', ja: 'マダイ' },
    buri: { en: 'Yellowtail', ja: 'ブリ' }
  };
  var STYLES = {
    lure: { en: 'Lure casting', ja: 'ルアー' }, bait: { en: 'Bait fishing', ja: 'エサ釣り' }, sabiki: { en: 'Sabiki', ja: 'サビキ' },
    eging: { en: 'Eging', ja: 'エギング' }, float: { en: 'Float fishing', ja: 'ウキ釣り' }, jigging: { en: 'Jigging', ja: 'ジギング' },
    fly: { en: 'Fly fishing', ja: 'フライ' }, boat: { en: 'Boat fishing', ja: '船釣り' }, tomo: { en: 'Ayu tomozuri', ja: '友釣り' },
    tenkara: { en: 'Tenkara', ja: 'テンカラ' }
  };
  return { REGIONS: REGIONS, PREFS: PREFS, SPOTS: SPOTS, FISH: FISH, STYLES: STYLES, hash: hash, rng: rng };
});
