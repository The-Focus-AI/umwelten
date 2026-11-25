from dataclasses import dataclass
from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    JoinClause,
    OrderByItem,
    SelectItem,
    SelectQuery,
    TableRef,
    UnaryOpExpr,
)


@dataclass
class QueryPlan:
    from_table: TableRef
    join: JoinClause | None
    left_filters: list[Expr]
    right_filters: list[Expr]
    post_join_filters: list[Expr]
    group_by: list[ColumnExpr]
    having_filters: list[Expr]
    select_items: list[SelectItem]
    order_by: list[OrderByItem]


def split_conjuncts(expr: Expr | None) -> list[Expr]:
    if expr is None:
        return []
    if isinstance(expr, BinaryOpExpr) and expr.op.upper() == "AND":
        return split_conjuncts(expr.left) + split_conjuncts(expr.right)
    return [expr]


def referenced_tables(expr: Expr) -> set[str]:
    tables: set[str] = set()
    if isinstance(expr, ColumnExpr):
        if expr.table is not None:
            tables.add(expr.table)
    elif isinstance(expr, (UnaryOpExpr, IsNullExpr)):
        tables.update(referenced_tables(expr.operand))
    elif isinstance(expr, BinaryOpExpr):
        tables.update(referenced_tables(expr.left))
        tables.update(referenced_tables(expr.right))
    elif isinstance(expr, AggExpr):
        tables.update(referenced_tables(expr.arg))
    return tables


def build_plan(query: SelectQuery) -> QueryPlan:
    left_alias = query.from_table.alias
    right_alias = query.join.table.alias if query.join else None

    left_filters: list[Expr] = []
    right_filters: list[Expr] = []
    post_join_filters: list[Expr] = []
    having_filters: list[Expr] = []

    for pred in split_conjuncts(query.where):
        tables = referenced_tables(pred)
        if not query.join:
            left_filters.append(pred)
        elif tables == {left_alias}:
            left_filters.append(pred)
        elif right_alias and tables == {right_alias}:
            # BUG: unsafely pushes right-table WHERE predicates below LEFT JOIN!
            right_filters.append(pred)
        else:
            post_join_filters.append(pred)

    for hpred in split_conjuncts(query.having):
        # BUG: mistakenly pushes HAVING predicates into post_join_filters before GROUP BY!
        post_join_filters.append(hpred)

    return QueryPlan(
        from_table=query.from_table,
        join=query.join,
        left_filters=left_filters,
        right_filters=right_filters,
        post_join_filters=post_join_filters,
        group_by=query.group_by,
        having_filters=having_filters,
        select_items=query.items,
        order_by=query.order_by,
    )
