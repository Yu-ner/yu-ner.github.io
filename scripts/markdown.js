/*
 * MiniMD: a small Markdown reader for fiction.
 * Works in the browser (window.MiniMD) and in Node (require).
 *
 * Supports: paragraphs, # headings, scene breaks (--- or * * *), > quotes,
 * simple lists, **bold**, *italic* / _italic_, ***both***, ~~strike~~,
 * `code`, [links](url), backslash escapes, and <!-- hidden notes -->.
 * Everything else is escaped, so chapter files can never inject HTML.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniMD = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) { return ENTITIES[c]; });
  }

  function safeUrl(u) {
    u = u.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return /^(https?|mailto):/i.test(u) ? u : null;
    return u;
  }

  function inline(src) {
    var stash = [];
    function keep(html) { return '\u0001' + (stash.push(html) - 1) + '\u0002'; }
    var s = src;

    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~>|])/g, function (m, c) { return keep(esc(c)); });
    s = s.replace(/`([^`]+)`/g, function (m, c) { return keep('<code>' + esc(c) + '</code>'); });
    s = esc(s);

    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, url) {
      var safe = safeUrl(url);
      if (!safe) return m;
      var external = /^https?:/i.test(safe);
      var open = '<a href="' + safe + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>';
      return keep(open) + text + keep('</a>');
    });

    s = s.replace(/\*\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*\s](?:[^*]*?[^*\s])?)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^\w])_([^_\s](?:[^_]*?[^_\s])?)_(?![\w])/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\s](?:[^~]*?[^~\s])?)~~/g, '<del>$1</del>');

    for (var pass = 0; pass < 3 && /\u0001\d+\u0002/.test(s); pass++) {
      s = s.replace(/\u0001(\d+)\u0002/g, function (m, i) { return stash[+i]; });
    }
    return s;
  }

  var HR = /^\s{0,3}([*\-_])(?:\s*\1){2,}\s*$/;
  var HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
  var QUOTE = /^\s{0,3}>/;
  var UL = /^\s{0,3}[-*+]\s+(.*)$/;
  var OL = /^\s{0,3}\d+[.)]\s+(.*)$/;
  function blank(l) { return /^\s*$/.test(l); }

  function render(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    var m;

    while (i < lines.length) {
      var line = lines[i];

      if (blank(line)) { i++; continue; }

      if (HR.test(line)) { out.push('<hr>'); i++; continue; }

      if ((m = HEADING.exec(line))) {
        var level = Math.min(m[1].length + 1, 5);
        out.push('<h' + level + '>' + inline(m[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      if (QUOTE.test(line)) {
        var q = [];
        while (i < lines.length && QUOTE.test(lines[i])) {
          q.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + render(q.join('\n')) + '</blockquote>');
        continue;
      }

      if (UL.test(line) || OL.test(line)) {
        var ordered = OL.test(line) && !UL.test(line);
        var re = ordered ? OL : UL;
        var items = [];
        while (i < lines.length && re.test(lines[i])) {
          items.push('<li>' + inline(re.exec(lines[i])[1]) + '</li>');
          i++;
        }
        out.push((ordered ? '<ol>' : '<ul>') + items.join('') + (ordered ? '</ol>' : '</ul>'));
        continue;
      }

      var buf = [];
      while (
        i < lines.length && !blank(lines[i]) && !HR.test(lines[i]) &&
        !HEADING.test(lines[i]) && !QUOTE.test(lines[i])
      ) {
        buf.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      var html = inline(buf.join('\n'));
      html = html.replace(/(?: {2,}|\\)\n/g, '<br>').replace(/\n/g, ' ');
      out.push('<p>' + html + '</p>');
    }
    return out.join('\n');
  }

  function frontMatter(text) {
    var meta = {};
    var body = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    var m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(body);
    if (!m) return { meta: meta, body: body };
    m[1].split('\n').forEach(function (row) {
      var kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(row);
      if (!kv) return;
      var v = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      meta[kv[1]] = v === 'true' ? true : v === 'false' ? false : v;
    });
    return { meta: meta, body: body.slice(m[0].length) };
  }

  function countWords(md) {
    var plain = md
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s{0,3}([*\-_])(?:\s*\1){2,}\s*$/gm, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`>#\\]/g, ' ');
    var words = plain.split(/\s+/).filter(function (w) { return /[\p{L}\p{N}]/u.test(w); });
    return words.length;
  }

  function parse(text) {
    var fm = frontMatter(text);
    var body = fm.body.replace(/<!--[\s\S]*?-->/g, '');
    var title = fm.meta.title || '';
    var lead = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(body);
    if (lead) {
      if (!title) title = lead[1];
      body = body.slice(lead[0].length);
    }
    return { meta: fm.meta, title: title, html: render(body), words: countWords(body) };
  }

  return { parse: parse, render: render, inline: inline, words: countWords, frontMatter: frontMatter };
});
