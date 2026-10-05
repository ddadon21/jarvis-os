import type { Condition } from "./types.ts";

/**
 * Small, interpretable decision tree (CART, weighted Gini) for rare-event
 * labels. Depth is kept low so every positive leaf becomes a readable rule of
 * at most a few conditions that compiles directly to Pine.
 */

export type TreeOptions = {
  maxDepth: number;
  /** Minimum number of POSITIVE rows a leaf must contain to become a rule. */
  minLeafPositives: number;
  /** Minimum total rows per child. */
  minLeafRows: number;
  /** Weight of a positive row relative to a negative row (handles the 1-2 entries/day imbalance). */
  positiveWeight: number;
  /** Candidate thresholds per feature per node (quantile bins). */
  bins: number;
};

export type TreeNode =
  | { leaf: true; pos: number; neg: number }
  | { leaf: false; pos: number; neg: number; feature: string; threshold: number; left: TreeNode; right: TreeNode };

export type LeafRule = { conditions: Condition[]; pos: number; neg: number; precision: number };

function gini(pos: number, neg: number, w: number) {
  const p = pos * w;
  const total = p + neg;
  if (total === 0) return 0;
  const a = p / total;
  return 1 - a * a - (1 - a) * (1 - a);
}

function roundThreshold(value: number) {
  if (!Number.isFinite(value) || value === 0) return value;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(value))) - 2);
  return Math.round(value / magnitude) * magnitude;
}

export function trainTree(columns: Record<string, number[]>, features: string[], rows: number[], label: (row: number) => boolean, options: TreeOptions): TreeNode {
  const labels = new Map<number, boolean>();
  for (const row of rows) labels.set(row, label(row));

  const grow = (subset: number[], depth: number): TreeNode => {
    let pos = 0;
    for (const row of subset) if (labels.get(row)) pos += 1;
    const neg = subset.length - pos;
    if (depth >= options.maxDepth || pos < options.minLeafPositives || neg === 0) return { leaf: true, pos, neg };

    const parentImpurity = gini(pos, neg, options.positiveWeight);
    let best: { feature: string; threshold: number; gain: number } | null = null;

    for (const feature of features) {
      const col = columns[feature];
      const values = subset.map((row) => col[row]).sort((a, b) => a - b);
      const thresholds = new Set<number>();
      for (let b = 1; b < options.bins; b += 1) {
        const q = values[Math.floor((b / options.bins) * (values.length - 1))];
        thresholds.add(roundThreshold(q));
      }
      for (const threshold of thresholds) {
        let lp = 0, ln = 0, rp = 0, rn = 0;
        for (const row of subset) {
          const isPos = labels.get(row)!;
          if (col[row] <= threshold) { if (isPos) lp += 1; else ln += 1; }
          else if (isPos) rp += 1; else rn += 1;
        }
        if (lp + ln < options.minLeafRows || rp + rn < options.minLeafRows) continue;
        const w = options.positiveWeight;
        const lw = lp * w + ln;
        const rw = rp * w + rn;
        const impurity = (lw * gini(lp, ln, w) + rw * gini(rp, rn, w)) / (lw + rw);
        const gain = parentImpurity - impurity;
        if (gain > 1e-9 && (!best || gain > best.gain)) best = { feature, threshold, gain };
      }
    }
    if (!best) return { leaf: true, pos, neg };
    const col = columns[best.feature];
    const left = subset.filter((row) => col[row] <= best!.threshold);
    const right = subset.filter((row) => col[row] > best!.threshold);
    return {
      leaf: false, pos, neg, feature: best.feature, threshold: best.threshold,
      left: grow(left, depth + 1),
      right: grow(right, depth + 1),
    };
  };

  return grow(rows, 0);
}

/** Leaves whose positive share beats the base rate, as rules (path conditions). */
export function extractRules(tree: TreeNode, minPositives: number): LeafRule[] {
  const base = tree.pos / Math.max(1, tree.pos + tree.neg);
  const out: LeafRule[] = [];
  const walk = (node: TreeNode, path: Condition[]) => {
    if (node.leaf) {
      const precision = node.pos / Math.max(1, node.pos + node.neg);
      if (node.pos >= minPositives && precision > base * 2) out.push({ conditions: simplify(path), pos: node.pos, neg: node.neg, precision });
      return;
    }
    walk(node.left, [...path, { feature: node.feature, op: "<=", value: node.threshold }]);
    walk(node.right, [...path, { feature: node.feature, op: ">", value: node.threshold }]);
  };
  walk(tree, []);
  return out.sort((a, b) => b.precision - a.precision);
}

/** Collapse repeated bounds on the same feature (keep the tightest). */
function simplify(conditions: Condition[]): Condition[] {
  const upper = new Map<string, number>();
  const lower = new Map<string, number>();
  for (const c of conditions) {
    if (c.op === "<=") upper.set(c.feature, Math.min(upper.get(c.feature) ?? Infinity, c.value));
    else lower.set(c.feature, Math.max(lower.get(c.feature) ?? -Infinity, c.value));
  }
  const out: Condition[] = [];
  for (const [feature, value] of lower) out.push({ feature, op: ">", value });
  for (const [feature, value] of upper) out.push({ feature, op: "<=", value });
  return out;
}

export function ruleMatches(conditions: Condition[], columns: Record<string, number[]>, row: number) {
  for (const c of conditions) {
    const v = columns[c.feature][row];
    if (!(c.op === "<=" ? v <= c.value : v > c.value)) return false;
  }
  return true;
}
