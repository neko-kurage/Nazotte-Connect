type TileKind = "normal" | "special";
type ChainMode = "color" | "special";
type ChainLineStyle = "normal" | "rainbow" | "specialCreate" | "specialEffect";
type SoundKey =
  | "start"
  | "trace"
  | "rainbow"
  | "effectiveGenerate"
  | "effectiveChain"
  | "removeNormal"
  | "removeBomb"
  | "removeReplace"
  | "timeUp";
type GameTile = HTMLDivElement;
type BoardCell = GameTile | null;
type Point = { x: number; y: number };
type CellPoint = { r: number; c: number };
type RenInfo = { count: number; bonus: number; makeSpecial: boolean; color: number | null };
type BtbInfo = { active: boolean; points: number };
type KeepSpecialInfo = { mode: "keep"; tile: GameTile; color: number | null };
type NormalCellsInfo = { mode: "normalCells"; cells: CellPoint[]; color: number; usedSpecials: GameTile[] };
type CreateSpecialInfo = KeepSpecialInfo | NormalCellsInfo | null;
type WebkitAudioWindow = Window & {
  /** Safari 旧実装で使う AudioContext コンストラクタ。 */
  webkitAudioContext?: typeof AudioContext;
};

const requiredElement = <T extends Element>(id: string, expected: { new (...args: unknown[]): T }): T => {
  const element = document.getElementById(id);
  if (!(element instanceof expected)) {
    throw new Error(`Required element #${id} is missing.`);
  }
  return element;
};

const isGameTile = (element: Element | null): element is GameTile => {
  return element instanceof HTMLDivElement && element.classList.contains("tile");
};

const soundUrls: Record<SoundKey, string> = {
  start: new URL("../../resources/sound/se/start.mp3", import.meta.url).href,
  trace: new URL("../../resources/sound/se/trace.mp3", import.meta.url).href,
  rainbow: new URL("../../resources/sound/se/rainbow.mp3", import.meta.url).href,
  effectiveGenerate: new URL("../../resources/sound/se/effective_generate.mp3", import.meta.url).href,
  effectiveChain: new URL("../../resources/sound/se/effective_chain.mp3", import.meta.url).href,
  removeNormal: new URL("../../resources/sound/se/remove_normal.mp3", import.meta.url).href,
  removeBomb: new URL("../../resources/sound/se/remove_bomb.mp3", import.meta.url).href,
  removeReplace: new URL("../../resources/sound/se/remove_replace.mp3", import.meta.url).href,
  timeUp: new URL("../../resources/sound/se/time_up.mp3", import.meta.url).href
};

const initNazotteConnect = (): void => {
const SIZE = 6;
const COLORS = 5;
const GAP = 7;
const board = requiredElement("board", HTMLDivElement);
const wrap = requiredElement("boardWrap", HTMLDivElement);
const svg = requiredElement("lineLayer", SVGSVGElement);
const scoreEl = requiredElement("score", HTMLSpanElement);
const timeEl = requiredElement("time", HTMLSpanElement);
const chainEl = requiredElement("chain", HTMLSpanElement);
const startBtn = requiredElement("start", HTMLButtonElement);
const hintBtn = requiredElement("hint", HTMLButtonElement);
const soundToggleBtn = requiredElement("soundToggle", HTMLButtonElement);
const messageEl = requiredElement("message", HTMLParagraphElement);
const soundMuteIcon = requiredElement("soundIconMute", HTMLImageElement);
const soundMaxIcon = requiredElement("soundIconMax", HTMLImageElement);

let grid: BoardCell[][] = [];
let selected: GameTile[] = [];
let selectedColor: number | null = null;
let chainMode: ChainMode | null = null;
let dragging = false;
let resolving = false;
let score = 0;
let timeLeft = 75;
let playing = false;
let timer: number | null = null;
let combo = 0;
let lastRenCount = 0;
let renStreak = 0;
let btbReady = false;
let moveTargetTile: GameTile | null = null;
let timePaused = false;
let bonusLocked = false;
let longPressTimer: number | null = null;
let longPressStarted = false;
let pendingSpecialTile: GameTile | null = null;
let startPoint: Point | null = null;
let pointerMoved = false;
let activeBoardTouch = false;
let currentChainLineStyle: ChainLineStyle | null = null;
let soundMuted = true;
let audioContext: AudioContext | null = null;
let audioGain: GainNode | null = null;
let audioReady = false;
let audioPreparing: Promise<void> | null = null;
const soundBuffers: Partial<Record<SoundKey, AudioBuffer>> = {};
const soundLastPlayedAt: Record<SoundKey, number> = {
  start: -Infinity,
  trace: -Infinity,
  rainbow: -Infinity,
  effectiveGenerate: -Infinity,
  effectiveChain: -Infinity,
  removeNormal: -Infinity,
  removeBomb: -Infinity,
  removeReplace: -Infinity,
  timeUp: -Infinity
};
const LONG_PRESS_MS = 260;
const SLIDE_START_PX = 12;
const REN_SCORE_STEP_CAP = 10;
const soundCooldownMs: Record<SoundKey, number> = {
  start: 0,
  trace: 20,
  rainbow: 90,
  effectiveGenerate: 150,
  effectiveChain: 150,
  removeNormal: 45,
  removeBomb: 45,
  removeReplace: 45,
  timeUp: 0
};

/**
 * 効果音用の AudioContext を返す。
 *
 * @return 効果音のデコードと再生に使う AudioContext。
 */
function getAudioContext(): AudioContext {
  if (!audioContext) {
    var AudioContextClass = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextClass) throw new Error("AudioContext is not supported.");

    audioContext = new AudioContextClass();
    audioGain = audioContext.createGain();
    audioGain.gain.value = soundMuted ? 0 : 1;
    audioGain.connect(audioContext.destination);
  }

  return audioContext;
}

/**
 * 効果音ファイルを一度だけ読み込み、AudioBuffer へデコードする。
 *
 * @return 準備完了時に解決する Promise。
 */
async function prepareAudio(): Promise<void> {
  if (audioReady) return;
  if (audioPreparing) return audioPreparing;

  audioPreparing = (async function () {
    try {
      var ctx = getAudioContext();
      await ctx.resume();

      await Promise.all(
        (Object.keys(soundUrls) as SoundKey[]).map(async function (key) {
          if (soundBuffers[key]) return;

          var response = await fetch(soundUrls[key]);
          if (!response.ok) throw new Error("Failed to load sound: " + key);
          var arrayBuffer = await response.arrayBuffer();
          soundBuffers[key] = await ctx.decodeAudioData(arrayBuffer);
        })
      );

      audioReady = true;
    } finally {
      audioPreparing = null;
    }
  })();

  return audioPreparing;
}

/**
 * 指定した効果音を AudioBufferSourceNode として再生する。
 *
 * @param key 再生する効果音の種類。
 */
function playSound(key: SoundKey): void {
  if (soundMuted) return;
  if (!audioContext || !audioReady) return;

  var now = performance.now();
  if (now - soundLastPlayedAt[key] < soundCooldownMs[key]) return;

  var buffer = soundBuffers[key];
  var gain = audioGain;
  if (!buffer || !gain) return;

  soundLastPlayedAt[key] = now;
  var source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(gain);
  source.start();
}

/**
 * 効果音のミュート状態をUIとゲインへ反映する。
 *
 * @param muted ミュートする場合は true。
 */
function setSoundMuted(muted: boolean): void {
  soundMuted = muted;
  if (audioGain) audioGain.gain.value = muted ? 0 : 1;

  soundToggleBtn.setAttribute("aria-pressed", String(!muted));
  soundToggleBtn.setAttribute("aria-label", muted ? "音を出す" : "音を消す");
  soundMuteIcon.hidden = !muted;
  soundMaxIcon.hidden = muted;
}

function randColor(): number { return Math.floor(Math.random() * COLORS); }
function tileSize(): number { return (board.clientWidth - GAP * (SIZE - 1)) / SIZE; }
function pos(row: number, col: number): { left: number; top: number; size: number } {
  var s = tileSize();
  return { left: col * (s + GAP), top: row * (s + GAP), size: s };
}

function makeTile(row: number, col: number, color: number | null, spawnFromAbove: boolean, type: TileKind | undefined): GameTile {
  var tile = document.createElement("div");
  tile.dataset.row = String(row);
  tile.dataset.col = String(col);
  tile.dataset.color = String(color);
  tile.dataset.type = type || "normal";
  applyClass(tile);
  tile.textContent = "";
  var p = pos(row, col);
  tile.style.width = p.size + "px";
  tile.style.height = p.size + "px";
  tile.style.left = p.left + "px";
  tile.style.top = (spawnFromAbove ? p.top - board.clientHeight * 0.35 : p.top) + "px";
  board.appendChild(tile);
  if (spawnFromAbove) {
    requestAnimationFrame(function () {
      tile.classList.add("spawn");
      moveTile(tile, row, col);
    });
  }
  return tile;
}

function applyClass(tile: GameTile): void {
  var type = tile.dataset.type || "normal";
  var color = tile.dataset.color || "0";
  tile.className = "tile c" + color + (type === "special" ? " special" : "");
}

function moveTile(tile: GameTile, row: number, col: number): void {
  tile.dataset.row = String(row);
  tile.dataset.col = String(col);
  var p = pos(row, col);
  tile.style.width = p.size + "px";
  tile.style.height = p.size + "px";
  tile.style.left = p.left + "px";
  tile.style.top = p.top + "px";
}

function buildBoard(): void {
  board.innerHTML = "";
  grid = [];
  for (var r = 0; r < SIZE; r++) {
    grid[r] = [];
    for (var c = 0; c < SIZE; c++) {
      grid[r][c] = makeTile(r, c, randColor(), false, "normal");
    }
  }
  ensurePlayable(true);
  updateLine();
}

function startGame(): void {
  playSound("start");
  score = 0;
  timeLeft = 75;
  combo = 0;
  lastRenCount = 0;
  renStreak = 0;
  btbReady = false;
  playing = true;
  resolving = false;
  timePaused = false;
  bonusLocked = false;
  selected = [];
  selectedColor = null;
  chainMode = null;
  dragging = false;
  cancelStarMoveTarget();
  scoreEl.textContent = "0";
  timeEl.textContent = String(timeLeft);
  chainEl.textContent = "0";
  messageEl.textContent = "通常ブロックだけの同数連続消しでREN！★を挟むとRENは切れる。★技連続はBTB x2！";
  startBtn.textContent = "やめる";
  startBtn.classList.add("isStop");
  buildBoard();
  if (timer !== null) window.clearInterval(timer);
  timer = window.setInterval(function () {
    if (timePaused) return;
    timeLeft -= 1;
    timeEl.textContent = String(timeLeft);
    if (timeLeft <= 0) endGame("timeUp");
  }, 1000);
}

/**
 * ゲームを終了し、終了理由に応じた演出を行う。
 *
 * @param reason 終了理由。時間切れの場合だけ専用SEを鳴らす。
 */
function endGame(reason: "timeUp" | "normal" = "normal"): void {
  playing = false;
  resolving = false;
  timePaused = false;
  bonusLocked = false;
  btbReady = false;
  dragging = false;
  longPressStarted = false;
  pendingSpecialTile = null;
  startPoint = null;
  pointerMoved = false;
  clearLongPressTimer();
  if (reason === "timeUp") playSound("timeUp");
  if (timer !== null) window.clearInterval(timer);
  clearSelection();
  cancelStarMoveTarget();
  startBtn.textContent = "スタート";
  startBtn.classList.remove("isStop");
  var rank = judgeRank(score);
  messageEl.textContent = "終了！スコア " + score + " / ランク: " + rank;
}

function judgeRank(score: number): string {
  // 得点設計に合わせて、★技やレインボーが噛み合っても神ランクが遠くなるよう調整。
  // 旧版は15,000点で最高ランクだったため、特殊連鎖に慣れるとすぐ天井に到達していた。
  if (score >= 1000000) return "宇宙コネクト神";
  if (score >= 750000) return "銀河盤面の覇者";
  if (score >= 500000) return "虹色創造神";
  if (score >= 350000) return "盤面構築の神";
  if (score >= 250000) return "なぞりの魔王";
  if (score >= 180000) return "レインボー支配者";
  if (score >= 120000) return "特殊職人・極";
  if (score >= 80000) return "連鎖マスター";
  if (score >= 50000) return "特殊職人";
  if (score >= 30000) return "盤面づくり上手";
  if (score >= 15000) return "上手い";
  if (score >= 7000) return "慣れてきた";
  return "ふつう";
}

function getTileFromPoint(x: number, y: number): GameTile | null {
  var el = document.elementFromPoint(x, y);
  return isGameTile(el) ? el : null;
}

function isSpecial(tile: GameTile | null): tile is GameTile {
  return Boolean(tile && tile.dataset.type === "special");
}

function isBoardEventTarget(target: EventTarget | null): boolean {
  return target instanceof Node && (board.contains(target) || svg.contains(target));
}

function adjacent(a: GameTile, b: GameTile): boolean {
  var ar = Number(a.dataset.row), ac = Number(a.dataset.col);
  var br = Number(b.dataset.row), bc = Number(b.dataset.col);
  var dr = Math.abs(ar - br), dc = Math.abs(ac - bc);
  return dr <= 1 && dc <= 1 && dr + dc > 0;
}

function pointerStart(e: MouseEvent | TouchEvent): void {
  if (!playing || resolving || bonusLocked) return;
  if (!isBoardEventTarget(e.target)) return;

  activeBoardTouch = true;
  e.preventDefault();

  var p = point(e);
  var tile = getTileFromPoint(p.x, p.y);
  longPressStarted = false;
  pendingSpecialTile = null;
  startPoint = p;
  pointerMoved = false;
  clearLongPressTimer();

  if (moveTargetTile) {
    handleTargetedStarTap(tile);
    return;
  }

  if (tile && isSpecial(tile)) {
    // 短いタップ: ★移動モード
    // 長押し: ★同士チェーン開始
    pendingSpecialTile = tile;
    longPressTimer = setTimeout(function () {
      if (!pendingSpecialTile || resolving || !playing) return;
      longPressStarted = true;
      cancelStarMoveTarget();
      clearSelection();
      dragging = true;
      addTile(pendingSpecialTile);
      messageEl.textContent = "★チェーン中。同色なら方向ライン生成、異色なら大量破壊！";
    }, LONG_PRESS_MS);
    return;
  }

  cancelStarMoveTarget();
  clearSelection();
  dragging = true;
  addTile(tile);
}

function pointerMove(e: MouseEvent | TouchEvent): void {
  if (!playing || resolving || bonusLocked) {
    cancelPointerInput();
    return;
  }
  if (!activeBoardTouch) return;

  e.preventDefault();
  var p = point(e);

  if (startPoint) {
    var moveDx = p.x - startPoint.x;
    var moveDy = p.y - startPoint.y;
    pointerMoved = pointerMoved || Math.sqrt(moveDx * moveDx + moveDy * moveDy) > SLIDE_START_PX;
  }

  if (pendingSpecialTile && !longPressStarted) {
    if (!startPoint) return;
    var dx = p.x - startPoint.x;
    var dy = p.y - startPoint.y;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (pointerMoved || dist > SLIDE_START_PX) {
      // ★を押してスライドし始めたら、長押しを待たずに★チェーン開始
      clearLongPressTimer();
      longPressStarted = true;
      cancelStarMoveTarget();
      clearSelection();
      dragging = true;
      addTile(pendingSpecialTile);
      messageEl.textContent = "★チェーン中。同色なら方向ライン生成、異色なら大量破壊！";
    } else {
      return;
    }
  }

  if (!dragging) return;

  addTile(getTileFromPoint(p.x, p.y));
}

function pointerEnd(e: MouseEvent | TouchEvent): void {
  if (!playing || resolving || bonusLocked) {
    cancelPointerInput();
    return;
  }
  if (!activeBoardTouch) return;

  activeBoardTouch = false;
  e.preventDefault();

  if (pendingSpecialTile && !longPressStarted) {
    var tile = pendingSpecialTile;
    clearLongPressTimer();
    pendingSpecialTile = null;

    clearSelection();
    if (!pointerMoved && countSpecialTiles() >= 2) {
      setStarMoveTarget(tile);
    } else {
      cancelStarMoveTarget();
    }
    return;
  }

  clearLongPressTimer();
  pendingSpecialTile = null;

  if (!dragging) return;
  dragging = false;

  if (!pointerMoved && !longPressStarted && selected.length === 1) {
    var target = selected[0];
    clearSelection();
    if (canSetStarMoveTarget(target)) setStarMoveTarget(target);
    return;
  }

  releaseChain();
}

function cancelPointerInput(): void {
  activeBoardTouch = false;
  dragging = false;
  pendingSpecialTile = null;
  longPressStarted = false;
  clearLongPressTimer();
}

function clearLongPressTimer(): void {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function point(e: MouseEvent | TouchEvent): Point {
  if ("touches" in e) {
    var touch = e.touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : { x: 0, y: 0 };
  }
  return { x: e.clientX, y: e.clientY };
}

/**
 * 盤面上にある★の数を返す。
 *
 * @return 現在の★の数。
 */
function countSpecialTiles(): number {
  var count = 0;
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (isSpecial(grid[r][c])) count += 1;
    }
  }
  return count;
}

/**
 * 指定したタイルを★移動先にできるかを返す。
 *
 * @param tile 移動先候補のタイル。
 * @return 移動に使える★が盤面上にある場合は true。
 */
function canSetStarMoveTarget(tile: GameTile): boolean {
  var requiredSpecialCount = isSpecial(tile) ? 2 : 1;
  return countSpecialTiles() >= requiredSpecialCount;
}

/**
 * ★の移動先を指定し、★以外を控えめに表示する。
 *
 * @param tile 移動先として指定したタイル。
 */
function setStarMoveTarget(tile: GameTile): void {
  cancelStarMoveTarget();
  clearSelection();
  moveTargetTile = tile;
  board.classList.add("starTargeting");
  tile.classList.add("moveTarget");
  messageEl.textContent = "移動先を指定中。動かしたい★をタップ！";
}

/**
 * ★移動先の指定状態を解除する。
 */
function cancelStarMoveTarget(): void {
  if (moveTargetTile && moveTargetTile.classList) moveTargetTile.classList.remove("moveTarget");
  moveTargetTile = null;
  board.classList.remove("starTargeting");
}

/**
 * 指定済みのピースをタップされた★の位置へ移動し、★を消費する。
 *
 * @param star 消費する候補のタイル。
 */
function handleTargetedStarTap(star: GameTile | null): void {
  if (!moveTargetTile || !isSpecial(star) || star === moveTargetTile) {
    cancelStarMoveTarget();
    return;
  }

  if (!playing || resolving) return;

  resolving = true;

  var sr = Number(star.dataset.row);
  var sc = Number(star.dataset.col);
  var tr = Number(moveTargetTile.dataset.row);
  var tc = Number(moveTargetTile.dataset.col);
  var target = moveTargetTile;

  grid[sr][sc] = target;
  grid[tr][tc] = null;
  if (star.parentNode) star.parentNode.removeChild(star);
  moveTile(target, sr, sc);
  showEmptyMark(tr, tc);
  cancelStarMoveTarget();

  score += 120;
  scoreEl.textContent = String(score);
  messageEl.textContent = "ピース移動！ 空いた場所から落下";
  playSound("removeReplace");
  floatText("MOVE +120", false);

  setTimeout(function () {
    applyGravityAndSpawn(null);
    setTimeout(function () {
      resolving = false;
      removeSpawnMarks();
      ensurePlayable(false);
      messageEl.textContent = "配置を作って5個以上を狙え！";
    }, 270);
  }, 230);
}

/**
 * 空いたマスを一時的に表示する。
 *
 * @param row 表示する行。
 * @param col 表示する列。
 */
function showEmptyMark(row: number, col: number): void {
  var p = pos(row, col);
  var mark = document.createElement("div");
  mark.className = "emptyMark";
  mark.style.width = p.size + "px";
  mark.style.height = p.size + "px";
  mark.style.left = p.left + "px";
  mark.style.top = p.top + "px";
  board.appendChild(mark);
  setTimeout(function () { if (mark.parentNode) mark.parentNode.removeChild(mark); }, 360);
}

function addTile(tile: GameTile | null): void {
  if (!playing || resolving || !tile) return;
  var color = Number(tile.dataset.color);

  if (selected.length === 0) {
    chainMode = isSpecial(tile) ? "special" : "color";
    selectedColor = color;
    selected.push(tile);
    tile.classList.add("selected");
    playSound("trace");
    updateLine();
    chainEl.textContent = String(selected.length);
    return;
  }

  var last = selected[selected.length - 1];

  if (selected.length >= 2 && tile === selected[selected.length - 2]) {
    last.classList.remove("selected");
    selected.pop();
    updateLine();
    chainEl.textContent = String(selected.length);
    return;
  }

  if (selected.indexOf(tile) !== -1) return;
  if (!adjacent(last, tile)) return;

  if (chainMode === "special") {
    // 特殊チェーンは色に関係なく★同士を繋げられる。
    // 同色だけなら横列を普通ピース化、異色を含むなら大量破壊。
    if (tile.dataset.type !== "special") {
      if (selected.length !== 1 || Number(tile.dataset.color) !== selectedColor) return;
      chainMode = "color";
    }
  } else {
    // 通常チェーンは同色のみ。特殊も同色なら含められる
    if (Number(tile.dataset.color) !== selectedColor) return;
  }

  selected.push(tile);
  tile.classList.add("selected");
  playSound("trace");
  updateLine();
  chainEl.textContent = String(selected.length);
}

function resetRen(): void {
  lastRenCount = 0;
  renStreak = 0;
}

function calcRenBonus(clearCount: number, color: number | null): RenInfo {
  if (lastRenCount === clearCount) {
    renStreak += 1;
  } else {
    lastRenCount = clearCount;
    renStreak = 1;
  }

  var bonus = renStepBonus(clearCount, renStreak);
  return {
    count: renStreak,
    bonus: bonus,
    makeSpecial: renStreak > 0 && renStreak % 5 === 0,
    color: color
  };
}

/**
 * 現在のREN状態で次の通常消しが★生成に届くかを返す。
 *
 * @param clearCount 今回消す予定の通常ブロック数。
 * @return 次の通常消しでREN由来の★生成が起きる場合は true。
 */
function willCreateRenSpecial(clearCount: number): boolean {
  var nextStreak = lastRenCount === clearCount ? renStreak + 1 : 1;
  return nextStreak > 0 && nextStreak % 5 === 0;
}

/**
 * REN 1回ぶんの加点を返す。
 *
 * @param clearCount 今回消した通常ブロック数。
 * @param streak 現在のREN数。表示や★生成判定では上限を設けない。
 * @return 11REN以降は10REN時と同じ点数を加算する。
 */
function renStepBonus(clearCount: number, streak: number): number {
  var scoreStep = Math.min(streak, REN_SCORE_STEP_CAP);
  return clearCount * 100 * scoreStep;
}

function renText(info: RenInfo | null): string {
  if (!info || info.count < 2) return "";
  return " / " + info.count + "REN +" + info.bonus + (info.makeSpecial ? " ★生成" : "");
}

function applyBtbIfNeeded(points: number, isSpecialTechnique: boolean): BtbInfo {
  var active = isSpecialTechnique && btbReady;
  var finalPoints = active ? points * 2 : points;

  // BTBは「特殊ブロックを含む特殊消し」が連続した時だけ継続。
  // 通常消し、通常の5個消し★生成では切れる。倍率は何連続しても2倍固定。
  if (isSpecialTechnique) {
    btbReady = true;
  } else {
    btbReady = false;
  }

  return { active: active, points: finalPoints };
}

function btbText(info: BtbInfo | null): string {
  return info && info.active ? " / BTB x2" : "";
}

function showBtbFloat(info: BtbInfo | null): void {
  if (info && info.active) floatText("BTB x2!", true);
}

/**
 * 残り時間を加算し、HUDへ反映する。
 *
 * @param seconds 追加する秒数。
 */
function addTimeBonus(seconds: number): void {
  if (seconds <= 0) return;
  timeLeft += seconds;
  timeEl.textContent = String(timeLeft);
}

function applyRenSpecialIfNeeded(info: RenInfo | null, currentInfo: CreateSpecialInfo, targets: GameTile[]): CreateSpecialInfo {
  if (!info || !info.makeSpecial) return currentInfo;
  if (currentInfo) return currentInfo;

  var keeper = lastNormalInSelection(selected) || selected[selected.length - 1];
  if (!keeper) return currentInfo;

  for (var i = targets.length - 1; i >= 0; i--) {
    if (targets[i] === keeper) targets.splice(i, 1);
  }
  floatText(info.count + "REN ★生成!", true);
  return { mode: "keep", tile: keeper, color: info.color };
}

function releaseChain(): void {
  var isSpecialChain = chainMode === "special" && selected.length >= 2;

  if (selected.length >= 3 || isSpecialChain) {
    resolving = true;

    var n = selected.length;
    var specials = selected.filter(isSpecial);
    combo += 1;

    var targets: GameTile[] = selected.slice();
    var gained = 0;
    var createSpecialInfo: CreateSpecialInfo = null;
    var superExplosion = false;

    if (isSpecialChain) {
      var sameColor = allSameColor(specials);
      var color = Number(specials[0].dataset.color);
      resetRen();

      if (sameColor) {
        // 同じ色の★同士:
        // 繋いだ方向のライン全体を同じ色の普通ピースにする。
        // ★の数が増えるほどかなり強くなる。
        var pathCells = directionalCellsFromPath(specials);
        var sameMultiplier = specials.length * specials.length;
        var longChainBonus = specials.length >= 5 ? 9000 : specials.length >= 4 ? 5200 : specials.length >= 3 ? 2200 : 0;
        // 同色★ラインは仕込み型の高得点技。2個で4,000〜7,000、3個で10,000〜16,000が目安。
        gained = pathCells.length * 230 * specials.length + sameMultiplier * 720 + longChainBonus + combo * 160;
        var btbInfo = applyBtbIfNeeded(gained, true);
        gained = btbInfo.points;
        score += gained;
        scoreEl.textContent = String(score);
        var sameColorTimeBonus = (specials.length - 1) * 5;
        addTimeBonus(sameColorTimeBonus);
        messageEl.textContent = "同色★" + specials.length + "連結！ ライン生成 +" + gained + " / +" + sameColorTimeBonus + "秒" + btbText(btbInfo);
        playSound("removeReplace");
        linePaintEffects(specials, gained);
        showBtbFloat(btbInfo);

        createSpecialInfo = {
          mode: "normalCells",
          cells: pathCells,
          color: color,
          // 使用した★は消費扱いで普通ピースに戻す。
          // ラインに巻き込まれただけの未使用★は、従来どおり★のまま色だけ変える。
          usedSpecials: specials.slice()
        };
        targets = [];
        superExplosion = false;
      } else {
        // 異なる色の★を混ぜた場合:
        // 大量破壊。全色混ぜると特別ボーナス。
        targets = mixedSpecialTargets(specials);
        var colorCount = uniqueColorCount(specials);
        // 異色★爆発はピンチ脱出＋瞬間高得点。全色ミックスは時間ボーナス込みの超大技。
        var allColorBonus = colorCount >= COLORS ? 12000 + targets.length * 160 : 0;
        gained = targets.length * 75 * (specials.length + 1) + specials.length * specials.length * 650 + colorCount * 400 + allColorBonus + combo * 120;
        var btbInfo = applyBtbIfNeeded(gained, true);
        gained = btbInfo.points;
        score += gained;
        scoreEl.textContent = String(score);

        if (colorCount >= COLORS) {
          messageEl.textContent = "全色★ミックス！ レインボーボーナス +" + gained + btbText(btbInfo);
          playSound("removeBomb");
          megaEffects(specials.length + 2, gained);
          rainbowEffects(gained);
        } else {
          var mixedColorTimeBonus = colorCount * 3;
          addTimeBonus(mixedColorTimeBonus);
          messageEl.textContent = "異色★ミックス！ 大量破壊 +" + gained + " / +" + mixedColorTimeBonus + "秒" + btbText(btbInfo);
          playSound("removeBomb");
          megaEffects(specials.length, gained);
        }
        showBtbFloat(btbInfo);
        superExplosion = true;
      }
    } else {
      if (n >= 3 && specials.length > 0) {
        // 2個+★以上で消した場合:
        // その色の普通ピースを全消しする。
        // ★生成は従来どおり4個+★以上の時だけ行う。
        var createsSpecialFromColorClear = n >= 5;
        var colorToClear = selectedColor;
        var keeper = lastNormalInSelection(selected);
        var colorClearTargets = allTilesOfColor(colorToClear);

        if (createsSpecialFromColorClear && keeper) {
          colorClearTargets = colorClearTargets.filter(function (t) { return t !== keeper; });
          targets = uniqueTiles(targets.concat(colorClearTargets)).filter(function (t) { return t !== keeper; });
          createSpecialInfo = { mode: "keep", tile: keeper, color: selectedColor };
        } else {
          targets = uniqueTiles(targets.concat(colorClearTargets));
        }

        // RENは「通常ブロックだけを同じ数で連続して消した時」だけ。
        // ★を含む色全消しは特殊技なのでRENは切れる。
        resetRen();
        gained = targets.length * 90 + n * n * 22 + specials.length * 720 + combo * 90 + 650;
        var btbInfo = applyBtbIfNeeded(gained, true);
        gained = btbInfo.points;
        score += gained;
        scoreEl.textContent = String(score);
        messageEl.textContent = createsSpecialFromColorClear
          ? "★込み5個以上！ 色全消し＋★生成 +" + gained + btbText(btbInfo)
          : "2個+★！ 色全消し +" + gained + btbText(btbInfo);
        playSound("removeBomb");
        megaEffects(2 + specials.length, gained);
        showBtbFloat(btbInfo);
        superExplosion = true;
      } else {
        var renInfo: RenInfo | null = null;
        if (specials.length === 0) {
          // RENは通常ブロックだけ。同じ個数なら5個以上でも継続する。
          renInfo = calcRenBonus(n, selectedColor);
        } else {
          // 同色チェーンに★を混ぜた場合もRENは切れる。
          resetRen();
        }

        gained = n * n * 14 + combo * 45 + specials.length * 280 + (renInfo ? renInfo.bonus : 0);
        var btbInfo = applyBtbIfNeeded(gained, false);
        gained = btbInfo.points;

        if (n >= 5) {
          // バグ対策:
          // 生成位置は落下後の座標に上書きしない。
          // 消したピース自身を特殊化して残す方式にする。
          var generatedKeeper = selected[selected.length - 1];
          targets = selected.filter(function (t) { return t !== generatedKeeper; });
          createSpecialInfo = { mode: "keep", tile: generatedKeeper, color: selectedColor };
          messageEl.textContent = n + "個消し！ ★生成 +" + gained + renText(renInfo);
          playSound("removeNormal");
          if (renInfo && renInfo.count >= 2) {
            floatText(renInfo.count + "REN +" + renInfo.bonus, true);
          } else {
            floatText("★生成!", false);
          }
        } else {
          createSpecialInfo = applyRenSpecialIfNeeded(renInfo, createSpecialInfo, targets);
          messageEl.textContent = n + "個消し！ +" + gained + renText(renInfo);
          playSound("removeNormal");
          floatText(renInfo && renInfo.count >= 2 ? renInfo.count + "REN +" + renInfo.bonus : "+" + gained, Boolean(renInfo && renInfo.count >= 2));
        }
        score += gained;
        scoreEl.textContent = String(score);
      }
    }

    vanishDropAndFill(targets, createSpecialInfo, superExplosion);
  } else {
    if (chainMode === "special") {
      messageEl.textContent = "★チェーンは長押しから。2個以上つなげよう！";
    } else {
      messageEl.textContent = "3個以上つなげて消そう";
    }
    clearSelection();
  }
}

function allSameColor(tiles: GameTile[]): boolean {
  if (!tiles.length) return false;
  var color = Number(tiles[0].dataset.color);
  return tiles.every(function (t) {
    return Number(t.dataset.color) === color;
  });
}

function uniqueColorCount(tiles: GameTile[]): number {
  var colors: number[] = [];
  tiles.forEach(function (t) {
    var color = Number(t.dataset.color);
    if (colors.indexOf(color) === -1) colors.push(color);
  });
  return colors.length;
}

function linePaintEffects(path: GameTile[], gained: number): void {
  wrap.classList.add("megaShake");
  setTimeout(function () { wrap.classList.remove("megaShake"); }, 420);

  for (var i = 0; i < path.length - 1; i++) {
    var a = path[i];
    var b = path[i + 1];
    var ar = Number(a.dataset.row);
    var ac = Number(a.dataset.col);
    var br = Number(b.dataset.row);
    var bc = Number(b.dataset.col);
    var dr = Math.sign(br - ar);
    var dc = Math.sign(bc - ac);
    addLineFlashThrough(ar, ac, dr, dc);
  }

  if (path.length >= 3) {
    var wave = document.createElement("div");
    wave.className = "shockwave";
    wrap.appendChild(wave);
    setTimeout(function () { wave.remove(); }, 700);
  }

  floatText((path.length >= 4 ? "BIG LINE! " : "LINE! ") + "+" + gained, true);
}

function addLineFlashThrough(r: number, c: number, dr: number, dc: number): void {
  if (dr === 0 && dc === 0) return;

  var s = tileSize();
  var cells: CellPoint[] = [];

  var sr = r;
  var sc = c;
  while (sr - dr >= 0 && sr - dr < SIZE && sc - dc >= 0 && sc - dc < SIZE) {
    sr -= dr;
    sc -= dc;
  }
  while (sr >= 0 && sr < SIZE && sc >= 0 && sc < SIZE) {
    cells.push({ r: sr, c: sc });
    sr += dr;
    sc += dc;
  }
  if (!cells.length) return;

  var first = cells[0];
  var last = cells[cells.length - 1];
  var p1 = pos(first.r, first.c);
  var p2 = pos(last.r, last.c);
  var x1 = 10 + p1.left + s / 2;
  var y1 = 10 + p1.top + s / 2;
  var x2 = 10 + p2.left + s / 2;
  var y2 = 10 + p2.top + s / 2;
  var length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) + s;
  var angle = Math.atan2(y2 - y1, x2 - x1);

  var flash = document.createElement("div");
  flash.className = "lineFlash";
  flash.style.width = length + "px";
  flash.style.height = Math.max(12, s * .22) + "px";
  flash.style.left = ((x1 + x2) / 2 - length / 2) + "px";
  flash.style.top = ((y1 + y2) / 2 - Math.max(12, s * .22) / 2) + "px";
  flash.style.setProperty("--angle", angle + "rad");
  wrap.appendChild(flash);
  setTimeout(function () { flash.remove(); }, 680);
}

function rainbowEffects(gained: number): void {
  playSound("rainbow");
  var rb = document.createElement("div");
  rb.className = "rainbowBurst";
  wrap.appendChild(rb);
  setTimeout(function () { rb.remove(); }, 920);

  floatText("RAINBOW BONUS! +" + gained, true);

  // レインボーボーナス本体:
  // 5秒間、時間停止・操作不可・虹色演出。その後30秒追加。
  bonusLocked = true;
  timePaused = true;

  var overlay = document.createElement("div");
  overlay.className = "rainbowTimeBonus";

  var text = document.createElement("div");
  text.className = "rainbowTimeBonusText";
  text.innerHTML = "RAINBOW BONUS<br>TIME +30";
  overlay.appendChild(text);
  wrap.appendChild(overlay);

  messageEl.textContent = "レインボーボーナス！時間停止中...";

  setTimeout(function () {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    timeLeft += 30;
    timeEl.textContent = String(timeLeft);
    timePaused = false;
    bonusLocked = false;
    if (playing) messageEl.textContent = "時間 +30秒！ 再開！";
    floatText("+30s", true);
  }, 5000);
}

function directionalCellsFromPath(path: GameTile[]): CellPoint[] {
  // ★同士を繋いだ「方向」のライン全体を、その色の普通ピースにする。
  // 横なら行全体、縦なら列全体、斜めなら盤面端から端までの斜めライン。
  // 曲げて繋いだ場合は、各線分ごとにラインを作る。
  var cells: CellPoint[] = [];
  if (path.length < 2) return cells;

  function addCell(r: number, c: number): void {
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return;
    if (!cells.some(function (cell) { return cell.r === r && cell.c === c; })) {
      cells.push({ r: r, c: c });
    }
  }

  function addFullLineThrough(r: number, c: number, dr: number, dc: number): void {
    if (dr === 0 && dc === 0) return;

    // まず反対方向に盤面端まで戻る
    var sr = r;
    var sc = c;
    while (sr - dr >= 0 && sr - dr < SIZE && sc - dc >= 0 && sc - dc < SIZE) {
      sr -= dr;
      sc -= dc;
    }

    // そこから正方向に端まで塗る
    while (sr >= 0 && sr < SIZE && sc >= 0 && sc < SIZE) {
      addCell(sr, sc);
      sr += dr;
      sc += dc;
    }
  }

  for (var i = 0; i < path.length - 1; i++) {
    var a = path[i];
    var b = path[i + 1];
    var ar = Number(a.dataset.row);
    var ac = Number(a.dataset.col);
    var br = Number(b.dataset.row);
    var bc = Number(b.dataset.col);
    var dr = Math.sign(br - ar);
    var dc = Math.sign(bc - ac);

    addFullLineThrough(ar, ac, dr, dc);
  }

  return cells;
}

function mixedSpecialTargets(specials: GameTile[]): GameTile[] {
  var out: GameTile[] = [];
  var power = specials.length;

  specials.forEach(function (sp) {
    var r = Number(sp.dataset.row);
    var c = Number(sp.dataset.col);
    addArea(out, r, c, Math.min(3, power));
  });

  if (specials.length >= 3) {
    specials.forEach(function (sp) {
      var row = Number(sp.dataset.row);
      var col = Number(sp.dataset.col);
      for (var c = 0; c < SIZE; c++) {
        var rowTile = grid[row][c];
        if (rowTile) out.push(rowTile);
      }
      for (var r = 0; r < SIZE; r++) {
        var colTile = grid[r][col];
        if (colTile) out.push(colTile);
      }
    });
  }

  if (specials.length >= 4) {
    for (var rr = 0; rr < SIZE; rr++) {
      for (var cc = 0; cc < SIZE; cc++) {
              var tile = grid[rr][cc];
              if ((rr + cc) % 2 === 0 && tile) out.push(tile);
      }
    }
  }

  if (specials.length >= 5) {
    for (var r2 = 0; r2 < SIZE; r2++) {
      for (var c2 = 0; c2 < SIZE; c2++) {
              var tile = grid[r2][c2];
              if (tile) out.push(tile);
      }
    }
  }

  // 異色★ミックスの爆発では、使用した★だけを消費する。
  // 爆風に巻き込まれただけの他の★は盤面に残す。
  return uniqueTiles(out).filter(function (tile) {
    return tile.dataset.type !== "special" || specials.indexOf(tile) !== -1;
  });
}

function addArea(out: GameTile[], row: number, col: number, radius: number): void {
  for (var dr = -radius; dr <= radius; dr++) {
    for (var dc = -radius; dc <= radius; dc++) {
      var r = row + dr;
      var c = col + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
      var tile = grid[r][c];
      if (Math.abs(dr) + Math.abs(dc) <= radius + 1 && tile) out.push(tile);
    }
  }
}

function lastNormalInSelection(tiles: GameTile[]): GameTile | null {
  for (var i = tiles.length - 1; i >= 0; i--) {
    if (tiles[i] && tiles[i].dataset.type === "normal") return tiles[i];
  }
  return null;
}

function allTilesOfColor(color: number | null): GameTile[] {
  var out: GameTile[] = [];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var tile = grid[r][c];
      // 同じ色を消す系では★は保護する。
      // ★込み5個以上で色全消ししても、対象は同色の普通ピースだけ。
      if (
        tile &&
        tile.dataset.type === "normal" &&
        Number(tile.dataset.color) === Number(color)
      ) {
        out.push(tile);
      }
    }
  }
  return out;
}

function uniqueTiles(arr: Array<GameTile | null>): GameTile[] {
  var out: GameTile[] = [];
  arr.forEach(function (tile) {
    if (tile && out.indexOf(tile) === -1) out.push(tile);
  });
  return out;
}

function vanishDropAndFill(tiles: GameTile[], createSpecialInfo: CreateSpecialInfo, superExplosion: boolean): void {
  var keepInfo = createSpecialInfo && createSpecialInfo.mode === "keep" ? createSpecialInfo : null;

  tiles.forEach(function (tile) {
    tile.classList.add(superExplosion ? "superVanish" : "vanish");
    var r = Number(tile.dataset.row);
    var c = Number(tile.dataset.col);
    if (grid[r] && grid[r][c] === tile) grid[r][c] = null;
  });

  if (keepInfo) {
    var keepTile = keepInfo.tile;
    // 消したチェーンの最後の1個をその場で特殊化して残す。
    // これにより、落下後の同座標へ書き戻して既存特殊を上書きするバグを避ける。
    keepTile.classList.remove("selected");
    keepTile.dataset.color = String(keepInfo.color);
    keepTile.dataset.type = "special";
    applyClass(keepTile);
    keepTile.classList.add("spawn");
  }

  selected = [];
  selectedColor = null;
  chainMode = null;
  updateLine();
  chainEl.textContent = "0";
  cancelStarMoveTarget();

  setTimeout(function () {
    tiles.forEach(function (tile) {
      if (tile.parentNode) tile.parentNode.removeChild(tile);
    });

    applyGravityAndSpawn(createSpecialInfo);

    setTimeout(function () {
      resolving = false;
      removeSpawnMarks();
      ensurePlayable(false);
      if (playing) messageEl.textContent = "★で移動・色全消し・横列★化を狙え！";
    }, 310);
  }, superExplosion ? 390 : 230);
}

function applyGravityAndSpawn(createSpecialInfo: CreateSpecialInfo): void {
  for (var c = 0; c < SIZE; c++) {
    var stack = [];
    for (var r = SIZE - 1; r >= 0; r--) {
      if (grid[r][c]) stack.push(grid[r][c]);
    }
    for (var row = SIZE - 1; row >= 0; row--) {
      var tile = stack.shift();
      if (tile) {
        grid[row][c] = tile;
        moveTile(tile, row, c);
      } else {
        grid[row][c] = makeTile(row, c, randColor(), true, "normal");
      }
    }
  }

  if (createSpecialInfo && createSpecialInfo.mode === "normalCells") {
    createNormalCells(
      createSpecialInfo.cells,
      createSpecialInfo.color,
      createSpecialInfo.usedSpecials || []
    );
  }
}

function createNormalCells(cells: CellPoint[], color: number, usedSpecials: GameTile[]): void {
  usedSpecials = usedSpecials || [];
  cells.forEach(function (cell) {
    var row = cell.r;
    var c = cell.c;
    if (row < 0 || row >= SIZE || c < 0 || c >= SIZE) return;

    var tile = grid[row][c];
    if (!tile) {
      tile = makeTile(row, c, color, false, "normal");
      grid[row][c] = tile;
    } else {
      tile.dataset.color = String(color);

      // 同色★ライン生成で「使用した★」は消費して普通ピースへ戻す。
      // ただし、ラインに巻き込まれただけの未使用★は★のまま色だけ変える。
      if (tile.dataset.type !== "special" || usedSpecials.indexOf(tile) !== -1) {
        tile.dataset.type = "normal";
      }

      applyClass(tile);
      tile.classList.add("spawn");
    }
  });
}

function megaEffects(count: number, gained: number): void {
  wrap.classList.add("megaShake");
  setTimeout(function () { wrap.classList.remove("megaShake"); }, 540);

  var flash = document.createElement("div");
  flash.className = "flash";
  wrap.appendChild(flash);
  setTimeout(function () { flash.remove(); }, 620);

  var wave = document.createElement("div");
  wave.className = "shockwave";
  wrap.appendChild(wave);
  setTimeout(function () { wave.remove(); }, 700);

  floatText((count >= 3 ? "SPECIAL!! " : "GOOD!! ") + "+" + gained, true);
}

function hasAnyMove(): boolean {
  if (findSpecialMove().length >= 2) return true;
  return findColorMove().length >= 3;
}

function findMove(): GameTile[] {
  var specials = findSpecialMove();
  if (specials.length >= 2) return specials;
  return findColorMove();
}

function findSpecialMove(): GameTile[] {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var start = grid[r][c];
      if (!isSpecial(start)) continue;
      var path = longestSpecialPathFrom(start, []);
      if (path.length >= 2) return path;
    }
  }
  return [];
}

function longestSpecialPathFrom(tile: GameTile, path: GameTile[]): GameTile[] {
  var best = path.concat([tile]);
  var r = Number(tile.dataset.row);
  var c = Number(tile.dataset.col);
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      var nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      var next = grid[nr][nc];
      if (!isSpecial(next)) continue;
      if (path.indexOf(next) !== -1) continue;
      var candidate = longestSpecialPathFrom(next, best);
      if (candidate.length > best.length) best = candidate;
      if (best.length >= 5) return best;
    }
  }
  return best;
}

function findColorMove(): GameTile[] {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var start = grid[r][c];
      if (!start) continue;
      var color = Number(start.dataset.color);
      var path = longestColorPathFrom(start, color, []);
      if (path.length >= 3) return path;
    }
  }
  return [];
}

function longestColorPathFrom(tile: GameTile, color: number, path: GameTile[]): GameTile[] {
  var best = path.concat([tile]);
  var r = Number(tile.dataset.row);
  var c = Number(tile.dataset.col);

  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      var nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE) continue;
      var next = grid[nr][nc];
      if (!next) continue;
      if (Number(next.dataset.color) !== color) continue;
      if (path.indexOf(next) !== -1) continue;
      var candidate = longestColorPathFrom(next, color, best);
      if (candidate.length > best.length) best = candidate;
      if (best.length >= 5) return best;
    }
  }
  return best;
}

function ensurePlayable(initial: boolean): void {
  var tries = 0;
  while (!hasAnyMove() && tries < 20) {
    randomizeBoard();
    tries++;
  }
  if (tries > 0 && !initial) {
    wrap.classList.add("shake");
    messageEl.textContent = "手がないのでシャッフル！";
    setTimeout(function () { wrap.classList.remove("shake"); }, 280);
  }
}

function randomizeBoard(): void {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var tile = grid[r][c];
      if (!tile) continue;
      tile.dataset.color = String(randColor());
      tile.dataset.type = "normal";
      applyClass(tile);
    }
  }
  var rr = Math.floor(Math.random() * SIZE);
  var cc = Math.floor(Math.random() * (SIZE - 2));
  var color = randColor();
  for (var i = 0; i < 3; i++) {
    var t = grid[rr][cc + i];
    if (!t) continue;
    t.dataset.color = String(color);
    t.dataset.type = "normal";
    applyClass(t);
  }
}

function showHint(): void {
  if (!playing || resolving) {
    messageEl.textContent = "スタート後に使えるよ";
    return;
  }
  clearHint();
  var move = findMove();
  if (move.length < 2) {
    ensurePlayable(false);
    return;
  }
  move.slice(0, Math.min(move.length, 5)).forEach(function (tile) {
    tile.classList.add("hint");
  });
  if (move.length >= 2 && move.every(isSpecial)) {
    messageEl.textContent = "★チェーン発見！同色なら方向ライン生成、異色なら大量破壊";
  } else {
    messageEl.textContent = "ここを狙える！★を含めて5個なら色全消し";
  }
  setTimeout(clearHint, 1000);
}

function clearHint(): void {
  board.querySelectorAll(".hint").forEach(function (tile) {
    tile.classList.remove("hint");
  });
}

function removeSpawnMarks(): void {
  board.querySelectorAll(".spawn").forEach(function (tile) {
    tile.classList.remove("spawn");
  });
}

function clearSelection(): void {
  selected.forEach(function (tile) {
    if (tile && tile.classList) tile.classList.remove("selected");
  });
  selected = [];
  selectedColor = null;
  chainMode = null;
  updateLine();
  chainEl.textContent = "0";
}

function centerOf(tile: GameTile): Point {
  var a = tile.getBoundingClientRect();
  var b = wrap.getBoundingClientRect();
  return {
    x: a.left + a.width / 2 - b.left - 10,
    y: a.top + a.height / 2 - b.top - 10
  };
}

/**
 * 現在のチェーン内容から線の演出種別を返す。
 *
 * @return 優先順位を反映したチェイン線の種類。
 */
function chainLineStyle(): ChainLineStyle {
  if (selected.length < 2) return "normal";

  var specials = selected.filter(isSpecial);
  var isSpecialChain = chainMode === "special" && selected.length >= 2;

  if (isSpecialChain && uniqueColorCount(specials) >= COLORS) return "rainbow";

  if (
    chainMode === "color" &&
    selected.length >= 3 &&
    (selected.length >= 5 || (specials.length === 0 && willCreateRenSpecial(selected.length)))
  ) {
    return "specialCreate";
  }

  if (isSpecialChain || (chainMode === "color" && selected.length >= 3 && specials.length > 0)) {
    return "specialEffect";
  }

  return "normal";
}

/**
 * レインボー用のSVGグラデーション定義を追加する。
 *
 * @return stroke 属性で参照するグラデーションURL。
 */
function appendRainbowLineGradient(): string {
  var defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  var gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", "chainLineRainbow");
  gradient.setAttribute("x1", "0%");
  gradient.setAttribute("y1", "0%");
  gradient.setAttribute("x2", "100%");
  gradient.setAttribute("y2", "0%");

  [
    ["0%", "#ff4f7b"],
    ["20%", "#ffd84f"],
    ["40%", "#63ff7a"],
    ["60%", "#50d8ff"],
    ["80%", "#bd78ff"],
    ["100%", "#ff4f7b"]
  ].forEach(function (stopInfo) {
    var stop = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    stop.setAttribute("offset", stopInfo[0]);
    stop.setAttribute("stop-color", stopInfo[1]);
    gradient.appendChild(stop);
  });

  defs.appendChild(gradient);
  svg.appendChild(defs);
  return "url(#chainLineRainbow)";
}

function updateLine(): void {
  svg.innerHTML = "";
  if (selected.length < 2) {
    currentChainLineStyle = null;
    return;
  }
  var points = selected.map(function (tile) {
    var p = centerOf(tile);
    return p.x + "," + p.y;
  }).join(" ");
  var poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  var lineStyle = chainLineStyle();
  if (currentChainLineStyle !== lineStyle) playChainLineStyleSound(lineStyle);
  currentChainLineStyle = lineStyle;
  poly.setAttribute("points", points);
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", lineStyle === "rainbow" ? appendRainbowLineGradient() : chainLineStroke(lineStyle));
  poly.setAttribute("stroke-width", lineStyle === "normal" ? (chainMode === "special" ? "11" : "8") : "12");
  poly.setAttribute("stroke-linecap", "round");
  poly.setAttribute("stroke-linejoin", "round");
  poly.classList.add("chainLine", "chainLine-" + lineStyle);
  svg.appendChild(poly);
}

/**
 * チェイン線の種類に対応する単色 stroke を返す。
 *
 * @param lineStyle チェイン線の種類。
 * @return SVG stroke 属性に指定する色。
 */
function chainLineStroke(lineStyle: ChainLineStyle): string {
  if (lineStyle === "specialCreate") return "rgba(255, 154, 39, .98)";
  if (lineStyle === "specialEffect") return "rgba(173, 235, 255, .98)";
  return chainMode === "special" ? "rgba(255, 238, 106, .96)" : "rgba(255,255,255,.85)";
}

/**
 * チェイン線の特殊状態に対応する条件成立SEを鳴らす。
 *
 * @param lineStyle 新しいチェイン線の種類。
 */
function playChainLineStyleSound(lineStyle: ChainLineStyle): void {
  if (lineStyle === "specialCreate") {
    playSound("effectiveGenerate");
    return;
  }

  if (lineStyle === "specialEffect" || lineStyle === "rainbow") {
    playSound("effectiveChain");
  }
}

function floatText(text: string, mega: boolean): void {
  var f = document.createElement("div");
  f.className = "float" + (mega ? " megaText" : "");
  f.textContent = text;
  wrap.appendChild(f);
  setTimeout(function () { f.remove(); }, mega ? 980 : 850);
}

function resizeBoard(): void {
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var tile = grid[r] ? grid[r][c] : null;
      if (tile) moveTile(tile, r, c);
    }
  }
  updateLine();
}

startBtn.addEventListener("click", async function () {
  if (playing) {
    endGame("normal");
    return;
  }

  if (!soundMuted) {
    await prepareAudio().catch(function () {
      audioReady = false;
    });
  }

  startGame();
});
hintBtn.addEventListener("click", showHint);
soundToggleBtn.addEventListener("click", async function () {
  var nextMuted = !soundMuted;
  setSoundMuted(nextMuted);

  if (!nextMuted) {
    await prepareAudio().catch(function () {
      audioReady = false;
    });
  }
});

wrap.addEventListener("mousedown", pointerStart);
window.addEventListener("mousemove", pointerMove);
window.addEventListener("mouseup", pointerEnd);

wrap.addEventListener("touchstart", pointerStart, { passive: false });
window.addEventListener("touchmove", pointerMove, { passive: false });
window.addEventListener("touchend", pointerEnd, { passive: false });
window.addEventListener("touchcancel", cancelPointerInput, { passive: true });
window.addEventListener("resize", resizeBoard);

setSoundMuted(true);
buildBoard();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNazotteConnect, { once: true });
} else {
  initNazotteConnect();
}

export {};
