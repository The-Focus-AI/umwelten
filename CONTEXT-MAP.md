# Context Map

This repo holds two bounded contexts. They share a repo and a dependency graph,
not a vocabulary — several words mean different things on either side of the
boundary, and the false friends are listed below.

## Contexts

- [Umwelten](./CONTEXT.md) — helps agents preserve, revisit, and reason about
  their work across conversations. Everything under `packages/` today except
  the exchange.
- [Exchange](./packages/exchange/CONTEXT.md) — buys model tokens wholesale from
  Suppliers and resells them retail to Applications, metering usage and
  settling with Suppliers.

## Relationships

- **Exchange → Umwelten**: none. The exchange depends on no Umwelten domain
  concept. It is a service that Umwelten happens to be deployed alongside.
- **Umwelten → Exchange**: one-way and over HTTP. `packages/core/src/providers/`
  gains an entry that points at a running exchange. It must not import exchange
  code — `core` sits at the root of the dependency DAG, and importing a package
  that depends on `core` would introduce the repo's first cycle.
- **Shared identity**: the signed `sub` that ADR 0003 establishes as the
  speaking user on the habitat A2A surface is the same identity the exchange
  meters as an **End User**. One identity, asserted once, read in two places.

## False friends

| Word | In Umwelten | In Exchange |
| --- | --- | --- |
| **Provider** | An upstream vendor integration under `packages/core/src/providers/` — Google, OpenRouter, Ollama. | Not used. The party that produces tokens is a **Supplier**, and a vendor is just one kind of Supplier. |
| **Capability** | Not a domain term. | Something an **Offer** can do (tool calling, context length). Belongs to the Offer, not the Model. |
| **User** | Ambiguous; usually the operator. | Never used bare. A person using an Application is an **End User**. |
| **Cost** | What a model call was billed at (`src/costs/`). | What a **Supplier** is owed — deliberately distinct from **Charge**. |
