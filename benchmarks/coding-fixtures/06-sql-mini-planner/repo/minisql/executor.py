from typing import Any
from .ast_nodes import (
    AggExpr,
    ColumnExpr,
    Expr,
    SelectItem,
    StarExpr,
    UnaryOpExpr,
    BinaryOpExpr,
    IsNullExpr,
)
from .eval_expr import eval_expr, eval_predicate
from .optimizer import QueryPlan, build_plan
from .parser import parse_sql


class Database:
    def __init__(self) -> None:
        self._tables: dict[str, list[dict[str, Any]]] = {}

    def create_table(self, name: str, rows: list[dict[str, Any]]) -> None:
        self._tables[name] = [dict(r) for r in rows]

    def get_rows(self, name: str) -> list[dict[str, Any]]:
        if name not in self._tables:
            raise KeyError(f"Unknown table {name}")
        return [dict(r) for r in self._tables[name]]


def _qualify_row(alias: str, row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for k, v in row.items():
        out[f"{alias}.{k}"] = v
    return out


def _left_join_null_row(alias: str, sample_rows: list[dict[str, Any]], known_cols: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    cols = set(known_cols)
    for r in sample_rows:
        cols.update(r.keys())
    for c in cols:
        out[f"{alias}.{c}"] = None
        if c not in out:
            out[c] = None
    return out


def _contains_agg(expr: Expr) -> bool:
    if isinstance(expr, AggExpr):
        return True
    if isinstance(expr, (UnaryOpExpr, IsNullExpr)):
        return _contains_agg(expr.operand)
    if isinstance(expr, BinaryOpExpr):
        return _contains_agg(expr.left) or _contains_agg(expr.right)
    return False


def _item_key(item: SelectItem) -> str:
    if item.alias:
        return item.alias
    if isinstance(item.expr, ColumnExpr):
        return item.expr.column
    if isinstance(item.expr, AggExpr):
        return item.expr.func.lower()
    return "expr"


def _eval_agg(expr: AggExpr, rows: list[dict[str, Any]]) -> Any:
    func = expr.func.upper()
    if func == "COUNT":
        # BUG: ignores non-NULL requirement of COUNT(col) and treats all columns like COUNT(*)
        return len(rows)

    vals: list[Any] = []
    for r in rows:
        v = eval_expr(expr.arg, r)
        if v is not None:
            vals.append(v)

    if func == "SUM":
        # BUG: returns 0 instead of None on empty/all-NULL values
        return sum(vals)
    if func == "AVG":
        return sum(vals) / len(vals) if vals else 0
    if func == "MIN":
        return min(vals) if vals else 0
    if func == "MAX":
        return max(vals) if vals else 0
    raise ValueError(f"Unknown aggregate: {func}")


def _eval_group_expr(expr: Expr, rows: list[dict[str, Any]]) -> Any:
    if isinstance(expr, AggExpr):
        return _eval_agg(expr, rows)
    if isinstance(expr, BinaryOpExpr):
        op = expr.op.upper()
        l = _eval_group_expr(expr.left, rows)
        r = _eval_group_expr(expr.right, rows)
        if l is None or r is None:
            if op == "AND":
                if l is False or r is False:
                    return False
                return None
            if op == "OR":
                if l is True or r is True:
                    return True
                return None
            return None
        if op == "=":
            return l == r
        if op in ("!=", "<>"):
            return l != r
        if op == "<":
            return l < r
        if op == "<=":
            return l <= r
        if op == ">":
            return l > r
        if op == ">=":
            return l >= r
    if isinstance(expr, IsNullExpr):
        val = _eval_group_expr(expr.operand, rows)
        return (val is not None) if expr.negated else (val is None)
    if rows:
        return eval_expr(expr, rows[0])
    return None


def _apply_filters(rows: list[dict[str, Any]], filters: list[Expr]) -> list[dict[str, Any]]:
    if not filters:
        return rows
    return [r for r in rows if all(eval_predicate(f, r) for f in filters)]


def execute_plan(db: Database, plan: QueryPlan) -> list[dict[str, Any]]:
    raw_left = db.get_rows(plan.from_table.name)
    left_rows = _apply_filters(
        [_qualify_row(plan.from_table.alias, r) for r in raw_left],
        plan.left_filters,
    )

    if plan.join is None:
        working_rows = left_rows
    else:
        raw_right = db.get_rows(plan.join.table.name)
        right_rows = _apply_filters(
            [_qualify_row(plan.join.table.alias, r) for r in raw_right],
            plan.right_filters,
        )
        known_right_cols: set[str] = set()
        for rr in raw_right:
            known_right_cols.update(rr.keys())

        joined: list[dict[str, Any]] = []
        for lrow in left_rows:
            matched = False
            for rrow in right_rows:
                combined = {**lrow, **rrow}
                for k, v in rrow.items():
                    if "." not in k and k in lrow:
                        combined[k] = lrow[k]
                if eval_predicate(plan.join.on, combined):
                    joined.append(combined)
                    matched = True
            if not matched and plan.join.join_type == "LEFT":
                null_r = _left_join_null_row(plan.join.table.alias, raw_right, known_right_cols)
                combined = {**null_r, **lrow}
                joined.append(combined)
        working_rows = joined

    working_rows = _apply_filters(working_rows, plan.post_join_filters)

    is_agg_query = bool(plan.group_by) or any(
        _contains_agg(item.expr) for item in plan.select_items
    )

    results: list[dict[str, Any]] = []
    if is_agg_query:
        groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        if plan.group_by:
            for row in working_rows:
                key = tuple(eval_expr(col, row) for col in plan.group_by)
                groups.setdefault(key, []).append(row)
        else:
            # BUG: drops empty group when working_rows is empty instead of emitting 1 aggregate row
            if working_rows:
                groups[()] = working_rows

        for group_rows in groups.values():
            if plan.having_filters and not all(
                _eval_group_expr(h, group_rows) is True for h in plan.having_filters
            ):
                continue
            out_row: dict[str, Any] = {}
            for item in plan.select_items:
                out_row[_item_key(item)] = _eval_group_expr(item.expr, group_rows)
            results.append(out_row)
    else:
        for row in working_rows:
            out_row = {}
            for item in plan.select_items:
                if isinstance(item.expr, StarExpr):
                    for k, v in row.items():
                        if "." not in k:
                            out_row[k] = v
                else:
                    out_row[_item_key(item)] = eval_expr(item.expr, row)
            results.append(out_row)

    if plan.order_by:
        for ob in reversed(plan.order_by):
            key_name = ob.expr.column if isinstance(ob.expr, ColumnExpr) else ob.expr
            results.sort(
                key=lambda r: (r.get(key_name) is None, r.get(key_name)),
                reverse=ob.desc,
            )

    return results


def execute_sql(db: Database, sql: str) -> list[dict[str, Any]]:
    query = parse_sql(sql)
    plan = build_plan(query)
    return execute_plan(db, plan)
