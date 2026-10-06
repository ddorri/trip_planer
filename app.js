'use strict';
/* =====================================================================
   Помощник по путешествию — PWA без сервера. Данные: IndexedDB на устройстве.
   ===================================================================== */

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const fmt0 = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = n => { const r = Math.round(n * 100) / 100; return (Number.isInteger(r) ? fmt0 : fmt2).format(r); };
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const pd = s => (s ? new Date(s.length <= 10 ? s + 'T00:00' : s) : null);
const fDate = (s, o) => { const d = pd(s); return d && !isNaN(d) ? d.toLocaleDateString('ru-RU', o || { day: 'numeric', month: 'short' }) : ''; };
const fDateW = s => fDate(s, { weekday: 'long', day: 'numeric', month: 'long' });
const fTime = s => (s && s.length > 10 ? s.slice(11, 16) : '');
const fDT = s => (s ? fDate(s) + (fTime(s) ? ', ' + fTime(s) : '') : '');
const dayDiff = (a, b) => Math.round((pd(b.slice(0, 10)) - pd(a.slice(0, 10))) / 864e5);
const nightsOf = s => (s.checkIn && s.checkOut ? Math.max(0, dayDiff(s.checkIn, s.checkOut)) : 0);
const byDate = f => (a, b) => { const x = f(a) || '', y = f(b) || ''; return x && y ? (x < y ? -1 : x > y ? 1 : 0) : x ? -1 : y ? 1 : 0; };
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- IndexedDB ---------- */
let _db;
function openDB() {
  if (!_db) _db = new Promise((res, rej) => {
    const r = indexedDB.open('trip-app', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _db;
}
function tx(store, mode, fn) {
  return openDB().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const kvGet = k => tx('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
const fileGet = id => tx('files', 'readonly', s => s.get(id));
const filePut = (id, rec) => tx('files', 'readwrite', s => s.put(rec, id));
const fileDel = id => tx('files', 'readwrite', s => s.delete(id));
const filesClear = () => tx('files', 'readwrite', s => s.clear());

/* ---------- справочники ---------- */
const TK = { plane: ['✈️', 'Самолёт'], train: ['🚆', 'Поезд'], bus: ['🚌', 'Автобус'], ferry: ['⛴️', 'Паром'], transfer: ['🚐', 'Трансфер'], taxi: ['🚕', 'Такси'], other: ['➡️', 'Другое'] };
const PC = { food: ['🍽️', 'Еда'], nature: ['🌿', 'Природа'], museum: ['🏛️', 'Музеи / история'], view: ['📸', 'Виды'], beach: ['🏖️', 'Пляж'], shop: ['🛍️', 'Шопинг'], fun: ['🎡', 'Развлечения'], other: ['📍', 'Другое'] };
const EC = { visa: ['🛂', 'Визы'], food: ['🍽️', 'Еда'], transport: ['🚇', 'Транспорт на месте'], tickets: ['🎟️', 'Билеты / входы'], sim: ['📶', 'Связь / SIM'], insurance: ['🩺', 'Страховка'], souvenir: ['🎁', 'Сувениры'], other: ['🧾', 'Прочее / мелочь'] };
const DK = { passport: 'Паспорт', visa: 'Виза', insurance: 'Страховка', ticket: 'Билет', booking: 'Бронь', other: 'Другое' };
const PS = { want: 'Хотим', visited: 'Были', skip: 'Не едем' };
const PP = { 1: '🔥 Очень хотим', 2: '👍 Хорошо бы', 3: '🤷 Если успеем' };
const PAY = [['unpaid', 'Не оплачено'], ['part', 'Предоплата'], ['paid', 'Оплачено']];
const PAYL = { unpaid: 'Не оплачено', part: 'Предоплата', paid: 'Оплачено' };
const pairs = (o, f) => Object.entries(o).map(([k, v]) => [k, f ? f(v) : v]);

const payF = [
  { k: 'amount', l: 'Стоимость, €', t: 'money' },
  { k: 'pay', l: 'Статус оплаты', t: 'select', o: PAY, def: 'unpaid' },
  { k: 'paidAmt', l: 'Уже внесено, €', t: 'money', show: ['pay', 'part'] },
  { k: 'payDate', l: 'Дата автосписания / оплаты', t: 'date', hint: 'Просто напоминание. На статус оплаты не влияет — его вы переключаете сами.' },
];
const filesF = { k: 'files', l: 'Билеты, брони, фото', t: 'files' };

const TYPES = {
  transport: {
    label: 'Перемещение', fields: [
      { k: 'kind', l: 'Тип', t: 'select', o: pairs(TK, v => v.join(' ')), def: 'plane' },
      { k: 'from', l: 'Откуда', t: 'text' }, { k: 'to', l: 'Куда', t: 'text' },
      { k: 'dep', l: 'Отправление', t: 'datetime' }, { k: 'arr', l: 'Прибытие', t: 'datetime' },
      { k: 'carrier', l: 'Перевозчик', t: 'text' }, { k: 'number', l: 'Номер рейса / поезда', t: 'text' },
      { k: 'code', l: 'Код брони', t: 'text' }, { k: 'seat', l: 'Места, багаж', t: 'text' },
      ...payF, { k: 'note', l: 'Заметки', t: 'textarea' }, filesF],
  },
  stay: {
    label: 'Жильё', fields: [
      { k: 'name', l: 'Название', t: 'text' }, { k: 'address', l: 'Адрес', t: 'text' },
      { k: 'll', l: 'Координаты (необязательно)', t: 'text', hint: 'Например: 41.4036, 2.1744 — можно скопировать из карт' },
      { k: 'checkIn', l: 'Заезд', t: 'date' }, { k: 'checkOut', l: 'Выезд', t: 'date' },
      { k: 'checkInTime', l: 'Время заезда / выезда', t: 'text', hint: 'Например: заезд 15:00–22:00, выезд до 11:00' },
      { k: 'code', l: 'Номер брони', t: 'text' }, { k: 'pin', l: 'PIN брони', t: 'text' },
      { k: 'cancelBy', l: 'Бесплатная отмена до', t: 'date' },
      ...payF,
      { k: 'contact', l: 'Контакты хозяина', t: 'text' }, { k: 'link', l: 'Ссылка на бронь', t: 'url' },
      { k: 'note', l: 'Заметки (код двери, Wi-Fi…)', t: 'textarea' }, filesF],
  },
  car: {
    label: 'Авто', fields: [
      { k: 'company', l: 'Прокатная компания', t: 'text' }, { k: 'model', l: 'Автомобиль / класс', t: 'text' },
      { k: 'pickPlace', l: 'Где получаем', t: 'text' }, { k: 'pickDt', l: 'Получение', t: 'datetime' },
      { k: 'retPlace', l: 'Где возвращаем', t: 'text' }, { k: 'retDt', l: 'Возврат', t: 'datetime' },
      { k: 'code', l: 'Номер брони', t: 'text' },
      ...payF,
      { k: 'deposit', l: 'Залог, € (блокируется на карте, в расходы не входит)', t: 'money' },
      { k: 'insurance', l: 'Страховка', t: 'text' }, { k: 'mileage', l: 'Лимит пробега', t: 'text' }, { k: 'fuel', l: 'Топливо', t: 'text' },
      { k: 'note', l: 'Заметки', t: 'textarea' }, filesF],
  },
  place: {
    label: 'Место', fields: [
      { k: 'name', l: 'Название', t: 'text' },
      { k: 'cat', l: 'Категория', t: 'select', o: pairs(PC, v => v.join(' ')), def: 'other' },
      { k: 'status', l: 'Статус', t: 'select', o: pairs(PS), def: 'want' },
      { k: 'prio', l: 'Приоритет', t: 'select', o: pairs(PP), def: '2' },
      { k: 'address', l: 'Адрес', t: 'text' },
      { k: 'll', l: 'Координаты (необязательно)', t: 'text', hint: 'Например: 41.4036, 2.1744' },
      { k: 'price', l: 'Примерная цена, €', t: 'money' }, { k: 'hours', l: 'Часы работы', t: 'text' },
      { k: 'link', l: 'Ссылка', t: 'url' }, { k: 'note', l: 'Заметки', t: 'textarea' },
      { k: 'files', l: 'Фото', t: 'files' }],
  },
  expense: {
    label: 'Расход', defaults: { pay: 'paid', cat: 'other' }, fields: [
      { k: 'title', l: 'Что', t: 'text' },
      { k: 'cat', l: 'Категория', t: 'select', o: pairs(EC, v => v.join(' ')), def: 'other' },
      { k: 'amount', l: 'Сумма, €', t: 'money' },
      { k: 'pay', l: 'Статус оплаты', t: 'select', o: PAY, def: 'paid' },
      { k: 'paidAmt', l: 'Уже внесено, €', t: 'money', show: ['pay', 'part'] },
      { k: 'date', l: 'Дата', t: 'date' },
      { k: 'note', l: 'Заметки', t: 'textarea' }, { k: 'files', l: 'Чеки, фото', t: 'files' }],
  },
  doc: {
    label: 'Документ', fields: [
      { k: 'title', l: 'Название', t: 'text' },
      { k: 'kind', l: 'Тип', t: 'select', o: pairs(DK), def: 'other' },
      { k: 'note', l: 'Заметки', t: 'textarea' }, { k: 'files', l: 'Файлы', t: 'files' }],
  },
};

const titleOf = {
  transport: i => `${i.from || '?'} → ${i.to || '?'}`, stay: i => i.name || 'Жильё', car: i => i.company || 'Авто',
  place: i => i.name || 'Место', expense: i => i.title || 'Расход', doc: i => i.title || 'Документ',
};

const CHECK0 = [
  ['Документы', ['Паспорта', 'Визы / разрешения на въезд', 'Страховка', 'Водительские права', 'Брони и билеты (скриншоты)', 'Банковские карты и немного наличных']],
  ['Техника', ['Зарядки и кабели', 'Powerbank', 'Переходники для розеток', 'Наушники']],
  ['Вещи', ['Одежда по погоде', 'Удобная обувь', 'Солнцезащитные очки и крем', 'Купальные принадлежности', 'Средства гигиены']],
  ['Аптечка', ['Личные лекарства', 'Обезболивающее, от температуры', 'Пластыри', 'От желудка']],
  ['Перед выездом', ['Онлайн-регистрация на рейс', 'Проверить брони и время заезда', 'Скачать офлайн-карты', 'Предупредить банк о поездке', 'Выключить воду и технику дома']],
];
const defaultCheck = () => CHECK0.flatMap(([g, list]) => list.map(t => ({ id: uid(), g, t, d: false })));

/* ---------- состояние ---------- */
let S;
const UI = { tab: 'overview', pf: 'want', pc: 'all', mf: 'all', ce: false };
const blank = () => ({ v: 1, settings: { name: '', budget: 0, lastExport: '' }, items: {}, fm: {}, check: defaultCheck() });
function norm(s) {
  s.settings = Object.assign({ name: '', budget: 0, lastExport: '' }, s.settings);
  s.items = Object.assign({ transport: [], stay: [], car: [], place: [], expense: [], doc: [] }, s.items);
  s.fm = s.fm || {}; s.check = s.check || defaultCheck();
  return s;
}
async function save() { try { await kvSet('state', S); } catch (e) { toast('⚠️ Не удалось сохранить данные'); } }

/* ---------- деньги ---------- */
const paidOf = it => (it.pay === 'paid' ? num(it.amount) : it.pay === 'part' ? Math.min(num(it.paidAmt), num(it.amount)) : 0);
const moneyItems = () => ['transport', 'stay', 'car', 'expense'].flatMap(t => S.items[t].map(it => ({ t, it })));
function totals() {
  let tot = 0, paid = 0;
  moneyItems().forEach(({ it }) => { tot += num(it.amount); paid += paidOf(it); });
  const budget = num(S.settings.budget);
  return { tot, paid, rest: tot - paid, budget, free: budget - tot };
}

/* ---------- файлы ---------- */
const URLS = new Map(), THUMBS = new Map();
const isImg = id => ((S.fm[id] || {}).ty || '').startsWith('image/');
function blobURL(cache, id, data, type) {
  if (!cache.has(id)) cache.set(id, URL.createObjectURL(new Blob([data], { type })));
  return cache.get(id);
}
async function thumbURL(id) {
  if (THUMBS.has(id)) return THUMBS.get(id);
  const r = await fileGet(id); if (!r) return null;
  if (r.thumb) return blobURL(THUMBS, id, r.thumb, 'image/jpeg');
  if ((r.type || '').startsWith('image/')) return blobURL(THUMBS, id, r.data, r.type);
  return null;
}
async function dropFile(id) {
  delete S.fm[id];
  [URLS, THUMBS].forEach(m => { if (m.has(id)) { URL.revokeObjectURL(m.get(id)); m.delete(id); } });
  try { await fileDel(id); } catch (e) { /* ignore */ }
}
function loadImg(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    im.src = u;
  });
}
function scaled(im, max, q) {
  return new Promise(res => {
    const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
    c.toBlob(b => res(b), 'image/jpeg', q);
  });
}
async function ingest(file) {
  const id = uid(); let type = file.type || '', data, thumb = null, name = file.name || 'file';
  if (type.startsWith('image/')) {
    try {
      const im = await loadImg(file);
      const full = await scaled(im, 2000, 0.86);
      const th = await scaled(im, 640, 0.72);
      thumb = await th.arrayBuffer();
      if (full.size < file.size) { data = await full.arrayBuffer(); type = 'image/jpeg'; } else data = await file.arrayBuffer();
    } catch (e) { data = await file.arrayBuffer(); }
  } else data = await file.arrayBuffer();
  await filePut(id, { name, type, data, thumb });
  S.fm[id] = { n: name, ty: type };
  return id;
}
async function hydrate(root = document) {
  await Promise.all($$('img[data-fid]', root).map(async el => { const u = await thumbURL(el.dataset.fid); if (u) el.src = u; }));
}
const ab2b64 = buf => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
const b642ab = s => { const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; };

/* ---------- карточки ---------- */
function payChip(it) {
  if (!num(it.amount) && (it.pay || 'unpaid') === 'unpaid') return '';
  return `<span class="chip ${it.pay || 'unpaid'}">${PAYL[it.pay || 'unpaid']}</span>`;
}
function moneyBlock(t, it) {
  const a = num(it.amount); if (!a && !it.payDate) return '';
  const p = paidOf(it);
  let h = '<div class="money">';
  if (a) h += `<b>${eur(a)}</b>`;
  h += payChip(it);
  if (it.pay === 'part' && a) h += `<span class="mut">внесено ${eur(p)}, осталось ${eur(a - p)}</span>`;
  if (it.payDate) h += `<span class="mut">💳 ${fDate(it.payDate)}</span>`;
  if (a && it.pay !== 'paid') h += `<button class="mini" data-act="paid" data-t="${t}" data-id="${it.id}">✓ Оплачено</button>`;
  return h + '</div>';
}
function mapLinks(q, ll, name) {
  if (!q && !ll) return '';
  const c = (ll || '').replace(/\s/g, '');
  const ap = c ? `https://maps.apple.com/?ll=${encodeURIComponent(c)}&q=${encodeURIComponent(name || q || 'Место')}` : `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
  const go = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c || q)}`;
  return `<div class="links"><a data-act="link" href="${ap}" target="_blank" rel="noopener">🗺 Apple Карты</a><a data-act="link" href="${go}" target="_blank" rel="noopener">📍 Google Maps</a></div>`;
}
function fileChips(t, it) {
  const f = it.files || []; if (!f.length) return '';
  return '<div class="fchips">' + f.map((id, i) => isImg(id)
    ? `<button class="fchip" data-act="file" data-t="${t}" data-id="${it.id}" data-i="${i}"><img data-fid="${id}" alt=""></button>`
    : `<button class="fchip pdf" data-act="file" data-t="${t}" data-id="${it.id}" data-i="${i}">📄 ${esc((S.fm[id] || {}).n || 'файл').slice(0, 18)}</button>`).join('') + '</div>';
}
const noteBlock = it => (it.note ? `<div class="note">${esc(it.note.length > 160 ? it.note.slice(0, 160) + '…' : it.note)}</div>` : '');
const card = (t, it, inner) => `<article class="card" data-act="edit" data-t="${t}" data-id="${it.id}">${inner}</article>`;
const line = (...a) => a.filter(Boolean).join(' · ');

function cardTransport(it) {
  const ic = (TK[it.kind] || TK.other)[0];
  const when = [fDT(it.dep), it.arr ? '→ ' + fDT(it.arr) : ''].filter(Boolean).join(' ');
  const meta = line(it.carrier, it.number, it.code && 'бронь ' + it.code, it.seat);
  return card('transport', it, `<div class="row"><span class="ic">${ic}</span><div class="grow"><div class="t">${esc(titleOf.transport(it))}</div>${when ? `<div class="s">${esc(when)}</div>` : ''}${meta ? `<div class="s">${esc(meta)}</div>` : ''}</div></div>${moneyBlock('transport', it)}${noteBlock(it)}${fileChips('transport', it)}`);
}
function cardStay(it) {
  const n = nightsOf(it);
  const dates = it.checkIn ? `${fDate(it.checkIn, { weekday: 'short', day: 'numeric', month: 'short' })} → ${it.checkOut ? fDate(it.checkOut, { weekday: 'short', day: 'numeric', month: 'short' }) : '?'}${n ? ` · ${n} ноч.` : ''}` : '';
  const meta = line(it.checkInTime, it.code && 'бронь ' + it.code, it.pin && 'PIN ' + it.pin);
  return card('stay', it, `<div class="row"><span class="ic">🛏️</span><div class="grow"><div class="t">${esc(titleOf.stay(it))}</div>${dates ? `<div class="s">${esc(dates)}</div>` : ''}${it.address ? `<div class="s">📍 ${esc(it.address)}</div>` : ''}${meta ? `<div class="s">${esc(meta)}</div>` : ''}${it.cancelBy ? `<div class="s">Бесплатная отмена до ${fDate(it.cancelBy)}</div>` : ''}${it.contact ? `<div class="s">☎️ ${esc(it.contact)}</div>` : ''}</div></div>${moneyBlock('stay', it)}${mapLinks(it.address, it.ll, it.name)}${it.link ? `<div class="links"><a data-act="link" href="${esc(it.link)}" target="_blank" rel="noopener">🔗 Бронь онлайн</a></div>` : ''}${noteBlock(it)}${fileChips('stay', it)}`);
}
function cardCar(it) {
  const a = it.pickDt ? `Получение: ${fDT(it.pickDt)}${it.pickPlace ? ', ' + it.pickPlace : ''}` : it.pickPlace ? 'Получение: ' + it.pickPlace : '';
  const b = it.retDt ? `Возврат: ${fDT(it.retDt)}${it.retPlace ? ', ' + it.retPlace : ''}` : it.retPlace ? 'Возврат: ' + it.retPlace : '';
  const meta = line(it.code && 'бронь ' + it.code, num(it.deposit) ? 'залог ' + eur(num(it.deposit)) : '', it.insurance, it.mileage, it.fuel);
  return card('car', it, `<div class="row"><span class="ic">🚗</span><div class="grow"><div class="t">${esc(titleOf.car(it))}${it.model ? ' · ' + esc(it.model) : ''}</div>${a ? `<div class="s">${esc(a)}</div>` : ''}${b ? `<div class="s">${esc(b)}</div>` : ''}${meta ? `<div class="s">${esc(meta)}</div>` : ''}</div></div>${moneyBlock('car', it)}${noteBlock(it)}${fileChips('car', it)}`);
}
function cardPlace(it) {
  const cover = (it.files || []).find(isImg);
  const c = PC[it.cat] || PC.other;
  const meta = line(it.price !== '' && it.price != null && num(it.price) ? '≈ ' + eur(num(it.price)) : '', it.hours);
  return card('place', it, `${cover ? `<img class="cover" data-fid="${cover}" alt="">` : ''}<div class="row"><span class="ic">${c[0]}</span><div class="grow"><div class="t">${esc(titleOf.place(it))}</div><div class="s">${esc(c[1])} · ${esc(PP[it.prio] || PP[2])}</div>${it.address ? `<div class="s">📍 ${esc(it.address)}</div>` : ''}${meta ? `<div class="s">${esc(meta)}</div>` : ''}</div><span class="chip ${it.status === 'visited' ? 'paid' : it.status === 'skip' ? '' : 'acc'}">${PS[it.status] || PS.want}</span></div>${mapLinks(it.address, it.ll, it.name)}${it.link ? `<div class="links"><a data-act="link" href="${esc(it.link)}" target="_blank" rel="noopener">🔗 Ссылка</a></div>` : ''}${noteBlock(it)}${it.status !== 'visited' ? `<div class="money"><button class="mini" data-act="visit" data-id="${it.id}">✓ Были здесь</button></div>` : ''}`);
}
function rowExpense(t, it) {
  const ic = t === 'expense' ? (EC[it.cat] || EC.other)[0] : t === 'transport' ? (TK[it.kind] || TK.other)[0] : t === 'stay' ? '🛏️' : '🚗';
  const d = t === 'expense' ? it.date : it.payDate;
  return `<div class="ev" data-act="edit" data-t="${t}" data-id="${it.id}"><span class="ic">${ic}</span><div class="grow"><div class="t" style="font-size:16px">${esc(titleOf[t](it))}</div><div class="s">${d ? (t === 'expense' ? '' : '💳 ') + fDate(d) + ' · ' : ''}${payChip(it) || ''}</div></div><b>${eur(num(it.amount))}</b></div>`;
}

/* ---------- страницы ---------- */
const head = (title, sub, right) => `<header class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right || ''}</header>`;
const addBtn = (t, preset) => `<button class="add" data-act="add" data-t="${t}"${preset ? ` data-preset="${esc(JSON.stringify(preset))}"` : ''} aria-label="Добавить">＋</button>`;
const empty = txt => `<div class="empty">${txt}<br>Нажмите «＋», чтобы добавить.</div>`;
function strip(items, extra = '') {
  const tot = items.reduce((s, i) => s + num(i.amount), 0), p = items.reduce((s, i) => s + paidOf(i), 0);
  return `<div class="strip"><div><span>Всего</span><b>${eur(tot)}</b></div><div><span>Оплачено</span><b class="ok">${eur(p)}</b></div><div><span>Осталось</span><b class="${tot - p > 0.004 ? 'warn' : ''}">${eur(tot - p)}</b></div>${extra}</div>`;
}

const SORT = { transport: i => i.dep, stay: i => i.checkIn, car: i => i.pickDt };
const CARD = { transport: cardTransport, stay: cardStay, car: cardCar };
const TITLES = { transport: ['Маршрут', 'Как и куда добираемся'], stay: ['Жильё', 'Где ночуем'], car: ['Авто', 'Аренда машины'] };
const EMPTY = { transport: 'Пока нет перемещений.', stay: 'Пока нет броней жилья.', car: 'Пока нет брони авто.' };
function listView(t) {
  const items = [...S.items[t]].sort(byDate(SORT[t]));
  const nights = t === 'stay' ? `<div><span>Ночей</span><b>${items.reduce((s, i) => s + nightsOf(i), 0)}</b></div>` : '';
  return head(TITLES[t][0], TITLES[t][1], addBtn(t)) + (items.length ? strip(items, nights) + items.map(CARD[t]).join('') : empty(EMPTY[t]));
}

function events() {
  const ev = [];
  S.items.transport.forEach(t => t.dep && ev.push({ d: t.dep, t: 'transport', id: t.id, ic: (TK[t.kind] || TK.other)[0], txt: titleOf.transport(t), sub: line(t.carrier, t.number) }));
  S.items.stay.forEach(s => {
    if (s.checkIn) ev.push({ d: s.checkIn, k: s.checkIn + 'T14:00', t: 'stay', id: s.id, ic: '🛏️', txt: 'Заезд: ' + titleOf.stay(s), sub: line(s.address, s.checkInTime) });
    if (s.checkOut) ev.push({ d: s.checkOut, k: s.checkOut + 'T10:00', t: 'stay', id: s.id, ic: '🚪', txt: 'Выезд: ' + titleOf.stay(s), sub: '' });
  });
  S.items.car.forEach(c => {
    if (c.pickDt) ev.push({ d: c.pickDt, t: 'car', id: c.id, ic: '🚗', txt: 'Получить авто: ' + titleOf.car(c), sub: c.pickPlace || '' });
    if (c.retDt) ev.push({ d: c.retDt, t: 'car', id: c.id, ic: '🔑', txt: 'Вернуть авто: ' + titleOf.car(c), sub: c.retPlace || '' });
  });
  ev.forEach(e => { e.k = e.k || e.d; });
  return ev.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
}
const rel = d => { const n = dayDiff(todayStr(), d); return n === 0 ? 'сегодня' : n === 1 ? 'завтра' : n > 1 ? `через ${n} дн.` : ''; };

function vOverview() {
  const ev = events(), td = todayStr(), T = totals();
  let sub = '';
  if (ev.length) {
    const a = ev[0].d.slice(0, 10), b = ev[ev.length - 1].d.slice(0, 10), k = dayDiff(td, a);
    sub = `${fDate(a)} — ${fDate(b)}` + (k > 0 ? ` · через ${k} дн.` : td <= b ? ` · идёт поездка, день ${dayDiff(a, td) + 1}` : ' · поездка завершена');
  }
  let h = head(S.settings.name || 'Наша поездка', sub);

  const base = Math.max(T.budget, T.tot, 1);
  h += `<div class="hero" data-act="tab" data-tab="money">
    <div class="mut">${T.budget ? 'Бюджет ' + eur(T.budget) : 'Бюджет не задан — нажмите, чтобы открыть «Деньги»'}</div>
    <div class="big">${eur(T.paid)} <span class="mut" style="font-weight:400;font-size:15px">оплачено</span></div>
    <div class="bar ${T.budget && T.tot > T.budget ? 'over' : ''}"><i class="p" style="width:${(T.paid / base) * 100}%"></i><i class="r" style="width:${(Math.max(0, T.rest) / base) * 100}%"></i></div>
    <div class="grid3"><div><span>Осталось оплатить</span><b class="${T.rest > 0.004 ? 'warn' : ''}">${eur(T.rest)}</b></div><div><span>Всего по плану</span><b>${eur(T.tot)}</b></div>${T.budget ? `<div><span>${T.free >= 0 ? 'Свободно' : 'Перерасход'}</span><b class="${T.free >= 0 ? 'ok' : 'bad'}">${eur(Math.abs(T.free))}</b></div>` : ''}</div></div>`;

  const next = ev.find(e => e.d.slice(0, 10) >= td);
  if (next) h += `<h2 class="sec">Ближайшее</h2><div class="ev" data-act="edit" data-t="${next.t}" data-id="${next.id}"><span class="ic">${next.ic}</span><div class="grow"><div class="t">${esc(next.txt)}</div><div class="s">${esc(fDate(next.d, { weekday: 'short', day: 'numeric', month: 'long' }))}${fTime(next.d) ? ', ' + fTime(next.d) : ''}${next.sub ? ' · ' + esc(next.sub) : ''}</div></div><span class="chip acc">${rel(next.d)}</span></div>`;

  const due = moneyItems().filter(({ it }) => it.payDate && it.pay !== 'paid' && num(it.amount)).sort(byDate(x => x.it.payDate)).slice(0, 6);
  if (due.length) h += `<h2 class="sec">Списания и оплаты</h2>` + due.map(({ t, it }) => {
    const late = it.payDate < td;
    return `<div class="ev" data-act="edit" data-t="${t}" data-id="${it.id}"><span class="ic">💳</span><div class="grow"><div class="t" style="font-size:16px">${esc(titleOf[t](it))}</div><div class="s">${fDate(it.payDate)}${late ? ' · дата прошла — проверьте и отметьте оплату' : ''}</div></div><div style="text-align:right"><b>${eur(num(it.amount) - paidOf(it))}</b><br><button class="mini" data-act="paid" data-t="${t}" data-id="${it.id}">✓</button></div></div>`;
  }).join('');

  const ck = S.check, done = ck.filter(c => c.d).length;
  h += `<h2 class="sec">Не забыть</h2><div class="ev" data-act="tab" data-tab="check"><span class="ic">✅</span><div class="grow"><div class="t" style="font-size:16px">Чеклист</div><div class="s">${done} из ${ck.length} готово</div></div><span class="ar mut">›</span></div>`;

  h += `<h2 class="sec">Хронология</h2>`;
  if (!ev.length) h += `<div class="empty">Добавьте перемещения, жильё или авто — здесь появится вся поездка по порядку.</div>`;
  let last = '';
  h += ev.map(e => {
    const day = e.d.slice(0, 10), past = day < td ? ' past' : '';
    const hd = day !== last ? (last = day, `<div class="dh${past}">${esc(fDateW(day))}</div>`) : '';
    return hd + `<div class="ev${past}" data-act="edit" data-t="${e.t}" data-id="${e.id}"><span class="ic">${e.ic}</span><div class="grow"><div class="t" style="font-size:16px">${esc(e.txt)}</div>${e.sub ? `<div class="s">${esc(e.sub)}</div>` : ''}</div>${fTime(e.d) ? `<span class="mut">${fTime(e.d)}</span>` : ''}</div>`;
  }).join('');
  if (!S.settings.lastExport && moneyItems().length + S.items.place.length > 2) h += `<div class="empty" style="padding-top:24px">💾 Сделайте резервную копию: «Ещё» → «Сохранить данные».</div>`;
  return h;
}

function vPlaces() {
  const all = S.items.place;
  const cats = [...new Set(all.map(p => p.cat || 'other'))];
  let items = all.filter(p => UI.pf === 'all' || (p.status || 'want') === UI.pf).filter(p => UI.pc === 'all' || (p.cat || 'other') === UI.pc);
  items.sort((a, b) => num(a.prio || 2) - num(b.prio || 2) || titleOf.place(a).localeCompare(titleOf.place(b), 'ru'));
  const chip = (key, val, label) => `<button class="${UI[key] === val ? 'on' : ''}" data-act="filt" data-key="${key}" data-val="${val}">${label}</button>`;
  return head('Места', 'Что хотим посмотреть', addBtn('place')) +
    `<div class="chips">${chip('pf', 'want', 'Хотим')}${chip('pf', 'visited', 'Были')}${chip('pf', 'all', 'Все')}</div>` +
    (cats.length > 1 ? `<div class="chips">${chip('pc', 'all', 'Все категории')}${cats.map(c => chip('pc', c, (PC[c] || PC.other).join(' '))).join('')}</div>` : '') +
    (items.length ? items.map(cardPlace).join('') : empty(all.length ? 'Ничего не найдено по фильтрам.' : 'Пока нет мест.'));
}

function vMoney() {
  const T = totals(), base = Math.max(T.budget, T.tot, 1);
  let h = head('Деньги', 'Общий бюджет, €', addBtn('expense'));
  h += `<div class="hero" data-act="settings">
    <div class="mut">${T.budget ? 'Бюджет' : 'Задайте бюджет — нажмите здесь'}</div>
    <div class="big">${T.budget ? eur(T.budget) : '—'}</div>
    <div class="bar ${T.budget && T.tot > T.budget ? 'over' : ''}"><i class="p" style="width:${(T.paid / base) * 100}%"></i><i class="r" style="width:${(Math.max(0, T.rest) / base) * 100}%"></i></div>
    <div class="grid3"><div><span>Оплачено</span><b class="ok">${eur(T.paid)}</b></div><div><span>Осталось оплатить</span><b class="${T.rest > 0.004 ? 'warn' : ''}">${eur(T.rest)}</b></div><div><span>${T.free >= 0 || !T.budget ? 'Свободно' : 'Перерасход'}</span><b class="${T.budget ? (T.free >= 0 ? 'ok' : 'bad') : ''}">${T.budget ? eur(Math.abs(T.free)) : '—'}</b></div></div></div>`;
  h += `<div class="chips"><button data-act="add" data-t="expense" data-preset="${esc(JSON.stringify({ title: 'Виза', cat: 'visa' }))}">🛂 + Виза</button><button data-act="add" data-t="expense" data-preset="${esc(JSON.stringify({ title: 'Мелочь', cat: 'other' }))}">🧾 + Мелочь</button><button data-act="add" data-t="expense" data-preset="${esc(JSON.stringify({ title: 'Еда', cat: 'food' }))}">🍽️ + Еда</button></div>`;

  const grp = [['transport', '🧭 Маршрут', S.items.transport], ['stay', '🛏️ Жильё', S.items.stay], ['car', '🚗 Авто', S.items.car]];
  Object.keys(EC).forEach(k => grp.push(['e' + k, EC[k].join(' '), S.items.expense.filter(e => (e.cat || 'other') === k)]));
  const rows = grp.filter(g => g[2].length).map(([, label, arr]) => {
    const tot = arr.reduce((s, i) => s + num(i.amount), 0), p = arr.reduce((s, i) => s + paidOf(i), 0);
    return `<div class="lrow"><span class="grow">${label}</span><span style="text-align:right"><b>${eur(tot)}</b><br><span class="mut">оплачено ${eur(p)}</span></span></div>`;
  });
  if (rows.length) h += `<h2 class="sec">По категориям</h2><div class="list">${rows.join('')}</div>`;

  const chip = (v, l) => `<button class="${UI.mf === v ? 'on' : ''}" data-act="filt" data-key="mf" data-val="${v}">${l}</button>`;
  let list = moneyItems().filter(({ it }) => num(it.amount));
  if (UI.mf === 'open') list = list.filter(({ it }) => it.pay !== 'paid');
  if (UI.mf === 'paid') list = list.filter(({ it }) => it.pay === 'paid');
  list.sort(byDate(({ t, it }) => (t === 'expense' ? it.date : it.payDate) || ''));
  h += `<h2 class="sec">Все платежи</h2><div class="chips">${chip('all', 'Все')}${chip('open', 'Не оплачено')}${chip('paid', 'Оплачено')}</div>`;
  h += list.length ? list.map(({ t, it }) => rowExpense(t, it)).join('') : `<div class="empty">Здесь появятся стоимость броней и ваши расходы (визы, мелочь и т. д.).</div>`;
  return h;
}

function vCheck() {
  const groups = [...new Set(S.check.map(c => c.g))];
  let h = `<a class="back" data-act="tab" data-tab="more">‹ Ещё</a>` + head('Не забыть', `${S.check.filter(c => c.d).length} из ${S.check.length}`, `<button class="mini" data-act="cedit">${UI.ce ? 'Готово' : 'Править'}</button>`);
  groups.forEach(g => {
    const items = S.check.filter(c => c.g === g), n = items.filter(c => c.d).length;
    h += `<div class="gh"><h2>${esc(g)} · ${n}/${items.length}</h2>${UI.ce ? `<button class="mini" style="color:var(--bad);background:var(--bad-bg)" data-act="gdel" data-g="${esc(g)}">Удалить группу</button>` : ''}</div><div class="list">`;
    h += items.map(c => `<div class="ck ${c.d ? 'done' : ''}" data-act="chk" data-id="${c.id}"><span class="box">${c.d ? '✓' : ''}</span><span class="tx">${esc(c.t)}</span>${UI.ce ? `<button class="x" data-act="cdel" data-id="${c.id}">✕</button>` : ''}</div>`).join('');
    h += `<form class="addrow" data-form="addcheck" data-g="${esc(g)}"><input placeholder="Добавить пункт…" enterkeyhint="done"><button>＋</button></form></div>`;
  });
  h += `<div class="gh"><h2>Новая группа</h2></div><div class="list"><form class="addrow" data-form="addgroup"><input placeholder="Название группы…" enterkeyhint="done"><button>＋</button></form></div>`;
  return h;
}

function vDocs() {
  const docs = S.items.doc;
  let h = `<a class="back" data-act="tab" data-tab="more">‹ Ещё</a>` + head('Документы', 'Все файлы под рукой', addBtn('doc'));
  h += docs.length ? docs.map(d => card('doc', d, `<div class="row"><span class="ic">🗂️</span><div class="grow"><div class="t">${esc(titleOf.doc(d))}</div><div class="s">${esc(DK[d.kind] || '')}</div></div></div>${noteBlock(d)}${fileChips('doc', d)}`)).join('') : empty('Паспорта, визы, страховки.');
  const att = [['transport', '🧭'], ['stay', '🛏️'], ['car', '🚗'], ['expense', '🧾']].flatMap(([t, ic]) => S.items[t].filter(i => (i.files || []).length).map(i => ({ t, ic, i })));
  if (att.length) h += `<h2 class="sec">Вложения из броней и расходов</h2>` + att.map(({ t, ic, i }) => `<div class="card static"><div class="row"><span class="ic">${ic}</span><div class="grow"><div class="t" style="font-size:16px">${esc(titleOf[t](i))}</div></div></div>${fileChips(t, i)}</div>`).join('');
  return h;
}

function vMore() {
  const done = S.check.filter(c => c.d).length;
  return head('Ещё') + `<div class="list">
    <button class="lrow" data-act="tab" data-tab="check"><span class="ic">✅</span><span class="grow">Чеклист — что не забыть<br><span class="mut">${done} из ${S.check.length}</span></span><span class="ar">›</span></button>
    <button class="lrow" data-act="tab" data-tab="docs"><span class="ic">🗂️</span><span class="grow">Документы и файлы<br><span class="mut">${S.items.doc.length} док.</span></span><span class="ar">›</span></button></div>
    <h2 class="sec">Настройки</h2><div class="list">
    <button class="lrow" data-act="settings"><span class="ic">⚙️</span><span class="grow">Название поездки и бюджет<br><span class="mut">${esc(S.settings.name || 'Наша поездка')} · ${S.settings.budget ? eur(num(S.settings.budget)) : 'бюджет не задан'}</span></span><span class="ar">›</span></button></div>
    <h2 class="sec">Данные</h2><div class="list">
    <button class="lrow" data-act="export"><span class="ic">💾</span><span class="grow">Сохранить данные в файл<br><span class="mut">${S.settings.lastExport ? 'последний раз: ' + fDate(S.settings.lastExport.slice(0, 10), { day: 'numeric', month: 'long' }) : 'ещё не делали'} · для резерва или передачи</span></span></button>
    <button class="lrow" data-act="import"><span class="ic">📥</span><span class="grow">Загрузить данные из файла<br><span class="mut">заменит данные на этом устройстве</span></span></button>
    <button class="lrow danger" data-act="wipe"><span class="ic">🗑️</span><span class="grow">Удалить все данные</span></button></div>
    <p class="mut" style="margin:14px 4px">Всё хранится только на этом телефоне и работает без интернета. Приложение на главном экране и Safari хранят данные раздельно — вносите данные в приложении с иконки.<br><span id="stor"></span></p>`;
}

const VIEWS = {
  overview: vOverview, transport: () => listView('transport'), stay: () => listView('stay'), car: () => listView('car'),
  place: vPlaces, money: vMoney, more: vMore, check: vCheck, docs: vDocs,
};
const TABS = [['overview', '🏠', 'Обзор'], ['transport', '🧭', 'Маршрут'], ['stay', '🛏️', 'Жильё'], ['car', '🚗', 'Авто'], ['place', '📍', 'Места'], ['money', '💶', 'Деньги'], ['more', '⋯', 'Ещё']];
function renderTabs() {
  const cur = UI.tab === 'check' || UI.tab === 'docs' ? 'more' : UI.tab;
  $('#tabs').innerHTML = TABS.map(([id, ic, l]) => `<button class="${id === cur ? 'on' : ''}" data-act="tab" data-tab="${id}"><span class="i">${ic}</span>${l}</button>`).join('');
}
function render(keep = true) {
  const y = keep ? window.scrollY : 0;
  $('#view').innerHTML = (VIEWS[UI.tab] || VIEWS.overview)();
  renderTabs(); hydrate(); window.scrollTo(0, y);
  if (UI.tab === 'more' && navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(e => { const el = $('#stor'); if (el && e.usage != null) el.textContent = `Занято: ${(e.usage / 1048576).toFixed(1)} МБ.`; }).catch(() => { });
  }
}
function go(tab) { UI.tab = tab; try { localStorage.setItem('tab', tab); } catch (e) { /* ignore */ } render(false); }

/* ---------- форма (нижняя панель) ---------- */
let SHEET = { added: [], discard: false };
async function closeSheet() {
  const s = SHEET; $('#sheet-root').innerHTML = ''; document.body.classList.remove('lock');
  SHEET = { added: [], discard: false };
  if (s.discard) for (const id of s.added) await dropFile(id);
}
function fieldHTML(f, v) {
  if (f.t === 'files') return `<div class="fld"><span class="fl">${esc(f.l)}</span><div class="fedit"></div><button type="button" class="btn ghost" data-pick="1">＋ Добавить фото / PDF</button></div>`;
  const val = v == null ? (f.def == null ? '' : f.def) : v, nm = `name="${f.k}"`;
  let inp;
  if (f.t === 'textarea') inp = `<textarea ${nm} rows="3">${esc(val)}</textarea>`;
  else if (f.t === 'select') inp = `<select ${nm}>${f.o.map(([k, l]) => `<option value="${esc(k)}"${String(k) === String(val) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.t === 'money') inp = `<input ${nm} inputmode="decimal" placeholder="0" value="${esc(val)}">`;
  else if (f.t === 'date') inp = `<input type="date" ${nm} value="${esc(val)}">`;
  else if (f.t === 'datetime') inp = `<input type="datetime-local" ${nm} value="${esc(val)}">`;
  else if (f.t === 'url') inp = `<input type="url" ${nm} placeholder="https://" value="${esc(val)}">`;
  else inp = `<input type="text" ${nm} value="${esc(val)}">`;
  return `<label class="fld" data-f="${f.k}"><span class="fl">${esc(f.l)}</span>${inp}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
}
function openSheet({ title, fields, data = {}, onSave, onDelete }) {
  SHEET = { added: [], discard: true };
  const added = SHEET.added, root = $('#sheet-root');
  let files = [...(data.files || [])];
  root.innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><form class="sheet" novalidate>
    <div class="sheet-h"><button type="button" class="c" data-act="sheet-close">Отмена</button><b>${esc(title)}</b><button type="submit">Готово</button></div>
    <div class="sheet-b">${fields.map(f => fieldHTML(f, data[f.k])).join('')}${onDelete ? '<button type="button" class="btn del" data-del="1">Удалить</button>' : ''}</div></form>`;
  document.body.classList.add('lock');
  const form = $('form', root), fedit = $('.fedit', form);
  const upd = () => fields.forEach(f => { if (f.show) { const w = $(`[data-f="${f.k}"]`, form); if (w) w.hidden = form.elements[f.show[0]].value !== f.show[1]; } });
  upd(); form.addEventListener('change', upd);
  const drawFiles = () => {
    if (!fedit) return;
    fedit.innerHTML = files.map((id, i) => `<div class="th">${isImg(id) ? `<img data-fid="${id}" alt="">` : '📄<br>' + esc(((S.fm[id] || {}).n || 'файл').slice(0, 14))}<button type="button" data-rm="${i}">✕</button></div>`).join('');
    hydrate(fedit);
  };
  drawFiles();
  if (fedit) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,application/pdf'; inp.hidden = true; form.appendChild(inp);
    $('[data-pick]', form).addEventListener('click', () => inp.click());
    inp.addEventListener('change', async () => {
      const list = [...inp.files]; inp.value = ''; if (!list.length) return;
      toast('Обрабатываю файлы…');
      for (const f of list) { try { const id = await ingest(f); files.push(id); added.push(id); drawFiles(); } catch (e) { toast('Не удалось добавить файл'); } }
      toast('Файлы добавлены');
    });
    fedit.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(+b.dataset.rm, 1); drawFiles(); } });
  }
  const del = $('[data-del]', form);
  if (del) del.addEventListener('click', async () => { if ((await onDelete()) !== false) closeSheet(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const out = Object.assign({}, data);
    for (const f of fields) {
      if (f.t === 'files') continue;
      let v = (form.elements[f.k].value || '').trim();
      if (f.t === 'money') v = v === '' ? '' : num(v);
      out[f.k] = v;
    }
    if (fedit) {
      out.files = files;
      for (const id of (data.files || []).filter(x => !files.includes(x))) await dropFile(id);
    }
    await onSave(out);
    SHEET.discard = false; closeSheet();
  });
}
function openItem(type, id, preset) {
  const T = TYPES[type], cur = id ? S.items[type].find(x => x.id === id) : null;
  const base = cur || Object.assign({ id: uid() }, T.defaults || {}, type === 'expense' ? { date: todayStr() } : {}, preset || {});
  openSheet({
    title: (cur ? 'Изменить: ' : 'Новое: ') + T.label.toLowerCase(), fields: T.fields, data: base,
    onSave: async o => {
      const arr = S.items[type], i = arr.findIndex(x => x.id === o.id);
      if (i >= 0) arr[i] = o; else arr.push(o);
      await save(); render();
    },
    onDelete: cur ? async () => {
      if (!confirm('Удалить запись?')) return false;
      for (const f of cur.files || []) await dropFile(f);
      S.items[type] = S.items[type].filter(x => x.id !== id);
      await save(); render(); return true;
    } : null,
  });
}
function openSettings() {
  openSheet({
    title: 'Настройки', data: { name: S.settings.name, budget: S.settings.budget || '' },
    fields: [{ k: 'name', l: 'Название поездки', t: 'text' }, { k: 'budget', l: 'Общий бюджет, €', t: 'money' }],
    onSave: async o => { S.settings.name = o.name; S.settings.budget = num(o.budget); await save(); render(); },
  });
}

/* ---------- просмотр файлов ---------- */
async function showViewer() {
  const { ids, i } = UI.viewer, id = ids[i], v = $('#viewer');
  const rec = await fileGet(id);
  if (!rec) { v.innerHTML = `<div class="vbar"><button data-act="vclose">✕</button></div><div class="vbody">Файл не найден</div>`; return; }
  const url = blobURL(URLS, id, rec.data, rec.type);
  UI.viewer.file = new File([rec.data], rec.name || 'file', { type: rec.type });
  const pdf = rec.type === 'application/pdf';
  v.innerHTML = `<div class="vbar"><button data-act="vclose">✕</button><span class="vname">${esc(rec.name || '')}</span><button data-act="vshare">⤴︎</button></div>
    <div class="vbody">${pdf ? `<iframe src="${url}"></iframe><a class="btn" data-act="link" href="${url}" target="_blank">Открыть PDF отдельно</a>` : `<img src="${url}" alt="">`}</div>
    ${ids.length > 1 ? `<div class="vnav"><button data-act="vprev">‹</button><span>${i + 1} / ${ids.length}</span><button data-act="vnext">›</button></div>` : ''}`;
}
function openViewer(ids, i) { UI.viewer = { ids, i }; $('#viewer').hidden = false; document.body.classList.add('lock'); showViewer(); }

/* ---------- экспорт / импорт ---------- */
async function exportData() {
  toast('Готовлю файл…');
  const ids = new Set(); Object.values(S.items).flat().forEach(it => (it.files || []).forEach(f => ids.add(f)));
  const files = {};
  for (const id of ids) {
    const r = await fileGet(id);
    if (r) files[id] = { name: r.name, type: r.type, data: ab2b64(r.data), thumb: r.thumb ? ab2b64(r.thumb) : null };
  }
  S.settings.lastExport = new Date().toISOString(); await save();
  const json = JSON.stringify({ app: 'trip-app', v: 1, exported: S.settings.lastExport, state: S, files });
  const name = `trip-backup-${todayStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const url = URL.createObjectURL(file);
  UI.exportFile = file;
  await closeSheet(); SHEET = { added: [], discard: false };
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet dialog"><h3>Файл готов</h3><div class="mut">${(json.length / 1048576).toFixed(1)} МБ · ${esc(name)}<br>Отправьте его себе или второму человеку (AirDrop, Telegram, почта), либо сохраните в «Файлы».</div>
    <button class="btn" data-act="share-export">Поделиться…</button><a class="btn ghost" data-act="link" href="${url}" download="${name}">Сохранить в «Файлы»</a><button class="btn ghost" data-act="sheet-close">Закрыть</button></div>`;
  document.body.classList.add('lock'); render();
}
async function importData(file) {
  let p; try { p = JSON.parse(await file.text()); } catch (e) { return toast('Не удалось прочитать файл'); }
  if (!p || p.app !== 'trip-app' || !p.state) return toast('Это не файл данных приложения');
  if (!confirm('Заменить все данные на этом устройстве данными из файла?')) return;
  toast('Загружаю…');
  await filesClear(); URLS.clear(); THUMBS.clear();
  for (const [id, r] of Object.entries(p.files || {})) await filePut(id, { name: r.name, type: r.type, data: b642ab(r.data), thumb: r.thumb ? b642ab(r.thumb) : null });
  S = norm(p.state); await save(); render(false); toast('Данные загружены ✓');
}

/* ---------- события ---------- */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const d = el.dataset, find = () => S.items[d.t].find(x => x.id === d.id);
  switch (d.act) {
    case 'link': return;
    case 'tab': return go(d.tab);
    case 'add': return openItem(d.t, null, d.preset ? JSON.parse(d.preset) : null);
    case 'edit': return openItem(d.t, d.id);
    case 'settings': return openSettings();
    case 'sheet-close': return closeSheet();
    case 'filt': UI[d.key] = d.val; return render();
    case 'paid': { const it = find(); if (it) { it.pay = 'paid'; await save(); render(); toast('Отмечено как оплачено ✓'); } return; }
    case 'visit': { const it = S.items.place.find(x => x.id === d.id); if (it) { it.status = 'visited'; await save(); render(); } return; }
    case 'file': { const it = find(); if (it) openViewer(it.files, +d.i); return; }
    case 'vclose': $('#viewer').hidden = true; $('#viewer').innerHTML = ''; document.body.classList.remove('lock'); return;
    case 'vprev': UI.viewer.i = (UI.viewer.i + UI.viewer.ids.length - 1) % UI.viewer.ids.length; return showViewer();
    case 'vnext': UI.viewer.i = (UI.viewer.i + 1) % UI.viewer.ids.length; return showViewer();
    case 'vshare': {
      const f = UI.viewer && UI.viewer.file;
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f] }).catch(() => { });
      else toast('Поделиться этим файлом нельзя');
      return;
    }
    case 'chk': { const c = S.check.find(x => x.id === d.id); if (c) { c.d = !c.d; await save(); render(); } return; }
    case 'cdel': { S.check = S.check.filter(x => x.id !== d.id); await save(); render(); return; }
    case 'gdel': { if (confirm(`Удалить группу «${d.g}» со всеми пунктами?`)) { S.check = S.check.filter(x => x.g !== d.g); await save(); render(); } return; }
    case 'cedit': UI.ce = !UI.ce; return render();
    case 'export': return exportData();
    case 'share-export': {
      const f = UI.exportFile;
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: 'Данные поездки' }).catch(() => { });
      else toast('Используйте «Сохранить в Файлы»');
      return;
    }
    case 'import': {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => inp.files[0] && importData(inp.files[0]); inp.click(); return;
    }
    case 'wipe': {
      if (!confirm('Удалить ВСЕ данные и файлы на этом устройстве?')) return;
      if (!confirm('Точно? Это нельзя отменить.')) return;
      await filesClear(); URLS.clear(); THUMBS.clear(); S = norm(blank()); await save(); render(false); toast('Всё удалено'); return;
    }
  }
});
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-form]'); if (!f) return;
  e.preventDefault();
  const inp = $('input', f), v = inp.value.trim(); if (!v) return;
  let focusG;
  if (f.dataset.form === 'addcheck') { S.check.push({ id: uid(), g: f.dataset.g, t: v, d: false }); focusG = f.dataset.g; }
  else { S.check.push({ id: uid(), g: v, t: 'Первый пункт', d: false }); }
  await save(); render();
  if (focusG) { const el = $$('form[data-form="addcheck"]').find(x => x.dataset.g === focusG); if (el) $('input', el).focus(); }
});

/* ---------- запуск ---------- */
(async function init() {
  try { S = (await kvGet('state')) || blank(); } catch (e) { S = blank(); toast('⚠️ Хранилище недоступно'); }
  norm(S);
  try { const t = localStorage.getItem('tab'); if (t && VIEWS[t]) UI.tab = t; } catch (e) { /* ignore */ }
  render(false);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
