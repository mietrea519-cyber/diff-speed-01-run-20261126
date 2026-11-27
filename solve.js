// solve.js — a fast drop-in for makefun-diff 1.0.0.
//
// run(input) returns exactly the patch makefun-diff 1.0.0 returns for the
// same { old, new }: same line cut (after every "\n", a last line without
// one is a line too), same edit script (common prefix, then common suffix,
// then Myers's greedy search that keeps the furthest-reaching path on each
// diagonal and takes the deletion when deletion and insertion reach the same
// point), and the same patch text (header, hunks with 3 lines of context,
// deletions before insertions, "%" after a line with no newline).
//
// It is faster because the search below never allocates per step: the
// furthest-x table is flat Int32Arrays, one row per edit depth, and lines
// are compared as integer ids instead of strings. The winning script is
// rebuilt by walking that table backwards. No step prunes a diagonal and
// no move passes either text's end, so the script found is the same one
// makefun-diff finds, including its tie-breaks.

const KEEP = 0;
const DEL = 1;
const INS = 2;
const CONTEXT = 3;

/** A text's lines, each with its "\n" (the last one without, when the text does not end in one). */
function tokenize(text) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const lines = new Array(parts.length);
  for (let i = 0; i < last; i++) lines[i] = parts[i] + '\n';
  if (parts[last] !== '') lines[last] = parts[last];
  else lines.length = last;
  return lines;
}

/**
 * The edit script of a into b as runs [{ kind, count }] in order, where
 * kind is KEEP, DEL or INS. a and b are the middle sections (prefix and
 * suffix already trimmed). The search is Myers's greedy one: for d edits,
 * each diagonal k holds the furthest old-lines-consumed count reachable in
 * d edits, extended along every run of equal lines; the first depth that
 * reaches both ends wins, and the script is rebuilt from the stored table.
 */
function diffRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];

  // Give every distinct line an integer id so the snakes compare ints.
  const ids = new Map();
  const aIds = new Int32Array(n);
  const bIds = new Int32Array(m);
  let nextId = 0;
  for (let i = 0; i < n; i++) {
    let id = ids.get(a[i]);
    if (id === undefined) {
      id = nextId++;
      ids.set(a[i], id);
    }
    aIds[i] = id;
  }
  for (let j = 0; j < m; j++) {
    let id = ids.get(b[j]);
    if (id === undefined) {
      id = nextId++;
      ids.set(b[j], id);
    }
    bIds[j] = id;
  }

  // vs[d] is the furthest-x row for depth d: diagonal k lives at index
  // k + d + 2 of a row of length 2d + 5, and the value stored is the old
  // lines consumed plus one, so 0 means that diagonal is unreachable and
  // no row needs filling. The two padding slots at each end stay 0, so
  // every read below is in bounds.
  const vs = [];
  let x0 = 0;
  while (x0 < n && x0 < m && aIds[x0] === bIds[x0]) x0++;
  const v0 = new Int32Array(5);
  v0[2] = x0 + 1;
  vs.push(v0);
  if (x0 >= n && x0 >= m) return [];
  const kend = n - m;

  let depth = -1;
  let endK = 0;
  for (let d = 1; d <= n + m; d++) {
    const prev = vs[d - 1];
    const row = new Int32Array(2 * d + 5);
    let done = false;
    for (let k = -d, w = 2; k <= d; k += 2, w += 2) {
      // The deletion's candidate comes from diagonal k - 1, the
      // insertion's from diagonal k + 1, both at depth d - 1.
      let down = -1;
      let right = -1;
      const sDown = prev[w - 2];
      if (sDown !== 0 && sDown - 1 < n) down = sDown;
      const sRight = prev[w];
      if (sRight !== 0 && sRight - 1 - (k + 1) < m) right = sRight - 1;
      if (down < 0 && right < 0) continue;
      // The deletion wins when both reach the same point.
      let x = down >= right ? down : right;
      let y = x - k;
      while (x < n && y < m && aIds[x] === bIds[y]) {
        x++;
        y++;
      }
      row[w] = x + 1;
      if (k === kend && x >= n) {
        depth = d;
        endK = k;
        done = true;
        break;
      }
    }
    vs.push(row);
    if (done) break;
  }
  if (depth < 0) throw new Error('diff: the search ended without reaching both ends');

  // Walk the winning path backwards, collecting its segments in reverse.
  const segs = [];
  let d = depth;
  let k = endK;
  let x = n;
  while (d > 0) {
    const prev = vs[d - 1];
    const w = k + d + 2;
    let down = -1;
    let right = -1;
    const sDown = prev[w - 2];
    if (sDown !== 0 && sDown - 1 < n) down = sDown;
    const sRight = prev[w];
    if (sRight !== 0 && sRight - 1 - (k + 1) < m) right = sRight - 1;
    const isDel = down >= right;
    const afterMove = isDel ? down : right;
    const snake = x - afterMove;
    if (snake > 0) segs.push({ kind: KEEP, count: snake });
    segs.push({ kind: isDel ? DEL : INS, count: 1 });
    x = isDel ? down - 1 : right;
    k = isDel ? k - 1 : k + 1;
    d--;
  }
  if (x > 0) segs.push({ kind: KEEP, count: x });

  // Reverse the segments and merge neighbours of the same kind.
  const runs = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === s.kind) last.count += s.count;
    else runs.push({ kind: s.kind, count: s.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...diffRuns(a.slice(prefix, n - suffix), b.slice(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DEL) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h === undefined ? undefined : h[h.length - 1];
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
