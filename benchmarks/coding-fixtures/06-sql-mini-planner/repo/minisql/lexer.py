from dataclasses import dataclass

KEYWORDS = {
    "SELECT",
    "FROM",
    "LEFT",
    "INNER",
    "JOIN",
    "ON",
    "WHERE",
    "GROUP",
    "BY",
    "HAVING",
    "ORDER",
    "ASC",
    "DESC",
    "AS",
    "AND",
    "OR",
    "NOT",
    "IS",
    "NULL",
    "TRUE",
    "FALSE",
}


@dataclass(frozen=True)
class Token:
    kind: str
    value: str


def tokenize(sql: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch.isspace():
            i += 1
            continue
        if ch in ("(", ")", ",", "*", "."):
            tokens.append(Token(ch, ch))
            i += 1
            continue
        if ch in ("!", "<", ">", "="):
            two = sql[i : i + 2]
            if two in ("!=", "<>", "<=", ">="):
                tokens.append(Token("OP", two))
                i += 2
            else:
                tokens.append(Token("OP", ch))
                i += 1
            continue
        if ch == "'":
            j = i + 1
            chars: list[str] = []
            while j < n and sql[j] != "'":
                chars.append(sql[j])
                j += 1
            if j >= n:
                raise SyntaxError("Unterminated string literal")
            tokens.append(Token("STRING", "".join(chars)))
            i = j + 1
            continue
        if ch.isdigit() or (ch == "-" and i + 1 < n and sql[i + 1].isdigit()):
            j = i + 1
            has_dot = False
            while j < n and (sql[j].isdigit() or (sql[j] == "." and not has_dot)):
                if sql[j] == ".":
                    has_dot = True
                j += 1
            tokens.append(Token("NUMBER", sql[i:j]))
            i = j
            continue
        if ch.isalpha() or ch == "_":
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            word = sql[i:j]
            upper = word.upper()
            if upper in KEYWORDS:
                tokens.append(Token("KW", upper))
            else:
                tokens.append(Token("IDENT", word))
            i = j
            continue
        raise SyntaxError(f"Unexpected character in SQL: {ch!r}")
    tokens.append(Token("EOF", ""))
    return tokens
