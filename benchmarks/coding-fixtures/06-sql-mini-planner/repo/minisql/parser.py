from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    JoinClause,
    LiteralExpr,
    OrderByItem,
    SelectItem,
    SelectQuery,
    StarExpr,
    TableRef,
    UnaryOpExpr,
)
from .lexer import Token, tokenize

AGG_FUNCS = {"COUNT", "SUM", "AVG", "MIN", "MAX"}


class Parser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> Token:
        return self.tokens[self.pos]

    def advance(self) -> Token:
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def match_kw(self, kw: str) -> bool:
        tok = self.peek()
        if tok.kind == "KW" and tok.value == kw:
            self.advance()
            return True
        return False

    def expect_kw(self, kw: str) -> Token:
        tok = self.peek()
        if tok.kind != "KW" or tok.value != kw:
            raise SyntaxError(f"Expected keyword {kw}, got {tok}")
        return self.advance()

    def expect(self, kind: str) -> Token:
        tok = self.peek()
        if tok.kind != kind:
            raise SyntaxError(f"Expected {kind}, got {tok}")
        return self.advance()

    def parse_query(self) -> SelectQuery:
        self.expect_kw("SELECT")
        items = self.parse_select_items()
        self.expect_kw("FROM")
        from_table = self.parse_table_ref()

        join: JoinClause | None = None
        join_type: str | None = None
        if self.match_kw("LEFT"):
            self.expect_kw("JOIN")
            join_type = "LEFT"
        elif self.match_kw("INNER"):
            self.expect_kw("JOIN")
            join_type = "INNER"
        elif self.match_kw("JOIN"):
            join_type = "INNER"

        if join_type is not None:
            right_table = self.parse_table_ref()
            self.expect_kw("ON")
            on_expr = self.parse_expr()
            join = JoinClause(join_type=join_type, table=right_table, on=on_expr)

        where: Expr | None = None
        if self.match_kw("WHERE"):
            where = self.parse_expr()

        group_by: list[ColumnExpr] = []
        if self.match_kw("GROUP"):
            self.expect_kw("BY")
            while True:
                col = self.parse_column_expr()
                group_by.append(col)
                if self.peek().kind == ",":
                    self.advance()
                else:
                    break

        having: Expr | None = None
        if self.match_kw("HAVING"):
            having = self.parse_expr()

        order_by: list[OrderByItem] = []
        if self.match_kw("ORDER"):
            self.expect_kw("BY")
            while True:
                expr = self.parse_column_or_name()
                desc = False
                if self.match_kw("DESC"):
                    desc = True
                elif self.match_kw("ASC"):
                    desc = False
                order_by.append(OrderByItem(expr=expr, desc=desc))
                if self.peek().kind == ",":
                    self.advance()
                else:
                    break

        self.expect("EOF")
        return SelectQuery(
            items=items,
            from_table=from_table,
            join=join,
            where=where,
            group_by=group_by,
            having=having,
            order_by=order_by,
        )

    def parse_table_ref(self) -> TableRef:
        name_tok = self.expect("IDENT")
        alias = name_tok.value
        if self.match_kw("AS"):
            alias = self.expect("IDENT").value
        elif self.peek().kind == "IDENT":
            alias = self.advance().value
        return TableRef(name=name_tok.value, alias=alias)

    def parse_select_items(self) -> list[SelectItem]:
        items: list[SelectItem] = []
        while True:
            if self.peek().kind == "*":
                self.advance()
                items.append(SelectItem(expr=StarExpr(), alias=None))
            else:
                expr = self.parse_expr()
                alias: str | None = None
                if self.match_kw("AS"):
                    alias = self.expect("IDENT").value
                items.append(SelectItem(expr=expr, alias=alias))
            if self.peek().kind == ",":
                self.advance()
            else:
                break
        return items

    def parse_column_expr(self) -> ColumnExpr:
        first = self.expect("IDENT").value
        if self.peek().kind == ".":
            self.advance()
            second = self.expect("IDENT").value
            return ColumnExpr(table=first, column=second)
        return ColumnExpr(table=None, column=first)

    def parse_column_or_name(self) -> ColumnExpr | str:
        first = self.expect("IDENT").value
        if self.peek().kind == ".":
            self.advance()
            second = self.expect("IDENT").value
            return ColumnExpr(table=first, column=second)
        return ColumnExpr(table=None, column=first)

    def parse_expr(self) -> Expr:
        return self.parse_or()

    def parse_or(self) -> Expr:
        left = self.parse_and()
        while self.match_kw("OR"):
            right = self.parse_and()
            left = BinaryOpExpr(op="OR", left=left, right=right)
        return left

    def parse_and(self) -> Expr:
        left = self.parse_not()
        while self.match_kw("AND"):
            right = self.parse_not()
            left = BinaryOpExpr(op="AND", left=left, right=right)
        return left

    def parse_not(self) -> Expr:
        if self.match_kw("NOT"):
            return UnaryOpExpr(op="NOT", operand=self.parse_not())
        return self.parse_comparison()

    def parse_comparison(self) -> Expr:
        left = self.parse_primary()
        if self.match_kw("IS"):
            negated = self.match_kw("NOT")
            self.expect_kw("NULL")
            return IsNullExpr(operand=left, negated=negated)
        if self.peek().kind == "OP":
            op = self.advance().value
            right = self.parse_primary()
            return BinaryOpExpr(op=op, left=left, right=right)
        return left

    def parse_primary(self) -> Expr:
        tok = self.peek()
        if tok.kind == "(":
            self.advance()
            inner = self.parse_expr()
            self.expect(")")
            return inner
        if tok.kind == "STRING":
            self.advance()
            return LiteralExpr(tok.value)
        if tok.kind == "NUMBER":
            self.advance()
            num = float(tok.value) if "." in tok.value else int(tok.value)
            return LiteralExpr(num)
        if tok.kind == "KW" and tok.value == "NULL":
            self.advance()
            return LiteralExpr(None)
        if tok.kind == "KW" and tok.value == "TRUE":
            self.advance()
            return LiteralExpr(True)
        if tok.kind == "KW" and tok.value == "FALSE":
            self.advance()
            return LiteralExpr(False)
        if tok.kind == "IDENT":
            ident = self.advance().value
            if self.peek().kind == "(":
                func = ident.upper()
                if func not in AGG_FUNCS:
                    raise SyntaxError(f"Unsupported function {ident}")
                self.advance()
                if self.peek().kind == "*":
                    self.advance()
                    arg: Expr = StarExpr()
                else:
                    arg = self.parse_expr()
                self.expect(")")
                return AggExpr(func=func, arg=arg)
            if self.peek().kind == ".":
                self.advance()
                col = self.expect("IDENT").value
                return ColumnExpr(table=ident, column=col)
            return ColumnExpr(table=None, column=ident)
        raise SyntaxError(f"Unexpected token in expression: {tok}")


def parse_sql(sql: str) -> SelectQuery:
    return Parser(tokenize(sql)).parse_query()
