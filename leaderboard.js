/* Public pseudonyms and best scores. The publishable key is intentionally public.
   RLS/RPC protect other users' records; browser-calculated scores are not anti-cheat. */
(() => {
  'use strict';
  const BASE = 'https://huvfhrvrmvfpclifeveg.supabase.co';
  const APIKEY = 'sb_publishable_r-mNFnjIdVun4Mg5v8W4lw_Lg_Htrv4';
  const KEY = 'wood-online-huvfhrvrmvfpclifeveg-v1';
  const MAX = 1000000000;
  const validScore = n => Number.isSafeInteger(n) && n >= 0 && n <= MAX;
  const validId = s => typeof s === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s);
  const cleanName = s => String(s).trim().replace(/\s+/g, ' ');
  const validName = s => [...s].length >= 2 && [...s].length <= 24 && /^[\p{L}\p{N} _-]+$/u.test(s);
  let data = {session:null, profile:null, pending:0, guest:false};
  let storageOK = true, authJob = null, registerJob = null, sendJob = null, timer = null;
  let retryDelay = 2000, rankingRequest = 0, mode = 'name', returnFocus = null;
  let automaticSendBlocked = false;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      data.guest = raw.guest === true;
      const s = raw.session;
      if (s && validId(s.user?.id) && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && Number.isFinite(s.expires_at)) {
        data.session = s;
        if (raw.profile && raw.profile.player_id === s.user.id && validName(raw.profile.display_name) && validScore(raw.profile.best_score)) {
          data.profile = raw.profile;
          data.pending = validScore(raw.pending) ? raw.pending : 0;
        }
      }
    }
  } catch (_) { storageOK = false; }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); storageOK = true; }
    catch (_) { storageOK = false; }
  }
  function el(tag, text, className) {
    const n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (className) n.className = className;
    return n;
  }
  function button(text, fn, className) {
    const n = el('button', text, className); n.type = 'button'; n.addEventListener('click', fn); return n;
  }
  function errMessage(error) {
    if (!navigator.onLine) return 'Нет интернета. Игра работает офлайн; рекорд отправится после подключения.';
    if (error.code === 'session') return 'Не удалось восстановить профиль. Проверьте подключение и повторите. Данные профиля не удалены.';
    if (error.status === 429) return 'Слишком много запросов. Подождите немного и повторите.';
    if (error.status === 400 || error.status === 422) return 'Сервис отклонил данные. Проверьте имя и повторите.';
    return 'Сервис рекордов временно недоступен. Попробуйте позже; партия сохранена на устройстве.';
  }
  function stopAutomaticSend(error) {
    if (error.code === 'session' || [400, 403, 422].includes(error.status)) {
      automaticSendBlocked = true;
      clearTimeout(timer); timer = null;
    }
  }
  function allowRetry() {
    automaticSendBlocked = false; retryDelay = 2000;
    clearTimeout(timer); timer = null;
  }
  async function request(path, body, token) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    try {
      const headers = {apikey:APIKEY, 'Content-Type':'application/json'};
      if (token) headers.Authorization = 'Bearer ' + token;
      const r = await fetch(BASE + path, {method:body === undefined ? 'GET':'POST', headers, body:body === undefined ? undefined:JSON.stringify(body), signal:ctrl.signal, cache:'no-store', credentials:'omit'});
      if (!r.ok) { const error = new Error('Backend request failed'); error.status = r.status; throw error; }
      return await r.json();
    } finally { clearTimeout(timeout); }
  }
  async function auth() {
    if (data.session && data.session.expires_at > Date.now()/1000 + 60) return data.session;
    if (authJob) return authJob;
    authJob = (async () => {
      const previous = data.session;
      let s;
      try {
        s = previous
          ? await request('/auth/v1/token?grant_type=refresh_token', {refresh_token:previous.refresh_token})
          : await request('/auth/v1/signup', {});
      } catch (e) {
        if (previous && (e.status === 400 || e.status === 401)) e.code = 'session';
        stopAutomaticSend(e);
        throw e; // Never replace an existing identity after a failed refresh.
      }
      if (!s?.access_token || !s.refresh_token || !validId(s.user?.id) || (previous && s.user.id !== previous.user.id)) throw new Error('Invalid auth response');
      data.session = {access_token:s.access_token, refresh_token:s.refresh_token, user:{id:s.user.id}, expires_at:s.expires_at || Date.now()/1000 + s.expires_in};
      if (!Number.isFinite(data.session.expires_at)) throw new Error('Invalid session expiry');
      save(); return data.session;
    })();
    try { return await authJob; } finally { authJob = null; }
  }
  async function rpc(name, body) {
    let s = await auth();
    try { return await request('/rest/v1/rpc/' + name, body, s.access_token); }
    catch (e) {
      if (e.status !== 401) throw e;
      data.session.expires_at = 0;
      s = await auth();
      return request('/rest/v1/rpc/' + name, body, s.access_token);
    }
  }
  function checkRow(row) {
    if (!row || !validId(row.player_id) || row.player_id !== data.session?.user.id || !validName(row.display_name) || !validScore(row.best_score)) throw new Error('Invalid player response');
    return {player_id:row.player_id, display_name:row.display_name, best_score:row.best_score};
  }
  const trophy = button('🏆', () => open('ranking'), 'icon wood-ranking-button');
  trophy.id = 'leaderboard'; trophy.setAttribute('aria-label', 'Общая таблица рекордов'); trophy.title = 'Рекорды игроков';
  document.querySelector('.tools')?.append(trophy);
  const dialog = el('dialog', null, 'wood-online-dialog'); dialog.id = 'wood-online-dialog';
  dialog.setAttribute('aria-labelledby', 'wood-online-title');
  const title = el('h2', '', 'wood-online-title'); title.id = 'wood-online-title';
  const body = el('div', null, 'wood-online-body');
  const message = el('p', '', 'wood-online-message'); message.id = 'wood-online-message'; message.setAttribute('role','status'); message.setAttribute('aria-live','polite');
  const actions = el('div', null, 'wood-online-actions');
  dialog.append(title, body, message, actions); document.body.append(dialog);
  let appWasInert = false;
  function close() {
    rankingRequest++;
    dialog.close();
  }
  dialog.addEventListener('close', () => {
    document.querySelector('.app').inert = appWasInert;
    returnFocus?.focus();
  });
  dialog.addEventListener('cancel', () => { if (!data.profile) { data.guest = true; save(); } });
  dialog.addEventListener('keydown', e => { e.stopPropagation(); });
  function setMessage(text) { message.textContent = text; }
  function updateButton() {
    trophy.title = data.profile ? 'Рекорды · ' + data.profile.display_name : 'Рекорды игроков';
    trophy.setAttribute('aria-label', trophy.title);
  }
  function open(nextMode = 'ranking') {
    mode = nextMode; rankingRequest++; title.textContent = mode === 'name' ? (data.profile ? 'Ваш псевдоним':'Добро пожаловать') : 'Рекорды мастерской';
    body.replaceChildren(); actions.replaceChildren(); setMessage('');
    if (!dialog.open) {
      returnFocus = document.activeElement;
      appWasInert = document.querySelector('.app').inert;
      document.querySelector('.app').inert = true;
      dialog.showModal();
    }
    if (mode === 'name') renderName(); else renderRanking();
  }
  function renderName() {
    body.append(el('p', 'Представьтесь, чтобы участвовать в общей таблице рекордов. Без почты и пароля.'));
    const form = el('form'); form.id = 'wood-name-form';
    const label = el('label', 'Имя игрока'); label.htmlFor = 'wood-player-name';
    const input = el('input'); input.id = 'wood-player-name'; input.name = 'playerName'; input.type = 'text'; input.maxLength = 48; input.autocomplete = 'nickname'; input.required = true; input.placeholder = 'Например, Лесной мастер'; input.value = data.profile?.display_name || ''; input.setAttribute('aria-describedby','wood-name-hint wood-online-message');
    const hint = el('p', '2–24 буквы или цифры, пробелы, _ и -. Имя видно всем: не указывайте телефон или почту.', 'wood-online-small'); hint.id = 'wood-name-hint';
    const submit = el('button', data.profile ? 'Сохранить имя':'Войти в мастерскую', 'wood-online-primary'); submit.type = 'submit'; submit.id = 'wood-name-submit';
    form.append(label,input,hint,submit);
    form.addEventListener('submit', async e => {
      e.preventDefault(); const name = cleanName(input.value);
      if (!validName(name)) { setMessage('Введите имя из 2–24 букв или цифр, пробелов, _ и -.'); input.focus(); return; }
      submit.disabled = true; setMessage('Подключаем профиль…');
      try { await register(name); if (dialog.open) open('ranking'); }
      catch (error) { setMessage(errMessage(error)); }
      finally { submit.disabled = false; }
    });
    body.append(form,el('p','Профиль привязан к этому браузеру. На другом устройстве или после удаления данных появится новый профиль. Совпадающие имена — разные игроки.','wood-online-small'));
    actions.append(button(data.profile ? 'Назад к рекордам':'Играть без регистрации', () => {
      if (data.profile) open('ranking'); else { data.guest = true; save(); close(); }
    }));
    input.focus();
  }
  async function register(name) {
    name = cleanName(name);
    if (!validName(name)) { const e = new Error('Invalid name'); e.status = 400; throw e; }
    if (registerJob) return registerJob;
    allowRetry();
    registerJob = (async () => {
      const row = checkRow(await rpc('register_player', {p_name:name}));
      if (data.profile?.player_id === row.player_id) row.best_score = Math.max(data.profile.best_score, row.best_score);
      data.profile = row; data.guest = false; save(); updateButton();
      scheduleSend(0);
      return row;
    })();
    try { return await registerJob; }
    catch (error) { stopAutomaticSend(error); throw error; }
    finally { registerJob = null; }
  }
  function renderRanking() {
    const who = el('p', data.profile ? 'Вы: ' + data.profile.display_name : 'Вы играете как гость', 'wood-online-profile');
    body.append(who);
    if (data.profile) body.append(el('p', 'Ваш онлайн-рекорд: ' + data.profile.best_score.toLocaleString('ru-RU'), 'wood-online-small'));
    const table = el('table', null, 'wood-ranking-table'); table.id = 'wood-ranking-table';
    const caption = el('caption','Лучшие 50 игроков'); table.append(caption);
    const header = el('thead'), row = el('tr');
    for (const text of ['Место','Игрок','Очки']) { const th = el('th',text); th.scope = 'col'; row.append(th); }
    header.append(row); const rows = el('tbody'); table.append(header,rows); body.append(table);
    actions.append(button(data.profile ? 'Изменить имя':'Войти по имени', () => open('name')),button('Обновить', () => { allowRetry(); open('ranking'); }),button('К игре',close,'wood-online-primary'));
    body.append(el('p', 'Публичный рейтинг без серверного античита. Имя — псевдоним, не защищённый логин.', 'wood-online-small'));
    if (!storageOK) body.append(el('p','Хранение в браузере недоступно: профиль может потеряться после закрытия страницы.','wood-online-small'));
    const id = ++rankingRequest;
    setMessage(navigator.onLine ? 'Загружаем рекорды…':'Нет интернета. Таблица доступна после подключения.');
    request('/rest/v1/wood_leaderboard?select=player_id,display_name,best_score&order=best_score.desc,updated_at.asc,player_id.asc&limit=50').then(list => {
      if (id !== rankingRequest || !dialog.open) return;
      if (!Array.isArray(list) || list.length > 50 || list.some(r => !validId(r.player_id) || typeof r.display_name !== 'string' || !validScore(r.best_score))) throw new Error('Invalid ranking response');
      list.forEach((entry, i) => {
        const tr = el('tr');
        if (entry.player_id === data.profile?.player_id) tr.className = 'wood-ranking-me';
        tr.append(el('td', String(i+1)),el('td',entry.display_name),el('td',entry.best_score.toLocaleString('ru-RU'))); rows.append(tr);
      });
      setMessage(list.length ? (data.pending > (data.profile?.best_score || 0) ? 'Новый рекорд ожидает отправки.':'Рекорды обновлены.') : 'Пока нет рекордов. Станьте первым!');
    }).catch(error => { if (id === rankingRequest && dialog.open) setMessage(errMessage(error)); });
    if (data.profile) scheduleSend(0);
  }
  function reportScore(score) {
    if (!data.profile || !validScore(score) || score <= Math.max(data.pending, data.profile.best_score)) return;
    data.pending = score; save(); scheduleSend(1000);
  }
  function scheduleSend(delay) {
    if (automaticSendBlocked || !data.profile || data.pending <= data.profile.best_score || !navigator.onLine) return;
    clearTimeout(timer); timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, delay);
  }
  async function flush() {
    if (sendJob) return sendJob;
    if (automaticSendBlocked || !data.profile || data.pending <= data.profile.best_score || !navigator.onLine) return;
    const sent = data.pending;
    sendJob = (async () => {
      try {
        const row = checkRow(await rpc('submit_score', {p_score:sent}));
        data.profile.best_score = Math.max(data.profile.best_score,row.best_score);
        if (data.pending <= data.profile.best_score) data.pending = 0;
        save(); retryDelay = 2000;
        if (dialog.open && mode === 'ranking') setMessage('Ваш рекорд сохранён. Нажмите «Обновить», чтобы увидеть место.');
      } catch (error) {
        if (dialog.open) setMessage(errMessage(error));
        // Retain the UID-associated pending score, including after refresh failure.
        stopAutomaticSend(error);
        if (!automaticSendBlocked) retryDelay = Math.min(retryDelay * 2, 60000);
      }
    })();
    try { await sendJob; } finally {
      sendJob = null;
      if (!timer && data.pending > data.profile.best_score) scheduleSend(retryDelay);
    }
  }
  window.addEventListener('wood-score', event => reportScore(event.detail?.score));
  window.addEventListener('online', () => { allowRetry(); scheduleSend(0); if (dialog.open && mode === 'ranking') open('ranking'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleSend(0); });
  window.WoodLeaderboard = Object.freeze({open, register, reportScore});
  updateButton(); scheduleSend(0);
  if (!data.profile && !data.guest) open('name');
})();
