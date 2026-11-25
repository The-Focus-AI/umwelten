from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LiteralExpr:
    value: Any


@dataclass(frozen=True)
class ColumnExpr:
    table: str | None
    column: str


@dataclass(frozen=True)
class StarExpr:
    pass


@dataclass(frozen=True)
class UnaryOpExpr:
    op: str  # "NOT"
    operand: "Expr"


@dataclass(frozen=True)
class IsNullExpr:
    operand: "Expr"
    negated: bool  # True -> IS NOT NULL


@dataclass(frozen=True)
class BinaryOpExpr:
    op: str
    left: "Expr"
    right: "Expr"


@dataclass(frozen=True)
class AggExpr:
    func: str  # COUNT | SUM | AVG | MIN | MAX
    arg: "Expr"


Expr = LiteralExpr | ColumnExpr | StarExpr | UnaryOpExpr | IsNullExpr | BinaryOpExpr | AggExpr


@dataclass(frozen=True)
class SelectItem:
    expr: Expr
    alias: str | None


@dataclass(frozen=True)
class TableRef:
    name: str
    alias: str


@dataclass(frozen=True)
class JoinClause:
    join_type: str  # "INNER" | "LEFT"
    table: TableRef
    on: Expr


@dataclass(frozen=True)
class OrderByItem:
    expr: ColumnExpr | str
    desc: bool = False


@dataclass(frozen=True)
class SelectQuery:
    items: list[SelectItem]
    from_table: TableRef
    join: JoinClause | None
    where: Expr | None
    group_by: list[ColumnExpr]
    having: Expr | None
    order_by: list[OrderByItem]
