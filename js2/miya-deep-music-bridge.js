/**
 * miya-deep-music-bridge.js — 深入 · 角色 Music API 生成与网易云解析
 */
(function (global) {
  'use strict';

  var MUSIC_MAX_TOKENS = 16384;

  function trim(s) { return String(s || '').trim(); }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  function sanitizeJsonText(text) {
    var t = String(text || '');
    t = t.replace(/^\uFEFF/, '');
    t = t.replace(/[\u201c\u201d\u201e\u201f]/g, '"');
    t = t.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
    t = t.replace(/,\s*([}\]])/g, '$1');
    return t;
  }

  function repairJsonClosure(text) {
    var t = sanitizeJsonText(String(text || ''));
    var i = t.indexOf('{');
    if (i < 0) return t;
    t = t.slice(i);
    var stack = [];
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < t.length; c++) {
      var ch = t.charAt(c);
      out += ch;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (stack.length) stack.pop();
      }
    }
    if (inStr) out += '"';
    while (stack.length) {
      var open = stack.pop();
      out += open === '{' ? '}' : ']';
    }
    return out;
  }

  function escapeRawNewlinesInJsonStrings(text) {
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < text.length; c++) {
      var ch = text.charAt(c);
      if (inStr) {
        if (esc) {
          out += ch;
          esc = false;
        } else if (ch === '\\') {
          out += ch;
          esc = true;
        } else if (ch === '"') {
          out += ch;
          inStr = false;
        } else if (ch === '\r') {
          if (text.charAt(c + 1) === '\n') c++;
          out += '\\n';
        } else if (ch === '\n') {
          out += '\\n';
        } else {
          out += ch;
        }
      } else {
        if (ch === '"') inStr = true;
        out += ch;
      }
    }
    return out;
  }

  function tryParseJsonSlice(text) {
    var t = sanitizeJsonText(text);
    if (!t) return null;
    var i = t.indexOf('{');
    if (i < 0) return null;
    var j = t.lastIndexOf('}');
    var candidates = [];
    if (j > i) candidates.push(t.slice(i, j + 1));
    candidates.push(repairJsonClosure(t.slice(i)));
    candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i))));
    if (j > i) {
      candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, j + 1))));
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) !== '}') continue;
        candidates.push(t.slice(i, c + 1));
        candidates.push(repairJsonClosure(t.slice(i, c + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, c + 1))));
      }
    }
    var seen = {};
    var n;
    for (n = 0; n < candidates.length; n++) {
      var slice = candidates[n];
      if (!slice || seen[slice]) continue;
      seen[slice] = true;
      try {
        var obj = JSON.parse(slice);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function tryParseJson(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned) return null;
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
      var direct = JSON.parse(cleaned);
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch (e0) { /* fall through */ }
    return tryParseJsonSlice(cleaned);
  }

  function resolveContactContext(contact) {
    var diaryBr = global.miyaDiaryBridge;
    if (diaryBr && typeof diaryBr.resolveContactContext === 'function') {
      return diaryBr.resolveContactContext(contact);
    }
    return { contact: contact, profile: null, chat: null, settings: {} };
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + trim(contact && contact.name || '未知'));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = trim(cts.renderChronicleBlock(roleId));
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + trim(contact.persona));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·参考】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；歌单须贴合此关系。'
    ];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? trim(eng.renderProfileBlock(profile))
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + trim(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + trim(settings.relationship));
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + trim(contact.remarkName));
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = trim(contact.name) + ' 音乐 歌单 听歌 心情 品味';
    var bundle = eng.buildWorldbookBundle(contact, seed, null, {
      includeAllBoundLocal: true,
      promptContext: 'general'
    });
    if (!bundle) return '';
    var text = '';
    if (typeof eng.joinWorldbookBundleText === 'function') {
      text = eng.joinWorldbookBundleText(bundle);
    } else {
      var parts = [];
      [].concat(bundle.frontLayers || [], bundle.layers || [], bundle.backLayers || []).forEach(function (layer) {
        if (layer) parts.push(layer);
      });
      text = parts.join('\n\n').trim();
    }
    return text ? '【世界书·必读】\n' + text : '';
  }

  function buildChatContextBlock(contact, profile, chat) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var profileName = trim(profile && profile.name || '用户');
    var charName = trim(contact && contact.name || '角色');
    var msgs = cs.getMessages(chat.id) || [];
    var lines = msgs
      .filter(function (m) {
        return m && !m.deleted && trim(m.content);
      })
      .slice(-50)
      .map(function (m) {
        var body = trim(m.content);
        if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
          body = global.miyaChatEngine.stripThinkingForApi(body);
        }
        body = trim(body);
        if (!body) return '';
        var who = m.role === 'user' ? profileName : charName;
        return who + '：' + body;
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return [
      '【近期聊天记录（最近 ' + lines.length + ' 条）】',
      '以下为与该角色的近期私聊，生成歌单时可参考其中的情绪、话题与关系动态，但不必逐条提及。',
      lines.join('\n')
    ].join('\n');
  }

  function buildMusicContext(contactId) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var contact = cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
    if (!contact) return null;

    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var profile = ctx.profile;
    var settings = ctx.settings || {};
    var chat = ctx.chat;
    var aw = global.MiyaChatAwareness;

    var parts = [
      '【当前时间】' + new Date().toLocaleString('zh-CN', { hour12: false }),
      buildCharacterBlock(contact),
      buildUserRelationBlock(contact, profile, settings)
    ];

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact);
    if (wb) parts.push(wb);

    var chatBlock = buildChatContextBlock(contact, profile, chat);
    if (chatBlock) parts.push(chatBlock);

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      chat: chat,
      contextText: parts.filter(Boolean).join('\n\n')
    };
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
    var deepStore = global.miyaDeepStore;
    if (!deepStore) return Promise.reject(new Error('API 模块未加载'));
    var resolved = deepStore.resolvePhoneApiConfig(phoneData || {});
    var base = resolved.normalizedBaseUrl;
    var model = trim(resolved.model);
    var key = trim(resolved.apiKey);
    if (!base || !model || !key) {
      return Promise.reject(new Error('请先在角色手机设置或全局设置中配置 API'));
    }
    reqOpts = Object.assign({
      temperature: resolved.temperature != null ? resolved.temperature : 0.88,
      timeoutMs: 180000,
      max_tokens: MUSIC_MAX_TOKENS
    }, reqOpts || {});

    var payload = {
      model: model,
      temperature: reqOpts.temperature,
      max_tokens: reqOpts.max_tokens,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: String(systemHint || '') },
        { role: 'user', content: String(userContent || '') }
      ]
    };

    var timeoutMs = Number(reqOpts.timeoutMs) || 180000;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    var proxyBase = resolved.proxyBaseUrl ? trim(resolved.proxyBaseUrl) : null;
    var fetchBase = proxyBase || base;
    var fetchHeaders = { 'Content-Type': 'application/json' };
    if (!proxyBase) { fetchHeaders['Authorization'] = 'Bearer ' + key; }
    return fetch(fetchBase + '/chat/completions', {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      return r.json();
    }).then(function (j) {
      var eng = global.miyaChatEngine;
      var text = '';
      if (eng && typeof eng.extractReplyContent === 'function') {
        text = eng.extractReplyContent(j);
      } else {
        var choice = j && j.choices && j.choices[0];
        var msg = choice && choice.message;
        var raw = msg && msg.content;
        if (typeof raw === 'string') text = raw.trim();
        else if (Array.isArray(raw)) {
          text = raw.map(function (p) { return p && p.text ? String(p.text) : ''; }).join('').trim();
        }
      }
      if (eng && typeof eng.stripThinkingForApi === 'function') {
        text = eng.stripThinkingForApi(text);
      }
      if (!text) throw new Error('API 返回为空');
      return text;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    });
  }

  function buildSystemPrompt(charName) {
    return (
      '你是「' + charName + '」的私人音乐品味策展人。' +
      '须根据角色人设、世界书、用户面具与双方关系，推断 ta 会收藏怎样的歌单与听歌习惯。' +
      '所有歌曲必须是真实存在的华语/欧美/日韩流行或独立歌曲，给出准确歌名与歌手名。' +
      '只输出 JSON，不要 markdown，首字符必须是 {。' +
      '格式：{"playlists":[{"title":"歌单名","subtitle":"一句话描述","mood":"情绪标签","tracks":[{"title":"歌名","artist":"歌手"}]}],' +
      '"weekStats":{"topSong":{"title":"歌名","artist":"歌手","playCount":整数},"totalMinutes":整数,"peakPeriod":"清晨|上午|午后|傍晚|深夜","peakPeriodLabel":"如 22:00–01:00"}}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完 3 个歌单×每单 10 首共 30 首歌，禁止只写部分歌单或少写曲目。' +
      '【硬性数量】playlists 必须恰好 3 个；每个 playlist.tracks 必须恰好 10 首；weekStats 须完整合理；' +
      '输出前自检 playlists.length===3 且每单 tracks.length===10 且 JSON 以 } 闭合；禁止提及 AI、系统、提示词。'
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·必读】',
      ctx.contextText,
      '',
      '【生成任务 · ' + charName + ' 的手机 Music · 必须完整】',
      '为角色「' + charName + '」一次性生成完整音乐库，面向「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【强制完整】',
      '- playlists 必须正好 3 个，每个 tracks 必须正好 10 首（共 30 首），禁止少写',
      '- 歌名+歌手必须真实准确；风格各异（通勤/深夜/回忆/恋爱/工作等，贴合人设）',
      '- weekStats：最常听哪首、总分钟数、最常时间段，必须写全',
      '- 只输出一个完整 JSON（从 { 到 }），3 单×10 首写满再结束'
    ].join('\n');
  }

  function normalizeApiTrack(raw, plIndex, trIndex) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.song);
    var artist = trim(raw.artist || raw.singer || raw.by);
    if (!title) return null;
    return {
      id: 't-' + plIndex + '-' + trIndex,
      title: title,
      artist: artist,
      neteaseSongId: '',
      coverUrl: '',
      durationSec: 0
    };
  }

  function normalizeApiPlaylist(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    var tracks = Array.isArray(raw.tracks) ? raw.tracks : Array.isArray(raw.songs) ? raw.songs : [];
    var normTracks = tracks.map(function (t, i) {
      return normalizeApiTrack(t, index, i);
    }).filter(Boolean);
    return {
      id: 'pl-' + (index + 1),
      title: title,
      subtitle: trim(raw.subtitle || raw.desc || raw.description),
      mood: trim(raw.mood || raw.tag || raw.vibe),
      tracks: normTracks
    };
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      playlists: [{
        id: 'pl-1',
        title: '原始返回',
        subtitle: raw,
        mood: '',
        tracks: [{
          id: 't-0-0',
          title: '原始返回',
          artist: '',
          neteaseSongId: '',
          coverUrl: '',
          durationSec: 0
        }]
      }],
      weekStats: {
        topSong: { title: '', artist: '', playCount: 0 },
        totalMinutes: 0,
        peakPeriod: '',
        peakPeriodLabel: ''
      }
    };
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    if (!obj || typeof obj !== 'object') return buildRawFallback(rawText);
    var playlists = Array.isArray(obj.playlists) ? obj.playlists : [];
    var norm = playlists.map(normalizeApiPlaylist).filter(Boolean);
    if (!norm.length) return buildRawFallback(rawText);
    var ws = obj.weekStats && typeof obj.weekStats === 'object' ? obj.weekStats : {};
    var top = ws.topSong && typeof ws.topSong === 'object' ? ws.topSong : {};
    var weekStats = {
      topSong: {
        title: trim(top.title || top.name),
        artist: trim(top.artist),
        playCount: Math.max(0, Number(top.playCount || top.count) || 0)
      },
      totalMinutes: Math.max(0, Number(ws.totalMinutes || ws.minutes) || 0),
      peakPeriod: trim(ws.peakPeriod || ws.peakSlot || ''),
      peakPeriodLabel: trim(ws.peakPeriodLabel || ws.peakTime || ws.timeRange || '')
    };
    return { playlists: norm, weekStats: weekStats };
  }

  function searchKeywordForTrack(track) {
    var title = trim(track.title);
    var artist = trim(track.artist);
    if (artist && title) return artist + ' ' + title;
    return title;
  }

  function pickBestSearchRow(rows, track) {
    if (!rows || !rows.length) return null;
    var best = rows[0];
    var titleLower = trim(track.title).toLowerCase();
    var artistLower = trim(track.artist).toLowerCase();
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var rowTitle = trim(row.title).toLowerCase();
      var rowArtist = trim(row.artist).toLowerCase();
      if (rowTitle === titleLower) {
        if (!artistLower || !rowArtist || rowArtist.indexOf(artistLower) >= 0 || artistLower.indexOf(rowArtist) >= 0) {
          return row;
        }
        best = row;
      } else if (rowTitle.indexOf(titleLower) >= 0 || titleLower.indexOf(rowTitle) >= 0) {
        best = row;
      }
    }
    return best;
  }

  function resolveTrackViaNetease(track) {
    var eng = global.miyaMusicEngine;
    if (!eng || typeof eng.searchNeteaseKeywords !== 'function') {
      return Promise.resolve(track);
    }
    var sid = trim(track.neteaseSongId);
    if (/^\d{4,}$/.test(sid)) return Promise.resolve(track);
    var keyword = searchKeywordForTrack(track);
    if (!keyword) return Promise.resolve(track);
    return eng.searchNeteaseKeywords(keyword).then(function (rows) {
      var best = pickBestSearchRow(rows, track);
      if (!best) return track;
      var next = Object.assign({}, track, {
        neteaseSongId: String(best.id || ''),
        coverUrl: String(best.coverUrl || track.coverUrl || ''),
        durationSec: best.duration ? Math.round(Number(best.duration) / 1000) : track.durationSec
      });
      if (!next.artist && best.artist) next.artist = best.artist;
      return next;
    }).catch(function () {
      return track;
    });
  }

  function generateMusicLibrary(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildMusicContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的music，' });
    }

    return callPhoneApi(
      buildSystemPrompt(charName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: MUSIC_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepMusicBridge = {
    buildMusicContext: buildMusicContext,
    generateMusicLibrary: generateMusicLibrary,
    resolveTrackViaNetease: resolveTrackViaNetease,
    pickBestSearchRow: pickBestSearchRow,
    searchKeywordForTrack: searchKeywordForTrack
  };
})(typeof window !== 'undefined' ? window : global);
