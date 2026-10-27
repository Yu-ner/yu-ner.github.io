/*
 * Chapter reader for the fanfic site.
 *
 * Routes (kept as plain hashes so every page has a shareable link):
 *   (empty)       home page with the chapter list
 *   #chapter-12   reader for chapter 12
 *
 * Chapters are Markdown files listed in chapters/chapters.json.
 * See README.md for how to publish a new one.
 */
(function () {
  'use strict';

  var MD = window.MiniMD;
  var root = document.documentElement;
  var app = document.getElementById('app');
  var bar = document.getElementById('bar');
  var barIn = document.getElementById('bar-in');
  var progressEl = document.getElementById('progress');
  var foot = document.getElementById('foot');
  var scrim = document.getElementById('scrim');
  var drawer = document.getElementById('drawer');
  var drawerList = document.getElementById('drawer-list');
  var prefsEl = document.getElementById('prefs');
  var sizeOut = document.getElementById('size-out');

  var KEY_PREFS = 'yuner.prefs.v1';
  var KEY_PROGRESS = 'yuner.progress.v1';
  var MANIFEST = 'chapters/chapters.json';

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return Number(n).toLocaleString('en'); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function minutes(words) { return Math.max(1, Math.round((words || 0) / 230)); }
  function fmtDate(d) {
    if (!d) return '';
    var t = new Date(d + 'T00:00:00');
    if (isNaN(t)) return '';
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }
  };

  /* ---------- state ---------- */

  var prefs = Object.assign({ theme: 'auto', size: 19, face: 'serif', newestFirst: false }, store.get(KEY_PREFS, {}));
  prefs.size = clamp(Number(prefs.size) || 19, 15, 28);
  var progress = Object.assign({ last: null, read: [] }, store.get(KEY_PROGRESS, {}));
  if (!Array.isArray(progress.read)) progress.read = [];

  var site = {};
  var chapters = [];
  var byNumber = new Map();
  var cache = new Map();
  var navId = 0;
  var readingN = null;
  var opener = null;
  var themeApplied = false;
  var artIndex = 0;

  /* ---------- preferences ---------- */

  function applyPrefs() {
    root.style.setProperty('--read-size', prefs.size + 'px');
    root.setAttribute('data-face', prefs.face);
    if (prefs.theme === 'auto') {
      if (themeApplied) root.removeAttribute('data-theme');
      themeApplied = false;
    } else {
      root.setAttribute('data-theme', prefs.theme);
      themeApplied = true;
    }
  }

  function syncPrefsUi() {
    Array.prototype.forEach.call(prefsEl.querySelectorAll('[data-pref]'), function (b) {
      b.setAttribute('aria-pressed', String(prefs[b.dataset.pref] === b.dataset.value));
    });
    sizeOut.textContent = prefs.size;
  }

  function savePrefs() {
    store.set(KEY_PREFS, prefs);
    applyPrefs();
    syncPrefsUi();
  }

  /* ---------- data ---------- */

  function loadManifest() {
    return fetch(MANIFEST, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        site = data.site || {};
        chapters = (data.chapters || []).slice().sort(function (a, b) { return a.n - b.n; });
        byNumber = new Map(chapters.map(function (c) { return [c.n, c]; }));
      });
  }

  function getChapter(ch) {
    if (!cache.has(ch.n)) {
      cache.set(ch.n, fetch(ch.file)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (text) { return MD.parse(text); })
        .catch(function (err) { cache.delete(ch.n); throw err; }));
    }
    return cache.get(ch.n);
  }

  /* ---------- reading progress ---------- */

  var saveTimer = 0;
  function rememberPosition(n, pct) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      progress.last = { n: n, pct: Math.round(pct * 1000) / 1000 };
      if (pct >= 0.92 && progress.read.indexOf(n) === -1) progress.read.push(n);
      store.set(KEY_PROGRESS, progress);
    }, 300);
  }

  var ticking = false;
  function onScroll() {
    if (readingN == null || ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var max = Math.max(1, root.scrollHeight - window.innerHeight);
      var pct = clamp(window.scrollY / max, 0, 1);
      progressEl.style.width = (pct * 100).toFixed(2) + '%';
      rememberPosition(readingN, pct);
    });
  }

  function resumeTarget() {
    var last = progress.last;
    if (!last || !byNumber.has(last.n)) return null;
    var i = chapters.findIndex(function (c) { return c.n === last.n; });
    if (last.pct >= 0.97) {
      return i < chapters.length - 1 ? { ch: chapters[i + 1], kind: 'next' } : { ch: chapters[i], kind: 'again' };
    }
    return { ch: chapters[i], kind: 'resume' };
  }

  /* ---------- top bar ---------- */

  function renderBar(mode, ch) {
    bar.hidden = false;
    progressEl.style.width = '0';
    var actions;
    if (mode === 'home') {
      barIn.innerHTML =
        '<a class="brand" href="#">' + esc(site.author || 'Home') + '</a>' +
        '<div class="bar-actions">' +
        '<button class="btn" type="button" data-act="prefs" aria-label="Reading settings" aria-expanded="false" aria-controls="prefs">Aa</button>' +
        '</div>';
    } else {
      actions =
        '<div class="bar-actions">' +
        '<button class="btn" type="button" data-act="toc" aria-expanded="false" aria-controls="drawer">Chapters</button>' +
        '<button class="btn" type="button" data-act="prefs" aria-label="Reading settings" aria-expanded="false" aria-controls="prefs">Aa</button>' +
        '</div>';
      barIn.innerHTML =
        '<a class="btn" href="#">Contents</a>' +
        '<span class="where">' + (ch ? 'Chapter ' + ch.n + ' of ' + chapters[chapters.length - 1].n : '') + '</span>' +
        actions;
    }
  }

  /* ---------- panels ---------- */

  function openPanel(kind, btn) {
    closePanels(false);
    opener = btn || null;
    if (kind === 'toc') {
      var cur = readingN;
      drawerList.innerHTML = chapters.map(function (c) {
        var cls = progress.read.indexOf(c.n) !== -1 ? ' class="read"' : '';
        var here = c.n === cur ? ' aria-current="page"' : '';
        return '<li><a href="#chapter-' + c.n + '"' + cls + here + '><span class="n">' + c.n +
          '</span><span class="t">' + esc(c.title) + '</span></a></li>';
      }).join('');
      drawer.hidden = false;
      scrim.hidden = false;
      document.body.style.overflow = 'hidden';
      var here2 = drawerList.querySelector('[aria-current]');
      if (here2) here2.scrollIntoView({ block: 'center' });
      drawer.querySelector('[data-act="close"]').focus();
    } else {
      syncPrefsUi();
      prefsEl.hidden = false;
    }
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }

  function closePanels(restoreFocus) {
    var wasOpen = !drawer.hidden || !prefsEl.hidden;
    drawer.hidden = true;
    prefsEl.hidden = true;
    scrim.hidden = true;
    document.body.style.overflow = '';
    Array.prototype.forEach.call(document.querySelectorAll('[aria-expanded="true"]'), function (b) {
      b.setAttribute('aria-expanded', 'false');
    });
    if (restoreFocus && wasOpen && opener && document.contains(opener)) opener.focus();
    if (!wasOpen) opener = null;
  }

  /* ---------- home ---------- */

  function chapterRows() {
    var list = chapters.slice();
    if (prefs.newestFirst) list.reverse();
    return list.map(function (c) {
      var read = progress.read.indexOf(c.n) !== -1;
      var meta = [fmtDate(c.date), c.words ? num(c.words) + ' words' : ''].filter(Boolean);
      return '<li><a href="#chapter-' + c.n + '"' + (read ? ' class="read"' : '') + '>' +
        '<span class="n">' + c.n + '</span>' +
        '<span class="t">' + esc(c.title) + (read ? '<span class="sr-only"> (read)</span>' : '') + '</span>' +
        '<span class="meta">' + esc(meta.join('  ')) + '</span></a></li>';
    }).join('');
  }

  function renderFoot() {
    var links = (site.links || []).map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.label) + '</a>';
    }).join('');
    foot.innerHTML =
      '<div class="wrap foot-in">' + links +
      (site.disclaimer ? '<p>' + esc(site.disclaimer) + '</p>' : '') + '</div>';
    foot.hidden = false;
  }

  function showHome() {
    navId++;
    readingN = null;
    document.title = site.title || document.title;
    renderBar('home');
    app.setAttribute('data-view', 'home');

    var totalWords = chapters.reduce(function (sum, c) { return sum + (c.words || 0); }, 0);
    var latest = chapters[chapters.length - 1];
    var resume = resumeTarget();
    var primary, secondary = '';

    if (!chapters.length) {
      primary = '';
    } else if (!resume) {
      primary = '<a class="btn primary" href="#chapter-' + chapters[0].n + '">Start reading</a>';
      if (latest.n !== chapters[0].n) {
        secondary = '<a class="btn" href="#chapter-' + latest.n + '">Jump to the latest, chapter ' + latest.n + '</a>';
      }
    } else {
      var label = resume.kind === 'resume' ? 'Continue chapter ' + resume.ch.n
        : resume.kind === 'next' ? 'Read chapter ' + resume.ch.n
        : 'Reread chapter ' + resume.ch.n;
      primary = '<a class="btn primary" href="#chapter-' + resume.ch.n + '">' + label + '</a>';
      if (latest.n !== resume.ch.n && resume.kind !== 'again') {
        secondary = '<a class="btn" href="#chapter-' + latest.n + '">Jump to the latest, chapter ' + latest.n + '</a>';
      }
    }

    var images = (site.images || []).filter(function (im) { return im && im.src; });
    artIndex = 0;
    var art = '';
    if (images.length) {
      var img = '<img id="hero-img" src="' + esc(images[0].src) + '" alt="' + esc(images[0].alt || '') + '">';
      art = images.length > 1
        ? '<button class="hero-art" type="button" data-act="art" title="Click to switch image" aria-label="Switch image">' + img + '</button>'
        : '<div class="hero-art">' + img + '</div>';
    }

    app.innerHTML =
      '<section class="hero' + (art ? '' : ' hero--plain') + '">' +
        '<div class="hero-title">' +
          '<h1>' + esc(site.title || 'Chapters') + '</h1>' +
          (site.author ? '<p class="by">by ' + esc(site.author) + '</p>' : '') +
        '</div>' +
        art +
        '<div class="hero-actions">' +
          '<div class="cta">' + primary + secondary + '</div>' +
          '<p class="stats"><span>' + chapters.length + ' chapters</span><span>' + num(totalWords) + ' words</span></p>' +
        '</div>' +
      '</section>' +
      (site.about
        ? '<section class="story" id="story" aria-labelledby="story-h" hidden>' +
          '<div class="list-head"><h2 id="story-h">The story</h2></div><div class="about" id="about"></div></section>'
        : '') +
      '<section aria-labelledby="chapters-h">' +
        '<div class="list-head"><h2 id="chapters-h">Chapters</h2>' +
        '<button class="btn" type="button" data-act="sort">' + (prefs.newestFirst ? 'Newest first' : 'Oldest first') + '</button></div>' +
        '<ol class="chapters" id="chapter-list">' + chapterRows() + '</ol>' +
      '</section>';

    var heroImg = document.getElementById('hero-img');
    if (heroImg) {
      heroImg.addEventListener('error', function () {
        if (artIndex > 0) {
          artIndex = 0;
          heroImg.src = images[0].src;
          heroImg.alt = images[0].alt || '';
          return;
        }
        var box = heroImg.closest('.hero-art');
        if (box) box.hidden = true;
        var hero = app.querySelector('.hero');
        if (hero) hero.classList.add('hero--plain');
      });
    }

    var id = navId;
    getAbout().then(function (html) {
      var box = document.getElementById('about');
      if (id !== navId || !html || !box) return;
      box.innerHTML = html;
      document.getElementById('story').hidden = false;
    });

    renderFoot();
    window.scrollTo(0, 0);
  }

  /* ---------- story intro ---------- */

  var aboutPromise = null;
  function getAbout() {
    if (!site.about) return Promise.resolve('');
    if (!aboutPromise) {
      aboutPromise = fetch(site.about)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (text) { return MD.parse(text).html; })
        .catch(function () { aboutPromise = null; return ''; });
    }
    return aboutPromise;
  }

  /* ---------- reader ---------- */

  function problem(title, text) {
    return '<div class="status"><h1 class="problem-title">' + esc(title) + '</h1><p>' + text + '</p>' +
      '<p><a href="#">Back to all chapters</a></p></div>';
  }

  function showChapter(n) {
    var id = ++navId;
    readingN = null;
    var i = chapters.findIndex(function (c) { return c.n === n; });
    app.setAttribute('data-view', 'reader');
    foot.hidden = true;

    if (i < 0) {
      renderBar('reader');
      document.title = 'Chapter not found - ' + (site.title || '');
      app.innerHTML = problem('This chapter isn’t published yet', 'Check the chapter list for what is available.');
      window.scrollTo(0, 0);
      return;
    }

    var ch = chapters[i];
    renderBar('reader', ch);
    app.innerHTML = '<p class="status">Loading chapter ' + ch.n + '…</p>';
    window.scrollTo(0, 0);

    var resumeAt = progress.last && progress.last.n === n ? progress.last.pct : 0;

    getChapter(ch).then(function (data) {
      if (id !== navId) return;

      var title = ch.title || data.title || 'Chapter ' + ch.n;
      var words = data.words || ch.words || 0;
      var prev = chapters[i - 1];
      var next = chapters[i + 1];
      var digits = String(ch.n).length;

      document.title = 'Chapter ' + ch.n + ': ' + title + ' - ' + (site.title || '');

      app.innerHTML =
        '<article class="article">' +
          '<header class="chapter-head">' +
            '<div class="seal" data-len="' + digits + '" aria-hidden="true">' + ch.n + '</div>' +
            '<div><h1>' + esc(title) + '</h1>' +
            '<p class="sub"><span>Chapter ' + ch.n + ' of ' + chapters[chapters.length - 1].n + '</span>' +
            '<span>' + num(words) + ' words</span><span>' + minutes(words) + ' min read</span></p></div>' +
          '</header>' +
          (data.meta.sample ? '<p class="notice">Sample text. Replace chapters/' + esc(ch.file.replace(/^.*\//, '')) + ' with your own chapter.</p>' : '') +
          '<div class="prose">' + data.html + '</div>' +
          '<nav class="pager" aria-label="Chapter navigation">' +
            (prev ? '<a class="prev" href="#chapter-' + prev.n + '" rel="prev"><small>Previous</small><strong>' + esc(prev.title) + '</strong></a>' : '<span></span>') +
            (next ? '<a class="next" href="#chapter-' + next.n + '" rel="next"><small>Next</small><strong>' + esc(next.title) + '</strong></a>'
                  : '<div class="next caught-up"><small>You’re up to date</small><strong>The next chapter will appear here</strong></div>') +
          '</nav>' +
          '<p class="back"><a href="#">Back to all chapters</a></p>' +
        '</article>';

      readingN = n;
      var max = root.scrollHeight - window.innerHeight;
      if (resumeAt > 0.02 && resumeAt < 0.97 && max > 0) {
        window.scrollTo(0, Math.round(resumeAt * max));
      } else {
        progress.last = { n: n, pct: 0 };
        store.set(KEY_PROGRESS, progress);
      }
      onScroll();

      if (next) {
        var warm = function () { getChapter(next).catch(function () {}); };
        if (window.requestIdleCallback) window.requestIdleCallback(warm); else setTimeout(warm, 800);
      }
    }).catch(function () {
      if (id !== navId) return;
      app.innerHTML = problem('Couldn’t load this chapter',
        'The file ' + esc(ch.file) + ' didn’t load. Check that it exists in the chapters folder and that the name matches chapters.json.');
    });
  }

  /* ---------- routing ---------- */

  function route() {
    closePanels(false);
    var m = /^#chapter-(\d+)$/.exec(location.hash);
    if (m) showChapter(parseInt(m[1], 10)); else showHome();
  }

  /* ---------- events ---------- */

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    var pref = t.closest('[data-pref]');
    if (pref) {
      prefs[pref.dataset.pref] = pref.dataset.value;
      savePrefs();
      return;
    }
    var size = t.closest('[data-size]');
    if (size) {
      prefs.size = clamp(prefs.size + Number(size.dataset.size), 15, 28);
      savePrefs();
      return;
    }
    var act = t.closest('[data-act]');
    if (act) {
      var kind = act.dataset.act;
      if (kind === 'close') closePanels(true);
      else if (kind === 'art') {
        var imgs = site.images || [];
        var shown = document.getElementById('hero-img');
        if (imgs.length > 1 && shown) {
          artIndex = (artIndex + 1) % imgs.length;
          shown.src = imgs[artIndex].src;
          shown.alt = imgs[artIndex].alt || '';
        }
      } else if (kind === 'sort') {
        prefs.newestFirst = !prefs.newestFirst;
        store.set(KEY_PREFS, prefs);
        act.textContent = prefs.newestFirst ? 'Newest first' : 'Oldest first';
        document.getElementById('chapter-list').innerHTML = chapterRows();
      } else if ((kind === 'toc' && !drawer.hidden) || (kind === 'prefs' && !prefsEl.hidden)) {
        closePanels(true);
      } else {
        openPanel(kind, act);
      }
      return;
    }
    if (t.closest('#scrim')) { closePanels(true); return; }
    if (!prefsEl.hidden && !t.closest('#prefs')) closePanels(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePanels(true); return; }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (readingN == null || !drawer.hidden) return;
    var i = chapters.findIndex(function (c) { return c.n === readingN; });
    if (e.key === 'ArrowRight' && chapters[i + 1]) location.hash = 'chapter-' + chapters[i + 1].n;
    if (e.key === 'ArrowLeft' && chapters[i - 1]) location.hash = 'chapter-' + chapters[i - 1].n;
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('hashchange', route);
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- start ---------- */

  applyPrefs();
  syncPrefsUi();

  loadManifest().then(route).catch(function () {
    app.innerHTML = problem('Couldn’t load the chapter list',
      'The file chapters/chapters.json didn’t load. If you opened index.html straight from your computer, ' +
      'start a local server instead (run <code>python -m http.server</code> in this folder, then open ' +
      '<code>http://localhost:8000</code>) or visit the published site.');
  });
})();
