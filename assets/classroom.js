/* Group Live Classroom (Portal.gs 2.9) — the chat screen of ONE classroom per group, used by the group page (students)
   and the Teacher Dashboard (teachers). It talks to Code.gs's own Live Classroom engine (delta sync, replies, reactions,
   pins, announcements, files in 2 MB chunks, read state) through the platform, which checks every request.
   No secrets are in this file. */
(function () {
  'use strict';
  var REACTIONS = ['👍', '❤️', '😂', '❓', '👏'];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function $(s, r) { return (r || document).querySelector(s); }
  function linkify(text) {
    return esc(text).replace(/(https:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g, '<br>');
  }
  function fmtBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(1) + ' MB'; }
  function b64(blob) { return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1] || ''); }; fr.onerror = function () { rej(fr.error); }; fr.readAsDataURL(blob); }); }
  /** A small JPEG preview of a picture (the engine keeps it with the file, max ~30 000 characters). */
  function preview(file) {
    return new Promise(function (res) {
      if (!/^image\/(png|jpe?g|gif|webp|bmp)$/i.test(file.type) || file.size > 15 * 1048576) return res(null);
      var img = new Image(), fr = new FileReader();   // a data: address (the page's security policy does not allow blob: pictures)
      img.onload = function () {
        var s = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var q = 0.8, d = c.toDataURL('image/jpeg', q); while (d.length > 29000 && q > 0.3) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
        res(d.length <= 29000 ? { preview: d, w: img.width, h: img.height } : { w: img.width, h: img.height });
      };
      img.onerror = function () { res(null); };
      fr.onload = function () { img.src = String(fr.result); }; fr.onerror = function () { res(null); };
      fr.readAsDataURL(file);
    });
  }

  /** cfg: { call(action, o) → Promise, me: {role, name, participantId}, title, lecture, timeZone, onBack(), onAuthLost() → Promise<boolean> } */
  function mount(host, cfg) {
    var tz = cfg.timeZone || undefined, msgs = {}, order = [], seq = 0, readVer = '', timer = null, stopped = false, hasMore = false, replyTo = null, pending = [], lastRead = 0;
    var tfmt = function (t) { try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(t)); } catch (e) { return new Date(t).toLocaleString(); } };
    var teacher = cfg.me.role === 'teacher';
    host.innerHTML = '';
    var root = h('<section class="lc" aria-label="Live Classroom">' +
      '<div class="lc-head"><button class="btn" type="button" data-a="back">← Back</button><div class="lc-ttl"><b>💬 ' + esc(cfg.title) + '</b><div class="small muted lc-on">Connecting…</div></div></div>' +
      (cfg.lecture ? '<div class="lc-lect">🔴 Live lecture: <b>' + esc(cfg.lecture.title) + '</b> — ' + esc(cfg.lecture.icon + ' ' + cfg.lecture.module) + (cfg.lecture.teacher ? ' · ' + esc(cfg.lecture.teacher) : '') + '</div>' : '') +
      '<div class="lc-pins" hidden></div>' +
      '<div class="lc-list" role="log" aria-live="polite"><div class="lc-more" hidden><button class="btn small" type="button">Load earlier messages</button></div><div class="lc-msgs"></div><p class="muted small lc-empty" hidden>No messages yet — say hello!</p></div>' +
      '<div class="lc-typing small muted"></div>' +
      '<form class="lc-form" novalidate><div class="lc-reply" hidden></div><div class="lc-files"></div>' +
      '<textarea rows="2" maxlength="4000" placeholder="' + (teacher ? 'Message the class…' : 'Message the class and your teacher…') + '" aria-label="Message"></textarea>' +
      '<div class="lc-row"><label class="btn small lc-att" title="Attach files (max 50 MB each)">📎 Attach<input type="file" multiple hidden></label>' +
      (teacher ? '<label class="chk small"><input type="checkbox" data-k="ann"> 📢 Announcement</label>' : '') +
      '<span class="err small" role="alert"></span><button class="btn primary" type="submit">Send</button></div></form></section>');
    host.appendChild(root);
    var list = $('.lc-list', root), box = $('.lc-msgs', root), ta = $('textarea', root), form = $('.lc-form', root), err = $('.err', form);
    $('[data-a=back]', root).onclick = function () { stop(); cfg.onBack(); };
    $('.lc-more button', root).onclick = loadEarlier;

    function stop() { stopped = true; if (timer) clearTimeout(timer); }
    function alive() { return !stopped && root.isConnected; }
    function call(action, o) {
      return cfg.call(action, o || {}).then(function (r) {
        if (r && r.code === 'auth' && cfg.onAuthLost) return cfg.onAuthLost().then(function (ok) { return ok ? cfg.call(action, o || {}) : r; });
        return r;
      });
    }
    function upsert(m) {
      if (m.deleted) { if (msgs[m.id]) { delete msgs[m.id]; order = order.filter(function (x) { return x !== m.id; }); } return; }
      if (!msgs[m.id]) order.push(m.id);
      msgs[m.id] = m;
    }
    function sortOrder() { order.sort(function (a, b) { var x = msgs[a], y = msgs[b]; return (x.ord || 0) - (y.ord || 0) || x.createdAt - y.createdAt; }); }
    function draw(stick) {
      var atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      sortOrder();
      box.innerHTML = '';
      order.forEach(function (id) { box.appendChild(msgEl(msgs[id])); });
      $('.lc-empty', root).hidden = order.length > 0;
      $('.lc-more', root).hidden = !hasMore;
      var pins = order.map(function (id) { return msgs[id]; }).filter(function (m) { return m.pinned; }), pb = $('.lc-pins', root);
      pb.hidden = !pins.length;
      pb.innerHTML = pins.length ? '📌 ' + pins.map(function (m) { return '<button type="button" class="lc-pin" data-id="' + esc(m.id) + '">' + esc((m.body || (m.attachments[0] || {}).name || '').slice(0, 80)) + '</button>'; }).join(' ') : '';
      Array.prototype.forEach.call(pb.querySelectorAll('.lc-pin'), function (b) { b.onclick = function () { var e = box.querySelector('[data-id="' + b.dataset.id + '"]'); if (e) { e.scrollIntoView({ block: 'center' }); e.classList.add('lc-hl'); setTimeout(function () { e.classList.remove('lc-hl'); }, 1500); } }; });
      if (stick || atBottom) list.scrollTop = list.scrollHeight;
    }
    function mine(m) { return teacher ? m.authorRole === 'teacher' : m.participantId === cfg.me.participantId; }
    function msgEl(m) {
      var parent = m.replyToId ? msgs[m.replyToId] : null;
      var el = h('<div class="lc-m' + (m.authorRole === 'teacher' ? ' t' : '') + (m.kind === 'announcement' ? ' ann' : '') + (mine(m) ? ' me' : '') + '" data-id="' + esc(m.id) + '">' +
        '<div class="lc-mh"><b>' + esc(m.authorName) + '</b>' + (m.authorRole === 'teacher' ? ' <span class="lc-badge">Teacher</span>' : '') + (m.kind === 'announcement' ? ' <span class="lc-badge ann">📢 Announcement</span>' : '') +
        (m.pinned ? ' 📌' : '') + ' <span class="small muted">' + esc(tfmt(m.createdAt)) + (m.edited ? ' · edited' : '') + '</span></div>' +
        (m.replyToId ? '<div class="lc-q small">↩ ' + (parent ? '<b>' + esc(parent.authorName) + '</b>: ' + esc(String(parent.body || '').slice(0, 120)) : 'a reply') + '</div>' : '') +
        (m.body ? '<div class="lc-b">' + linkify(m.body) + '</div>' : '') + '<div class="lc-atts"></div>' +
        '<div class="lc-rx"></div><div class="lc-acts"><button type="button" data-a="reply">Reply</button><button type="button" data-a="react">React</button>' +
        (teacher ? '<button type="button" data-a="pin">' + (m.pinned ? 'Unpin' : 'Pin') + '</button>' : '') + (mine(m) || teacher ? '<button type="button" data-a="del">Delete</button>' : '') + '</div></div>');
      (m.attachments || []).forEach(function (a) {
        var x = a.kind === 'image' && a.preview ? h('<button type="button" class="lc-img" title="Open ' + esc(a.name) + '"><img alt="' + esc(a.name) + '" src="' + esc(a.preview) + '"></button>')
          : h('<button type="button" class="btn small lc-file">⬇ ' + esc(a.name) + ' <span class="muted">(' + fmtBytes(a.size || 0) + ')</span></button>');
        x.onclick = function () { download(a, x); };
        $('.lc-atts', el).appendChild(x);
      });
      var rx = m.reactions || {}, my = (m.reactors || {})[teacher ? '__teacher__' : cfg.me.participantId];
      Object.keys(rx).forEach(function (e) { var b = h('<button type="button" class="lc-chip' + (my === e ? ' on' : '') + '">' + esc(e) + ' ' + rx[e] + '</button>'); b.onclick = function () { react(m, e); }; $('.lc-rx', el).appendChild(b); });
      $('[data-a=reply]', el).onclick = function () { replyTo = m; showReply(); ta.focus(); };
      $('[data-a=react]', el).onclick = function () {
        var cur = $('.lc-pick', el); if (cur) { cur.remove(); return; }
        var pk = h('<span class="lc-pick">' + REACTIONS.map(function (e) { return '<button type="button">' + e + '</button>'; }).join('') + '</span>');
        Array.prototype.forEach.call(pk.querySelectorAll('button'), function (b) { b.onclick = function () { pk.remove(); react(m, b.textContent); }; });
        $('.lc-acts', el).appendChild(pk);
      };
      var pin = $('[data-a=pin]', el); if (pin) pin.onclick = function () { call('livePin', { id: m.id, pinned: !m.pinned }).then(done); };
      var del = $('[data-a=del]', el); if (del) del.onclick = function () { if (window.confirm('Delete this message for everyone?')) call('liveDelete', { id: m.id }).then(done); };
      return el;
    }
    function done(r) { if (!r.ok) return note(r.error); if (r.message) { upsert(r.message); draw(); } }
    function react(m, e) { call('liveReact', { id: m.id, reaction: e }).then(done); }
    function note(t) { err.textContent = t || ''; if (t) setTimeout(function () { if (err.textContent === t) err.textContent = ''; }, 6000); }
    function showReply() {
      var r = $('.lc-reply', form);
      if (!replyTo) { r.hidden = true; r.innerHTML = ''; return; }
      r.hidden = false; r.innerHTML = '↩ Replying to <b>' + esc(replyTo.authorName) + '</b>: ' + esc(String(replyTo.body || '').slice(0, 80)) + ' <button type="button" class="btn small">✕</button>';
      $('button', r).onclick = function () { replyTo = null; showReply(); };
    }
    function download(a, btn) {
      var parts = [], off = 0, label = btn.innerHTML;
      btn.disabled = true;
      (function next() {
        call('liveFileChunk', { fileId: a.fileId, offset: off }).then(function (r) {
          if (!r.ok) { btn.disabled = false; btn.innerHTML = label; return note(r.error); }
          if (r.data) { var bin = atob(r.data), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); parts.push(u); off += u.length; }
          if (a.kind !== 'image') btn.textContent = '⬇ ' + Math.min(100, Math.round(off / (r.size || 1) * 100)) + '%';
          if (!r.done && off < r.size && r.data) return next();
          btn.disabled = false; btn.innerHTML = label;
          var url = URL.createObjectURL(new Blob(parts, { type: r.mime || 'application/octet-stream' })), link = document.createElement('a');
          link.href = url; link.download = r.name || a.name; document.body.appendChild(link); link.click();
          setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 60000);
        });
      })();
    }
    /* ---- attachments: chosen files upload at once (2 MB chunks), then travel with the next message ---- */
    $('input[type=file]', form).onchange = function () { Array.prototype.forEach.call(this.files || [], upload); this.value = ''; };
    function upload(file) {
      var it = { file: file, ready: false, fileId: '', el: h('<span class="lc-up small">📄 ' + esc(file.name) + ' <i>0%</i> <button type="button" title="Remove">✕</button></span>') };
      pending.push(it); $('.lc-files', form).appendChild(it.el);
      $('button', it.el).onclick = function () { it.cancel = true; pending = pending.filter(function (x) { return x !== it; }); it.el.remove(); };
      preview(file).then(function (pv) {
        it.pv = pv;
        return call('liveUploadInit', { name: file.name, size: file.size, mime: file.type || 'application/octet-stream', uploadKey: file.name + ':' + file.size + ':' + file.lastModified });
      }).then(function (r) {
        if (!r.ok) { $('i', it.el).textContent = '✗ ' + r.error; it.failed = true; return; }
        it.fileId = r.fileId; var off = r.received || 0, size = r.chunkSize || 2097152;
        (function chunk() {
          if (it.cancel) return;
          if (off >= file.size || r.done) { it.ready = true; $('i', it.el).textContent = '✓'; return; }
          b64(file.slice(off, off + size)).then(function (data) { return call('liveUploadChunk', { fileId: it.fileId, offset: off, data: data }); }).then(function (c) {
            if (!c.ok) { $('i', it.el).textContent = '✗ ' + c.error; it.failed = true; return; }
            off = c.received; $('i', it.el).textContent = Math.round(off / file.size * 100) + '%';
            if (c.done) { it.ready = true; $('i', it.el).textContent = '✓'; return; }
            chunk();
          });
        })();
      });
    }
    form.onsubmit = function (e) {
      e.preventDefault();
      var body = ta.value.trim();
      if (pending.some(function (x) { return !x.ready && !x.failed; })) return note('Wait until the files have finished uploading.');
      var atts = pending.filter(function (x) { return x.ready; }).map(function (x) { var o = { fileId: x.fileId }; if (x.pv) { o.w = x.pv.w; o.h = x.pv.h; if (x.pv.preview) o.preview = x.pv.preview; } return o; });
      if (!body && !atts.length) return;
      var ann = $('[data-k=ann]', form), b = $('button[type=submit]', form);
      b.disabled = true;
      call('livePost', { body: body, attachments: atts, kind: ann && ann.checked ? 'announcement' : 'message', replyToId: replyTo ? replyTo.id : '', clientId: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }).then(function (r) {
        b.disabled = false;
        if (!r.ok) return note(r.error);
        ta.value = ''; replyTo = null; showReply(); pending = []; $('.lc-files', form).innerHTML = ''; if (ann) ann.checked = false;
        upsert(r.message); draw(true);
      });
    };
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.onsubmit(e); } });
    var lastTyping = 0;
    ta.addEventListener('input', function () { var n = Date.now(); if (n - lastTyping > 4000 && ta.value.trim()) { lastTyping = n; call('liveTyping', {}); } });
    /* ---- sync: the first call loads the latest page, then only what changed (the server sets the pace) ---- */
    function loadEarlier() {
      var first = order[0]; if (!first) return;
      call('liveHistory', { beforeId: first }).then(function (r) {
        if (!r.ok) return note(r.error);
        var h0 = list.scrollHeight; r.messages.forEach(upsert); hasMore = r.hasMore; draw(); list.scrollTop = list.scrollHeight - h0;
      });
    }
    function status(r) {
      var o = r.online || {}, el = $('.lc-on', root);
      if (el) el.textContent = (o.teacherOnline ? '🟢 Teacher online · ' : '') + (o.studentCount || 0) + ' student(s) online';
      var ty = (r.typing || []).filter(Boolean); $('.lc-typing', root).textContent = ty.length ? ty.slice(0, 3).join(', ') + (ty.length > 1 ? ' are' : ' is') + ' typing…' : '';
    }
    function sync(full) {
      if (!alive()) return;
      call('liveSync', { full: !!full, since: seq, readVer: readVer, viewing: !document.hidden, hb: true }).then(function (r) {
        if (!alive()) return;
        if (!r.ok) {
          if (r.code === 'examlock' || r.code === 'auth') { stop(); box.innerHTML = ''; root.querySelector('.lc-list').innerHTML = '<p class="err lc-stop">' + esc(r.code === 'auth' ? 'Please open the classroom again.' : r.error) + '</p>'; return; }
          timer = setTimeout(function () { sync(false); }, 8000); return;
        }
        status(r);
        var changed = false;
        if (r.initial) { msgs = {}; order = []; r.messages.forEach(upsert); (r.pinned || []).forEach(function (m) { if (!msgs[m.id]) upsert(m); }); hasMore = r.hasMore; changed = true; }
        else if (r.resync) return sync(true);
        else if (r.changes && r.changes.length) { r.changes.forEach(upsert); changed = true; }
        if (r.seq) seq = r.seq; if (r.readVer) readVer = r.readVer;
        if (changed) draw(!!r.initial);
        if ((changed || r.unread) && !document.hidden && Date.now() - lastRead > 5000 && r.unread) { lastRead = Date.now(); call('liveMarkRead', { all: true }); }
        timer = setTimeout(function () { sync(false); }, document.hidden ? 15000 : (r.nextPollMs || 3000));
      });
    }
    sync(true);
    return { stop: stop };
  }
  window.PlatformClassroom = { mount: mount };
})();
