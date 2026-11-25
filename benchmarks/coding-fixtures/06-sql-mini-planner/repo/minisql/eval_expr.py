from typing import Any
from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    LiteralExpr,
    UnaryOpExpr,
)


def lookup_column(row: dict[str, Any], expr: ColumnExpr) -> Any:
    if expr.table is not None:
        qualified = f"{expr.table}.{expr.column}"
        if qualified in row:
            return row[qualified]
    if expr.column in row:
        return row[expr.column]
    suffix = f".{expr.column}"
    matches = [v for k, v in row.items() if k.endswith(suffix)]
    if len(matches) == 1:
        return matches[0]
    raise KeyError(f"Column not found in row: {expr}")


def eval_expr(expr: Expr, row: dict[str, Any]) -> Any:
    if isinstance(expr, LiteralExpr):
        return expr.value
    if isinstance(expr, ColumnExpr):
        return lookup_column(row, expr)
    if isinstance(expr, IsNullExpr):
        val = eval_expr(expr.operand, row)
        is_null = val is None
        return (not is_null) if expr.negated else is_null
    if isinstance(expr, UnaryOpExpr):
        if expr.op == "NOT":
            # BUG: Python `not None` returns True instead of None (NULL)
            return not bool(eval_expr(expr.operand, row))
        raise ValueError(f"Unknown unary op: {expr.op}")
    if isinstance(expr, BinaryOpExpr):
        op = expr.op.upper()
        if op == "AND":
            # BUG: violates three-valued logic (None and False -> None/True bugs)
            return bool(eval_expr(expr.left, row)) and bool(eval_expr(expr.right, row))
        if op == "OR":
            return bool(eval_expr(expr.left, row)) or bool(eval_expr(expr.right, row))

        left = eval_expr(expr.left, row)
        right = eval_expr(expr.right, row)
        # BUG: compares None directly using Python operators (None == None -> True)
        if op == "=":
            return left == right
        if op in ("!=", "<>"):
            return left != right
        if left is None or right is None:
            return False
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        if op == ">":
            return left > right
        if op == ">=":
            return left >= right
        raise ValueError(f"Unknown operator: {op}")
    if isinstance(expr, AggExpr):
        raise ValueError("Aggregate expression evaluated directly outside aggregation")
    raise ValueError(f"Unsupported expression node: {expr}")


def eval_predicate(expr: Expr, row: dict[str, Any]) -> bool:
    return eval_expr(expr, row) is True
