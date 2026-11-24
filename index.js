(function () {
  "use strict";

  var V = vendetta;
  var storage = V.plugin.storage;
  var React = V.metro.common.React;
  var RN = V.metro.common.ReactNative;
  var h = React.createElement;

  function toast(text) {
    try { V.ui.toasts.showToast(text); } catch (e) {}
  }

  function getDispatcher() {
    try {
      var d = V.metro.common.FluxDispatcher;
      if (d && d.dispatch) return d;
    } catch (e) {}
    try { return V.metro.findByProps("dispatch", "subscribe", "unsubscribe"); } catch (e) {}
    return null;
  }

  var FD = null;
  var timer = null;
  var sendTimer = null;
  var latest = null;
  var lastSent = 0;
  var startedAt = 0;
  var elapsed = 0;
  var onConnect = null;

  // ---------- helpers ----------
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function parseDur(str) {
    str = String(str || "").trim();
    if (!str) return 180;
    var m = str.match(/^(\d+):(\d{1,2})$/);
    var sec = m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : parseInt(str, 10);
    if (!isFinite(sec) || sec <= 0) return 180;
    return Math.max(30, sec);
  }

  function parseLines(text) {
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var dur = 180;
      var dm = line.match(/\s*[\[(]\s*(\d+:\d{1,2}|\d+)\s*[\])]\s*$/);
      if (dm) {
        dur = parseDur(dm[1]);
        line = line.slice(0, dm.index).trim();
      }
      var sep = line.search(/\s[-\u2013\u2014]\s/);
      var artist = "", title = line;
      if (sep > 0) {
        artist = line.slice(0, sep).trim();
        title = line.slice(sep).replace(/^\s[-\u2013\u2014]\s/, "").trim();
      }
      if (title) out.push({ title: title, artist: artist, duration: dur });
    });
    return out;
  }

  function tracks() {
    return Array.isArray(storage.tracks) ? storage.tracks : [];
  }

  // ---------- presence ----------
  function rawSend(activity) {
    if (!FD) FD = getDispatcher();
    if (!FD) { toast("Local Music: не нашёл FluxDispatcher"); return; }
    try {
      FD.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: activity, socketId: "LocalMusic" });
    } catch (e) {
      toast("Local Music: не удалось обновить статус");
    }
  }

  // Discord limits how often presence can change, so updates are spaced out.
  function send(activity) {
    latest = activity;
    if (sendTimer) return;
    var wait = Math.max(0, 2500 - (Date.now() - lastSent));
    sendTimer = setTimeout(function () {
      sendTimer = null;
      lastSent = Date.now();
      rawSend(latest);
    }, wait);
  }

  function buildActivity(t, start) {
    var a = {
      type: 2,
      name: String(storage.appName || "Music"),
      details: t.title,
      application_id: "0",
      flags: 1,
      timestamps: { start: start, end: start + t.duration * 1000 }
    };
    if (t.artist) a.state = t.artist;
    return a;
  }

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  // ---------- player ----------
  function playIndex(i, offsetMs) {
    var list = tracks();
    if (!list.length) { stop(); return; }
    var n = list.length;
    i = ((i % n) + n) % n;
    storage.idx = i;
    storage.active = true;
    var t = list[i];
    var off = offsetMs || 0;
    startedAt = Date.now() - off;
    elapsed = off;
    send(buildActivity(t, startedAt));
    clearTimer();
    timer = setTimeout(function () { advance(1, true); }, Math.max(1000, t.duration * 1000 - off));
  }

  function advance(dir, auto) {
    var list = tracks();
    var n = list.length;
    if (!n) { stop(); return; }
    var i = storage.idx || 0;
    if (auto && storage.loop === "one") { playIndex(i); return; }
    if (storage.shuffle && n > 1) {
      var j;
      do { j = Math.floor(Math.random() * n); } while (j === i);
      playIndex(j);
      return;
    }
    var ni = i + dir;
    if (auto && storage.loop === "off" && ni >= n) { stop(); return; }
    playIndex(ni);
  }

  function pause() {
    elapsed = Date.now() - startedAt;
    clearTimer();
    storage.active = false;
    send(null);
  }

  function stop() {
    clearTimer();
    elapsed = 0;
    storage.active = false;
    send(null);
  }

  function toggle() {
    if (storage.active) pause();
    else if (tracks().length) playIndex(storage.idx || 0, elapsed);
    else toast("Сначала добавь треки");
  }

  function removeTrack(i) {
    var list = tracks().slice();
    var cur = storage.idx || 0;
    list.splice(i, 1);
    storage.tracks = list;
    if (!list.length) { stop(); storage.idx = 0; return; }
    if (i < cur) storage.idx = cur - 1;
    else if (i === cur) { storage.idx = Math.min(cur, list.length - 1); if (storage.active) playIndex(storage.idx); }
  }

  // ---------- settings UI ----------
  var C = { bg: "#2b2d31", bg2: "#1e1f22", text: "#f2f3f5", dim: "#b5bac1", accent: "#5865f2", red: "#da373c", green: "#23a559" };

  function useRefresh() {
    var s = React.useState(0);
    React.useEffect(function () {
      var id = setInterval(function () { s[1](function (x) { return x + 1; }); }, 700);
      return function () { clearInterval(id); };
    }, []);
  }

  function Btn(p) {
    return h(RN.TouchableOpacity, {
      onPress: p.onPress,
      style: { backgroundColor: p.color || C.accent, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, marginRight: 8, marginTop: 8 }
    }, h(RN.Text, { style: { color: "#fff", fontWeight: "600" } }, p.label));
  }

  function Card(p) {
    return h(RN.View, { style: { backgroundColor: C.bg, borderRadius: 12, padding: 14, marginHorizontal: 12, marginTop: 12 } },
      p.title ? h(RN.Text, { style: { color: C.dim, fontSize: 12, fontWeight: "700", marginBottom: 4 } }, String(p.title).toUpperCase()) : null,
      p.children);
  }

  function Field(p) {
    return h(RN.TextInput, {
      value: p.value,
      onChangeText: p.onChange,
      placeholder: p.placeholder,
      placeholderTextColor: "#6d6f78",
      multiline: !!p.multiline,
      keyboardType: p.keyboardType,
      style: {
        color: C.text, backgroundColor: C.bg2, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
        marginTop: 8, minHeight: p.multiline ? 90 : undefined, textAlignVertical: p.multiline ? "top" : "center"
      }
    });
  }

  function Line(p) {
    return h(RN.View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 } },
      h(RN.Text, { style: { color: C.text, flex: 1, marginRight: 8 } }, p.label),
      p.right);
  }

  function Settings() {
    var useProxy = V.storage && V.storage.useProxy;
    if (useProxy) useProxy(storage); else useRefresh();

    var a = React.useState(""), title = a[0], setTitle = a[1];
    var b = React.useState(""), artist = b[0], setArtist = b[1];
    var c = React.useState(""), dur = c[0], setDur = c[1];
    var d = React.useState(""), bulk = d[0], setBulk = d[1];

    var list = tracks();
    var idx = storage.idx || 0;
    var cur = list[idx];
    var loop = storage.loop || "all";
    var loopLabel = loop === "one" ? "Повтор: трек" : (loop === "off" ? "Повтор: выкл" : "Повтор: список");

    function addOne() {
      if (!title.trim()) { toast("Введи название"); return; }
      storage.tracks = list.concat([{ title: title.trim(), artist: artist.trim(), duration: parseDur(dur) }]);
      setTitle(""); setArtist(""); setDur("");
    }

    function importBulk() {
      var items = parseLines(bulk);
      if (!items.length) { toast("Не нашёл ни одной строки"); return; }
      storage.tracks = list.concat(items);
      setBulk("");
      toast("Добавлено: " + items.length);
    }

    function cycleLoop() {
      storage.loop = loop === "all" ? "one" : (loop === "one" ? "off" : "all");
    }

    var rows = list.map(function (t, i) {
      var isCur = i === idx;
      return h(RN.View, { key: "t" + i, style: { flexDirection: "row", alignItems: "center", marginTop: 8, backgroundColor: isCur ? C.bg2 : "transparent", borderRadius: 8, padding: 6 } },
        h(RN.View, { style: { flex: 1 } },
          h(RN.Text, { numberOfLines: 1, style: { color: C.text, fontWeight: isCur ? "700" : "400" } }, t.title),
          h(RN.Text, { numberOfLines: 1, style: { color: C.dim, fontSize: 12 } }, (t.artist ? t.artist + " \u00b7 " : "") + fmt(t.duration))),
        h(RN.TouchableOpacity, { onPress: function () { playIndex(i); }, style: { padding: 8 } }, h(RN.Text, { style: { color: C.green, fontSize: 18 } }, "\u25b6")),
        h(RN.TouchableOpacity, { onPress: function () { removeTrack(i); }, style: { padding: 8 } }, h(RN.Text, { style: { color: C.red, fontSize: 18 } }, "\u2715")));
    });

    return h(RN.ScrollView, { style: { flex: 1 }, keyboardShouldPersistTaps: "handled", contentContainerStyle: { paddingBottom: 60 } },
      h(Card, { title: "Сейчас" },
        h(RN.Text, { style: { color: C.text, fontSize: 16, fontWeight: "700", marginTop: 4 } }, cur ? cur.title : "Плейлист пуст"),
        h(RN.Text, { style: { color: C.dim } }, cur ? ((cur.artist || "\u2014") + " \u00b7 " + fmt(cur.duration)) : "Добавь треки ниже"),
        h(RN.View, { style: { flexDirection: "row", flexWrap: "wrap" } },
          h(Btn, { label: "\u23ee", onPress: function () { advance(-1, false); } }),
          h(Btn, { label: storage.active ? "\u23f8 Пауза" : "\u25b6 Играть", onPress: toggle, color: storage.active ? C.red : C.green }),
          h(Btn, { label: "\u23ed", onPress: function () { advance(1, false); } }),
          h(Btn, { label: "\u23f9", onPress: stop, color: C.bg2 }))),
      h(Card, { title: "Настройки" },
        h(Line, { label: "Перемешивать", right: h(RN.Switch, { value: !!storage.shuffle, onValueChange: function (v) { storage.shuffle = v; } }) }),
        h(Line, { label: "Запускать вместе с Discord", right: h(RN.Switch, { value: !!storage.autostart, onValueChange: function (v) { storage.autostart = v; } }) }),
        h(RN.View, { style: { flexDirection: "row" } }, h(Btn, { label: loopLabel, onPress: cycleLoop, color: C.bg2 })),
        h(Field, { value: String(storage.appName || ""), onChange: function (v) { storage.appName = v; }, placeholder: "Название в «Слушает …» (по умолчанию Music)" })),
      h(Card, { title: "Добавить трек" },
        h(Field, { value: title, onChange: setTitle, placeholder: "Название" }),
        h(Field, { value: artist, onChange: setArtist, placeholder: "Исполнитель" }),
        h(Field, { value: dur, onChange: setDur, placeholder: "Длительность, мм:сс (по умолчанию 3:00)" }),
        h(RN.View, { style: { flexDirection: "row" } }, h(Btn, { label: "Добавить", onPress: addOne }))),
      h(Card, { title: "Импорт списком" },
        h(RN.Text, { style: { color: C.dim, fontSize: 12, marginTop: 4 } }, "По строке на трек: Исполнитель - Название [3:25]"),
        h(Field, { value: bulk, onChange: setBulk, placeholder: "akkiemi - I'm a stalker [2:30]", multiline: true }),
        h(RN.View, { style: { flexDirection: "row" } }, h(Btn, { label: "Импортировать", onPress: importBulk }))),
      h(Card, { title: "Плейлист (" + list.length + ")" }, rows.length ? rows : h(RN.Text, { style: { color: C.dim, marginTop: 8 } }, "Пока ничего")));
  }

  return {
    onLoad: function () {
      if (!Array.isArray(storage.tracks)) storage.tracks = [];
      if (typeof storage.idx !== "number") storage.idx = 0;
      if (!storage.loop) storage.loop = "all";
      storage.active = false;
      FD = getDispatcher();
      if (FD && FD.subscribe) {
        onConnect = function () {
          if (storage.active) {
            var t = tracks()[storage.idx || 0];
            if (t) send(buildActivity(t, startedAt));
          }
        };
        try { FD.subscribe("CONNECTION_OPEN", onConnect); } catch (e) {}
      }
      if (storage.autostart && tracks().length) playIndex(storage.idx || 0);
    },
    onUnload: function () {
      clearTimer();
      if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
      storage.active = false;
      rawSend(null);
      try { if (FD && FD.unsubscribe && onConnect) FD.unsubscribe("CONNECTION_OPEN", onConnect); } catch (e) {}
    },
    settings: Settings
  };
})()
