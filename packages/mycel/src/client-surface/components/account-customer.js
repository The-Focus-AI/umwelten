import { authKey, customerKey } from "./account-services.js";

export default {
  name: "account-customer",
  inject: [authKey],
  apply(ctx, view) {
    const auth = view.get(authKey);
    const subscribers = new Set();
    let generation = 0;
    let state = { phase: "loading", dashboard: null, error: null };
    const publish = (next) => {
      state = { ...state, ...next };
      for (const subscriber of subscribers) subscriber(state);
    };
    const authorizedFetch = async (path = "", options = {}) => {
      const token = await auth.getToken();
      return fetch(`/api/customer${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...options.headers,
        },
      });
    };
    const request = async (path = "", options = {}) => {
      const response = await authorizedFetch(path, options);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload.error?.replaceAll?.("_", " ") ??
            `Request failed (${response.status}).`,
        );
      }
      return payload;
    };
    const refresh = async () => {
      const current = ++generation;
      const identity = auth.snapshot();
      if (identity.loading) return publish({ phase: "loading", error: null });
      if (!identity.available)
        return publish({ phase: "unavailable", dashboard: null, error: null });
      if (!identity.signedIn)
        return publish({ phase: "signed-out", dashboard: null, error: null });
      if (!state.dashboard) publish({ phase: "loading", error: null });
      try {
        const dashboard = await request();
        if (current === generation)
          publish({ phase: "ready", dashboard, error: null });
      } catch (error) {
        if (current === generation)
          publish({ phase: "error", dashboard: null, error });
      }
    };
    const service = {
      snapshot: () => state,
      subscribe(subscriber) {
        subscribers.add(subscriber);
        subscriber(state);
        return () => subscribers.delete(subscriber);
      },
      fetch: authorizedFetch,
      request,
      refresh,
    };
    ctx.provide(customerKey, service);
    const unsubscribe = auth.subscribe(() => void refresh());
    return () => {
      generation++;
      unsubscribe();
      subscribers.clear();
    };
  },
};
